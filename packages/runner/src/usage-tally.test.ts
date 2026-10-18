import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UsageTally, assistantUsage, readSessionRecord } from './usage-tally.ts';

const counts = (output: number, over: Partial<Record<string, number>> = {}) => ({ input_tokens: 2, output_tokens: output, cache_read_input_tokens: 100, cache_creation_input_tokens: 50, ...over });
const line = (id: string, usage: object, extra: object = {}, model: string | null = 'claude-opus-5-5') => ({ type: 'assistant', message: { id, model, usage, content: [{ type: 'text', text: 'hi' }] }, ...extra });

describe('assistantUsage', () => {
  test("reads a message's id, model, counts and whether a helper agent sent it", () => {
    expect(assistantUsage(line('m1', counts(6)))).toEqual({ id: 'm1', model: 'claude-opus-5-5', subagent: false, usage: counts(6) });
    expect(assistantUsage(line('m2', counts(3), { parent_tool_use_id: 'toolu_1' }))!.subagent).toBe(true);
    expect(assistantUsage(line('m3', counts(3), { isSidechain: true }))!.subagent).toBe(true);
    expect(assistantUsage(line('m4', { output_tokens: 3, input_tokens: -1, cache_read_input_tokens: 'x' }, {}, null))).toEqual({ id: 'm4', model: null, subagent: false, usage: { input_tokens: 0, output_tokens: 3, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } });
  });
  test('anything else is null: other message types, a message without id or usage, junk', () => {
    expect(assistantUsage({ type: 'user', message: { id: 'x', usage: {} } })).toBeNull();
    expect(assistantUsage({ type: 'assistant', message: { content: [], usage: {} } })).toBeNull();
    expect(assistantUsage({ type: 'assistant', message: { id: 'x' } })).toBeNull();
    expect(assistantUsage(null)).toBeNull();
    expect(assistantUsage('text')).toBeNull();
  });
});

describe('UsageTally', () => {
  test('counts each message once however many lines it came in, the largest count per field winning', () => {
    const t = new UsageTally();
    // the stream: one line per content block, each with the message's opening usage
    t.add(assistantUsage(line('m1', counts(6)))!);
    t.add(assistantUsage(line('m1', counts(6)))!);
    // the session's own record: the final count
    t.add(assistantUsage(line('m1', counts(710)))!);
    t.add(assistantUsage(line('m2', counts(20, { input_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 10 }), { parent_tool_use_id: 'toolu_1' }, 'claude-haiku-5-5'))!);
    expect(t.messages).toBe(2);
    // helper agents' messages are not turns of the main conversation
    expect(t.turns()).toBe(1);
    expect(t.totals()).toEqual({ input_tokens: 3, output_tokens: 730, cache_read_input_tokens: 100, cache_creation_input_tokens: 60 });
    expect(t.byModel()).toEqual({
      'claude-opus-5-5': { inputTokens: 2, outputTokens: 710, cacheReadInputTokens: 100, cacheCreationInputTokens: 50 },
      'claude-haiku-5-5': { inputTokens: 1, outputTokens: 20, cacheReadInputTokens: 0, cacheCreationInputTokens: 10 },
    });
    // no costUSD anywhere: unknown is not zero
    expect(Object.values(t.byModel()).some((m) => 'costUSD' in m)).toBe(false);
  });
  test('a message once seen from a helper agent stays one; a model learnt late is kept', () => {
    const t = new UsageTally();
    t.add(assistantUsage(line('m1', counts(1), {}, null))!);
    t.add(assistantUsage(line('m1', counts(9), { isSidechain: true }))!);
    expect(t.turns()).toBe(0);
    expect(t.byModel()).toEqual({ 'claude-opus-5-5': { inputTokens: 2, outputTokens: 9, cacheReadInputTokens: 100, cacheCreationInputTokens: 50 } });
  });
  test('empty: nothing counted', () => {
    const t = new UsageTally();
    expect(t.messages).toBe(0);
    expect(t.turns()).toBe(0);
    expect(t.totals()).toEqual({ input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 });
    expect(t.byModel()).toEqual({});
  });
});

describe('readSessionRecord', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const SID = '11111111-2222-3333-4444-555555555555';
  const home = () => {
    const h = mkdtempSync(join(tmpdir(), 'foundry-claude-home-'));
    dirs.push(h);
    return h;
  };

  test("finds the session's main record and its helper agents' under whichever project folder, final counts included", () => {
    const h = home();
    const proj = join(h, 'projects', '-Users-x-repo');
    mkdirSync(join(h, 'projects', '-Users-x-other'), { recursive: true });
    mkdirSync(join(proj, SID, 'subagents'), { recursive: true });
    writeFileSync(join(proj, `${SID}.jsonl`), [JSON.stringify({ type: 'user', message: { role: 'user', content: 'go' } }), JSON.stringify(line('m1', counts(710), { isSidechain: false })), JSON.stringify(line('m1', counts(710), { isSidechain: false })), 'not json', ''].join('\n'));
    writeFileSync(join(proj, SID, 'subagents', 'agent-abc.jsonl'), [JSON.stringify(line('m2', counts(2))), JSON.stringify(line('m2', counts(8737)))].join('\n'));
    writeFileSync(join(proj, SID, 'subagents', 'agent-abc.meta.json'), '{"agentType":"Explore"}');
    const recs = readSessionRecord(h, SID);
    expect(recs.map((r) => [r.id, r.subagent, r.usage.output_tokens])).toEqual([
      ['m1', false, 710],
      ['m1', false, 710],
      ['m2', true, 2],
      ['m2', true, 8737],
    ]);
    const t = new UsageTally();
    t.addAll(recs);
    expect(t.turns()).toBe(1);
    expect(t.totals().output_tokens).toBe(710 + 8737);
  });
  test('nothing when the home, the session or a well-formed id is missing', () => {
    const h = home();
    expect(readSessionRecord(h, SID)).toEqual([]);
    mkdirSync(join(h, 'projects', 'p'), { recursive: true });
    expect(readSessionRecord(h, SID)).toEqual([]);
    expect(readSessionRecord(h, '../../etc/passwd')).toEqual([]);
    expect(readSessionRecord(h, '')).toEqual([]);
  });
});
