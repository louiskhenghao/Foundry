import { z } from 'zod';
import { CheckSpec, CheckTier } from './check.ts';
import { TaskKind, TaskScenario } from './task.ts';

export const BriefAssumption = z.object({
  id: z.string(),
  text: z.string(),
  accepted: z.boolean().default(true),
});

export const BriefCheck = z.object({
  key: z.string(),
  name: z.string(),
  tier: CheckTier,
  /** null = goal-level check; otherwise the key of the task it belongs to */
  taskKey: z.string().nullable().default(null),
  spec: CheckSpec,
});
export type BriefCheck = z.infer<typeof BriefCheck>;

export const BriefTask = z.object({
  key: z.string(),
  /** imperative, Conventional-Commit style subject without the type prefix (the type comes from `kind`) */
  title: z.string(),
  spec: z.string(),
  kind: TaskKind.default('feature'),
  /** optional Conventional Commit scope, e.g. the module touched */
  scope: z.string().nullable().default(null),
  scenario: TaskScenario.default('general'),
  dependsOnKeys: z.array(z.string()).default([]),
  parallelizable: z.boolean().default(true),
  relevantFiles: z.array(z.string()).default([]),
});
export type BriefTask = z.infer<typeof BriefTask>;

export const BriefQuestion = z.object({
  id: z.string(),
  text: z.string(),
  answer: z.string().nullable().default(null),
  blocking: z.boolean().default(true),
});

export const Brief = z.object({
  goalId: z.string(),
  /** Conventional Commit header summarising the whole goal; becomes the PR title. Empty = derive from the goal title. */
  title: z.string().default(''),
  understanding: z.string(),
  assumptions: z.array(BriefAssumption),
  checks: z.array(BriefCheck),
  tasks: z.array(BriefTask),
  costEstimateUsd: z.number().nonnegative(),
  timeEstimateMin: z.number().nonnegative(),
  questions: z.array(BriefQuestion),
});
export type Brief = z.infer<typeof Brief>;

/**
 * What the Clarifier session must emit (no goalId, ids are assigned by the engine).
 * Kept separate so the JSON schema handed to Claude is minimal.
 */
export const BriefOutput = z.object({
  title: z.string().describe('One Conventional Commits header for the whole goal, e.g. "feat(site): add resort landing page". ≤ 72 chars. Used as the pull request title.'),
  understanding: z.string().describe('Your understanding of the goal in 3-8 sentences.'),
  assumptions: z.array(z.string()).describe('Assumptions you are proceeding on. Each can be overridden by the user.'),
  tasks: z
    .array(
      z.object({
        key: z.string().describe('Short unique key, e.g. T1'),
        title: z.string().describe('Imperative commit subject, ≤ 60 chars, no trailing period, NO type prefix (e.g. "add quote engine with PDF tests", not "feat: …"). It becomes the commit message and PR title.'),
        spec: z.string().describe('Markdown spec: what to change, where, and how to know it is done.'),
        kind: z.enum(['feature', 'bug', 'refactor', 'research', 'chore']).describe('feature = new behaviour; bug = something is broken and must be reproduced first; refactor = behaviour-preserving restructure; research = a spike whose output is knowledge, not production code; chore = config/tooling.'),
        scope: z.string().nullable().describe('Conventional Commits scope: the module/area touched (e.g. "quotes", "api", "ui"), or null.'),
        scenario: z
          .enum(['frontend', 'backend', 'fullstack', 'data', 'mobile', 'infra', 'docs', 'general'])
          .describe('Where the work happens: frontend = UI, pages, styling, components; backend = APIs, services, database; fullstack = substantial changes on both sides; data = data processing, scripts, analysis; mobile = native/mobile app; infra = CI, build, deploy, configuration; docs = documentation only; general = anything else.'),
        dependsOnKeys: z.array(z.string()),
        parallelizable: z.boolean(),
        relevantFiles: z.array(z.string()).describe('Repo-relative paths the worker should start from.'),
      }),
    )
    .min(1),
  checks: z
    .array(
      z.object({
        key: z.string(),
        name: z.string(),
        tier: z.enum(['must', 'stretch']),
        taskKey: z.string().nullable().describe('Task key this check belongs to, or null for a goal-level check.'),
        type: z.enum(['command', 'reviewer']),
        cmd: z.string().nullable().describe('Shell command for type=command; exit code 0 means pass.'),
        rubric: z.string().nullable().describe('For type=reviewer: what the reviewer must verify.'),
      }),
    )
    .min(1),
  costEstimateUsd: z.number(),
  timeEstimateMin: z.number(),
  questions: z
    .array(
      z.object({
        text: z.string(),
        blocking: z.boolean().describe('true only if you genuinely cannot proceed without an answer.'),
      }),
    )
    .describe('Questions you could not safely assume. Prefer assumptions over questions.'),
});
export type BriefOutput = z.infer<typeof BriefOutput>;
