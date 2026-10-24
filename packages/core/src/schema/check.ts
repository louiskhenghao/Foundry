import { z } from 'zod';

export const CheckTier = z.enum(['must', 'stretch']);
export type CheckTier = z.infer<typeof CheckTier>;

export const CommandCheckSpec = z.object({
  type: z.literal('command'),
  cmd: z.string().min(1),
  cwd: z.string().optional(),
  timeoutMs: z.number().int().positive().default(300_000),
  expectExitCode: z.number().int().default(0),
  /** PORT and API_PORT are set to free ports: a milestone script's servers never land on the preview's or another task's */
  ports: z.boolean().optional(),
  /** a milestone script (repo-relative): it runs through the project's Playwright config on Chromium, as its recording does */
  milestone: z.string().optional(),
});

export const ReviewerCheckSpec = z.object({
  type: z.literal('reviewer'),
  scope: z.enum(['task-diff', 'goal-diff']),
  rubric: z.string().default(''),
});

export const LlmJudgeCheckSpec = z.object({
  type: z.literal('llm-judge'),
  prompt: z.string().min(1),
});

/** the engine opens the goal's preview headless, screenshots it and fails on console/page/network errors (goal-level, no LLM) */
export const SelfCheckSpec = z.object({
  type: z.literal('selfcheck'),
});

/**
 * the engine opens each figure page the task delivered (its `.html` Deliverables under artifacts/) in headless Chromium,
 * screenshots it and fails on script errors or a page that drew nothing (task-level, no LLM; ADR-0076)
 */
export const FigureCheckSpec = z.object({
  type: z.literal('figure'),
});

export const CheckSpec = z.discriminatedUnion('type', [CommandCheckSpec, ReviewerCheckSpec, LlmJudgeCheckSpec, SelfCheckSpec, FigureCheckSpec]);
export type CheckSpec = z.infer<typeof CheckSpec>;

export const Check = z.object({
  id: z.string(),
  goalId: z.string(),
  /** null = goal-level check */
  taskId: z.string().nullable(),
  name: z.string().min(1),
  tier: CheckTier,
  spec: CheckSpec,
});
export type Check = z.infer<typeof Check>;

export const CheckStatus = z.enum(['pass', 'fail', 'error', 'skipped']);
export type CheckStatus = z.infer<typeof CheckStatus>;

export const CheckResult = z.object({
  id: z.string(),
  checkId: z.string(),
  goalId: z.string(),
  taskId: z.string().nullable(),
  attemptId: z.string().nullable(),
  status: CheckStatus,
  /** distilled, ≤ ~4KB */
  summary: z.string(),
  /** path to the raw output file, if any */
  rawRef: z.string().nullable(),
  durationMs: z.number().int().nonnegative(),
  at: z.string(),
});
export type CheckResult = z.infer<typeof CheckResult>;
