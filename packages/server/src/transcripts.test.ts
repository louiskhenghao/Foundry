import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SLIM_LIMITS, channelTranscript, readHistory, readTranscriptEvent, slimEvent } from './transcripts.ts';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function dataDir(files: Record<string, number>) {
  const d = mkdtempSync(join(tmpdir(), 'foundry-transcripts-'));
  dirs.push(d);
  mkdirSync(join(d, 'transcripts'));
  for (const [name, age] of Object.entries(files)) {
    const p = join(d, 'transcripts', name);
    writeFileSync(p, '{}\n');
    const t = Date.now() / 1000 - age;
    utimesSync(p, t, t);
  }
  return d;
}

describe('the transcript behind a live channel', () => {
  test('a channel saved under its own name, such as a goal review round', () => {
    const d = dataDir({ 'goal-review-g_1-0.jsonl': 5, 'goal-review-g_2-0.jsonl': 1 });
    expect(channelTranscript(d, 'goal-review-g_1-0')).toBe(join(d, 'transcripts', 'goal-review-g_1-0.jsonl'));
    expect(channelTranscript(d, 'goal-review-g_1-1')).toBeNull();
  });
  test("the Brief page's draft channel is the newest Draft or Revise session of that goal only", () => {
    const d = dataDir({ 'draft-g_1-1.jsonl': 30, 'revise-g_1-1.jsonl': 10, 'draft-g_1-2.jsonl': 20, 'draft-g_10-1.jsonl': 1 });
    expect(channelTranscript(d, 'draft-g_1')).toBe(join(d, 'transcripts', 'revise-g_1-1.jsonl'));
    expect(channelTranscript(d, 'draft-g_3')).toBeNull();
  });
  test('refuses anything that could leave the transcripts folder', () => {
    expect(channelTranscript(dataDir({}), '../settings')).toBeNull();
  });
});

describe('full live-log events, read back from the transcript', () => {
  const long = 'x'.repeat(4000);
  const lines = [
    JSON.stringify({ type: 'system', subtype: 'init', session_id: 's', model: 'm', tools: [] }),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'thinking', thinking: `think ${long}` }, { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }] } }),
    JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', is_error: false, content: `out ${long}` }] } }),
    'not json: the CLI printed a warning',
    JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: '## Done\n\nAll of it.', session_id: 's' }),
  ];
  function withTranscript(name: string) {
    const d = dataDir({});
    writeFileSync(join(d, 'transcripts', name), lines.join('\n') + '\n');
    return d;
  }

  test('the history is slimmed like the live feed, keeps stderr and names each line', () => {
    const d = withTranscript('a_1.jsonl');
    const events = readHistory(join(d, 'transcripts', 'a_1.jsonl'));
    expect(events.map((e) => e.kind)).toEqual(['init', 'thinking', 'tool_use', 'tool_result', 'stderr', 'result']);
    const thinking = events[1] as { text: string; truncated?: boolean; ref?: unknown };
    expect(thinking.text.length).toBe(SLIM_LIMITS.thinking);
    expect(thinking.truncated).toBe(true);
    expect(thinking.ref).toEqual({ file: 'a_1.jsonl', line: 1, block: 0 });
    expect(events[2]!.ref).toEqual({ file: 'a_1.jsonl', line: 1, block: 1 });
    expect((events[3] as { content: string }).content.length).toBe(SLIM_LIMITS.tool_result);
    expect(events[4]!.truncated).toBeUndefined();
    expect(readHistory(join(d, 'transcripts', 'a_1.jsonl'), 2).map((e) => e.kind)).toEqual(['stderr', 'result']);
  });

  test('a ref reads the whole event back', () => {
    const d = withTranscript('goal-review-g_1-0.jsonl');
    const thinking = readTranscriptEvent(d, 'goal-review-g_1-0.jsonl', 1, 0);
    expect(thinking).toMatchObject({ kind: 'thinking', text: `think ${long}` });
    expect(readTranscriptEvent(d, 'goal-review-g_1-0.jsonl', 2, 0)).toMatchObject({ kind: 'tool_result', content: `out ${long}` });
    expect(readTranscriptEvent(d, 'goal-review-g_1-0.jsonl', 4, 0)).toMatchObject({ kind: 'result' });
  });

  test('a missing file, line or block, or a name outside the transcripts folder, is null', () => {
    const d = withTranscript('a_1.jsonl');
    expect(readTranscriptEvent(d, 'a_2.jsonl', 1, 0)).toBeNull();
    expect(readTranscriptEvent(d, 'a_1.jsonl', 99, 0)).toBeNull();
    expect(readTranscriptEvent(d, 'a_1.jsonl', 1, 5)).toBeNull();
    expect(readTranscriptEvent(d, 'a_1.jsonl', -1, 0)).toBeNull();
    expect(readTranscriptEvent(d, 'a_1.jsonl', Number.NaN, 0)).toBeNull();
    expect(readTranscriptEvent(d, '../a_1.jsonl', 1, 0)).toBeNull();
    expect(readTranscriptEvent(d, 'settings.json', 0, 0)).toBeNull();
  });

  test('short events pass through the live feed untouched, unknowns are dropped', () => {
    expect(slimEvent({ kind: 'thinking', text: 'short' })).toEqual({ kind: 'thinking', text: 'short' });
    expect(slimEvent({ kind: 'unknown', raw: {} })).toBeNull();
  });
});
