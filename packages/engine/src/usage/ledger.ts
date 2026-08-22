import type { Database } from 'bun:sqlite';
import { listGoals, listRateLimitState, listUsageSince, type UsageRow } from '@ai-engine/core';
import type { UsageBucket, UsageSummary, WindowSummary } from './types.ts';

export type { UsageBucket, UsageSummary, WindowSummary };
export const FIVE_HOURS_MS = 5 * 3600_000;
export const SEVEN_DAYS_MS = 7 * 24 * 3600_000;
const HOUR = 3600_000;
const DAY = 24 * HOUR;

function sum(rows: UsageRow[]) {
  return rows.reduce(
    (a, r) => ({ sessions: a.sessions + 1, inputTokens: a.inputTokens + r.input_tokens, outputTokens: a.outputTokens + r.output_tokens, cacheReadTokens: a.cacheReadTokens + r.cache_read_tokens, cacheCreateTokens: a.cacheCreateTokens + r.cache_create_tokens, costUsd: a.costUsd + r.cost_usd }),
    { sessions: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreateTokens: 0, costUsd: 0 },
  );
}

/** Fixed-size buckets from `start` to `end` (empty ones included) — hourly for the 5h window, daily for 7d. */
export function bucketize(rows: UsageRow[], start: number, end: number, size: number, label: (t: number) => string): UsageBucket[] {
  const first = Math.floor(start / size) * size;
  const out: UsageBucket[] = [];
  for (let t = first; t < end; t += size) out.push({ t: new Date(t).toISOString(), label: label(t), sessions: 0, costUsd: 0, outputTokens: 0 });
  for (const r of rows) {
    const ts = Date.parse(r.ts);
    const i = Math.floor((ts - first) / size);
    const b = out[i];
    if (!b) continue;
    b.sessions++;
    b.costUsd += r.cost_usd;
    b.outputTokens += r.output_tokens;
  }
  return out;
}

const hourLabel = (t: number) => new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
const dayLabel = (t: number) => new Date(t).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' });

/**
 * Aggregate our own ledger into the two windows Claude subscriptions use. The 5-hour window is
 * aligned to the CLI's `resetsAt` when we have seen one; otherwise it is "the last 5 hours".
 */
export function usageSummary(db: Database, now = Date.now()): UsageSummary {
  const state = listRateLimitState(db);
  const five = state.find((s) => s.rate_limit_type === 'five_hour') ?? null;
  const week = state.find((s) => /seven_day|weekly/.test(s.rate_limit_type)) ?? null;

  const fiveEnd = five?.resets_at && five.resets_at * 1000 > now ? five.resets_at * 1000 : now;
  const fiveStart = Math.max(fiveEnd - FIVE_HOURS_MS, five?.resets_at && five.resets_at * 1000 > now ? fiveEnd - FIVE_HOURS_MS : now - FIVE_HOURS_MS);
  const weekEnd = week?.resets_at && week.resets_at * 1000 > now ? week.resets_at * 1000 : now;
  const weekStart = weekEnd - SEVEN_DAYS_MS;

  const rows = listUsageSince(db, new Date(Math.min(fiveStart, weekStart)).toISOString());
  const inWin = (start: number, end: number) => rows.filter((r) => Date.parse(r.ts) >= start && Date.parse(r.ts) <= end);
  const fiveRows = inWin(fiveStart, fiveEnd);
  const weekRows = inWin(weekStart, weekEnd);

  const mk = (label: string, start: number, end: number, st: typeof five, r: UsageRow[]): WindowSummary => ({
    label,
    windowStart: new Date(start).toISOString(),
    windowEnd: new Date(end).toISOString(),
    resetsAt: st?.resets_at ? new Date(st.resets_at * 1000).toISOString() : null,
    status: st?.status ?? null,
    isUsingOverage: !!st?.is_using_overage,
    lastSignalAt: st?.seen_at ?? null,
    ...sum(r),
  });

  const group = <K extends string | null>(key: (r: UsageRow) => K) => {
    const m = new Map<K, UsageRow[]>();
    for (const r of weekRows) m.set(key(r), [...(m.get(key(r)) ?? []), r]);
    return [...m.entries()].map(([k, rs]) => ({ key: k, rows: rs, ...sum(rs) })).sort((a, b) => b.costUsd - a.costUsd);
  };
  const avgDuration = (rs: UsageRow[]) => (rs.length ? Math.round(rs.reduce((a, r) => a + r.duration_ms, 0) / rs.length) : 0);

  const limitedState = state.find((s) => s.status !== 'allowed' && s.status !== 'allowed_warning' && s.resets_at && s.resets_at * 1000 > now) ?? null;
  const goals = new Map(listGoals(db).map((g) => [g.id, g]));
  const weekTotals = sum(weekRows);
  const input = weekTotals.inputTokens + weekTotals.cacheReadTokens;

  return {
    now: new Date(now).toISOString(),
    fiveHour: mk('5-hour window', fiveStart, fiveEnd, five, fiveRows),
    sevenDay: mk('7-day window', weekStart, weekEnd, week, weekRows),
    series: {
      hourly: bucketize(fiveRows, fiveStart, fiveEnd, HOUR, hourLabel),
      daily: bucketize(weekRows, weekStart, weekEnd, DAY, dayLabel),
    },
    byModel: group((r) => r.model ?? 'unknown').map((g) => ({ model: g.key as string, sessions: g.sessions, costUsd: g.costUsd, outputTokens: g.outputTokens })),
    byGoal: group((r) => r.goal_id)
      .slice(0, 10)
      .map((g) => ({ goalId: g.key, title: g.key ? (goals.get(g.key)?.title ?? null) : null, state: g.key ? (goals.get(g.key)?.state ?? null) : null, sessions: g.sessions, costUsd: g.costUsd })),
    byKind: group((r) => r.kind).map((g) => ({ kind: g.key as string, sessions: g.sessions, costUsd: g.costUsd, avgDurationMs: avgDuration(g.rows) })),
    totals: {
      cacheHitRate: input > 0 ? weekTotals.cacheReadTokens / input : null,
      avgCostPerSession: weekRows.length ? weekTotals.costUsd / weekRows.length : null,
      avgDurationMs: weekRows.length ? avgDuration(weekRows) : null,
      errorSessions: weekRows.filter((r) => r.subtype !== 'success').length,
    },
    limited: limitedState ? { rateLimitType: limitedState.rate_limit_type, until: new Date(limitedState.resets_at! * 1000).toISOString() } : null,
    note: 'Counts only sessions started by ai-engine on this machine. Subscription plans expose no usage API; for exact percentages run /usage inside Claude Code.',
  };
}
