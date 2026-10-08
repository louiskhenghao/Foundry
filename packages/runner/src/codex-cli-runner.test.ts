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
if (process.env.CHILD_PID) require('node:child_process').spawn(process.execPath, ['-e', "process.on('SIGTERM',()=>{});require('node:fs').writeFileSync(process.env.CHILD_PID,String(process.pid));setInterval(()=>{},1000)"], {stdio:'ignore',env:process.env});
if (!process.env.SKIP_CANARY) fs.writeFileSync(policy.canary, JSON.stringify({hook_event_name:'SessionStart',model:'test-model'}));
if (process.env.TEST_GUARD) {
  const hook=Bun.spawn([process.execPath,process.env.TEST_GUARD],{stdin:'pipe',stdout:'pipe',stderr:'pipe',env:process.env});
  hook.stdin.write(JSON.stringify({tool_name:'mcp__example__search',tool_input:{token:'private-fixture-secret'}}));hook.stdin.end();
  await Promise.all([new Response(hook.stdout).text(),new Response(hook.stderr).text(),hook.exited]);
}
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
  test('native MCP denial reaches recovery metadata without storing tool arguments', async () => {
    const {dir,bin}=fixture();
    const runner=new CodexCliRunner({codexBin:bin,env:{TEST_GUARD:join(import.meta.dir,'../hooks/codex-guard.ts'),EVENTS:JSON.stringify(stream)}});
    const {result}=await collect(runner,dir,{allowedTools:['Read']});
    expect(result.permissionDenials).toEqual([{tool_name:'mcp__example__search',tool_input:{}}]);
    expect(JSON.stringify(result)).not.toContain('private-fixture-secret');
  });
  for (const action of ['cancel', 'timeout', 'shutdown'] as const) test.skipIf(process.platform === 'win32')(`${action} stops owned tool descendants before releasing the session`, async () => {
    const { dir, bin } = fixture();
    const pidFile = join(dir, 'child.pid');
    const runner = new CodexCliRunner({ codexBin: bin, env: { CHILD_PID: pidFile, HANG: '1' } });
    // Leave time for both native processes to start; the deadline must exercise cleanup after readiness.
    const handle = await runner.run({ prompt:'task',cwd:dir,timeoutMs:action === 'timeout' ? 2500 : 5000 });
    let pid: number | null = null;
    try {
      for (let i = 0; !existsSync(pidFile) && i < 200; i++) await Bun.sleep(10);
      pid = Number(readFileSync(pidFile, 'utf8'));
      if (action === 'cancel') handle.kill('killed_manual');
      if (action === 'shutdown') expect(runner.killAll()).toBe(1);
      const result = await handle.result;
      expect(result.subtype).toBe(action === 'timeout' ? 'killed_timeout' : 'killed_manual');
      let alive = true;
      for (let i = 0; alive && i < 100; i++) {
        try { process.kill(pid, 0); await Bun.sleep(10); } catch { alive = false; }
      }
      expect(alive).toBe(false);
      expect(runner.active()).toBe(0);
    } finally {
      handle.kill('killed_manual');
      if (pid) try { process.kill(pid, 'SIGKILL'); } catch {}
      await handle.result;
    }
  }, 8000);
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
    expect(invocation.args).toContain('model_reasoning_effort="max"');
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

test('strict MCP switches off every server config.toml defines, and only those', () => {
  const home = mkdtempSync(join(tmpdir(), 'foundry-codex-strict-'));
  try {
    writeFileSync(join(home, 'config.toml'), ['model = "x"', '[mcp_servers.gitnexus]', 'command = "gitnexus"', '[mcp_servers.gitnexus.env]', 'A = "1"', '[mcp_servers."odd name"]', 'url = "http://x"', '[plugins."p@m"]', 'enabled = true'].join('\n'));
    const runner = new CodexCliRunner({ codexHome: home });
    const files = { canary: '/tmp/canary', guard: '/tmp/guard' };
    const strict = runner.buildArgs({ prompt: 'x', cwd: '/tmp', strictMcp: true }, files).join(' ');
    expect(strict).toContain('mcp_servers.gitnexus.enabled=false');
    expect(strict).toContain('mcp_servers."odd name".enabled=false');
    expect(strict).not.toContain('mcp_servers.gitnexus.env');
    expect(runner.buildArgs({ prompt: 'x', cwd: '/tmp' }, files).join(' ')).not.toContain('mcp_servers.');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
