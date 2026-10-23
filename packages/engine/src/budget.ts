import type { Goal } from '@foundry/core';

export interface BudgetStatus {
  /** what the goal's work cost: a Conversation's answers (ADR-0073) are the goal's but left out of this and of the limit */
  costUsd: number;
  /** what the goal's Conversations cost */
  conversationUsd: number;
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
  // the time Foundry worked (waits for the person left out); a goal from before that was counted runs from its start
  const elapsedMin =
    goal.activeMs !== undefined
      ? (goal.activeMs + (goal.activeSince ? Math.max(0, now - Date.parse(goal.activeSince)) : 0)) / 60_000
      : goal.runningSince
        ? Math.max(0, end - Date.parse(goal.runningSince)) / 60_000
        : 0;
  const { maxCostUsd, maxDurationMin } = goal.budgets;
  // a question must never hold up the work: what the Conversations cost is counted on the goal but outside the budget
  const conversationUsd = goal.conversationCostUsd ?? 0;
  const spent = Math.max(0, goal.costUsd - conversationUsd);
  const remainingUsd = maxCostUsd == null ? null : Math.max(0, maxCostUsd - spent);
  const exceeded = maxCostUsd != null && spent >= maxCostUsd ? 'cost' : maxDurationMin != null && elapsedMin >= maxDurationMin ? 'time' : null;
  return { costUsd: spent, conversationUsd, maxCostUsd, elapsedMin, maxDurationMin, remainingUsd, exceeded };
}
