/**
 * Reports (ADR-0060): what Foundry cost and did over a window, from its own records — the usage ledger and the goals,
 * tasks, attempts and Briefs — by project and by session kind: the spend over time, each project's goals, dollars,
 * hours, retry rate and estimate error, each kind's share, and the goals whose estimates missed most. Goals count by
 * when they were created, sessions by when they ran. Read on request, nothing stored; the Usage page's seven days and
 * account limits stay where they are.
 */
import { basename } from 'node:path';
import { calibrate, listAttemptsByGoal, listGoals, listTasks, listUsageSince, type EstimateSample, type Goal, type UsageRow, reportsDollars } from '@foundry/core';
import { budgetStatus } from './budget.ts';
import { estimateSamples } from './calibration.ts';
import type { Engine } from './engine.ts';
import type { Report, ReportBucket, ReportEstimate, ReportGoals, ReportKind, ReportMiss, ReportRepo, ReportRetries, ReportSpend } from './usage/types.ts';

const DAY = 86_400_000;
const FINISHED = new Set<Goal['state']>(['done', 'over_delivered']);
/** tasks that mend something after the fact, as opposed to the Brief's own tasks and the merge syncs */
const FIX_ORIGINS = new Set(['goal-review-fix', 'delivery-fix', 'feedback-fix', 'audit-fix', 'likeness-fix', 'review-fix', 'qa-fix']);
/** the windows the page offers, in days; `null` is all time */
export const REPORT_WINDOWS: (number | null)[] = [30, 90, 365, null];
/** how many estimate misses are shown */
const MISSES = 8;

const claude = (r: UsageRow) => (r.provider ?? 'claude') === 'claude';
const spend = (rows: UsageRow[]): ReportSpend => ({
  sessions: rows.length,
  costUsd: rows.reduce((a, r) => a + (claude(r) ? r.cost_usd : 0), 0),
  unmeasured: rows.filter((r) => claude(r) && r.cost_status === 'unavailable').length,
  codexSessions: rows.filter((r) => !claude(r)).length,
  durationMs: rows.reduce((a, r) => a + r.duration_ms, 0),
});
const goalCounts = (goals: Goal[]): ReportGoals => ({
  total: goals.length,
  finished: goals.filter((g) => FINISHED.has(g.state)).length,
  failed: goals.filter((g) => g.state === 'failed').length,
  cancelled: goals.filter((g) => g.state === 'cancelled').length,
  open: goals.filter((g) => !FINISHED.has(g.state) && g.state !== 'failed' && g.state !== 'cancelled').length,
});

/** work attempts per task: a task that took more than one was retried; merge attempts are syncs, not retries */
function retries(engine: Engine, goals: Goal[]): ReportRetries {
  const db = engine.store.db;
  let tasks = 0;
  let retried = 0;
  let attempts = 0;
  let fixTasks = 0;
  for (const g of goals) {
    const byTask = new Map<string, number>();
    for (const a of listAttemptsByGoal(db, g.id)) if (a.kind === 'work') byTask.set(a.taskId, (byTask.get(a.taskId) ?? 0) + 1);
    for (const t of listTasks(db, g.id)) {
      if (FIX_ORIGINS.has(t.origin)) fixTasks++;
      const n = byTask.get(t.id) ?? 0;
      if (!n) continue;
      tasks++;
      attempts += n;
      if (n > 1) retried++;
    }
  }
  return { tasks, retried, attempts, fixTasks, rate: tasks ? retried / tasks : null };
}

const estimate = (samples: EstimateSample[]): ReportEstimate => ({ ...calibrate(samples), samples: samples.length });

const round2 = (x: number) => Math.round(x * 100) / 100;
const off = (factor: number | null) => (factor == null || !(factor > 0) ? 0 : Math.abs(Math.log(factor)));
/** the goals whose estimates missed most, by the larger of the cost and time miss (either way: too much or too little) */
function misses(samples: (EstimateSample & { repoPath: string })[]): ReportMiss[] {
  return samples
    .map((s) => {
      const costFactor = s.actualUsd != null && s.estimateUsd > 0 ? round2(s.actualUsd / s.estimateUsd) : null;
      const timeFactor = s.actualMin != null && s.estimateMin > 0 ? round2(s.actualMin / s.estimateMin) : null;
      const m: ReportMiss = { goalId: s.goalId, title: s.title, repo: basename(s.repoPath) || s.repoPath, at: s.at, estimateUsd: s.estimateUsd, actualUsd: s.actualUsd, estimateMin: s.estimateMin, actualMin: s.actualMin, costFactor, timeFactor };
      return { m, by: Math.max(off(costFactor), off(timeFactor)) };
    })
    .filter((x) => x.by > 0)
    .sort((a, b) => b.by - a.by || b.m.at.localeCompare(a.m.at))
    .slice(0, MISSES)
    .map((x) => x.m);
}

type Step = Report['step'];
const stepFor = (spanMs: number): Step => (spanMs <= 31 * DAY ? 'day' : spanMs <= 366 * DAY ? 'week' : 'month');
/** the start of the bucket holding `t`: the UTC day, the week from Monday, or the month */
function bucketStart(t: number, step: Step): number {
  const d = new Date(t);
  if (step === 'month') return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  const day = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return step === 'day' ? day : day - ((d.getUTCDay() + 6) % 7) * DAY;
}
function nextBucket(t: number, step: Step): number {
  if (step === 'month') {
    const d = new Date(t);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  }
  return t + (step === 'day' ? DAY : 7 * DAY);
}
const label = (t: number, step: Step) => new Date(t).toLocaleDateString('en-US', step === 'month' ? { month: 'short', year: '2-digit', timeZone: 'UTC' } : { month: 'short', day: 'numeric', timeZone: 'UTC' });
/** sessions and dollars per bucket, and the goals that finished in it */
function series(rows: UsageRow[], goals: Goal[], from: number, to: number, step: Step): ReportBucket[] {
  const out: ReportBucket[] = [];
  for (let t = bucketStart(from, step); t < to; t = nextBucket(t, step)) out.push({ t: new Date(t).toISOString(), label: label(t, step), sessions: 0, costUsd: 0, finished: 0 });
  const starts = out.map((b) => Date.parse(b.t));
  const at = (iso: string): ReportBucket | undefined => {
    const ts = Date.parse(iso);
    let i = -1;
    while (i + 1 < starts.length && starts[i + 1]! <= ts) i++;
    return i >= 0 && ts <= to ? out[i] : undefined;
  };
  for (const r of rows) {
    const b = at(r.ts);
    if (!b) continue;
    b.sessions++;
    if (claude(r)) b.costUsd += r.cost_usd;
  }
  for (const g of goals) {
    if (!FINISHED.has(g.state)) continue;
    const b = at(g.updatedAt);
    if (b) b.finished++;
  }
  return out;
}

/** The report over the last `days` (null = all time, from the earliest record), as of `now`. */
export function buildReport(engine: Engine, opts: { days: number | null; now?: number }): Report {
  const db = engine.store.db;
  const now = opts.now ?? Date.now();
  const all = listGoals(db);
  const everyRow = listUsageSince(db, '1970-01-01T00:00:00.000Z').filter((r) => Date.parse(r.ts) <= now);
  const earliest = Math.min(now, ...everyRow.map((r) => Date.parse(r.ts)), ...all.map((g) => Date.parse(g.createdAt)));
  const from = opts.days == null ? earliest : now - opts.days * DAY;
  const rows = everyRow.filter((r) => Date.parse(r.ts) >= from);
  const goals = all.filter((g) => Date.parse(g.createdAt) >= from && Date.parse(g.createdAt) <= now);
  const byId = new Map(all.map((g) => [g.id, g]));
  const samples = estimateSamples(engine).filter((s) => Date.parse(s.at) >= from && Date.parse(s.at) <= now);
  const step = stepFor(now - from);
  const minutes = (gs: Goal[]) => Math.round(gs.reduce((a, g) => a + budgetStatus(g, now).elapsedMin, 0));

  // by project: the sessions of its goals, its goals of the window, their time, retries and estimates
  const repoOf = (r: UsageRow) => (r.goal_id ? (byId.get(r.goal_id)?.repoPath ?? null) : null);
  const paths = new Set<string>([...goals.map((g) => g.repoPath), ...rows.map(repoOf).filter((p): p is string => !!p)]);
  const repos: ReportRepo[] = [...paths]
    .map((repoPath) => {
      const mine = goals.filter((g) => g.repoPath === repoPath);
      const priced = mine.filter((g) => FINISHED.has(g.state) && reportsDollars(g.provider) && g.costUsd > 0);
      return {
        repoPath,
        name: basename(repoPath) || repoPath,
        ...spend(rows.filter((r) => repoOf(r) === repoPath)),
        goals: goalCounts(mine),
        activeMin: minutes(mine),
        costPerFinishedGoal: priced.length ? round2(priced.reduce((a, g) => a + g.costUsd, 0) / priced.length) : null,
        retries: retries(engine, mine),
        estimate: estimate(samples.filter((s) => s.repoPath === repoPath)),
      };
    })
    .sort((a, b) => b.costUsd - a.costUsd || b.durationMs - a.durationMs || a.name.localeCompare(b.name));

  const total = spend(rows);
  const kinds: ReportKind[] = [...new Set(rows.map((r) => r.kind))]
    .map((kind) => {
      const s = spend(rows.filter((r) => r.kind === kind));
      return { kind, ...s, costShare: total.costUsd > 0 ? s.costUsd / total.costUsd : null, timeShare: total.durationMs > 0 ? s.durationMs / total.durationMs : 0 };
    })
    .sort((a, b) => b.costUsd - a.costUsd || b.durationMs - a.durationMs);

  return {
    now: new Date(now).toISOString(),
    window: { days: opts.days, from: new Date(from).toISOString(), to: new Date(now).toISOString() },
    step,
    totals: { ...total, goals: goalCounts(goals), activeMin: minutes(goals), retries: retries(engine, goals), estimate: estimate(samples), noGoal: spend(rows.filter((r) => !repoOf(r))) },
    series: series(rows, goals, from, now, step),
    repos,
    kinds,
    misses: misses(samples),
    note: 'From the sessions Foundry started on this machine. Dollars are Claude Code estimates: Codex reports none, and a Claude Code session cut before it reported a cost counts as unknown, not $0.',
  };
}
