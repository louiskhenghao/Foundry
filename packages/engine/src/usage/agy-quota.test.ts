import { expect, test } from 'bun:test';
import { AgyQuotaReader, parseAgyUsage } from './agy-quota.ts';

// `agy -p /usage --output-format json` on a real account (agy 1.4.4): the CLI answers it without a model turn
const REPORT = JSON.stringify({ conversation_id: '', status: 'SUCCESS', response: 'Gemini Models\tWeekly Limit Remaining\t43%\n', num_turns: 0, command: { name: 'usage', data: { description: 'Within each group, models share a weekly limit.', groups: [
  { name: 'Gemini Models', description: 'Models within this group: Gemini Flash, Gemini Pro', buckets: [{ id: 'gemini-weekly', name: 'Weekly Limit Remaining', window: 'weekly', remaining_fraction: 0.4286367893218994, reset_time: '2026-10-28T17:39:12Z' }] },
  { name: 'Claude and GPT models', description: 'Models within this group: Claude Opus, Claude Sonnet, GPT-OSS', buckets: [{ id: '3p-weekly', name: 'Weekly Limit Remaining', window: 'weekly', remaining_fraction: 1, reset_time: '2026-10-28T18:23:27Z' }] },
] } } });

test('the usage report becomes one group per shared limit, with what is left and when it resets', () => {
  const q = parseAgyUsage(REPORT, new Date('2026-10-21T18:00:00Z'));
  expect(q).toMatchObject({ state: 'available', error: null, checkedAt: '2026-10-21T18:00:00.000Z' });
  expect(q.groups.map((g) => g.name)).toEqual(['Gemini Models', 'Claude and GPT models']);
  expect(q.groups[0]!.buckets[0]).toEqual({ id: 'gemini-weekly', name: 'Weekly Limit Remaining', window: 'weekly', remainingFraction: 0.4286367893218994, resetTime: '2026-10-28T17:39:12Z' });
});

test('a failed, empty or unreadable report is unavailable, never a full quota', () => {
  expect(parseAgyUsage('not json')).toMatchObject({ state: 'unavailable', groups: [] });
  expect(parseAgyUsage(JSON.stringify({ status: 'ERROR', error: 'not signed in' }))).toMatchObject({ state: 'unavailable', error: 'not signed in' });
  expect(parseAgyUsage(JSON.stringify({ status: 'SUCCESS', command: { data: { groups: [] } } }))).toMatchObject({ state: 'unavailable', error: 'the usage report lists no quota' });
  // a fraction outside 0–1 is clamped, a missing one stays unknown
  const odd = parseAgyUsage(JSON.stringify({ status: 'SUCCESS', command: { data: { groups: [{ name: 'G', buckets: [{ id: 'a', remaining_fraction: 1.4 }, { id: 'b' }] }] } } }));
  expect(odd.groups[0]!.buckets.map((b) => b.remainingFraction)).toEqual([1, null]);
});

test('the reader runs agy once a minute at most, again when forced, and reports a failed run', async () => {
  const calls: string[][] = [];
  let code = 0;
  const reader = new AgyQuotaReader({ bin: () => '/bin/agy', run: (async (cmd: string[]) => { calls.push(cmd); return { code, stdout: REPORT, stderr: code ? 'agy: not signed in' : '' }; }) as never });
  expect(reader.current()).toBeNull();
  expect((await reader.read()).state).toBe('available');
  await reader.read();
  expect(calls).toHaveLength(1);
  expect(calls[0]!.slice(1, 5)).toEqual(['-p', '/usage', '--output-format', 'json']);
  code = 1;
  expect(await reader.read(true)).toMatchObject({ state: 'unavailable', error: 'agy: not signed in' });
  expect(calls).toHaveLength(2);
  expect(reader.current()?.state).toBe('unavailable');
  expect(await new AgyQuotaReader({ bin: () => null }).read()).toMatchObject({ state: 'unavailable', error: 'agy is not installed' });
});
