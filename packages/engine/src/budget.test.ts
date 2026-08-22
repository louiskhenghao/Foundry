import { describe, expect, test } from 'bun:test';
import { BUDGET_PRESETS, Budgets, Goal, proposeBudgetFromEstimate } from '@ai-engine/core';
import { budgetStatus } from './budget.ts';

const base = (over: Partial<Goal> = {}): Goal =>
  Goal.parse({
    id: 'g_1',
    title: 't',
    prompt: 'p',
    repoPath: '/r',
    baseBranch: 'main',
    branch: 'goal/g_1',
    budgets: { maxCostUsd: 5, maxDurationMin: 120, maxConcurrent: 3, attemptsPerTask: 3 },
    models: { strong: 'opus', cheap: 'haiku', worker: 'opus' },
    state: 'running',
    stateBeforeBlock: null,
    costUsd: 0,
    fixCycles: 0,
    runningSince: new Date(Date.now() - 10 * 60_000).toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...over,
  });

describe('budgetStatus', () => {
  test('numeric limits: remaining and exceeded', () => {
    const s = budgetStatus(base({ costUsd: 4 }));
    expect(s.remainingUsd).toBe(1);
    expect(s.exceeded).toBeNull();
    expect(budgetStatus(base({ costUsd: 5 })).exceeded).toBe('cost');
    expect(budgetStatus(base({ budgets: { maxCostUsd: 5, maxDurationMin: 5, maxConcurrent: 3, attemptsPerTask: 3 } })).exceeded).toBe('time');
  });

  test('null limits never exceed and report remaining=null (not Infinity)', () => {
    const g = base({ costUsd: 999, budgets: { maxCostUsd: null, maxDurationMin: null, maxConcurrent: 3, attemptsPerTask: 3 } });
    const s = budgetStatus(g);
    expect(s.exceeded).toBeNull();
    expect(s.remainingUsd).toBeNull();
    expect(JSON.parse(JSON.stringify(s)).remainingUsd).toBeNull();
  });

  test('old goals without budgetPreset parse with custom + numeric limits', () => {
    const g = Goal.parse({ ...base(), budgetPreset: undefined });
    expect(g.budgetPreset).toBe('custom');
    expect(Budgets.parse({}).maxCostUsd).toBe(5);
  });
});

describe('budget presets', () => {
  test('auto and unlimited have no caps; quick < thorough', () => {
    expect(BUDGET_PRESETS.auto.budgets.maxCostUsd).toBeNull();
    expect(BUDGET_PRESETS.unlimited.budgets.maxDurationMin).toBeNull();
    expect(BUDGET_PRESETS.quick.budgets.maxCostUsd!).toBeLessThan(BUDGET_PRESETS.thorough.budgets.maxCostUsd!);
  });

  test('proposal = estimate ×2 rounded up with floors', () => {
    expect(proposeBudgetFromEstimate({ costEstimateUsd: 1, timeEstimateMin: 15 })).toEqual({ maxCostUsd: 3, maxDurationMin: 30 });
    expect(proposeBudgetFromEstimate({ costEstimateUsd: 4.2, timeEstimateMin: 47 })).toEqual({ maxCostUsd: 8.5, maxDurationMin: 100 });
    expect(proposeBudgetFromEstimate({ costEstimateUsd: 0, timeEstimateMin: 0 })).toEqual({ maxCostUsd: 3, maxDurationMin: 30 });
  });
});
