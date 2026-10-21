import { beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Attempt, Brief, Goal, Task } from '@foundry/core';
import { Goal as GoalSchema, IdPrefix, newId, upsertAttempt, upsertBrief, upsertGoal, upsertTask } from '@foundry/core';
import { defaultConfig } from './config.ts';
import { Engine } from './engine.ts';
import { buildReport } from './reports.ts';
import { FakeRunner } from './test-helpers.ts';

const ROOT = resolve(import.meta.dir, '../../..');
const NOW = Date.parse('2026-10-21T12:00:00Z');
const DAY = 86_400_000;
const at = (daysAgo: number) => new Date(NOW - daysAgo * DAY).toISOString();
let engine: Engine;
beforeEach(() => {
  const dataDir = mkdtempSync(join(tmpdir(), 'foundry-reports-'));
  engine = new Engine(defaultConfig(ROOT, { dataDir, claudeHome: join(dataDir, 'claude-home'), log: () => {} }), new FakeRunner(() => {}));
});

let n = 0;
/** a goal created `daysAgo`, finished half a day later, with an approved estimate when `estMin` is given */
function goal(over: Partial<Goal> & { daysAgo?: number; estUsd?: number; estMin?: number; activeMin?: number } = {}): Goal {
  const { daysAgo = 3, estUsd = 0, estMin = 0, activeMin = 60, ...rest } = over;
  n++;
  const g = GoalSchema.parse({
    id: `g_${n}`, title: `goal ${n}`, prompt: 'p', repoPath: '/home/me/alpha', baseBranch: 'main', branch: `goal/g_${n}`, budgets: {}, models: { strong: 'opus', cheap: 'haiku', worker: 'opus' },
    state: 'done', stateBeforeBlock: null, costUsd: 0, fixCycles: 0, runningSince: null, activeMs: activeMin * 60_000, activeSince: null, nature: 'code',
    createdAt: at(daysAgo), updatedAt: at(Math.max(0, daysAgo - 0.5)), ...rest,
  });
  upsertGoal(engine.store.db, g);
  if (estMin > 0) upsertBrief(engine.store.db, { goalId: g.id, title: 't', understanding: 'u', areas: [], assumptions: [], questions: [], styleOptions: [], tasks: [], checks: [], costEstimateUsd: estUsd, timeEstimateMin: estMin } as unknown as Brief, true, false);
  return g;
}
/** a session in the ledger, dated by hand (the store stamps appended events with now) */
function usage(g: Goal | null, kind: string, costUsd: number, opts: { daysAgo?: number; minutes?: number; unavailable?: boolean } = {}) {
  const { daysAgo = 2, minutes = 10, unavailable = false } = opts;
  engine.store.db.run(
    'INSERT INTO usage_ledger (event_id, ts, goal_id, kind, model, input_tokens, output_tokens, cache_read_tokens, cache_create_tokens, cost_usd, duration_ms, subtype, cost_status) VALUES (?, ?, ?, ?, ?, 0, 0, 0, 0, ?, ?, ?, ?)',
    [newId(IdPrefix.event), at(daysAgo), g?.id ?? null, kind, 'opus', costUsd, minutes * 60_000, 'success', unavailable ? 'unavailable' : 'reported'],
  );
}
/** a done task of `g` with `attempts` work attempts, the last one passed */
function task(g: Goal, origin: Task['origin'], attempts: number, kind: Attempt['kind'] = 'work'): Task {
  const now = at(1);
  const t: Task = { id: newId(IdPrefix.task), goalId: g.id, title: 't', spec: 's', kind: 'feature', scope: null, scenario: 'frontend', area: null, tdd: 'inherit', dependsOn: [], relevantFiles: [], parallelizable: false, retryBudget: 3, origin, milestone: null, milestoneScript: null, milestoneVisits: 0, checkpointOf: null, difficulty: 'standard', state: 'done', branch: null, worktreePath: null, baseRef: null, commitRef: null, commitMessage: null, hint: null, extraAttempts: 0, delegatedGoalId: null, summary: null, createdAt: now, updatedAt: now };
  upsertTask(engine.store.db, t);
  for (let i = 1; i <= attempts; i++) {
    const a: Attempt = { id: newId(IdPrefix.attempt), goalId: g.id, taskId: t.id, index: i, kind, sessionId: null, model: 'opus', state: i === attempts ? 'passed' : 'failed', costUsd: 0.5, numTurns: 3, resultSubtype: null, baseRef: null, endRef: null, pid: null, cwd: null, transcriptPath: null, startedAt: now, endedAt: now, skillsUsed: [], continuations: 0, sessions: [] };
    upsertAttempt(engine.store.db, a);
  }
  return t;
}

describe('reports (ADR-0060)', () => {
  test('the window takes goals by creation and sessions by time; spend, goals, hours and retries are told by project and spend by session kind', () => {
    const g1 = goal({ daysAgo: 3, costUsd: 4 });
    const g2 = goal({ daysAgo: 10, state: 'failed', activeMin: 30 });
    const g3 = goal({ daysAgo: 40, costUsd: 5 }); // before the window
    const g4 = goal({ daysAgo: 1, repoPath: '/home/me/beta', provider: 'codex', activeMin: 15 });
    usage(g1, 'attempt', 3, { minutes: 10 });
    usage(g1, 'review-goal', 1, { minutes: 5 });
    usage(g2, 'attempt', 0, { unavailable: true, minutes: 20 });
    usage(g3, 'attempt', 5, { daysAgo: 40 });
    usage(g4, 'attempt', 0, { minutes: 5 });
    usage(null, 'probe', 0.1, { minutes: 1 });
    task(g1, 'brief', 1);
    task(g1, 'brief', 2);
    task(g1, 'goal-review-fix', 1);
    task(g1, 'merge', 2, 'merge'); // a sync, not a retry
    task(g2, 'brief', 3);

    const r = buildReport(engine, { days: 30, now: NOW });
    expect(r.window).toEqual({ days: 30, from: at(30), to: at(0) });
    expect(r.step).toBe('day');
    expect(r.totals).toMatchObject({ sessions: 5, costUsd: 4.1, unmeasured: 1, codexSessions: 1, durationMs: 41 * 60_000, activeMin: 105 });
    expect(r.totals.goals).toEqual({ total: 3, finished: 2, failed: 1, cancelled: 0, open: 0 });
    expect(r.totals.retries).toEqual({ tasks: 4, retried: 2, attempts: 7, fixTasks: 1, rate: 0.5 });
    expect(r.totals.noGoal).toMatchObject({ sessions: 1, costUsd: 0.1 });
    expect(r.repos.map((p) => p.name)).toEqual(['alpha', 'beta']);
    const alpha = r.repos[0]!;
    expect(alpha).toMatchObject({ repoPath: '/home/me/alpha', sessions: 3, costUsd: 4, unmeasured: 1, codexSessions: 0, activeMin: 90, costPerFinishedGoal: 4 });
    expect(alpha.goals).toEqual({ total: 2, finished: 1, failed: 1, cancelled: 0, open: 0 });
    expect(alpha.retries).toEqual({ tasks: 4, retried: 2, attempts: 7, fixTasks: 1, rate: 0.5 });
    expect(r.repos[1]).toMatchObject({ name: 'beta', sessions: 1, costUsd: 0, codexSessions: 1, costPerFinishedGoal: null, activeMin: 15 });
    expect(r.repos[1]!.retries).toEqual({ tasks: 0, retried: 0, attempts: 0, fixTasks: 0, rate: null });
    expect(r.kinds.map((k) => k.kind)).toEqual(['attempt', 'review-goal', 'probe']);
    expect(r.kinds[0]).toMatchObject({ sessions: 3, costUsd: 3, unmeasured: 1, codexSessions: 1 });
    expect(r.kinds[0]!.costShare).toBeCloseTo(3 / 4.1);
    expect(r.kinds[0]!.timeShare).toBeCloseTo(35 / 41);
    // all time reaches the older goal and its session
    const all = buildReport(engine, { days: null, now: NOW });
    expect(all.window.days).toBeNull();
    expect(all.window.from).toBe(at(40));
    expect(all.totals).toMatchObject({ sessions: 6, costUsd: 9.1 });
    expect(all.totals.goals.total).toBe(4);
    expect(all.repos[0]).toMatchObject({ name: 'alpha', costUsd: 9, costPerFinishedGoal: 4.5 });
    expect(all.step).toBe('week');
  });

  test('estimate error is the calibration factor over the finished goals with an estimate, and the misses are listed furthest first', () => {
    const a = goal({ daysAgo: 8, estUsd: 10, estMin: 60, costUsd: 15, activeMin: 90, title: 'a' }); // ×1.5 / ×1.5
    const b = goal({ daysAgo: 6, estUsd: 10, estMin: 60, costUsd: 30, activeMin: 60, title: 'b' }); // ×3 / ×1
    const c = goal({ daysAgo: 4, estUsd: 10, estMin: 60, costUsd: 5, activeMin: 15, title: 'c' }); // ×0.5 / ×0.25
    goal({ daysAgo: 2, estUsd: 10, estMin: 60, costUsd: 15, activeMin: 90, state: 'failed' }); // not finished: no sample
    goal({ daysAgo: 2, costUsd: 15 }); // no estimate: no sample
    const d = goal({ daysAgo: 3, estUsd: 10, estMin: 60, costUsd: 15, activeMin: 90, repoPath: '/home/me/beta', title: 'd' }); // ×1.5 / ×1.5, newer than a
    const r = buildReport(engine, { days: 30, now: NOW });
    expect(r.totals.estimate).toEqual({ cost: { factor: 1.5, samples: 4, spread: 'tight' }, time: { factor: 1.25, samples: 4, spread: 'tight' }, samples: 4 });
    const alpha = r.repos.find((p) => p.name === 'alpha')!;
    expect(alpha.estimate).toMatchObject({ cost: { factor: 1.5, samples: 3 }, time: { factor: 1, samples: 3 }, samples: 3 });
    // beta has one sample: a factor needs three
    expect(r.repos.find((p) => p.name === 'beta')!.estimate).toEqual({ cost: null, time: null, samples: 1 });
    // the same miss either way: the newer goal first
    expect(r.misses.map((m) => m.goalId)).toEqual([c.id, b.id, d.id, a.id]);
    expect(r.misses[0]).toMatchObject({ goalId: c.id, repo: 'alpha', estimateUsd: 10, actualUsd: 5, estimateMin: 60, actualMin: 15, costFactor: 0.5, timeFactor: 0.25 });
    expect(r.misses[1]).toMatchObject({ goalId: b.id, costFactor: 3, timeFactor: 1 });
  });

  test('the series follows the window: days for 30, weeks for 90 and 12 months, months over a longer all-time span; a finished goal lands in its day', () => {
    const g = goal({ daysAgo: 2.5, costUsd: 2 });
    usage(g, 'attempt', 2, { daysAgo: 2.2 });
    const r30 = buildReport(engine, { days: 30, now: NOW });
    expect(r30.step).toBe('day');
    expect(r30.series).toHaveLength(31);
    expect(r30.series[0]!.t).toBe('2026-09-21T00:00:00.000Z');
    expect(r30.series[0]!.label).toBe('Sep 21');
    const day = r30.series.find((b) => b.t === '2026-10-19T00:00:00.000Z')!;
    expect(day).toMatchObject({ sessions: 1, costUsd: 2, finished: 1 });
    expect(r30.series.reduce((a, b) => a + b.sessions, 0)).toBe(1);
    const r90 = buildReport(engine, { days: 90, now: NOW });
    expect(r90.step).toBe('week');
    expect(r90.series.every((b) => new Date(b.t).getUTCDay() === 1)).toBe(true);
    expect(buildReport(engine, { days: 365, now: NOW }).step).toBe('week');
    goal({ daysAgo: 400 });
    const all = buildReport(engine, { days: null, now: NOW });
    expect(all.step).toBe('month');
    expect(all.series[0]!.t).toBe('2025-09-01T00:00:00.000Z');
    expect(all.series.at(-1)!.t).toBe('2026-10-01T00:00:00.000Z');
    expect(all.series.at(-1)!.label).toBe('Oct 26');
  });

  test('an empty store reports nothing, and the engine reads the last 30 days by default', () => {
    const r = engine.report();
    expect(r.window.days).toBe(30);
    expect(r.totals).toMatchObject({ sessions: 0, costUsd: 0, activeMin: 0 });
    expect(r.totals.goals.total).toBe(0);
    expect(r.repos).toEqual([]);
    expect(r.kinds).toEqual([]);
    expect(r.misses).toEqual([]);
    expect(r.totals.estimate).toEqual({ cost: null, time: null, samples: 0 });
  });
});
