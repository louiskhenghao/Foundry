/** Browser-safe (no runtime imports beyond the usage types). Exported as `@foundry/engine/account-meters`. */
import { codexQuotaWindows } from './quota-windows.ts';
import type { AgyQuota, ClaudeUsage, CodexQuota } from './types.ts';

/**
 * How far one usage window of an account is used, as every account row shows it (ADR-0090): one bar per window, the
 * same words and thresholds for every coding agent. Claude's windows come from its own usage report, Codex's from its
 * quota, Antigravity's from agy.
 */
export interface AccountMeter {
  id: string;
  /** what the window covers: Session, All models, a model's name, a group of models, Extra usage */
  title: string;
  /** how long it is: "5-hour rolling window", "Weekly", "Monthly" */
  window: string;
  /** 0–100 used; null when the report does not say (shown as unknown, never as an empty bar) */
  usedPercent: number | null;
  /** when it resets (ISO), when the report says */
  resetsAt: string | null;
  /** a word beside the figure: "No active session", what extra usage has spent of its cap */
  note: string | null;
}

export type MeterLevel = 'ok' | 'warn' | 'bad' | 'unknown';
/** the same thresholds for every coding agent: a bar turns amber at half, red near the end */
export const METER_WARN_PERCENT = 50;
export const METER_BAD_PERCENT = 85;
export const meterLevel = (usedPercent: number | null): MeterLevel => (usedPercent == null ? 'unknown' : usedPercent >= METER_BAD_PERCENT ? 'bad' : usedPercent >= METER_WARN_PERCENT ? 'warn' : 'ok');

export type AccountMeters =
  | { state: 'available'; checkedAt: string; meters: AccountMeter[]; /** a word about the whole account: Codex reporting ordinary usage as blocked */ note: string | null }
  | { state: 'unread'; checkedAt: null }
  | { state: 'unavailable' | 'error'; checkedAt: string; message: string };

const UNREAD: AccountMeters = { state: 'unread', checkedAt: null };
const clamp = (n: number) => Math.max(0, Math.min(100, n));
const fmtMoney = (n: number, currency: string | null) => `${currency === 'USD' || !currency ? '$' : `${currency} `}${n.toFixed(2)}`;

/** Claude's windows: the session one is drawn at 0% when none is open (a figure, not a missing card) */
export function claudeMeters(u?: ClaudeUsage | null): AccountMeters {
  if (!u) return UNREAD;
  if (u.state !== 'available') return { state: u.state, checkedAt: u.checkedAt, message: u.message };
  const meters: AccountMeter[] = [
    { id: 'five_hour', title: 'Session', window: '5-hour rolling window', usedPercent: u.fiveHour ? clamp(u.fiveHour.usedPercent) : 0, resetsAt: u.fiveHour?.resetsAt ?? null, note: u.fiveHour ? null : 'No active session · starts with your next session' },
    ...(u.sevenDay ? [{ id: 'seven_day', title: 'All models', window: 'Weekly', usedPercent: clamp(u.sevenDay.usedPercent), resetsAt: u.sevenDay.resetsAt, note: null }] : []),
    ...u.models.map((m, i) => ({ id: `model_${i}`, title: m.name, window: 'Weekly', usedPercent: clamp(m.usedPercent), resetsAt: m.resetsAt, note: null })),
    ...(u.extraUsage ? [{ id: 'extra_usage', title: 'Extra usage', window: 'Monthly', usedPercent: u.extraUsage.usedPercent == null ? null : clamp(u.extraUsage.usedPercent), resetsAt: null, note: u.extraUsage.limit != null ? `${fmtMoney(u.extraUsage.used ?? 0, u.extraUsage.currency)} of ${fmtMoney(u.extraUsage.limit, u.extraUsage.currency)}` : null }] : []),
  ];
  return { state: 'available', checkedAt: u.checkedAt, meters, note: null };
}

/** Codex's windows, named by their length as the quota card names them (5-hour → Session, weekly → All models) */
export function codexMeters(q?: CodexQuota | null): AccountMeters {
  if (!q) return UNREAD;
  if (q.state !== 'available') return { state: q.state, checkedAt: q.checkedAt, message: q.message };
  const many = q.buckets.length > 1;
  const meters = q.buckets.flatMap((b) =>
    codexQuotaWindows(b).map(({ slot, window, label }) => {
      const mins = window.windowDurationMins;
      const title = mins === 300 ? 'Session' : mins === 10080 ? 'All models' : label.replace(/ limit$/, '');
      return {
        id: `${b.id}:${slot}`,
        title: many ? `${b.label || b.id} · ${title}` : title,
        window: mins === 300 ? '5-hour rolling window' : mins === 10080 ? 'Weekly' : label,
        usedPercent: window.usedPercent == null || !Number.isFinite(window.usedPercent) ? null : clamp(window.usedPercent),
        resetsAt: window.resetsAt == null || !Number.isFinite(window.resetsAt) ? null : new Date(window.resetsAt * 1000).toISOString(),
        note: null,
      };
    }),
  );
  return { state: 'available', checkedAt: q.checkedAt, meters, note: q.ordinaryUsageAllowed === false ? 'Codex reports ordinary usage as blocked.' : null };
}

/** Antigravity's groups: agy reports what is left, the bar shows what is used */
export function agyMeters(q?: AgyQuota | null): AccountMeters {
  if (!q) return UNREAD;
  if (q.state !== 'available') return { state: 'unavailable', checkedAt: q.checkedAt, message: q.error ?? 'agy reported no quota.' };
  const meters = q.groups.flatMap((g) => g.buckets.map((b) => ({ id: `${g.name}:${b.id || b.name}`, title: g.name, window: b.window === 'weekly' || !b.window ? 'Weekly' : b.window, usedPercent: b.remainingFraction == null ? null : Math.round((1 - b.remainingFraction) * 1000) / 10, resetsAt: b.resetTime, note: null })));
  return { state: 'available', checkedAt: q.checkedAt, meters, note: null };
}

/** one line for a tooltip or a terminal: "Session 0% · All models 53% · Fable 11%" */
export function metersSummary(m: AccountMeters): string {
  if (m.state === 'unread') return 'usage not read yet';
  if (m.state !== 'available') return 'usage unavailable';
  return m.meters.length ? m.meters.map((x) => `${x.title} ${x.usedPercent == null ? 'unknown' : `${Math.round(x.usedPercent)}%`}`).join(' · ') : 'no usage window reported';
}

/** "Resets today 3:42 PM", "Resets tomorrow 10:00 AM", "Resets Nov 14, 10:00 AM" (the viewer's locale and zone) */
export function fmtReset(iso: string | null, now = new Date()): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const tomorrow = new Date(now.getTime() + 86_400_000);
  if (d.toDateString() === now.toDateString()) return `Resets today ${time}`;
  if (d.toDateString() === tomorrow.toDateString()) return `Resets tomorrow ${time}`;
  return `Resets ${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`;
}

/** "in 2h 5m" while the reset is ahead, else null */
export function resetIn(iso: string | null, now = Date.now()): string | null {
  const ms = iso ? Date.parse(iso) - now : 0;
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const m = Math.round(ms / 60_000);
  if (m < 60) return `in ${m}m`;
  const h = Math.floor(m / 60);
  return h < 48 ? `in ${h}h ${m % 60}m` : `in ${Math.floor(h / 24)}d ${h % 24}h`;
}
