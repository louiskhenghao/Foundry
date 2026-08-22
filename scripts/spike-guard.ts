/**
 * M0 spike 2: boundary guard + permission denial.
 *  - starts a tiny callback server
 *  - asks claude to `git push` (must be blocked by the PreToolUse hook AND hit the callback)
 *  - asks claude to use Write while only Bash is allowed under dontAsk (must show in permission_denials)
 *
 *   bun scripts/spike-guard.ts
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ClaudeCliRunner, boundaryHook, buildSettings, canaryHook } from '../packages/runner/src/index.ts';

const hooksDir = resolve(import.meta.dir, '../packages/runner/hooks');
const cwd = mkdtempSync(join(tmpdir(), 'ai-engine-guard-'));
await Bun.$`git -C ${cwd} init -q && git -C ${cwd} commit -q --allow-empty -m init`.quiet();

const callbacks: any[] = [];
const server = Bun.serve({
  port: 0,
  hostname: '127.0.0.1',
  async fetch(req) {
    if (new URL(req.url).pathname === '/internal/boundary') {
      callbacks.push({ attempt: req.headers.get('x-ai-engine-attempt'), body: await req.json() });
      return new Response('ok');
    }
    return new Response('nf', { status: 404 });
  },
});
const callbackUrl = `http://127.0.0.1:${server.port}`;
const runner = new ClaudeCliRunner({ maxConcurrent: 2, env: { AI_ENGINE_CALLBACK: callbackUrl }, log: console.log });
const settings = buildSettings([canaryHook(join(hooksDir, 'canary.sh')), boundaryHook(join(hooksDir, 'boundary-guard.sh'))]);

async function run(label: string, prompt: string, allowedTools: string[]) {
  const h = await runner.run({
    prompt,
    cwd,
    model: 'haiku',
    maxTurns: 4,
    maxBudgetUsd: 0.3,
    permissionMode: 'dontAsk',
    allowedTools,
    settings,
    env: { AI_ENGINE_ATTEMPT_ID: label },
    label,
  });
  for await (const ev of h.events) {
    if (ev.kind === 'tool_use') console.log(`[${label}] tool_use ${ev.name} ${JSON.stringify(ev.input).slice(0, 120)}`);
    if (ev.kind === 'tool_result') console.log(`[${label}] tool_result error=${ev.isError} ${ev.content.slice(0, 140).replace(/\n/g, ' ')}`);
    if (ev.kind === 'text') console.log(`[${label}] text ${ev.text.slice(0, 120)}`);
  }
  const r = await h.result;
  console.log(`[${label}] subtype=${r.subtype} cost=$${r.costUsd.toFixed(4)} denials=${JSON.stringify(r.permissionDenials).slice(0, 300)}`);
  return r;
}

const [push, denial] = await Promise.all([
  run('push', 'Using the Bash tool, run exactly: git push origin main . If the tool call is blocked, reply with the single word BLOCKED. Otherwise reply DONE.', ['Bash']),
  run('denial', 'Use the Write tool to create a file named note.txt with content "x". If you cannot, reply with the single word DENIED.', ['Bash']),
]);

server.stop(true);
console.log('\n=== verdicts ===');
console.log(callbacks.length > 0 ? `✅ boundary callback received (${callbacks.length}) attempt=${callbacks[0]?.attempt}` : '❌ no boundary callback received');
console.log(push.finalText?.includes('BLOCKED') ? '✅ model reported BLOCKED' : `❌ model said: ${push.finalText}`);
console.log(denial.permissionDenials.length > 0 ? `✅ permission_denials observable under dontAsk: ${denial.permissionDenials.map((d) => d.tool_name)}` : `❌ no permission_denials (finalText=${denial.finalText})`);
