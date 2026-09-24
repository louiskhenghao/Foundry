import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { channelTranscript } from './transcripts.ts';

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
