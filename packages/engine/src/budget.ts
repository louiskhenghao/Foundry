import type { Goal } from '@ai-engine/core';

export interface BudgetStatus {
  costUsd: number;
  /** null = no limit */
  maxCostUsd: number | null;
  elapsedMin: number;
  /** null = no limit */
  maxDurationMin: number | null;
  /** null = unlimited (never use Infinity: it does not survive JSON) */
  remainingUsd: number | null;
  exceeded: 'cost' | 'time' | null;
}

const TERMINAL = new Set(['done', 'over_delivered', 'failed', 'cancelled']);

export function budgetStatus(goal: Goal, now = Date.now()): BudgetStatus {
  const end = TERMINAL.has(goal.state) ? Date.parse(goal.updatedAt) : now;
  const elapsedMin = goal.runningSince ? Math.max(0, end - Date.parse(goal.runningSince)) / 60_000 : 0;
  const { maxCostUsd, maxDurationMin } = goal.budgets;
  const remainingUsd = maxCostUsd == null ? null : Math.max(0, maxCostUsd - goal.costUsd);
  const exceeded = maxCostUsd != null && goal.costUsd >= maxCostUsd ? 'cost' : maxDurationMin != null && elapsedMin >= maxDurationMin ? 'time' : null;
  return { costUsd: goal.costUsd, maxCostUsd, elapsedMin, maxDurationMin, remainingUsd, exceeded };
}
