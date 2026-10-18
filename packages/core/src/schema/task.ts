import { z } from 'zod';

/** `skipped` = the human chose to move on without this task; dependents proceed, the goal review judges the result. */
export const TaskState = z.enum(['pending', 'ready', 'running', 'observing', 'merging', 'blocked', 'done', 'failed', 'skipped']);
export type TaskState = z.infer<typeof TaskState>;

/** How hard a task is for a worker; picks the model route (Settings → Models). */
export const TaskDifficulty = z.preprocess(
  // the first release named them routine / normal / hard: events written then replay as simple / standard / complex
  (v) => (v === 'routine' ? 'simple' : v === 'normal' ? 'standard' : v === 'hard' ? 'complex' : v),
  z.enum(['simple', 'standard', 'complex']),
);
export type TaskDifficulty = 'simple' | 'standard' | 'complex';

/** the task id a goal's final walkthrough uses where a milestone's task id goes (its checkpoint, its feedback fixes) */
export const FINAL_WALK = 'final';

export const TaskOrigin = z.enum(['brief', 'goal-review-fix', 'merge', 'delivery-fix', 'feedback-fix', 'audit-fix', 'likeness-fix']);

/**
 * What kind of work a task is; selects the workflow discipline the worker is asked to follow (tdd vs diagnosing-bugs …).
 * `goal` = a step too big for one session: a Delegated goal (its own Clarify, plan and tasks) does it, and its result
 * lands on this goal's branch as this task's commit. Only a goal whose Brief allowed delegation plans such tasks.
 */
export const TaskKind = z.enum(['feature', 'bug', 'refactor', 'research', 'chore', 'goal']);
export type TaskKind = z.infer<typeof TaskKind>;
/** the kinds a worker session runs: every kind but `goal` */
export const WORKER_TASK_KINDS = ['feature', 'bug', 'refactor', 'research', 'chore'] as const satisfies readonly TaskKind[];

/** The area a task works in; selects scenario-specific skills (design packs for UI work, image/video packs for media, …). */
export const TaskScenario = z.enum(['frontend', 'backend', 'fullstack', 'data', 'mobile', 'infra', 'docs', 'research', 'image', 'video', 'cad', 'general']);
export type TaskScenario = z.infer<typeof TaskScenario>;
export const TASK_SCENARIOS = TaskScenario.options;
/** tasks whose deliverables are files under artifacts/ (a model and its snapshots, images, video): kept out of git, carried between workspaces, shown by their milestone */
export const ARTIFACT_SCENARIOS: readonly TaskScenario[] = ['image', 'video', 'cad'];

export const Task = z.object({
  id: z.string(),
  goalId: z.string(),
  title: z.string().min(1),
  /** markdown spec handed to the worker */
  spec: z.string(),
  /** default keeps pre-kind `task.created` events replayable */
  kind: TaskKind.default('feature'),
  /** simple / standard / complex — the Clarifier's call, the human's to change; default keeps older events replayable */
  difficulty: TaskDifficulty.default('standard'),
  /** Conventional Commit scope for this task's commit, or null */
  scope: z.string().nullable().default(null),
  /** default keeps pre-scenario `task.created` events replayable */
  scenario: TaskScenario.default('general'),
  /** name of the Brief Area this task belongs to (display + worker prompt), or null */
  area: z.string().nullable().default(null),
  /** per-task override of the goal's TDD discipline: off = never asked for on this task */
  tdd: z.enum(['inherit', 'off']).default('inherit'),
  /** goal-branch ref the task started from (set once at its first attempt; cleared on restart) */
  baseRef: z.string().nullable().default(null),
  /** the single Conventional Commit the task was squashed into on the goal branch; null = not committed yet / no changes */
  commitRef: z.string().nullable().default(null),
  commitMessage: z.string().nullable().default(null),
  dependsOn: z.array(z.string()),
  relevantFiles: z.array(z.string()),
  /** Deliverables: the files it leaves for the tasks after it (repo-relative, or under artifacts/), each a must check when it lands; absent on tasks from before */
  delivers: z.array(z.string()).optional(),
  /** a `goal` task: the share of the goal's cost budget (USD) its Delegated goal may spend; null = an even share of what is left */
  budgetUsd: z.number().positive().nullable().optional(),
  parallelizable: z.boolean(),
  retryBudget: z.number().int().positive(),
  origin: TaskOrigin,
  /** what a person should look at or try once this task lands — non-null makes the task a milestone (the goal pauses there) */
  milestone: z.string().nullable().default(null),
  /** a feature milestone's Playwright script (repo-relative): it must pass for the task to land, and Foundry runs it to record the milestone */
  milestoneScript: z.string().nullable().optional(),
  /** how many times the goal has paused at this milestone: the first look, then at most one re-check after feedback fixes */
  milestoneVisits: z.number().int().nonnegative().default(0),
  /** for a feedback-fix task: the milestone task whose checkpoint re-opens once this one lands */
  checkpointOf: z.string().nullable().default(null),
  state: TaskState,
  /** git branch this task works on (task/<id>) or null when it works on the goal branch */
  branch: z.string().nullable(),
  worktreePath: z.string().nullable(),
  /** human hint injected into the next attempt (from an escalation answer) */
  hint: z.string().nullable(),
  extraAttempts: z.number().int().nonnegative(),
  /** a `goal` task: the Delegated goal doing it (set once it is created; a restart of this task starts a new one) */
  delegatedGoalId: z.string().nullable().default(null),
  /** what this task delivered, written when it landed, for the tasks that depend on it (a Delegated goal's summary; null = none yet) */
  summary: z.string().nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Task = z.infer<typeof Task>;
