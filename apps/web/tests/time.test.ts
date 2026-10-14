import { expect, test } from 'bun:test';
import { clock, stamp } from '../src/time.ts';

test("times read in this computer's time zone, not UTC", () => {
  const iso = '2026-10-09T08:08:53Z';
  const d = new Date(iso);
  const two = (n: number) => String(n).padStart(2, '0');
  expect(clock(iso)).toBe(`${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`);
  expect(stamp(iso)).toBe(`${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`);
  expect(clock('not a date')).toBe('not a date');
});

test('in a zone away from UTC the clock moves with it', () => {
  // Bun reads TZ at each Date call: Kuala Lumpur is UTC+8 all year
  const prev = process.env.TZ;
  process.env.TZ = 'Asia/Kuala_Lumpur';
  try {
    expect(clock('2026-10-09T08:08:53Z')).toBe('16:08:53');
    expect(stamp('2026-10-09T23:30:00Z')).toBe('2026-10-10 07:30');
  } finally {
    process.env.TZ = prev;
  }
});
