import { describe, expect, test } from 'bun:test';
import { cadenceLabel, isDue, nextOccurrence, nextRunAt } from './schedule.ts';

// local wall-clock dates: the cadence is read on this computer's clock
const local = (y: number, m: number, d: number, h = 0, min = 0, sec = 0) => new Date(y, m - 1, d, h, min, sec, 0);

describe('when a cadence falls next', () => {
  test('daily: today at the time when that is still ahead, else tomorrow', () => {
    expect(nextOccurrence({ kind: 'daily', at: '03:00' }, local(2026, 10, 21, 1, 0))).toEqual(local(2026, 10, 21, 3, 0));
    expect(nextOccurrence({ kind: 'daily', at: '03:00' }, local(2026, 10, 21, 3, 0))).toEqual(local(2026, 10, 22, 3, 0));
    expect(nextOccurrence({ kind: 'daily', at: '03:00' }, local(2026, 10, 31, 9, 0))).toEqual(local(2026, 11, 1, 3, 0));
  });
  test('weekly: the next such weekday, a week later when today’s time has passed', () => {
    // 2026-10-21 is a Wednesday
    expect(nextOccurrence({ kind: 'weekly', weekday: 1, at: '09:30' }, local(2026, 10, 21, 10, 0))).toEqual(local(2026, 10, 26, 9, 30));
    expect(nextOccurrence({ kind: 'weekly', weekday: 3, at: '09:30' }, local(2026, 10, 21, 8, 0))).toEqual(local(2026, 10, 21, 9, 30));
    expect(nextOccurrence({ kind: 'weekly', weekday: 3, at: '09:30' }, local(2026, 10, 21, 9, 30))).toEqual(local(2026, 10, 28, 9, 30));
    expect(nextOccurrence({ kind: 'weekly', weekday: 0, at: '06:00' }, local(2026, 10, 21, 0, 0))).toEqual(local(2026, 10, 25, 6, 0));
  });
  test('monthly: this month’s day when still ahead, else next month’s; day 28 exists in every month', () => {
    expect(nextOccurrence({ kind: 'monthly', day: 1, at: '06:00' }, local(2026, 10, 21, 0, 0))).toEqual(local(2026, 11, 1, 6, 0));
    expect(nextOccurrence({ kind: 'monthly', day: 25, at: '06:00' }, local(2026, 10, 21, 0, 0))).toEqual(local(2026, 10, 25, 6, 0));
    expect(nextOccurrence({ kind: 'monthly', day: 28, at: '06:00' }, local(2026, 1, 31, 0, 0))).toEqual(local(2026, 2, 28, 6, 0));
    expect(nextOccurrence({ kind: 'monthly', day: 1, at: '06:00' }, local(2026, 12, 15, 0, 0))).toEqual(local(2027, 1, 1, 6, 0));
  });
});

describe('when a schedule runs next', () => {
  const base = { enabled: true, cadence: { kind: 'daily' as const, at: '03:00' }, updatedAt: local(2026, 10, 21, 10, 0).toISOString(), lastRun: null };
  test('counts from the last run, else from when the schedule was last changed; a disabled one never', () => {
    expect(nextRunAt(base, local(2026, 10, 21, 12, 0))).toEqual(local(2026, 10, 22, 3, 0));
    expect(nextRunAt({ ...base, lastRun: { at: local(2026, 10, 22, 3, 0, 30).toISOString(), goalId: 'g', skipped: null } }, local(2026, 10, 22, 4, 0))).toEqual(local(2026, 10, 23, 3, 0));
    expect(nextRunAt({ ...base, enabled: false }, local(2026, 10, 21, 12, 0))).toBeNull();
  });
  test('a run missed while the engine was off is due at once, and only once', () => {
    // asleep from the 21st at night until the 23rd at 09:00: the 22nd 03:00 run is due now
    const now = local(2026, 10, 23, 9, 0);
    expect(isDue(base, now)).toBe(true);
    expect(nextRunAt(base, now)).toEqual(local(2026, 10, 22, 3, 0));
    // once it fired (late), the next one is tomorrow at 03:00, not the 23rd's slot that passed meanwhile
    const after = { ...base, lastRun: { at: now.toISOString(), goalId: 'g', skipped: null } };
    expect(isDue(after, local(2026, 10, 23, 9, 1))).toBe(false);
    expect(nextRunAt(after, local(2026, 10, 23, 9, 1))).toEqual(local(2026, 10, 24, 3, 0));
  });
  test('editing a schedule counts the cadence from the edit', () => {
    const edited = { ...base, updatedAt: local(2026, 10, 23, 12, 0).toISOString(), lastRun: { at: local(2026, 10, 22, 3, 0).toISOString(), goalId: 'g', skipped: null } };
    expect(nextRunAt(edited, local(2026, 10, 23, 12, 1))).toEqual(local(2026, 10, 24, 3, 0));
    expect(isDue(edited, local(2026, 10, 23, 12, 1))).toBe(false);
  });
});

test('a cadence in words', () => {
  expect(cadenceLabel({ kind: 'daily', at: '03:00' })).toBe('every day at 03:00');
  expect(cadenceLabel({ kind: 'weekly', weekday: 1, at: '09:30' })).toBe('every Monday at 09:30');
  expect(cadenceLabel({ kind: 'monthly', day: 1, at: '06:00' })).toBe('on the 1st of every month at 06:00');
  expect(cadenceLabel({ kind: 'monthly', day: 2, at: '06:00' })).toBe('on the 2nd of every month at 06:00');
  expect(cadenceLabel({ kind: 'monthly', day: 3, at: '06:00' })).toBe('on the 3rd of every month at 06:00');
  expect(cadenceLabel({ kind: 'monthly', day: 11, at: '06:00' })).toBe('on the 11th of every month at 06:00');
  expect(cadenceLabel({ kind: 'monthly', day: 22, at: '06:00' })).toBe('on the 22nd of every month at 06:00');
});
