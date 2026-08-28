/**
 * M0 spike 1: run a trivial prompt through ClaudeCliRunner with canary + boundary hooks,
 * print parsed events, verify hooks fired, dump RunResult.
 *
 *   bun scripts/spike-runner.ts [--setting-sources project] [--model haiku]
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ClaudeCliRunner, boundaryHook, buildSettings, canaryHook } from '../packages/runner/src/index.ts';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const model = flag('--model') ?? 'haiku';
const settingSources = flag('--setting-sources')?.split(',');

const hooksDir = resolve(import.meta.dir, '../packages/runner/hooks');
const cwd = mkdtempSync(join(tmpdir(), 'foundry-spike-'));
const runner = new ClaudeCliRunner({ maxConcurrent: 3, log: console.log });

const prompt = flag('--prompt') ?? 'Create a file named hello.txt containing the single word hello, then reply DONE.';
const settings = buildSettings([canaryHook(join(hooksDir, 'canary.sh')), boundaryHook(join(hooksDir, 'boundary-guard.sh'))]);

console.log('cwd:', cwd);
console.log('args:', runner.buildArgs({ prompt, cwd, model, settings, settingSources }).join(' '));

const handle = await runner.run({
  prompt,
  cwd,
  model,
  maxTurns: 6,
  maxBudgetUsd: 0.5,
  permissionMode: 'dontAsk',
  allowedTools: ['Bash', 'Write', 'Read', 'Edit'],
  settings,
  settingSources,
  transcriptPath: join(cwd, 'transcript.jsonl'),
  label: 'spike-runner',
});

const hooks: string[] = [];
let initRaw: any = null;
for await (const ev of handle.events) {
  switch (ev.kind) {
    case 'init':
      initRaw = ev.raw;
      console.log(`[init] session=${ev.sessionId} model=${ev.model} tools=${ev.tools.length}`);
      break;
    case 'hook':
      hooks.push(ev.name);
      console.log(`[hook] ${ev.name} ${ev.outcome ?? ''}`);
      break;
    case 'text':
      console.log(`[text] ${ev.text.slice(0, 200)}`);
      break;
    case 'tool_use':
      console.log(`[tool_use] ${ev.name} ${JSON.stringify(ev.input).slice(0, 160)}`);
      break;
    case 'tool_result':
      console.log(`[tool_result] error=${ev.isError} ${ev.content.slice(0, 160)}`);
      break;
    case 'rate_limit':
      console.log(`[rate_limit] ${ev.info.status} type=${ev.info.rateLimitType} resetsAt=${ev.info.resetsAt}`);
      break;
    case 'stderr':
      console.log(`[stderr] ${ev.text.trim().slice(0, 200)}`);
      break;
    case 'unknown':
      console.log(`[unknown] ${JSON.stringify(ev.raw).slice(0, 200)}`);
      break;
  }
}
const result = await handle.result;
console.log('\n=== RunResult ===');
console.log(JSON.stringify({ ...result, usage: undefined, modelUsage: Object.keys((result.modelUsage as object) ?? {}) }, null, 2));
console.log('\n=== hooks seen ===', hooks);
console.log('init keys:', initRaw ? Object.keys(initRaw) : null);
if (initRaw?.skills) console.log('init.skills count:', Array.isArray(initRaw.skills) ? initRaw.skills.length : initRaw.skills);
if (initRaw?.slash_commands) console.log('init.slash_commands count:', initRaw.slash_commands.length, 'sample:', initRaw.slash_commands.slice(0, 8));
const canaryFired = hooks.some((h) => h.startsWith('SessionStart'));
console.log(canaryFired ? '✅ SessionStart hook observed (settings accepted)' : '❌ no SessionStart hook observed — settings may have been ignored');
console.log('hello.txt exists:', await Bun.file(join(cwd, 'hello.txt')).exists());
