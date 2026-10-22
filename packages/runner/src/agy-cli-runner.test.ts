import { afterEach, describe, expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AGY_HOOKS_FILE, AgyCliRunner, agyEffort } from './agy-cli-runner.ts';
import { AgyStreamDecoder, agyUsage, decodeAgyLines } from './agy-stream-codec.ts';
import type { RunnerEvent } from './types.ts';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** a stand-in `agy`: runs the workspace hooks file the way the CLI would, then prints the scripted stream */
function fixture(opts: { git?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'foundry-agy-test-'));
  dirs.push(dir);
  if (opts.git) Bun.spawnSync(['git', 'init', '-q'], { cwd: dir });
  const bin = join(dir, 'agy');
  writeFileSync(bin, `#!${process.execPath}
const fs = require('node:fs'); const path = require('node:path');
const args = process.argv.slice(2);
const stdin = await Bun.stdin.text();
if (process.env.CHILD_PID) require('node:child_process').spawn(process.execPath, ['-e', "process.on('SIGTERM',()=>{});require('node:fs').writeFileSync(process.env.CHILD_PID,String(process.pid));setInterval(()=>{},1000)"], {stdio:'ignore',env:process.env});
const hooksPath = path.join(process.cwd(), '.agents/hooks.json');
const hooks = fs.existsSync(hooksPath) ? JSON.parse(fs.readFileSync(hooksPath, 'utf8')) : {};
const runHook = async (h, payload) => { const p = Bun.spawn(['sh', '-c', h.command], { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe', env: process.env }); p.stdin.write(JSON.stringify(payload)); p.stdin.end(); const out = await new Response(p.stdout).text(); await p.exited; return out.trim(); };
const entries = Object.entries(hooks).filter(([k]) => k.startsWith('foundry'));
const resumed = args.includes('--conversation');
if (!process.env.SKIP_HOOKS) for (const [, e] of entries) for (const h of [...(resumed ? [] : e.SessionStart ?? []), ...(e.PreInvocation ?? [])]) { if (!h.command) { console.error('invalid hook: command hook must specify command'); process.exit(1); } await runHook(h, { conversationId: 'c1', modelName: 'test-model', workspacePaths: [process.cwd()], transcriptPath: '/t', artifactDirectoryPath: '/a' }); }
const decisions = [];
for (const call of JSON.parse(process.env.TOOL_CALLS ?? '[]')) for (const [, e] of entries) for (const g of e.PreToolUse ?? []) for (const h of g.hooks) decisions.push(await runHook(h, { conversationId: 'c1', stepIdx: 1, toolCall: call }));
if (process.env.CAPTURE) fs.writeFileSync(process.env.CAPTURE, JSON.stringify({ args, stdin, hooks, decisions, schema: args.includes('--json-schema') ? JSON.parse(fs.readFileSync(args[args.indexOf('--json-schema') + 1], 'utf8')) : null }));
if (process.env.AGY_ERROR) console.error('AGY_ERROR: ' + process.env.AGY_ERROR);
for (const event of JSON.parse(process.env.EVENTS ?? '[]')) console.log(JSON.stringify(event));
if (process.env.HANG) await Bun.sleep(60000);
process.exit(Number(process.env.EXIT_CODE ?? 0));
`);
  chmodSync(bin, 0o755);
  return { dir, bin };
}
const usage = { input_tokens: 100, output_tokens: 10, thinking_tokens: 5, cache_read_tokens: 60, total_tokens: 110 };
const stream = [
  { event: 'init', conversation_id: 'c1', init: { cwd: '/w', tools: ['run_command', 'write_to_file'], permission_mode: 'always-proceed' } },
  { event: 'step_update', step_update: { conversation_id: 'c1', step_index: 0, state: 'DONE', step_type: 'user_input' } },
  { event: 'step_update', step_update: { conversation_id: 'c1', step_index: 1, state: 'DONE', step_type: 'tool', tool_name: 'run_command', duration_seconds: 0.1, tool_info: { name: 'run_command', parameters: { CommandLine: 'bun test' }, output: 'passed' } } },
  { event: 'step_update', step_update: { conversation_id: 'c1', step_index: 2, state: 'ACTIVE', step_type: 'agent_response', text_delta: '{"ok":' } },
  { event: 'step_update', step_update: { conversation_id: 'c1', step_index: 2, state: 'DONE', step_type: 'agent_response', text_delta: 'true}', usage } },
  { event: 'step_update', step_update: { conversation_id: 'c1', step_index: 3, state: 'DONE', step_type: 'checkpoint' } },
  { event: 'result', result: { conversation_id: 'c1', status: 'SUCCESS', response: '{"ok":true}', duration_seconds: 2, num_turns: 1, structured_output: { ok: true }, usage } },
];
async function collect(runner: AgyCliRunner, dir: string, extra: any = {}) {
  const h = await runner.run({ prompt: 'task', cwd: dir, timeoutMs: 3000, ...extra });
  const events: RunnerEvent[] = [];
  for await (const ev of h.events) events.push(ev);
  return { events, result: await h.result };
}

describe('Antigravity stream decoder', () => {
  test('joins the fragments of an answer, pairs a tool step with its output, passes the rest through', () => {
    const d = new AgyStreamDecoder();
    const out = stream.flatMap((m) => d.decode(m));
    expect(out.map((e) => e.kind)).toEqual(['init', 'tool_use', 'tool_result', 'text']);
    expect(out[0]).toMatchObject({ kind: 'init', sessionId: 'c1', tools: ['run_command', 'write_to_file'] });
    expect(out[1]).toMatchObject({ kind: 'tool_use', id: 'step-1', name: 'run_command', input: { CommandLine: 'bun test' } });
    expect(out[2]).toMatchObject({ kind: 'tool_result', toolUseId: 'step-1', isError: false, content: 'passed' });
    expect(out[3]).toMatchObject({ kind: 'text', text: '{"ok":true}' });
    expect(d.result).toMatchObject({ status: 'SUCCESS', num_turns: 1 });
    expect(d.decode({ event: 'something_new', x: 1 })).toMatchObject([{ kind: 'unknown' }]);
    expect(d.decode({ event: 'result', result: { status: 'ERROR', error: 'boom' } })).toMatchObject([{ kind: 'stderr', text: 'boom' }]);
    expect(decodeAgyLines(['not json', JSON.stringify(stream[0])]).map((e) => e.kind)).toEqual(['init']);
    expect(agyUsage(usage)).toEqual({ input_tokens: 40, cache_read_input_tokens: 60, output_tokens: 10, thinking_tokens: 5, total_tokens: 110 });
    expect(agyEffort('xhigh')).toBe('xhigh');
    expect(agyEffort('ultra')).toBe('max');
    expect(agyEffort('minimal')).toBe('low');
    expect(agyEffort(undefined)).toBeNull();
  });
});

describe('Antigravity CLI adapter', () => {
  test('the prompt with its role, the switches and the schema reach the CLI; the hooks file is there for the run and gone after it', async () => {
    const { dir, bin } = fixture({ git: true });
    const capture = join(dir, 'capture.json');
    const transcript = join(dir, 'transcript.jsonl');
    const runner = new AgyCliRunner({ agyBin: bin, env: { CAPTURE: capture, EVENTS: JSON.stringify(stream) } });
    const { events, result } = await collect(runner, dir, { model: 'gemini-3.8-flash-high', effort: 'xhigh', resumeSessionId: 'c0', appendSystemPrompt: 'Be brief.', jsonSchema: { type: 'object', properties: { ok: { type: 'boolean' } } }, allowedTools: ['Write', 'Read'], transcriptPath: transcript, label: 'attempt 1' });
    const got = JSON.parse(readFileSync(capture, 'utf8'));
    expect(got.args).toEqual(expect.arrayContaining(['--input-format', 'stream-json', '--output-format', 'stream-json', '--dangerously-skip-permissions', '--conversation', 'c0', '--model', 'gemini-3.8-flash-high', '--effort', 'xhigh', '--json-schema', expect.any(String), '--print-timeout', '2m']));
    expect(got.schema).toEqual({ type: 'object', properties: { ok: { type: 'boolean' } } });
    const sent = JSON.parse(got.stdin.trim());
    expect(sent).toMatchObject({ event: 'user', message: {} });
    expect(sent.message.content).toStartWith('# Role\n\nBe brief.');
    expect(sent.message.content).toContain('inside Foundry using the Antigravity CLI');
    expect(sent.message.content).toEndWith('# Task\n\ntask');
    const entry = Object.entries(got.hooks).find(([k]) => k.startsWith('foundry-'))![1] as any;
    // a session event's handler as it is, a tool event's under its matcher: agy refuses the whole file otherwise
    expect(entry.SessionStart[0]).toMatchObject({ type: 'command' });
    expect(entry.SessionStart[0].command).toStartWith("cat > '");
    // a resumed conversation starts no session: the canary is written before each invocation too (this run resumes c0)
    expect(entry.PreInvocation).toEqual(entry.SessionStart);
    expect(entry.PreToolUse[0]).toMatchObject({ matcher: '*' });
    expect(entry.PreToolUse[0].hooks[0].command).toContain('agy-guard.ts');
    expect(existsSync(join(dir, AGY_HOOKS_FILE))).toBe(false);
    expect(readFileSync(join(dir, '.git/info/exclude'), 'utf8')).toContain(AGY_HOOKS_FILE);
    expect(result).toMatchObject({ subtype: 'success', isError: false, sessionId: 'c1', numTurns: 1, costUsd: 0, costStatus: 'unavailable', structuredOutput: { ok: true }, finalText: '{"ok":true}', toolsUsed: { run_command: 1 } });
    expect(result.usage).toEqual({ input_tokens: 40, cache_read_input_tokens: 60, output_tokens: 10, thinking_tokens: 5, total_tokens: 110 });
    expect(result.modelUsage).toEqual({ 'test-model': result.usage });
    expect(events.map((e) => e.kind)).toEqual(['hook', 'init', 'tool_use', 'tool_result', 'text', 'result']);
    expect(events[1]).toMatchObject({ kind: 'init', model: 'test-model', ref: { file: 'transcript.jsonl', line: 0, block: 0 } });
    expect(readFileSync(transcript, 'utf8').trim().split('\n')).toHaveLength(stream.length);
  });

  test("a person's own hooks file keeps its entries during the run and comes back as it was", async () => {
    const { dir, bin } = fixture();
    mkdirSync(join(dir, '.agents'));
    const original = '{\n  "mine": { "PostToolUse": [] }\n}\n';
    writeFileSync(join(dir, AGY_HOOKS_FILE), original);
    const capture = join(dir, 'capture.json');
    const runner = new AgyCliRunner({ agyBin: bin, env: { CAPTURE: capture, EVENTS: JSON.stringify(stream) } });
    await collect(runner, dir);
    const seen = JSON.parse(readFileSync(capture, 'utf8')).hooks;
    expect(seen.mine).toEqual({ PostToolUse: [] });
    expect(Object.keys(seen).some((k) => k.startsWith('foundry-'))).toBe(true);
    expect(readFileSync(join(dir, AGY_HOOKS_FILE), 'utf8')).toBe(original);
  });

  test('a failed run, an empty answer, a structured error line and a nonzero exit are never mistaken for work', async () => {
    const { dir, bin } = fixture();
    const failed = [stream[0], { event: 'result', result: { conversation_id: 'c1', status: 'ERROR', response: '', error: 'boom', usage } }];
    expect((await collect(new AgyCliRunner({ agyBin: bin, env: { EVENTS: JSON.stringify(failed) } }), dir)).result).toMatchObject({ subtype: 'error_during_execution', isError: true, errorMessage: 'boom' });
    const empty = [stream[0], { event: 'result', result: { conversation_id: 'c1', status: 'SUCCESS', response: '', num_turns: 1, usage: { input_tokens: 0, output_tokens: 0, thinking_tokens: 0, cache_read_tokens: 0, total_tokens: 0 } } }];
    expect((await collect(new AgyCliRunner({ agyBin: bin, env: { EVENTS: JSON.stringify(empty) } }), dir)).result).toMatchObject({ subtype: 'error_during_execution', errorMessage: 'the Antigravity CLI returned an empty response' });
    // the line the real CLI writes when the account's quota is used up (agy 1.2.14, issue #1018)
    const quota = 'RESOURCE_EXHAUSTED (code 429): Individual quota reached. Please upgrade your subscription to increase your limits. Resets in 1h1m35s.';
    const cut = await collect(new AgyCliRunner({ agyBin: bin, env: { EVENTS: JSON.stringify([stream[0]]), EXIT_CODE: '3', AGY_ERROR: JSON.stringify({ short_error: quota, status: 'RESOURCE_EXHAUSTED', error_code: 429, code_kind: 'http', retryable: true }) } }), dir);
    expect(cut.result).toMatchObject({ subtype: 'error_during_execution', exitCode: 3, errorMessage: quota, failureClass: 'rate_limit' });
    const notJson = [...stream.slice(0, -1), { event: 'result', result: { conversation_id: 'c1', status: 'SUCCESS', response: 'not json', num_turns: 1, usage } }];
    expect((await collect(new AgyCliRunner({ agyBin: bin, env: { EVENTS: JSON.stringify(notJson) } }), dir, { jsonSchema: { type: 'object' } })).result).toMatchObject({ isError: true, errorMessage: 'the Antigravity CLI did not return valid structured JSON' });
  });

  test('missing hooks fail closed; a timeout and a spawn failure release the slot', async () => {
    const { dir, bin } = fixture();
    const noHooks = new AgyCliRunner({ agyBin: bin, env: { SKIP_HOOKS: '1', EVENTS: JSON.stringify(stream) } });
    const r = (await collect(noHooks, dir)).result;
    expect(r.isError).toBe(true);
    expect(r.errorMessage).toContain('SessionStart guard');
    const hang = new AgyCliRunner({ agyBin: bin, env: { HANG: '1', EVENTS: JSON.stringify([stream[0]]) } });
    expect((await collect(hang, dir, { timeoutMs: 1500 })).result.subtype).toBe('killed_timeout');
    expect(hang.active()).toBe(0);
    expect(hang.wouldQueue()).toBe(false);
    const missing = new AgyCliRunner({ agyBin: join(dir, 'no-such-agy') });
    expect((await collect(missing, dir)).result.subtype).toBe('spawn_error');
    expect(missing.wouldQueue()).toBe(false);
    expect(existsSync(join(dir, AGY_HOOKS_FILE))).toBe(false);
  }, 30_000);

  test.skipIf(process.platform === 'win32')('cancel stops owned tool descendants before releasing the session', async () => {
    const { dir, bin } = fixture();
    const pidFile = join(dir, 'child.pid');
    const runner = new AgyCliRunner({ agyBin: bin, env: { CHILD_PID: pidFile, HANG: '1', EVENTS: JSON.stringify([stream[0]]) } });
    const handle = await runner.run({ prompt: 'task', cwd: dir, timeoutMs: 5000 });
    for (let i = 0; !existsSync(pidFile) && i < 200; i++) await Bun.sleep(10);
    const pid = Number(readFileSync(pidFile, 'utf8'));
    handle.kill('killed_manual');
    expect((await handle.result).subtype).toBe('killed_manual');
    let alive = true;
    for (let i = 0; alive && i < 100; i++) {
      try {
        process.kill(pid, 0);
        await Bun.sleep(10);
      } catch {
        alive = false;
      }
    }
    expect(alive).toBe(false);
    expect(runner.active()).toBe(0);
  });

  test('a session without tools still hands over its answer: the finish tool passes, others do not', async () => {
    const { dir, bin } = fixture();
    const capture = join(dir, 'capture.json');
    const calls = [{ name: 'finish', args: { answer: '{"ok":true}' } }, { name: 'view_file', args: { AbsolutePath: 'a.txt' } }];
    const runner = new AgyCliRunner({ agyBin: bin, env: { CAPTURE: capture, TOOL_CALLS: JSON.stringify(calls), EVENTS: JSON.stringify(stream) } });
    await collect(runner, dir, { allowedTools: [], jsonSchema: { type: 'object' } });
    const decisions = JSON.parse(readFileSync(capture, 'utf8')).decisions.map((d: string) => (d ? JSON.parse(d) : null));
    expect(decisions[0]).toBeNull();
    expect(decisions[1]).toMatchObject({ decision: 'deny', reason: 'This Foundry session does not permit tools.' });
  });

  test('the guard keeps the boundary, a read-only role and the tool-call allowance', async () => {
    const { dir, bin } = fixture();
    const capture = join(dir, 'capture.json');
    const calls = [
      { name: 'run_command', args: { CommandLine: 'git push origin main', WaitMsBeforeAsync: 5000 } },
      { name: 'write_to_file', args: { TargetFile: 'a.txt' } },
      { name: 'view_file', args: { AbsolutePath: 'a.txt' } },
      { name: 'run_command', args: { CommandLine: 'bun test' } },
      { name: 'view_file', args: { AbsolutePath: 'b.txt' } },
      { name: 'invoke_subagent', args: { Task: 'do it for me' } },
    ];
    const runner = new AgyCliRunner({ agyBin: bin, env: { CAPTURE: capture, TOOL_CALLS: JSON.stringify(calls), EVENTS: JSON.stringify(stream) } });
    // one turn allows three calls; the read-only denial comes before the count, so the fourth counted call is refused
    const { result } = await collect(runner, dir, { allowedTools: ['Read'], maxTurns: 1 });
    const decisions = JSON.parse(readFileSync(capture, 'utf8')).decisions.map((d: string) => (d ? JSON.parse(d) : null));
    expect(decisions[0]).toMatchObject({ decision: 'deny' });
    expect(decisions[0].reason).toMatch(/push|boundary|worktree/i);
    expect(decisions[1]).toMatchObject({ decision: 'deny', reason: 'This Foundry role is read-only.' });
    expect(decisions[2]).toBeNull();
    expect(decisions[3]).toBeNull();
    expect(decisions[4]).toMatchObject({ decision: 'deny' });
    expect(decisions[4].reason).toContain('allowance');
    // Foundry runs the roles: no subagent of the CLI's own
    expect(decisions[5]).toMatchObject({ decision: 'deny', reason: 'Foundry runs the roles itself: do this work in this session.' });
    // cut by the allowance: continued by the attempt loop, like a --max-turns stop
    expect(result).toMatchObject({ subtype: 'error_max_turns', isError: true });
  });
});
