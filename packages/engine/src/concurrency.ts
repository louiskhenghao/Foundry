/**
 * Auto concurrency (ADR-0103): how many agent sessions run at once when Settings → Concurrency is Auto, read from the
 * machine rather than typed in — half its cores, and one session for every 2 GB of memory beyond the first 4, at least
 * one and at most sixteen; half that while the machine is busier than its cores can carry (the load average over the
 * last minute above the core count). A coding agent whose current account has used most of its 5-hour window runs one
 * task at a time until the window resets, so a limit cuts one session rather than every one running (windowHeld).
 */
import { availableParallelism, loadavg, totalmem } from 'node:os';

export interface Machine {
  cpus: number;
  memGB: number;
  /** the load average over the last minute (0 on Windows, where there is none) */
  load1: number;
}
export const MAX_SESSIONS = 16;
/** the share of the 5-hour window from which a coding agent runs one task at a time */
export const WINDOW_HOLD_AT = 0.9;

export function readMachine(): Machine {
  return { cpus: availableParallelism(), memGB: totalmem() / 2 ** 30, load1: loadavg()[0] ?? 0 };
}

/** the sessions this machine carries: half its cores, one per 2 GB beyond the first 4, within 1 and MAX_SESSIONS */
export function machineCap(m: Pick<Machine, 'cpus' | 'memGB'>): number {
  return Math.max(1, Math.min(MAX_SESSIONS, Math.floor(m.cpus / 2), Math.floor((m.memGB - 4) / 2)));
}

export interface AutoConcurrency {
  /** the sessions that may run now */
  limit: number;
  /** what the machine carries when it is not busy */
  cap: number;
  /** the load average is above the core count: the limit is half the cap */
  busy: boolean;
}
export function autoConcurrency(m: Machine): AutoConcurrency {
  const cap = machineCap(m);
  const busy = m.load1 > m.cpus;
  return { cap, busy, limit: busy ? Math.max(1, Math.floor(cap / 2)) : cap };
}

/** how much of its 5-hour window an account had used when a session last said, and when the window resets */
export interface WindowSignal {
  /** 0–1 */
  utilization: number;
  /** epoch seconds */
  resetsAt: number;
}

/**
 * The 5-hour window a Claude Code session's last rate-limit event reported: its `unifiedWindows.five_hour`, or the event
 * itself when it was about that window. null when it said nothing about it (another window, no utilization).
 */
export function fiveHourSignal(raw: unknown): WindowSignal | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { rateLimitType?: unknown; utilization?: unknown; resetsAt?: unknown; unifiedWindows?: { five_hour?: { utilization?: unknown; resetsAt?: unknown } } };
  const w = r.unifiedWindows?.five_hour ?? (r.rateLimitType === 'five_hour' ? r : null);
  if (!w || typeof w.utilization !== 'number' || typeof w.resetsAt !== 'number') return null;
  return { utilization: w.utilization, resetsAt: w.resetsAt };
}

/** why a coding agent runs one task at a time now, for the task drawer and the goal's activity */
export const windowHoldReason = (w: WindowSignal): string =>
  `the 5-hour usage window is ${Math.round(w.utilization * 100)}% used: one task at a time until it resets (Concurrency: Auto), so the limit cuts one session rather than several`;

/** the window is used up to WINDOW_HOLD_AT or more and has not reset yet */
export function windowHeld(s: WindowSignal | null | undefined, now = Date.now()): s is WindowSignal {
  return !!s && s.utilization >= WINDOW_HOLD_AT && s.resetsAt * 1000 > now;
}
