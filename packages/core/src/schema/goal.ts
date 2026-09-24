import { z } from 'zod';
import { Attachment } from './attachment.ts';
import { DeliveryState, IDLE_DELIVERY } from './delivery.ts';
import { Interview } from './interview.ts';

/** Claude Code effort level handed to every session of a goal; null = the CLI default */
export const Effort = z.enum(['low', 'medium', 'high', 'xhigh', 'max']);
export type Effort = z.infer<typeof Effort>;

export const GoalState = z.enum([
  'draft',
  'clarifying',
  'awaiting_brief_approval',
  'running',
  'goal_review',
  'blocked',
  /** paused at a milestone for the human to look at the work and continue or give feedback */
  'awaiting_feedback',
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

/** Simple = the user sees a plain-language Brief and progress; Expert = every control. Same engine underneath. */
export const GoalMode = z.enum(['simple', 'expert']);
export type GoalMode = z.infer<typeof GoalMode>;

/**
 * What kind of thing the goal produces. Drives the Clarify prompt (no tech-stack question for prose,
 * artifact conventions for media), the default view (non-code goals open Simple) and completion defaults.
 * `auto` = the user did not say; the Clarifier decides from the prompt and the engine records its verdict.
 */
export const GoalNature = z.enum(['auto', 'code', 'docs', 'research', 'image', 'video']);
export type GoalNature = z.infer<typeof GoalNature>;
/** natures whose artifacts are media files (kept out of git, delivered to the output folder at done) */
export const MEDIA_NATURES: GoalNature[] = ['image', 'video'];

/** How hard the engine pushes a discipline: required = MUST + noted when skipped; preferred = suggested only; off = not mentioned. */
export const Discipline = z.enum(['required', 'preferred', 'off']);
export type Discipline = z.infer<typeof Discipline>;

/** thorough = the engine adds its own AI reviews on top of the Brief's checks; fast = only what the Brief asked for runs. */
export const GoalPace = z.enum(['thorough', 'fast']);
export type GoalPace = z.infer<typeof GoalPace>;

export const GoalWorkflow = z.object({
  tdd: Discipline.default('required'),
  /** default keeps pre-pace goals replayable */
  pace: GoalPace.default('thorough'),
});
export type GoalWorkflow = z.infer<typeof GoalWorkflow>;

/** Documents generated once at goal completion (after the goal review passes, before delivery). */
export const DocType = z.enum(['to-prd', 'readme-update', 'changelog', 'to-questionnaire']);
export type DocType = z.infer<typeof DocType>;

/**
 * Completion actions: automatic wrap-up chosen at Brief approval, executed when the goal finishes.
 * Docs are generated after the goal review passes and committed to the goal branch (same delivery unit as the code);
 * the graph refresh (graphify / gitnexus, whichever is on PATH) runs after delivery so the graph reflects the landed code.
 */
export const GoalCompletion = z.object({
  graphRefresh: z.boolean().default(false),
  docs: z.array(DocType).default([]),
  /** result of the docs-generation session (null = not run yet) */
  docsRun: z.object({ status: z.enum(['ok', 'skipped', 'failed']), types: z.array(DocType), files: z.array(z.string()), costUsd: z.number(), detail: z.string(), at: z.string() }).nullable().default(null),
  /** result of the graph refresh (null = not run yet) */
  graphRun: z.object({ tools: z.array(z.object({ name: z.string(), status: z.enum(['ok', 'skipped', 'failed']), detail: z.string() })), at: z.string() }).nullable().default(null),
  /** result of copying the media artifacts to the goal's output folder at done (null = not run yet) */
  artifactsRun: z.object({ status: z.enum(['ok', 'skipped', 'failed']), files: z.array(z.string()), dest: z.string(), detail: z.string(), at: z.string() }).nullable().default(null),
});
export type GoalCompletion = z.infer<typeof GoalCompletion>;
export const IDLE_COMPLETION: GoalCompletion = { graphRefresh: false, docs: [], docsRun: null, graphRun: null, artifactsRun: null };

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
  /** defaults keep pre-mode `goal.created` events replayable */
  mode: GoalMode.default('expert'),
  /** default keeps pre-nature `goal.created` events replayable (old goals were all code goals in effect) */
  nature: GoalNature.default('auto'),
  /** where media artifacts are copied when the goal finishes; null = they stay in the goal workspace */
  outputDir: z.string().nullable().default(null),
  /** the progress folder — the goal worktree the human opens, next to the repository; null = the legacy `<dataDir>/worktrees/<id>/_goal` */
  workspaceDir: z.string().nullable().default(null),
  /** the milestone checkpoint the goal is paused at (state awaiting_feedback), or null */
  checkpoint: z.object({ taskId: z.string(), lookFor: z.string(), openedAt: z.string(), recheck: z.boolean() }).nullable().default(null),
  /** after each integration, open the preview in a headless browser, screenshot it and fail on console/network errors */
  selfCheck: z.boolean().default(false),
  /** the Clarify interview (rounds of questions before the Brief); null = the one-shot Clarify of before */
  interview: Interview.nullable().default(null),
  /** effort level for every session of this goal; null = Settings default / CLI default */
  effort: Effort.nullable().default(null),
  /** the model preset this goal uses; null = the preset Settings picks for its nature */
  modelPreset: z.string().nullable().default(null),
  /** models found unavailable during this goal and what replaced them (from → to), applied to every later session */
  modelSubstitutions: z.record(z.string(), z.string()).default({}),
  workflow: GoalWorkflow.default(() => ({ tdd: 'required' as const })),
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
  /** completion actions chosen at Brief approval; default keeps pre-completion `goal.created` events replayable */
  completion: GoalCompletion.default(() => ({ ...IDLE_COMPLETION })),
  runningSince: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Goal = z.infer<typeof Goal>;
