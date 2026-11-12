import { describe, expect, test } from 'bun:test';
import { agyMeters, claudeMeters, codexMeters, fmtReset, meterLevel, metersSummary, resetIn } from './account-meters.ts';
import type { ClaudeUsage } from './types.ts';

const claude = (over: Partial<Extract<ClaudeUsage, { state: 'available' }>> = {}): ClaudeUsage => ({ state: 'available', checkedAt: '2026-11-11T10:00:00Z', fiveHour: null, sevenDay: { usedPercent: 53, resetsAt: '2026-11-14T02:00:00Z' }, models: [{ name: 'Fable', usedPercent: 11, resetsAt: '2026-11-14T02:00:00Z' }], extraUsage: null, ...over });

describe('account meters (ADR-0090)', () => {
  test('Claude: Session first (0% with a word when no window is open), the week over all models, one row per model, extra usage only when it is on', () => {
    const m = claudeMeters(claude());
    if (m.state !== 'available') throw new Error(m.state);
    expect(m.meters.map((x) => [x.title, x.window, x.usedPercent])).toEqual([['Session', '5-hour rolling window', 0], ['All models', 'Weekly', 53], ['Fable', 'Weekly', 11]]);
    expect(m.meters[0]!.note).toContain('No active session');
    expect(m.meters[1]!.resetsAt).toBe('2026-11-14T02:00:00Z');
    const extra = claudeMeters(claude({ fiveHour: { usedPercent: 12, resetsAt: '2026-11-11T15:42:00Z' }, extraUsage: { usedPercent: 6.17, used: 12.34, limit: 200, currency: 'USD' } }));
    if (extra.state !== 'available') throw new Error(extra.state);
    expect(extra.meters[0]).toMatchObject({ title: 'Session', usedPercent: 12, note: null });
    expect(extra.meters.at(-1)).toMatchObject({ title: 'Extra usage', window: 'Monthly', usedPercent: 6.17, note: '$12.34 of $200.00' });
  });

  test('Codex: windows named by their length, as the quota card names them; blocked ordinary usage is said once for the account', () => {
    const m = codexMeters({ state: 'available', checkedAt: 'c', ordinaryUsageAllowed: false, buckets: [{ id: 'codex', label: 'codex', primary: { usedPercent: 38, windowDurationMins: 10080, resetsAt: 1_800_000_000 }, secondary: { usedPercent: 90, windowDurationMins: 300, resetsAt: null } }] });
    if (m.state !== 'available') throw new Error(m.state);
    expect(m.meters.map((x) => [x.title, x.window, x.usedPercent, x.resetsAt])).toEqual([['All models', 'Weekly', 38, new Date(1_800_000_000_000).toISOString()], ['Session', '5-hour rolling window', 90, null]]);
    expect(m.note).toBe('Codex reports ordinary usage as blocked.');
    const two = codexMeters({ state: 'available', checkedAt: 'c', ordinaryUsageAllowed: true, buckets: [{ id: 'a', label: 'Alpha', primary: { usedPercent: 1, windowDurationMins: 1440, resetsAt: null }, secondary: null }, { id: 'b', label: '', primary: null, secondary: null }] });
    if (two.state !== 'available') throw new Error(two.state);
    expect(two.meters.map((x) => [x.title, x.window])).toEqual([['Alpha · Daily', 'Daily limit']]);
    expect(two.note).toBeNull();
  });

  test('Antigravity: what is left becomes what is used, one row per group', () => {
    const m = agyMeters({ state: 'available', checkedAt: 'c', error: null, groups: [{ name: 'Gemini Models', description: null, buckets: [{ id: 'g', name: 'Weekly Limit Remaining', window: 'weekly', remainingFraction: 0.4286, resetTime: '2026-11-18T07:49:43Z' }] }, { name: 'Claude and GPT models', description: null, buckets: [{ id: 'c', name: 'Weekly Limit Remaining', window: 'weekly', remainingFraction: null, resetTime: null }] }] });
    if (m.state !== 'available') throw new Error(m.state);
    expect(m.meters.map((x) => [x.title, x.window, x.usedPercent, x.resetsAt])).toEqual([['Gemini Models', 'Weekly', 57.1, '2026-11-18T07:49:43Z'], ['Claude and GPT models', 'Weekly', null, null]]);
  });

  test('not read, unavailable and an error stay words, never bars', () => {
    expect(claudeMeters(undefined)).toEqual({ state: 'unread', checkedAt: null });
    expect(codexMeters(null)).toEqual({ state: 'unread', checkedAt: null });
    expect(claudeMeters({ state: 'unavailable', checkedAt: 'c', message: 'Sign in to Claude Code to read its usage.' })).toEqual({ state: 'unavailable', checkedAt: 'c', message: 'Sign in to Claude Code to read its usage.' });
    expect(codexMeters({ state: 'error', checkedAt: 'c', message: 'boom' })).toMatchObject({ state: 'error', message: 'boom' });
    expect(agyMeters({ state: 'unavailable', checkedAt: 'c', error: 'agy is not installed', groups: [] })).toMatchObject({ state: 'unavailable', message: 'agy is not installed' });
  });

  test('levels: amber from half, red from 85%, the same for every coding agent; unknown stays unknown', () => {
    expect([0, 49.9, 50, 84.9, 85, 100, null].map(meterLevel)).toEqual(['ok', 'ok', 'warn', 'warn', 'bad', 'bad', 'unknown']);
  });

  test('one line for the top bar and the terminal', () => {
    expect(metersSummary(claudeMeters(claude()))).toBe('Session 0% · All models 53% · Fable 11%');
    expect(metersSummary(claudeMeters(undefined))).toBe('usage not read yet');
    expect(metersSummary(claudeMeters({ state: 'error', checkedAt: 'c', message: 'x' }))).toBe('usage unavailable');
    expect(metersSummary(codexMeters({ state: 'available', checkedAt: 'c', ordinaryUsageAllowed: true, buckets: [] }))).toBe('no usage window reported');
  });

  test('a reset is said as a time today, tomorrow, or on a date, and as how far off it is', () => {
    const now = new Date(2026, 10, 11, 10, 0, 0);
    expect(fmtReset(new Date(2026, 10, 11, 15, 42).toISOString(), now)).toMatch(/^Resets today \d{1,2}:42/);
    expect(fmtReset(new Date(2026, 10, 12, 9, 0).toISOString(), now)).toMatch(/^Resets tomorrow /);
    expect(fmtReset(new Date(2026, 10, 14, 10, 0).toISOString(), now)).toMatch(/^Resets (?!today|tomorrow)\S+ 14, /);
    expect(fmtReset(null, now)).toBeNull();
    expect(fmtReset('never', now)).toBeNull();
    expect(resetIn(new Date(now.getTime() + 125 * 60_000).toISOString(), now.getTime())).toBe('in 2h 5m');
    expect(resetIn(new Date(now.getTime() + 20 * 60_000).toISOString(), now.getTime())).toBe('in 20m');
    expect(resetIn(new Date(now.getTime() + 3 * 86_400_000).toISOString(), now.getTime())).toBe('in 3d 0h');
    expect(resetIn(new Date(now.getTime() - 1).toISOString(), now.getTime())).toBeNull();
  });
});
