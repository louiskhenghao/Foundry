import { describe, expect, test } from 'bun:test';
import { EventStore, openDatabase } from '@ai-engine/core';
import { usageSummary } from './ledger.ts';

function store() {
  return new EventStore(openDatabase(':memory:'));
}
function usage(s: EventStore, goalId: string | null, kind: string, model: string, costUsd: number, rateLimit: any = null) {
  s.append({ type: 'session.usage', goalId, payload: { sessionId: 's', kind, model, inputTokens: 10, outputTokens: 100, cacheReadTokens: 1000, cacheCreateTokens: 0, costUsd, durationMs: 5, subtype: 'success', rateLimit, skillsUsed: [] } });
}

describe('usage ledger', () => {
  test('aggregates windows, models, kinds and goals; replay keeps it identical', () => {
    const s = store();
    usage(s, 'g1', 'attempt', 'opus', 0.5);
    usage(s, 'g1', 'review-task', 'haiku', 0.05);
    usage(s, 'g2', 'clarify', 'opus', 0.8, { status: 'allowed', resetsAt: Math.floor(Date.now() / 1000) + 3600, rateLimitType: 'five_hour', isUsingOverage: false });
    const u = usageSummary(s.db);
    expect(u.fiveHour.sessions).toBe(3);
    expect(u.fiveHour.costUsd).toBeCloseTo(1.35);
    expect(u.fiveHour.status).toBe('allowed');
    expect(u.fiveHour.resetsAt).not.toBeNull();
    expect(u.sevenDay.sessions).toBe(3);
    expect(u.byModel.map((m) => m.model)).toEqual(['opus', 'haiku']);
    expect(u.byGoal[0]).toMatchObject({ goalId: 'g2', costUsd: 0.8 });
    expect(u.byKind.find((k) => k.kind === 'attempt')?.costUsd).toBe(0.5);
    expect(u.limited).toBeNull();
    const before = s.snapshotReadModels();
    s.replay();
    expect(s.snapshotReadModels()).toEqual(before);
  });

  test('rejected signal with a future reset marks limited; past reset does not', () => {
    const s = store();
    usage(s, null, 'probe', 'haiku', 0.01, { status: 'rejected', resetsAt: Math.floor(Date.now() / 1000) + 120, rateLimitType: 'five_hour', isUsingOverage: false });
    expect(usageSummary(s.db).limited).toMatchObject({ rateLimitType: 'five_hour' });
    usage(s, null, 'probe', 'haiku', 0.01, { status: 'rejected', resetsAt: Math.floor(Date.now() / 1000) - 120, rateLimitType: 'five_hour', isUsingOverage: false });
    expect(usageSummary(s.db).limited).toBeNull();
  });

  test('without any signal the 5h window is simply the last five hours', () => {
    const s = store();
    const now = Date.now();
    const u = usageSummary(s.db, now);
    expect(Date.parse(u.fiveHour.windowEnd)).toBe(now);
    expect(now - Date.parse(u.fiveHour.windowStart)).toBe(5 * 3600_000);
    expect(u.fiveHour.status).toBeNull();
  });
});

describe('usage dashboard aggregates', () => {
  test('series buckets cover the whole window with empty buckets; totals and byGoal titles', async () => {
    const { bucketize } = await import('./ledger.ts');
    const s = store();
    // a goal so byGoal can show a title
    const { IDLE_DELIVERY } = await import('@ai-engine/core');
    const now = new Date().toISOString();
    s.append({ type: 'goal.created', goalId: 'g_t', payload: { goal: { id: 'g_t', title: 'Titled goal', prompt: 'p', repoPath: '/r', baseBranch: 'main', branch: 'goal/g_t', mode: 'expert', workflow: { tdd: 'required' }, budgets: { maxCostUsd: 5, maxDurationMin: 120, maxConcurrent: 3, attemptsPerTask: 3 }, budgetPreset: 'custom', models: { strong: 'opus', cheap: 'haiku', worker: 'opus' }, state: 'done', stateBeforeBlock: null, costUsd: 1, fixCycles: 0, delivery: IDLE_DELIVERY, attachments: [], baseSync: null, autoskills: null, completion: { graphRefresh: false, docs: [], docsRun: null, graphRun: null }, runningSince: null, createdAt: now, updatedAt: now } } });
    usage(s, 'g_t', 'attempt', 'opus', 0.4);
    usage(s, 'g_t', 'attempt', 'opus', 0.6);
    s.append({ type: 'session.usage', goalId: 'g_t', payload: { sessionId: 'x', kind: 'attempt', model: 'opus', inputTokens: 0, outputTokens: 1, cacheReadTokens: 0, cacheCreateTokens: 0, costUsd: 0.1, durationMs: 95, subtype: 'error_during_execution', rateLimit: null, skillsUsed: [] } });
    const u = usageSummary(s.db);
    expect(u.series.hourly.length).toBeGreaterThanOrEqual(5);
    expect(u.series.hourly.length).toBeLessThanOrEqual(6);
    expect(u.series.daily.length).toBeGreaterThanOrEqual(7);
    expect(u.series.hourly.reduce((a, b) => a + b.sessions, 0)).toBe(3);
    expect(u.series.daily.reduce((a, b) => a + b.costUsd, 0)).toBeCloseTo(1.1);
    expect(u.byGoal[0]).toMatchObject({ goalId: 'g_t', title: 'Titled goal', state: 'done', sessions: 3 });
    expect(u.totals.errorSessions).toBe(1);
    expect(u.totals.avgCostPerSession!).toBeCloseTo(1.1 / 3);
    expect(u.totals.cacheHitRate!).toBeCloseTo(2000 / 2020);
    expect(u.byKind[0]!.avgDurationMs).toBe(Math.round((5 + 5 + 95) / 3));
    // bucketize aligns to the bucket size and drops rows outside the range
    const b = bucketize([{ ts: new Date(Date.UTC(2026, 0, 1, 1, 30)).toISOString(), cost_usd: 1, output_tokens: 2 } as any], Date.UTC(2026, 0, 1, 0, 10), Date.UTC(2026, 0, 1, 3, 0), 3600_000, (t) => String(new Date(t).getUTCHours()));
    expect(b.map((x) => [x.label, x.sessions])).toEqual([['0', 0], ['1', 1], ['2', 0]]);
  });
});
