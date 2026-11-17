import { afterEach, describe, expect, test } from 'bun:test';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ClaudeCliRunner } from './claude-cli-runner.ts';

describe('ClaudeCliRunner arguments', () => {
  test('a workflow suite is loaded with --plugin-dir, one per directory', () => {
    const runner = new ClaudeCliRunner({ claudeBin: '/bin/true' });
    const args = runner.buildArgs({ prompt: 'x', cwd: '/tmp', pluginDirs: ['/suites/pstack/plugin'] });
    expect(args.slice(args.indexOf('--plugin-dir'), args.indexOf('--plugin-dir') + 2)).toEqual(['--plugin-dir', '/suites/pstack/plugin']);
    expect(runner.buildArgs({ prompt: 'x', cwd: '/tmp' })).not.toContain('--plugin-dir');
  });
  test('MCP servers handed to a session come as --mcp-config, beside the CLI\'s own', () => {
    const runner = new ClaudeCliRunner({ claudeBin: '/bin/true' });
    const args = runner.buildArgs({ prompt: 'x', cwd: '/tmp', mcpConfig: { mcpServers: { docs: { type: 'http', url: 'https://example.com/mcp' } } } });
    expect(JSON.parse(args[args.indexOf('--mcp-config') + 1]!)).toEqual({ mcpServers: { docs: { type: 'http', url: 'https://example.com/mcp' } } });
    expect(runner.buildArgs({ prompt: 'x', cwd: '/tmp' })).not.toContain('--mcp-config');
  });
  test('strictMcp loads no MCP servers; without it the CLI keeps its own', () => {
    const runner = new ClaudeCliRunner({ claudeBin: '/bin/true' });
    expect(runner.buildArgs({ prompt: 'x', cwd: '/tmp', strictMcp: true })).toContain('--strict-mcp-config');
    expect(runner.buildArgs({ prompt: 'x', cwd: '/tmp' })).not.toContain('--strict-mcp-config');
  });
});

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'foundry-runner-'));
  dirs.push(d);
  return d;
};
/** a stand-in CLI that prints the given stream-json lines and exits with `code` */
function fakeCli(dir: string, lines: object[], code = 0): string {
  const out = join(dir, 'session.jsonl');
  writeFileSync(out, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  const bin = join(dir, 'fake-cli');
  writeFileSync(bin, `#!/bin/sh\ncat '${out}'\nexit ${code}\n`);
  chmodSync(bin, 0o755);
  return bin;
}
const SID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const init = { type: 'system', subtype: 'init', session_id: SID, model: 'claude-opus-5-5', tools: [] };
const counts = (output: number) => ({ input_tokens: 2, output_tokens: output, cache_read_input_tokens: 1000, cache_creation_input_tokens: 50 });
const assistant = (id: string, output: number, extra: object = {}) => ({ type: 'assistant', message: { id, model: 'claude-opus-5-5', usage: counts(output), content: [{ type: 'text', text: 'hi' }] }, ...extra });
async function run(runner: ClaudeCliRunner, cwd: string) {
  const handle = await runner.run({ prompt: 'x', cwd });
  for await (const _ of handle.events) void _;
  return handle.result;
}

describe('a session on an added account', () => {
  test('runs with the account\'s home as its config dir, whatever the engine\'s own', async () => {
    const dir = tmp();
    const capture = join(dir, 'home.txt');
    const out = join(dir, 'session.jsonl');
    writeFileSync(out, JSON.stringify(init) + '\n');
    const bin = join(dir, 'fake-cli');
    writeFileSync(bin, `#!/bin/sh\nprintf '%s|%s' "$CLAUDE_CONFIG_DIR" "$CLAUDE_CODE_OAUTH_TOKEN" > '${capture}'\ncat '${out}'\n`);
    chmodSync(bin, 0o755);
    // the machine's sign-in may come as a token (claude setup-token): it must not take the account's place
    const runner = new ClaudeCliRunner({ claudeBin: bin, claudeHome: join(dir, 'native'), env: { CLAUDE_CONFIG_DIR: join(dir, 'native'), CLAUDE_CODE_OAUTH_TOKEN: 'native-token' } });
    const run = async (configHome?: string) => {
      const handle = await runner.run({ prompt: 'x', cwd: dir, configHome });
      for await (const _ of handle.events) void _;
      await handle.result;
      return readFileSync(capture, 'utf8');
    };
    expect(await run(join(dir, 'acc_1'))).toBe(`${join(dir, 'acc_1')}|`);
    expect(await run()).toBe(`${join(dir, 'native')}|native-token`);
  });
});

describe('a session that ends without a result line', () => {
  test('is unmeasured: turns and tokens counted from the stream, cost unknown rather than zero', async () => {
    const dir = tmp();
    // one message arrives as two lines (two content blocks); a helper agent's message is not a turn
    const bin = fakeCli(dir, [init, assistant('m1', 6), assistant('m1', 6), assistant('m2', 6, { parent_tool_use_id: 'toolu_1' })]);
    const r = await run(new ClaudeCliRunner({ claudeBin: bin, claudeHome: join(dir, 'no-such-home') }), dir);
    expect(r.subtype).toBe('no_result');
    expect(r.costStatus).toBe('unavailable');
    expect(r.costUsd).toBe(0);
    expect(r.numTurns).toBe(1);
    expect(r.context).toEqual({ turns: 1, tokens: 1052, first: 1052 });
    expect(r.usage).toEqual({ input_tokens: 4, output_tokens: 12, cache_read_input_tokens: 2000, cache_creation_input_tokens: 100 });
    expect(r.modelUsage).toEqual({ 'claude-opus-5-5': { inputTokens: 4, outputTokens: 12, cacheReadInputTokens: 2000, cacheCreationInputTokens: 100 } });
    expect(r.sessionId).toBe(SID);
  });
  test("takes the final counts from the session's own record when Claude Code left one", async () => {
    const dir = tmp();
    const home = join(dir, 'home');
    const proj = join(home, 'projects', '-Users-x-repo');
    mkdirSync(proj, { recursive: true });
    writeFileSync(join(proj, `${SID}.jsonl`), JSON.stringify(assistant('m1', 710, { isSidechain: false })) + '\n');
    const bin = fakeCli(dir, [init, assistant('m1', 6)]);
    const r = await run(new ClaudeCliRunner({ claudeBin: bin, claudeHome: home }), dir);
    expect(r.costStatus).toBe('unavailable');
    expect(r.numTurns).toBe(1);
    expect(r.usage).toEqual({ input_tokens: 2, output_tokens: 710, cache_read_input_tokens: 1000, cache_creation_input_tokens: 50 });
  });
  test("a result line keeps the CLI's own figures and says the cost was reported", async () => {
    const dir = tmp();
    const bin = fakeCli(dir, [init, assistant('m1', 6), { type: 'result', subtype: 'success', is_error: false, result: 'done', session_id: SID, total_cost_usd: 0.42, num_turns: 3, usage: { input_tokens: 9 } }]);
    const r = await run(new ClaudeCliRunner({ claudeBin: bin, claudeHome: join(dir, 'no-such-home') }), dir);
    expect(r.subtype).toBe('success');
    expect(r.costStatus).toBe('reported');
    expect(r.costUsd).toBe(0.42);
    expect(r.numTurns).toBe(3);
    expect(r.usage).toEqual({ input_tokens: 9 });
    // what its turns read comes from the stream either way
    expect(r.context).toEqual({ turns: 1, tokens: 1052, first: 1052 });
  });
  test('a CLI that died before any session started has nothing unknown about it: nothing ran', async () => {
    const dir = tmp();
    const bin = fakeCli(dir, [], 1);
    const r = await run(new ClaudeCliRunner({ claudeBin: bin, claudeHome: join(dir, 'no-such-home') }), dir);
    expect(r.subtype).toBe('error_during_execution');
    expect(r.costStatus).toBe('reported');
    expect(r.numTurns).toBe(0);
    expect(r.usage).toBeNull();
  });
});

describe('partial messages (ADR-0073)', () => {
  test('partialText asks the CLI for them; a plain run does not', () => {
    const runner = new ClaudeCliRunner({ claudeBin: 'claude' });
    expect(runner.buildArgs({ prompt: 'x', cwd: '/tmp', partialText: true })).toContain('--include-partial-messages');
    expect(runner.buildArgs({ prompt: 'x', cwd: '/tmp' })).not.toContain('--include-partial-messages');
  });
});

describe('the idle limit', () => {
  const toolUse = { type: 'assistant', message: { id: 'm1', model: 'claude-opus-5-5', usage: counts(3), content: [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'bun test' } }] } };
  const toolResult = { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'ok' }] } };
  const done = { type: 'result', subtype: 'success', is_error: false, result: 'done', session_id: SID, total_cost_usd: 0.1, num_turns: 2, usage: { input_tokens: 9 } };
  /** a stand-in CLI that prints the lines before the pause, waits `pauseS` seconds with nothing on its stream, then prints the rest */
  function pausingCli(dir: string, before: object[], after: object[], pauseS: number): string {
    const a = join(dir, 'before.jsonl');
    const b = join(dir, 'after.jsonl');
    writeFileSync(a, before.map((l) => JSON.stringify(l)).join('\n') + '\n');
    writeFileSync(b, after.map((l) => JSON.stringify(l)).join('\n') + '\n');
    const bin = join(dir, 'fake-cli');
    writeFileSync(bin, `#!/bin/sh\ncat '${a}'\nsleep ${pauseS}\ncat '${b}'\n`);
    chmodSync(bin, 0o755);
    return bin;
  }
  test('a tool call under way is not idleness: a command that outlives the limit ends the session normally', async () => {
    const dir = tmp();
    // the limit is short and the pause well past it; both leave room for the shell to start, which counts as silence too
    const bin = pausingCli(dir, [init, toolUse], [toolResult, done], 2.5);
    const r = await run(new ClaudeCliRunner({ claudeBin: bin, claudeHome: join(dir, 'home'), defaultIdleTimeoutMs: 1200 }), dir);
    expect(r.subtype).toBe('success');
    expect(r.toolsUsed).toEqual({ Bash: 1 });
  });
  test('silence while no tool call is under way is idleness: the session is stopped', async () => {
    const dir = tmp();
    const bin = pausingCli(dir, [init, assistant('m1', 6)], [done], 2.5);
    const r = await run(new ClaudeCliRunner({ claudeBin: bin, claudeHome: join(dir, 'home'), defaultIdleTimeoutMs: 1200 }), dir);
    expect(r.subtype).toBe('killed_idle');
    expect(r.costStatus).toBe('unavailable');
  });
});
