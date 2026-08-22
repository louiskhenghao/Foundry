import { z } from 'zod';
import { CheckSpec, CheckTier } from './check.ts';
import { TaskKind, TaskScenario } from './task.ts';

export const BriefAssumption = z.object({
  id: z.string(),
  text: z.string(),
  accepted: z.boolean().default(true),
  /** a rejected assumption is a Decision; true once a Revise honoured it (or the human said no change was needed) */
  applied: z.boolean().default(false),
});
export type BriefAssumption = z.infer<typeof BriefAssumption>;

/**
 * An Area is a part of the product the goal covers (a user-facing role or app, or cross-cutting groundwork).
 * Every task, goal-level check and question belongs to one; coverage = every Area has at least one task.
 */
export const BriefArea = z.object({
  key: z.string(),
  name: z.string(),
  /** short kebab-case English slug; the default Conventional Commits scope of the Area's tasks */
  slug: z.string(),
  description: z.string().default(''),
});
export type BriefArea = z.infer<typeof BriefArea>;

export const BriefCheck = z.object({
  key: z.string(),
  name: z.string(),
  tier: CheckTier,
  /** null = goal-level check; otherwise the key of the task it belongs to */
  taskKey: z.string().nullable().default(null),
  /** Area of a goal-level check; task-level checks take their task's Area */
  areaKey: z.string().nullable().default(null),
  spec: CheckSpec,
});
export type BriefCheck = z.infer<typeof BriefCheck>;

export const BriefTask = z.object({
  key: z.string(),
  /** imperative, Conventional-Commit style subject without the type prefix (the type comes from `kind`) */
  title: z.string(),
  spec: z.string(),
  kind: TaskKind.default('feature'),
  /** optional Conventional Commit scope, e.g. the module touched; defaults to the Area slug when null */
  scope: z.string().nullable().default(null),
  scenario: TaskScenario.default('general'),
  areaKey: z.string().nullable().default(null),
  /** inherit the goal's TDD discipline, or off for this task (docs/infra tasks are set off automatically) */
  tdd: z.enum(['inherit', 'off']).default('inherit'),
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
  areaKey: z.string().nullable().default(null),
  /** an answered question is a Decision; true once a Revise honoured it (or the human said no change was needed) */
  applied: z.boolean().default(false),
});
export type BriefQuestion = z.infer<typeof BriefQuestion>;

export const Brief = z.object({
  goalId: z.string(),
  /** Conventional Commit header summarising the whole goal; becomes the PR title. Empty = derive from the goal title. */
  title: z.string().default(''),
  understanding: z.string(),
  areas: z.array(BriefArea).default([]),
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
const OutputTask = z.object({
  key: z.string().describe('Short unique key, e.g. T1'),
  title: z.string().describe('Imperative commit subject, ≤ 60 chars, no trailing period, NO type prefix (e.g. "add quote engine with PDF tests", not "feat: …"). It becomes the commit message and PR title.'),
  spec: z.string().describe('Markdown spec: what to change, where, and how to know it is done.'),
  kind: z.enum(['feature', 'bug', 'refactor', 'research', 'chore']).describe('feature = new behaviour; bug = something is broken and must be reproduced first; refactor = behaviour-preserving restructure; research = a spike whose output is knowledge, not production code; chore = config/tooling.'),
  scope: z.string().nullable().describe('Conventional Commits scope (e.g. "quotes", "api", "ui"); null = use the Area slug.'),
  scenario: z
    .enum(['frontend', 'backend', 'fullstack', 'data', 'mobile', 'infra', 'docs', 'general'])
    .describe('Where the work happens: frontend = UI, pages, styling, components; backend = APIs, services, database; fullstack = substantial changes on both sides; data = data processing, scripts, analysis; mobile = native/mobile app; infra = CI, build, deploy, configuration; docs = documentation only; general = anything else.'),
  areaKey: z.string().describe('Key of the Area this task belongs to.'),
  dependsOnKeys: z.array(z.string()),
  parallelizable: z.boolean(),
  relevantFiles: z.array(z.string()).describe('Repo-relative paths the worker should start from.'),
});

const OutputCheck = z.object({
  key: z.string(),
  name: z.string(),
  tier: z.enum(['must', 'stretch']),
  taskKey: z.string().nullable().describe('Task key this check belongs to, or null for a goal-level check.'),
  areaKey: z.string().nullable().describe('For goal-level checks: the Area it verifies (null if it spans the whole goal, e.g. the test suite).'),
  type: z.enum(['command', 'reviewer']),
  cmd: z.string().nullable().describe('Shell command for type=command; exit code 0 means pass.'),
  rubric: z.string().nullable().describe('For type=reviewer: what the reviewer must verify.'),
});

export const BriefOutput = z.object({
  title: z.string().describe('One Conventional Commits header for the whole goal, e.g. "feat(site): add resort landing page". ≤ 72 chars. Used as the pull request title.'),
  understanding: z.string().describe('Your understanding of the goal in 3-8 sentences.'),
  areas: z
    .array(
      z.object({
        key: z.string().describe('Short unique key, e.g. A1'),
        name: z.string().describe('Name in the language of the goal, e.g. "Student portal", "教师端".'),
        slug: z.string().describe('Short kebab-case English slug used as the Conventional Commits scope, e.g. "student-portal".'),
        description: z.string().describe('One sentence: what this Area covers within the goal.'),
      }),
    )
    .min(1)
    .describe('The parts of the product this goal covers: one Area per user-facing role/app the goal names, plus a "shared" Area for groundwork they all need. A small goal has exactly one Area. Every Area must get at least one task.'),
  assumptions: z.array(z.string()).describe('Assumptions you are proceeding on. Each can be overridden by the user.'),
  tasks: z.array(OutputTask).min(1),
  checks: z.array(OutputCheck).min(1),
  costEstimateUsd: z.number(),
  timeEstimateMin: z.number(),
  questions: z
    .array(
      z.object({
        text: z.string(),
        blocking: z.boolean().describe('true only if you genuinely cannot proceed without an answer.'),
        areaKey: z.string().nullable().describe('The Area the question is about, or null.'),
      }),
    )
    .describe('Questions you could not safely assume. Prefer assumptions over questions.'),
});
export type BriefOutput = z.infer<typeof BriefOutput>;

/**
 * What a Revise session emits: the whole Brief again, honouring the human's Decisions. Questions stay the human's
 * (only new, non-blocking ones may be added); keys of unchanged tasks/checks/areas must be kept so the page can diff.
 */
export const RevisionOutput = BriefOutput.omit({ questions: true }).extend({
  changeSummary: z.string().describe('One to three sentences for the human: what changed because of which decision, and what was left alone.'),
  newQuestions: z
    .array(z.object({ text: z.string(), areaKey: z.string().nullable() }))
    .describe('Only genuinely new, non-blocking questions raised by the decisions. Usually empty.'),
});
export type RevisionOutput = z.infer<typeof RevisionOutput>;

/** What a Draft session emits for one task (mode `task` fills everything, mode `acceptance` only proposes checks). */
export const TaskDraftOutput = z.object({
  spec: z.string().nullable().describe('Markdown spec for the task, or null when only acceptance was requested.'),
  kind: OutputTask.shape.kind.nullable(),
  scope: OutputTask.shape.scope,
  scenario: OutputTask.shape.scenario.nullable(),
  areaKey: z.string().nullable(),
  dependsOnKeys: z.array(z.string()).describe('Keys of existing tasks this one must run after.'),
  relevantFiles: z.array(z.string()),
  checks: z.array(OutputCheck.omit({ key: true, taskKey: true, areaKey: true })).describe('Acceptance checks for this task only.'),
  rationale: z.string().describe('One or two sentences for the human: why these choices.'),
});
export type TaskDraftOutput = z.infer<typeof TaskDraftOutput>;

/** What a Draft session emits for an uncovered Area: new tasks (keys are placeholders, the engine renumbers) and their checks. */
export const AreaDraftOutput = z.object({
  tasks: z.array(OutputTask).min(1),
  checks: z.array(OutputCheck).describe('Checks for the new tasks (taskKey = one of the new keys) or goal-level checks for this Area.'),
  rationale: z.string(),
});
export type AreaDraftOutput = z.infer<typeof AreaDraftOutput>;
