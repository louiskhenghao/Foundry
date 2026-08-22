import { z } from 'zod';
import { Attachment } from './attachment.ts';
import { DeliveryState, IDLE_DELIVERY } from './delivery.ts';

export const GoalState = z.enum([
  'draft',
  'clarifying',
  'awaiting_brief_approval',
  'running',
  'goal_review',
  'blocked',
  'done',
  'over_delivered',
  'failed',
  'cancelled',
]);
export type GoalState = z.infer<typeof GoalState>;

/** Cost and time limits may be null = no limit. Old events carry numbers and replay unchanged. */
export const Budgets = z.object({
  maxCostUsd: z.number().positive().nullable().default(5),
  maxDurationMin: z.number().positive().nullable().default(120),
  maxConcurrent: z.number().int().positive().default(3),
  attemptsPerTask: z.number().int().positive().default(3),
});
export type Budgets = z.infer<typeof Budgets>;

/**
 * How the budget was chosen. `auto` = no cap while clarifying; the Brief's estimate proposes the budget,
 * which the human confirms or edits when approving the Brief.
 */
export const BudgetPreset = z.enum(['auto', 'quick', 'thorough', 'unlimited', 'custom']);
export type BudgetPreset = z.infer<typeof BudgetPreset>;

export const DEFAULT_BUDGETS: Budgets = { maxCostUsd: 5, maxDurationMin: 120, maxConcurrent: 3, attemptsPerTask: 3 };

export const BUDGET_PRESETS: Record<BudgetPreset, { label: string; blurb: string; budgets: Budgets }> = {
  auto: { label: 'Auto', blurb: 'No cap while clarifying. The Brief estimates cost and time; you confirm the proposed budget before work starts.', budgets: { maxCostUsd: null, maxDurationMin: null, maxConcurrent: 3, attemptsPerTask: 3 } },
  quick: { label: 'Quick', blurb: 'Small fix or a question about the code. $3 · 30 min · 2 parallel · 2 attempts per task.', budgets: { maxCostUsd: 3, maxDurationMin: 30, maxConcurrent: 2, attemptsPerTask: 2 } },
  thorough: { label: 'Thorough', blurb: 'A feature with tests and review. $25 · 8 h · 3 parallel · 4 attempts per task.', budgets: { maxCostUsd: 25, maxDurationMin: 480, maxConcurrent: 3, attemptsPerTask: 4 } },
  unlimited: { label: 'Unlimited', blurb: 'No cost or time cap. Attempts per task and parallelism still apply; rate limits still pause the engine.', budgets: { maxCostUsd: null, maxDurationMin: null, maxConcurrent: 3, attemptsPerTask: 3 } },
  custom: { label: 'Custom', blurb: 'Set every limit yourself.', budgets: DEFAULT_BUDGETS },
};

/** Budget proposed from a Brief estimate: ×2 headroom, rounded up, with sensible floors. */
export function proposeBudgetFromEstimate(est: { costEstimateUsd: number; timeEstimateMin: number }): { maxCostUsd: number; maxDurationMin: number } {
  const cost = Math.max(3, Math.ceil((est.costEstimateUsd * 2) / 0.5) * 0.5);
  const min = Math.max(30, Math.ceil((est.timeEstimateMin * 2) / 10) * 10);
  return { maxCostUsd: Number(cost.toFixed(2)), maxDurationMin: min };
}

export const ModelConfig = z.object({
  strong: z.string().default('opus'),
  cheap: z.string().default('haiku'),
  worker: z.string().default('opus'),
});
export type ModelConfig = z.infer<typeof ModelConfig>;

export const Goal = z.object({
  id: z.string(),
  title: z.string().min(1),
  prompt: z.string().min(1),
  repoPath: z.string().min(1),
  baseBranch: z.string(),
  /** goal/<id> */
  branch: z.string(),
  budgets: Budgets,
  /** default keeps pre-preset `goal.created` events replayable */
  budgetPreset: BudgetPreset.default('custom'),
  models: ModelConfig,
  state: GoalState,
  /** state to return to when an escalation is answered */
  stateBeforeBlock: GoalState.nullable(),
  costUsd: z.number().nonnegative(),
  fixCycles: z.number().int().nonnegative(),
  /** default keeps pre-delivery `goal.created` events replayable */
  delivery: DeliveryState.default(() => IDLE_DELIVERY),
  /** files / links the user attached; default keeps older events replayable */
  attachments: z.array(Attachment).default([]),
  /** how the goal branch was started relative to the remote base branch (fetched when the goal began) */
  baseSync: z
    .object({
      remote: z.string().nullable(),
      base: z.string(),
      localRef: z.string().nullable(),
      remoteRef: z.string().nullable(),
      ahead: z.number().int().nonnegative(),
      behind: z.number().int().nonnegative(),
      fetched: z.boolean(),
      startedFrom: z.enum(['local', 'remote']),
      detail: z.string(),
      at: z.string(),
    })
    .nullable()
    .default(null),
  /** result of the per-goal autoskills run (project skills matched to the repository's stack) */
  autoskills: z.object({ status: z.enum(['installed', 'skipped', 'failed']), skills: z.array(z.string()), detail: z.string(), at: z.string() }).nullable().default(null),
  runningSince: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Goal = z.infer<typeof Goal>;
