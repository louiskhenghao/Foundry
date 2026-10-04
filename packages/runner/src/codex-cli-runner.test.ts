import { afterEach, describe, expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodexCliRunner, codexOutputSchema } from './codex-cli-runner.ts';
import { decodeLine } from './stream-codec.ts';
import type { RunnerEvent } from './types.ts';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'foundry-codex-test-')); dirs.push(dir);
  const bin = join(dir, 'codex');
  writeFileSync(bin, `#!${process.execPath}
const args = process.argv.slice(2);
const fs = require('node:fs');
const policy = JSON.parse(fs.readFileSync(process.env.FOUNDRY_CODEX_POLICY, 'utf8'));
if (!process.env.SKIP_CANARY) fs.writeFileSync(policy.canary, JSON.stringify({hook_event_name:'SessionStart',model:'test-model'}));
if (process.env.CAPTURE) fs.writeFileSync(process.env.CAPTURE, JSON.stringify({args, prompt:await Bun.stdin.text(), policy, schema:args.includes('--output-schema') ? JSON.parse(fs.readFileSync(args[args.indexOf('--output-schema')+1],'utf8')) : null}));
for(const event of JSON.parse(process.env.EVENTS ?? '[]')) console.log(JSON.stringify(event));
if(process.env.HANG) await Bun.sleep(60000);
process.exit(Number(process.env.EXIT_CODE ?? 0));
`);
  chmodSync(bin, 0o755);
  return { dir, bin };
}
const stream = [
  { type: 'thread.started', thread_id: 's1' }, { type: 'turn.started' },
  { type: 'item.started', item: { id: 'cmd', type: 'command_execution', command: 'bun test' } },
  { type: 'item.completed', item: { id: 'cmd', type: 'command_execution', aggregated_output: 'passed', exit_code: 0, status: 'completed' } },
  { type: 'item.completed', item: { id: 'msg', type: 'agent_message', text: '{"ok":true}' } },
  { type: 'turn.completed', usage: { input_tokens: 100, cached_input_tokens: 60, output_tokens: 10 } },
];
async function collect(runner: CodexCliRunner, dir: string, extra: any = {}) {
  const h = await runner.run({ prompt: 'task', cwd: dir, timeoutMs: 3000, ...extra });
  const events: RunnerEvent[] = []; for await (const ev of h.events) events.push(ev);
  return { events, result: await h.result };
}

describe('Codex CLI adapter', () => {
  test('structured output, actual model, usage and raw transcript references survive resume', async () => {
    const { dir, bin } = fixture();
    const capture = join(dir, 'capture.json'); const transcriptPath = join(dir, 'run.jsonl');
    const runner = new CodexCliRunner({ codexBin: bin, env: { EVENTS: JSON.stringify(stream), CAPTURE: capture } });
    const spec = { model: 'codex-default', allowedTools: ['Read'], effort: 'max', transcriptPath, jsonSchema: { type: 'object', properties: { ok: { type: 'boolean' } } } };
    const first = await collect(runner, dir, spec);
    expect(first.result).toMatchObject({ subtype: 'success', isError: false, structuredOutput: { ok: true }, sessionId: 's1', costStatus: 'unavailable', usage: { input_tokens: 40, cache_read_input_tokens: 60, output_tokens: 10 } });
    expect(first.events.filter((e) => e.kind === 'init')[0]).toMatchObject({ model: 'test-model' });
    expect(first.events[0]?.kind).toBe('hook');
    const second = await collect(runner, dir, { ...spec, resumeSessionId: 's1' });
    const init = second.events.find((e) => e.kind === 'init')!;
    expect(init.ref?.line).toBe(stream.length);
    const text = second.events.find((e) => e.kind === 'text')!;
    const lines = readFileSync(transcriptPath, 'utf8').split('\n');
    expect(decodeLine(lines[text.ref!.line]!)[text.ref!.block]).toEqual({ kind: 'text', text: '{"ok":true}' });
    const invocation = JSON.parse(readFileSync(capture, 'utf8'));
    expect(invocation.args.slice(0, 3)).toEqual(['exec', 'resume', 's1']);
    expect(invocation.args).not.toContain('--model');
    expect(invocation.args).toContain('model_reasoning_effort="xhigh"');
    expect(invocation.args).toContain('sandbox_mode="read-only"');
    expect(invocation.schema.required).toEqual(['ok']);
    expect(invocation.prompt).toBe('task');
    expect(existsSync(invocation.policy.canary)).toBe(false);
    expect(runner.active()).toBe(0);
  });
  test('failure, bad JSON and nonzero exit cannot be mistaken for successful work', async () => {
    const { dir, bin } = fixture();
    for (const [events, exit, schema] of [
      [[{ type: 'thread.started', thread_id: 's' }, { type: 'turn.failed', error: { message: 'model not found' } }], '1', false],
      [stream.map((e) => e.type === 'item.completed' && e.item?.type === 'agent_message' ? { ...e, item: { ...e.item, text: 'not json' } } : e), '0', true],
      [stream, '7', false],
    ] as const) {
      const runner = new CodexCliRunner({ codexBin: bin, env: { EVENTS: JSON.stringify(events), EXIT_CODE: exit } });
      const { result } = await collect(runner, dir, schema ? { jsonSchema: { type: 'object' } } : {});
      expect(result.isError).toBe(true);
    }
  });
  test('missing hooks fail closed; timeout and spawn failure release concurrency slots', async () => {
    const { dir, bin } = fixture();
    const missing = new CodexCliRunner({ codexBin: bin, maxConcurrent: 1, env: { EVENTS: JSON.stringify(stream), SKIP_CANARY: '1' } });
    expect((await collect(missing, dir, { timeoutMs: 80 })).result.isError).toBe(true);
    expect(missing.active()).toBe(0);
    const runner = new CodexCliRunner({ codexBin: bin, maxConcurrent: 1, env: { HANG: '1' } });
    expect((await collect(runner, dir, { timeoutMs: 80 })).result.subtype).toBe('killed_timeout');
    expect((await collect(runner, dir, { timeoutMs: 80 })).result.subtype).toBe('killed_timeout');
    expect(runner.active()).toBe(0);
    const absent = new CodexCliRunner({ codexBin: join(dir, 'missing') });
    expect((await collect(absent, dir)).result.subtype).toBe('spawn_error');
    expect((await collect(absent, dir)).result.subtype).toBe('spawn_error');
  });
  test('worker sandbox and role instructions map without Claude CLI flags', () => {
    const runner = new CodexCliRunner();
    const args = runner.buildArgs({ prompt: 'x', cwd: '/tmp', model: 'gpt-test', permissionMode: 'dontAsk', allowedTools: ['Write'], appendSystemPrompt: 'WORKER', agents: { planner: { description: 'plan', prompt: 'PLANNER' } } }, { canary: '/tmp/canary', guard: '/tmp/guard' });
    expect(args).toContain('sandbox_mode="workspace-write"');
    expect(args).toContain('sandbox_workspace_write.network_access=true');
    expect(args.some((a) => a.includes('WORKER') && a.includes('PLANNER'))).toBe(true);
    expect(args).not.toContain('--agents');
    expect(args).not.toContain('--dangerously-bypass-approvals-and-sandbox');
  });
  test('strict schema normalization preserves nullable unions and nested object shapes', () => {
    const result = codexOutputSchema({ type: 'object', properties: { child: { anyOf: [{ type: 'null' }, { type: 'object', properties: { count: { type: 'number', default: 2 } } }] } } });
    expect(result.required).toEqual(['child']);
    expect(result.properties.child.anyOf[1]).toEqual({ type: 'object', properties: { count: { type: 'number' } }, required: ['count'], additionalProperties: false });
  });
});
