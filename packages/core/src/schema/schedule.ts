import { AgentProvider } from './provider.ts';
import { z } from 'zod';
import { CodexEffort } from './codex-presets.ts';
import { DeliveryPolicy } from './delivery.ts';
import { BudgetPreset, Budgets, GoalMode, GoalNature, GoalWorkflow } from './goal.ts';

/** `HH:MM`, this computer's clock */
export const ClockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'a time as HH:MM');

/** When a Schedule fires (ADR-0054): every day, one weekday a week, or one day a month (1–28, so every month has it), at a time of this computer's clock. */
export const ScheduleCadence = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('daily'), at: ClockTime }),
  z.object({ kind: z.literal('weekly'), weekday: z.number().int().min(0).max(6), at: ClockTime }),
  z.object({ kind: z.literal('monthly'), day: z.number().int().min(1).max(28), at: ClockTime }),
]);
export type ScheduleCadence = z.infer<typeof ScheduleCadence>;

/**
 * What the New goal form submits, kept to be submitted again (ADR-0054): everything but what cannot be reused — an
 * upload (staged once), a reference (investigated once), an issue (read once). Links are attached to every run.
 */
export const GoalRecipe = z.object({
  provider: AgentProvider.optional(),
  codexModel: z.string().trim().min(1).optional(),
  agyModel: z.string().trim().min(1).optional(),
  prompt: z.string().min(1),
  repoPath: z.string().min(1),
  title: z.string().optional(),
  baseBranch: z.string().optional(),
  budgets: Budgets.partial().optional(),
  budgetPreset: BudgetPreset.optional(),
  modelPreset: z.string().min(1).nullable().optional(),
  effort: CodexEffort.nullable().optional(),
  nature: GoalNature.optional(),
  mode: GoalMode.optional(),
  workflow: GoalWorkflow.partial().optional(),
  delivery: DeliveryPolicy.partial().optional(),
  delegation: z.object({ allow: z.boolean().optional(), autoApprove: z.boolean().optional() }).optional(),
  interviewDepth: z.number().int().min(0).max(5).optional(),
  autoBrief: z.object({ mustChecks: z.array(z.string()), stretchChecks: z.array(z.string()).optional() }).optional(),
  selfCheck: z.boolean().optional(),
  milestonePause: z.boolean().optional(),
  outputDir: z.string().nullable().optional(),
  /** links attached to every run; uploads cannot be staged twice */
  links: z.array(z.object({ url: z.string().url(), name: z.string().optional(), note: z.string().optional() })).default([]),
});
export type GoalRecipe = z.infer<typeof GoalRecipe>;

/** A saved goal recipe that fires on a cadence (ADR-0054): one run at a time, the Brief approved by the engine when the person said so. */
export const Schedule = z.object({
  id: z.string(),
  name: z.string().min(1).max(80),
  enabled: z.boolean().default(true),
  cadence: ScheduleCadence,
  recipe: GoalRecipe,
  /** the engine approves each run's Brief itself (and skips the interview); off = the Brief waits for the person like any goal's */
  autoApprove: z.boolean().default(true),
  createdAt: z.string(),
  /** the last time the schedule itself changed: the cadence counts from here when no run came later */
  updatedAt: z.string(),
  /** the last firing: when, the goal it made, or why no goal was made */
  lastRun: z.object({ at: z.string(), goalId: z.string().nullable(), skipped: z.string().nullable() }).nullable().default(null),
  /** firings so far, goals made or not */
  runs: z.number().int().nonnegative().default(0),
});
export type Schedule = z.infer<typeof Schedule>;

/** the names the web and the CLI show for a cadence */
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
