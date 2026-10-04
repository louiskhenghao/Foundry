import { describe, expect, test } from 'bun:test';
import { mergeActivity } from '../src/pages/UsagePage.tsx';

const week = (sessions: number, inputTokens: number, cacheReadTokens: number) => ({ label: '', windowStart: '', windowEnd: '', resetsAt: null, status: null, isUsingOverage: false, lastSignalAt: null, sessions, inputTokens, outputTokens: 0, cacheReadTokens, cacheCreateTokens: 0, costUsd: 0 });

describe('Foundry activity across coding agents', () => {
  test('merges both agents; Codex adds sessions and time but never a cost', () => {
    const m = mergeActivity({
      claude: { sevenDay: week(3, 10, 90), byGoal: [{ goalId: 'g1', title: 'One', state: 'done', sessions: 3, costUsd: 2 }], byKind: [{ kind: 'attempt', sessions: 3, costUsd: 2, avgDurationMs: 1000 }], byModel: [{ model: 'claude-opus-5-5', sessions: 3, costUsd: 2, outputTokens: 5 }], totals: { cacheHitRate: 0.9, avgCostPerSession: 0.67, avgDurationMs: 1000, errorSessions: 0 } },
      codex: { sevenDay: week(1, 50, 50), byGoal: [{ goalId: 'g1', title: 'One', state: 'done', sessions: 1, costUsd: 0 }, { goalId: 'g2', title: 'Two', state: 'running', sessions: 1, costUsd: 0 }], byKind: [{ kind: 'attempt', sessions: 1, costUsd: 0, avgDurationMs: 5000 }], byModel: [{ model: 'gpt-5.5', sessions: 1, costUsd: 0, outputTokens: 9 }], totals: { cacheHitRate: 0.5, avgCostPerSession: null, avgDurationMs: 5000, errorSessions: 1 } },
    });
    expect(m.byGoal).toEqual([{ goalId: 'g1', title: 'One', state: 'done', sessions: 4, costUsd: 2 }, { goalId: 'g2', title: 'Two', state: 'running', sessions: 1, costUsd: null }]);
    expect(m.byKind).toEqual([{ kind: 'attempt', sessions: 4, costUsd: 2, avgDurationMs: 2000 }]);
    expect(m.byModel.map((x) => [x.provider, x.model, x.costUsd])).toEqual([['claude', 'claude-opus-5-5', 2], ['codex', 'gpt-5.5', null]]);
    expect(m.cacheHitRate).toBeCloseTo(140 / 200);
    expect(m.avgDurationMs).toBe(2000);
    expect(m.errorSessions).toBe(1);
  });
});
