import { describe, expect, test } from 'bun:test';
import { mergeActivity } from '../src/pages/UsagePage.tsx';

const week = (sessions: number, inputTokens: number, cacheReadTokens: number) => ({ label: '', windowStart: '', windowEnd: '', resetsAt: null, status: null, isUsingOverage: false, lastSignalAt: null, sessions, inputTokens, outputTokens: 0, cacheReadTokens, cacheCreateTokens: 0, costUsd: 0 });
const m = (durationMs: number, output: number) => ({ durationMs, inputTokens: 10, cacheReadTokens: 100, cacheCreateTokens: 0, outputTokens: output });

describe('Foundry activity across coding agents', () => {
  const merged = mergeActivity({
    claude: { sevenDay: week(3, 10, 90), byGoal: [{ goalId: 'g1', title: 'One', state: 'done', sessions: 3, costUsd: 2, ...m(60_000, 5) }], byKind: [{ kind: 'attempt', sessions: 3, costUsd: 2, avgDurationMs: 20_000, ...m(60_000, 5) }], byModel: [{ model: 'claude-opus-5-5', sessions: 3, costUsd: 2, ...m(60_000, 5) }], totals: { cacheHitRate: 0.9, avgCostPerSession: 0.67, avgDurationMs: 20_000, errorSessions: 0 } },
    codex: { sevenDay: week(2, 50, 50), byGoal: [{ goalId: 'g1', title: 'One', state: 'done', sessions: 1, costUsd: 0, ...m(30_000, 7) }, { goalId: 'g2', title: 'Two', state: 'running', sessions: 1, costUsd: 0, ...m(300_000, 9) }], byKind: [{ kind: 'attempt', sessions: 2, costUsd: 0, avgDurationMs: 165_000, ...m(330_000, 16) }], byModel: [{ model: 'gpt-5.5', sessions: 2, costUsd: 0, ...m(330_000, 16) }], totals: { cacheHitRate: 0.5, avgCostPerSession: null, avgDurationMs: 165_000, errorSessions: 1 } },
  });

  test('rows are compared by time, which both agents report; a Codex-only row has no cost', () => {
    expect(merged.byGoal.map((g) => [g.goalId, g.agents, g.durationMs, g.costUsd, g.partial])).toEqual([
      ['g2', ['codex'], 300_000, null, false],
      ['g1', ['claude', 'codex'], 90_000, 2, true],
    ]);
    expect(merged.byGoal[1]!.tokens).toEqual({ input: 20, cacheRead: 200, cacheCreate: 0, output: 12 });
  });

  test('kinds merge across agents; models stay per agent', () => {
    expect(merged.byKind).toMatchObject([{ id: 'attempt', sessions: 5, durationMs: 390_000, costUsd: 2, partial: true }]);
    expect(merged.byModel.map((x) => [x.id, x.costUsd])).toEqual([['codex:gpt-5.5', null], ['claude:claude-opus-5-5', 2]]);
  });

  test('summaries recorded before time totals fall back to the average', () => {
    const old = mergeActivity({ claude: { sevenDay: week(2, 0, 0), byGoal: [], byKind: [{ kind: 'review', sessions: 2, costUsd: 1, avgDurationMs: 4000 }], byModel: [], totals: { cacheHitRate: null, avgCostPerSession: 0.5, avgDurationMs: 4000, errorSessions: 0 } } });
    expect(old.byKind[0]).toMatchObject({ durationMs: 8000, costUsd: 1, partial: false });
  });

  test('totals keep their meaning', () => {
    expect(merged.cacheHitRate).toBeCloseTo(140 / 200);
    expect(merged.avgCostPerSession).toBe(0.67);
    expect(merged.errorSessions).toBe(1);
  });
});
