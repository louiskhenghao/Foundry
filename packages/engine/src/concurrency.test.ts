import { describe, expect, test } from 'bun:test';
import { autoConcurrency, fiveHourSignal, machineCap, windowHeld } from './concurrency.ts';

describe('auto concurrency (ADR-0103)', () => {
  test('half the cores, one session per 2 GB beyond the first 4, within 1 and 16', () => {
    expect(machineCap({ cpus: 18, memGB: 48 })).toBe(9);
    expect(machineCap({ cpus: 10, memGB: 16 })).toBe(5);
    expect(machineCap({ cpus: 8, memGB: 8 })).toBe(2);
    expect(machineCap({ cpus: 2, memGB: 4 })).toBe(1);
    expect(machineCap({ cpus: 64, memGB: 256 })).toBe(16);
  });
  test('a machine busier than its cores runs half as many', () => {
    expect(autoConcurrency({ cpus: 18, memGB: 48, load1: 12 })).toEqual({ cap: 9, busy: false, limit: 9 });
    expect(autoConcurrency({ cpus: 18, memGB: 48, load1: 24 })).toEqual({ cap: 9, busy: true, limit: 4 });
    expect(autoConcurrency({ cpus: 2, memGB: 4, load1: 9 }).limit).toBe(1);
  });
});

describe("the 5-hour window a session reports", () => {
  const resetsAt = Math.floor(Date.now() / 1000) + 3600;
  test('read from the unified windows, or from an event about that window', () => {
    expect(fiveHourSignal({ rateLimitType: 'seven_day', utilization: 0.82, unifiedWindows: { five_hour: { utilization: 0.93, resetsAt, status: 'allowed' } } })).toEqual({ utilization: 0.93, resetsAt });
    expect(fiveHourSignal({ rateLimitType: 'five_hour', utilization: 0.91, resetsAt })).toEqual({ utilization: 0.91, resetsAt });
    expect(fiveHourSignal({ rateLimitType: 'seven_day', utilization: 0.95, resetsAt })).toBeNull();
    expect(fiveHourSignal({ status: 'allowed' })).toBeNull();
    expect(fiveHourSignal(null)).toBeNull();
  });
  test('holds from 90% until the window resets', () => {
    expect(windowHeld({ utilization: 0.9, resetsAt })).toBe(true);
    expect(windowHeld({ utilization: 0.89, resetsAt })).toBe(false);
    expect(windowHeld({ utilization: 0.99, resetsAt: Math.floor(Date.now() / 1000) - 1 })).toBe(false);
    expect(windowHeld(null)).toBe(false);
  });
});
