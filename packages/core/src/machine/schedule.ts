import type { Schedule, ScheduleCadence } from '../schema/schedule.ts';
import { WEEKDAYS } from '../schema/schedule.ts';

const parseTime = (at: string): [number, number] => {
  const [h, m] = at.split(':').map(Number);
  return [h ?? 0, m ?? 0];
};
const atTime = (d: Date, at: string): Date => {
  const [h, m] = parseTime(at);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m, 0, 0);
};
const plusDays = (d: Date, n: number): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes(), 0, 0);

/** The first time the cadence falls strictly after `after`, on this computer's clock. */
export function nextOccurrence(c: ScheduleCadence, after: Date): Date {
  switch (c.kind) {
    case 'daily': {
      const today = atTime(after, c.at);
      return today > after ? today : plusDays(today, 1);
    }
    case 'weekly': {
      const today = atTime(after, c.at);
      const ahead = (c.weekday - today.getDay() + 7) % 7;
      const candidate = plusDays(today, ahead);
      return candidate > after ? candidate : plusDays(candidate, 7);
    }
    case 'monthly': {
      const [h, m] = parseTime(c.at);
      const thisMonth = new Date(after.getFullYear(), after.getMonth(), c.day, h, m, 0, 0);
      return thisMonth > after ? thisMonth : new Date(after.getFullYear(), after.getMonth() + 1, c.day, h, m, 0, 0);
    }
  }
}

/**
 * When a schedule fires next: the first occurrence after its last run, or after the schedule was last changed when no
 * run came later. A disabled schedule has no next run. A run the engine missed (asleep, off) is due at once, and only
 * once: the next one counts from that late run.
 */
export function nextRunAt(s: Pick<Schedule, 'enabled' | 'cadence' | 'updatedAt' | 'lastRun'>, now = new Date()): Date | null {
  if (!s.enabled) return null;
  const anchors = [Date.parse(s.updatedAt), s.lastRun ? Date.parse(s.lastRun.at) : Number.NEGATIVE_INFINITY].filter((t) => Number.isFinite(t));
  const after = new Date(Math.max(...anchors, Number.NEGATIVE_INFINITY) === Number.NEGATIVE_INFINITY ? now.getTime() : Math.max(...anchors));
  return nextOccurrence(s.cadence, after);
}

/** due = enabled and its next run is now or past */
export function isDue(s: Pick<Schedule, 'enabled' | 'cadence' | 'updatedAt' | 'lastRun'>, now = new Date()): boolean {
  const next = nextRunAt(s, now);
  return !!next && next.getTime() <= now.getTime();
}

/** "every day at 03:00", "every Monday at 09:30", "on the 1st of every month at 06:00" */
export function cadenceLabel(c: ScheduleCadence): string {
  switch (c.kind) {
    case 'daily':
      return `every day at ${c.at}`;
    case 'weekly':
      return `every ${WEEKDAYS[c.weekday]} at ${c.at}`;
    case 'monthly': {
      const n = c.day;
      const suffix = n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th';
      return `on the ${n}${suffix} of every month at ${c.at}`;
    }
  }
}
