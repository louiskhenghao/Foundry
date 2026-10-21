import { CodexEffort, CodexModelPreset } from './codex-presets.ts';
import { z } from 'zod';
import { Attachment } from './attachment.ts';
import { BriefStyleOption } from './brief.ts';
import { BriefSubject } from './subject.ts';
import { DeliveryState, IDLE_DELIVERY } from './delivery.ts';
import { Deployment } from './deploy.ts';
import { Interview, ReviseState } from './interview.ts';

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
 * artifact conventions for media and CAD), the default view (prose and media goals open Simple; cad, code work with a
 * geometry kernel, keeps the default) and completion defaults.
 * `auto` = the user did not say; the Clarifier decides from the prompt and the engine records its verdict.
 */
export const GoalNature = z.enum(['auto', 'code', 'docs', 'research', 'image', 'video', 'cad']);
export type GoalNature = z.infer<typeof GoalNature>;
/** natures judged by eye: the fast pace by default, image tools writing into artifacts/ (delivery reads ARTIFACT_NATURES) */
export const MEDIA_NATURES: GoalNature[] = ['image', 'video'];
/** natures whose deliverables are files under artifacts/ (kept out of git, delivered to the output folder) */
export const ARTIFACT_NATURES: GoalNature[] = ['image', 'video', 'cad'];

/**
 * The workflow suite a goal's sessions follow (ADR-0049): whose skills the roles are told to invoke. mattpocock (the
 * default) = Matt Pocock's suite; pstack = pstack's, with Matt Pocock's skills where it has none; plain = the one-line
 * hint of installed skills only.
 */
export const WorkflowProfile = z.enum(['mattpocock', 'pstack', 'plain']);
export type WorkflowProfile = z.infer<typeof WorkflowProfile>;

/** How hard the engine pushes a discipline: required = MUST + noted when skipped; preferred = suggested only; off = not mentioned. */
export const Discipline = z.enum(['required', 'preferred', 'off']);
export type Discipline = z.infer<typeof Discipline>;

/** thorough = the engine adds its own AI reviews on top of the Brief's checks; fast = only what the Brief asked for runs. */
export const GoalPace = z.enum(['thorough', 'fast']);
export type GoalPace = z.infer<typeof GoalPace>;

/** shipped software a goal learns from: where it is (a URL or a path on this computer) and which feature to study */
export const GoalReference = z.object({
  target: z.string().min(1),
  /** which feature or behaviour to understand, in the person's words */
  lookAt: z.string().default(''),
});
export type GoalReference = z.infer<typeof GoalReference>;

/** what the investigation of a goal's references produced: a report (an attachment, and a document on the goal branch) */
export const GoalInvestigation = z.object({
  status: z.enum(['ok', 'failed', 'skipped']),
  summary: z.string(),
  /** the report among the goal's attachments */
  attachmentId: z.string().nullable(),
  /** the report committed on the goal branch, repository-relative, and that commit */
  docPath: z.string().nullable(),
  docRef: z.string().nullable().default(null),
  costUsd: z.number(),
  detail: z.string(),
  at: z.string(),
});
export type GoalInvestigation = z.infer<typeof GoalInvestigation>;

/** Ponytail, the lazy senior dev: on = workers climb its ladder before writing, the planner plans lean, ponytail-review reviews */
export const PonytailSwitch = z.enum(['on', 'off']);
export type PonytailSwitch = z.infer<typeof PonytailSwitch>;

export const GoalWorkflow = z.object({
  tdd: Discipline.default('required'),
  /** default keeps pre-pace goals replayable */
  pace: GoalPace.default('thorough'),
  /** default: goals from before the switch get it too, from their next session */
  ponytail: PonytailSwitch.default('on'),
  /** frozen at creation; absent on a goal from before suites were per goal: the Settings default applies at session time */
  profile: WorkflowProfile.optional(),
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
/** one thing the audit found, ranked the way ponytail-audit ranks: must fix, should fix, nice to have */
export const AuditFinding = z.object({
  severity: z.enum(['must', 'should', 'nice']),
  title: z.string(),
  /** what the code does and what goes wrong, with the concrete case */
  problem: z.string(),
  fix: z.string(),
  files: z.array(z.string()).default([]),
  /** in code this goal changed: a must-fix finding here becomes a fix task */
  inScope: z.boolean().default(false),
  /** the fix task this finding became, when it did (a must-fix finding in scope beyond the cap, or after the goal stopped, has none) */
  fixTaskId: z.string().nullable().default(null),
});
export type AuditFinding = z.infer<typeof AuditFinding>;

/** one thing the browser QA tried (ADR-0057): an acceptance check by name, or `general` for a problem outside them */
export const QaResult = z.object({
  check: z.string(),
  status: z.enum(['pass', 'fail', 'skipped']),
  /** what was done in the browser and what was seen */
  evidence: z.string(),
  problem: z.string().nullable().default(null),
  fix: z.string().nullable().default(null),
  files: z.array(z.string()).default([]),
  /** screenshot file names under the goal's screenshots folder */
  shots: z.array(z.string()).default([]),
  /** the check is a must check of the goal: a failure becomes a fix task */
  must: z.boolean().default(false),
  /** the fix task this failure became, when it did */
  fixTaskId: z.string().nullable().default(null),
});
export type QaResult = z.infer<typeof QaResult>;

export const GoalCompletion = z.object({
  graphRefresh: z.boolean().default(false),
  docs: z.array(DocType).default([]),
  /** ponytail-audit on the finished branch once every task is done, before the goal review */
  audit: z.boolean().default(false),
  /** the browser QA on the finished app once every task is done, before the goal review (ADR-0057) */
  qa: z.boolean().default(false),
  /** result of the browser QA (null = not run yet): what it tried, and the fix tasks its failed must checks became */
  qaRun: z.object({ status: z.enum(['ok', 'skipped', 'failed']), summary: z.string(), results: z.array(QaResult), fixTaskIds: z.array(z.string()), costUsd: z.number(), detail: z.string(), at: z.string() }).nullable().default(null),
  /** result of the audit (null = not run yet): its findings, and the fix tasks its in-scope must-fix findings became */
  auditRun: z.object({ status: z.enum(['ok', 'skipped', 'failed']), summary: z.string(), findings: z.array(AuditFinding), fixTaskIds: z.array(z.string()), costUsd: z.number(), detail: z.string(), at: z.string() }).nullable().default(null),
  /** result of the docs-generation session (null = not run yet) */
  docsRun: z.object({ status: z.enum(['ok', 'skipped', 'failed']), types: z.array(DocType), files: z.array(z.string()), costUsd: z.number(), detail: z.string(), at: z.string(), ref: z.string().nullable().default(null), pr: z.object({ number: z.number().int(), url: z.string(), branch: z.string() }).nullable().default(null) }).nullable().default(null),
  /** result of the graph refresh (null = not run yet) */
  graphRun: z.object({ tools: z.array(z.object({ name: z.string(), status: z.enum(['ok', 'skipped', 'failed']), detail: z.string() })), at: z.string() }).nullable().default(null),
  /** result of copying the media artifacts to the goal's output folder at done (null = not run yet) */
  artifactsRun: z
    .object({
      status: z.enum(['ok', 'skipped', 'failed']),
      files: z.array(z.string()),
      dest: z.string(),
      detail: z.string(),
      at: z.string(),
      /** a cad goal's model for the CAD Viewer among `files` (null = none); not recorded by deliveries before it was */
      model: z.string().nullable().optional(),
      /** when the copy began; not recorded by deliveries before it was */
      startedAt: z.string().optional(),
      /** each copy's identity in the output folder as it was made; not recorded by deliveries before it was */
      copies: z.record(z.string(), z.string()).optional(),
    })
    .nullable()
    .default(null),
});
export type GoalCompletion = z.infer<typeof GoalCompletion>;
export const IDLE_COMPLETION: GoalCompletion = { graphRefresh: false, docs: [], audit: false, auditRun: null, qa: false, qaRun: null, docsRun: null, graphRun: null, artifactsRun: null };

/**
 * Delegation: whether the planner may plan `goal` tasks (steps done by a Delegated goal of their own), and whether such a
 * goal's Brief is approved without the human. Both off by default; a Delegated goal never delegates again (one level).
 */
export const GoalDelegation = z.object({
  allow: z.boolean().default(false),
  autoApprove: z.boolean().default(false),
});
export type GoalDelegation = z.infer<typeof GoalDelegation>;
export const NO_DELEGATION: GoalDelegation = { allow: false, autoApprove: false };

/**
 * A Delegated goal: this goal does one `goal` task of a main goal. Kept on the Delegated goal (the main goal's task
 * points back with `delegatedGoalId`); the title is kept so the link still reads once the main goal is deleted.
 */
export const GoalDelegatedFrom = z.object({
  goalId: z.string(),
  taskId: z.string(),
  /** the main goal's title when the Delegated goal was created */
  title: z.string(),
  /** the main goal's chosen Style Proposal, kept: the Delegated goal's Brief starts with it picked; null = none */
  style: BriefStyleOption.nullable().default(null),
  /** the main goal's Subjects with their pictures (copied into this goal's subjects folder): its Brief starts with them */
  subjects: z.array(BriefSubject).optional(),
  at: z.string(),
});
export type GoalDelegatedFrom = z.infer<typeof GoalDelegatedFrom>;

/** Goal states a Follow-up can be created from: the earlier goal is finished, whatever the outcome. */
export const FOLLOWABLE_STATES: GoalState[] = ['done', 'over_delivered', 'failed', 'cancelled'];

/**
 * A Follow-up: this goal continues an earlier goal of the same repository (B follows A). Kept on B, so deleting A
 * later breaks nothing: everything B needs from A is snapshotted here. "Followed by" is derived (goals whose
 * `follows.goalId` is A).
 */
export const GoalFollows = z.object({
  goalId: z.string(),
  /** A's title when the link was made; shown as-is once A has been deleted */
  title: z.string(),
  /** created = B was created to follow A (context snapshotted, start point chosen); linked = marked afterwards, relationship only */
  via: z.enum(['created', 'linked']),
  /** where B's goal branch starts: the base branch (A's work is already on it) or A's goal branch; null when linked */
  startFrom: z.enum(['base', 'previous']).nullable(),
  /** A's goal branch when B was created (B starts from it when startFrom = previous) */
  branch: z.string().nullable(),
  /** the "# Previous goal" section rendered from A at creation, handed to Clarify; '' when linked */
  context: z.string(),
  /** A's chosen Style Proposal, kept for B; null = none, or the human opted out */
  style: BriefStyleOption.nullable(),
  /** A's Subjects with their pictures (copied into B's subjects folder): B's Brief starts with them */
  subjects: z.array(BriefSubject).optional(),
  at: z.string(),
});
export type GoalFollows = z.infer<typeof GoalFollows>;

/**
 * The GitHub issue a Goal was made from (ADR-0052). Read once, when the person pressed Read issue: the issue's thread
 * is the Goal's attachment, the body its description; the pull request of the Delivery closes the issue when it merges.
 */
export const GoalIssue = z.object({
  /** owner/name of the repository the issue is in */
  repo: z.string().min(1),
  number: z.number().int().positive(),
  url: z.string().url(),
  /** the issue's title when it was read */
  title: z.string(),
  state: z.enum(['open', 'closed']),
  labels: z.array(z.string()).default([]),
  /** when it was read: the attachment snapshot dates from then */
  readAt: z.string(),
});
export type GoalIssue = z.infer<typeof GoalIssue>;

/** the Schedule a Goal was made by, on the Goal (ADR-0054) */
export const GoalSchedule = z.object({
  id: z.string(),
  /** the schedule's name when it fired; shown as-is once the schedule is deleted */
  name: z.string(),
  at: z.string(),
  /** the engine approves the Brief itself (the interview was skipped) */
  autoApprove: z.boolean(),
});
export type GoalSchedule = z.infer<typeof GoalSchedule>;

/**
 * Where an Imported Goal came from and how far it got here (ADR-0030). It arrives as history; mapping its repository
 * restores its branch, and an unfinished one can then be Reattached. Absent on goals made on this instance.
 */
export const GoalTransfer = z.object({
  transferId: z.string(),
  from: z.object({ release: z.string(), hostname: z.string(), exportedAt: z.string() }),
  importedAt: z.string(),
  /** the goal was not finished when it was exported: it can be Reattached */
  unfinished: z.boolean(),
  /** the goal branch carried as a git bundle, data-dir-relative; null = the base branch already had all of it */
  bundle: z.string().nullable(),
  /** the git-excluded files of its progress folder (media artifacts, style samples), data-dir-relative; null = none came */
  artifacts: z.string().nullable(),
  /** its session transcripts and check output came along */
  transcripts: z.boolean(),
  /** the paths it had on the computer it came from */
  original: z.object({ repoPath: z.string(), workspaceDir: z.string().nullable(), outputDir: z.string().nullable() }),
  repoMapped: z.object({ to: z.string(), how: z.enum(['same-path', 'chosen']), at: z.string() }).nullable(),
  branchRestored: z.object({ head: z.string(), at: z.string() }).nullable(),
  reattachedAt: z.string().nullable(),
});
export type GoalTransfer = z.infer<typeof GoalTransfer>;

/** An Imported Goal not Reattached yet: readable history the engine never acts on by itself */
export function isHistory(g: { transfer?: GoalTransfer | null }): boolean {
  return !!g.transfer && !g.transfer.reattachedAt;
}

/** The goal's repository is a checkout on this computer: always, except for an Imported Goal whose repository is not mapped yet */
export function repoHere(g: { transfer?: GoalTransfer | null }): boolean {
  return !g.transfer || !!g.transfer.repoMapped;
}

/** where a finished goal's preview runs (see Goal.previewPlace) */
export const PreviewPlace = z.enum(['auto', 'checkout', 'foundry']);
export type PreviewPlace = z.infer<typeof PreviewPlace>;

export const Goal = z.object({
  /** Fixed at creation. Absent only in events written before provider support. */
  provider: z.enum(['claude', 'codex']).optional(),
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
  /** pause at milestones for the human's look ("Have a look"); off = the goal goes on and the milestone is only notified */
  milestonePause: z.boolean().default(true),
  /** the final walkthrough: every milestone script run once all tasks are done (ranAt null = due again after new tasks);
   * looks = how many times the goal paused for it (a first look, then at most one more after feedback fixes) */
  finalWalk: z.object({ ranAt: z.string().nullable(), passed: z.boolean().nullable(), looks: z.number().int().nonnegative() }).optional(),
  /** the branch a finished goal's preview runs from; null = the goal branch while its folder exists, else the base branch */
  previewRef: z.string().nullable().default(null),
  /**
   * where a finished goal's preview runs: `auto` = the person's checkout when it is on the chosen branch, else Foundry's
   * preview folder; `checkout` = the person's checkout as it is, whatever its branch; `foundry` = always Foundry's folder
   */
  previewPlace: PreviewPlace.default('auto'),
  /** which Clarify step runs and since when: REA, a wait for a free session slot, the Clarifier (reading the repository, writing its answer) or the planner */
  clarifyStage: z.object({ stage: z.enum(['investigating', 'queued', 'clarifying', 'planning']), at: z.string() }).nullable().default(null),
  /** shipped software the goal learns from (a site, an app, a package): REA investigates each one before Clarify */
  references: z.array(GoalReference).default([]),
  /** the investigation of the references; its report is an attachment and a committed document (null = not run yet) */
  investigation: GoalInvestigation.nullable().default(null),
  /** the Clarify interview (rounds of questions before the Brief); null = the one-shot Clarify of before */
  interview: Interview.nullable().default(null),
  /** a Revise that asked the human back before proposing; null until one does */
  revise: ReviseState.nullable().default(null),
  /** effort level for every session of this goal; null = Settings default / CLI default */
  effort: CodexEffort.nullable().default(null),
  /** the model preset this goal uses; null = the preset Settings picks for its nature */
  codexPreset: CodexModelPreset.optional(),
  /** Explicit all-role model selection, retained separately from the captured role table for follow-ups. */
  codexModelOverride: z.string().trim().min(1).optional(),
  codexFallbacks: z.array(z.string().min(1)).optional(),
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
  /** every deploy of the goal's web app (ADR-0041), oldest first; absent on goals never deployed */
  deployments: z.array(Deployment).optional(),
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
      /** previous = a Follow-up started from the earlier goal's branch */
      startedFrom: z.enum(['local', 'remote', 'previous']),
      detail: z.string(),
      at: z.string(),
    })
    .nullable()
    .default(null),
  /** result of the per-goal autoskills run (project skills matched to the repository's stack) */
  autoskills: z.object({ status: z.enum(['installed', 'skipped', 'failed']), skills: z.array(z.string()), detail: z.string(), at: z.string() }).nullable().default(null),
  /** completion actions chosen at Brief approval; default keeps pre-completion `goal.created` events replayable */
  completion: GoalCompletion.default(() => ({ ...IDLE_COMPLETION })),
  /** the earlier goal this one follows; default keeps pre-follow-up `goal.created` events replayable */
  follows: GoalFollows.nullable().default(null),
  /** may the planner delegate steps to goals of their own, and are their Briefs approved without the human; default keeps older events replayable */
  delegation: GoalDelegation.default(() => ({ ...NO_DELEGATION })),
  /** set on a Delegated goal: the main goal and the task it does */
  delegatedFrom: GoalDelegatedFrom.nullable().default(null),
  /** the GitHub issue the goal was made from (ADR-0052); absent on goals made before, and on goals made some other way */
  issue: GoalIssue.nullable().optional(),
  /** the Schedule the goal was made by (ADR-0054); absent on goals made by hand */
  schedule: GoalSchedule.nullable().optional(),
  /** who asked for the goal: the Person signed in when it was made (ADR-0061); null or absent when Access is off or it came another way */
  by: z.string().nullable().optional(),
  /** who approved its Brief: the Person signed in, or the chat it was approved from; absent before Access existed */
  approvedBy: z.string().nullable().optional(),
  /** set when the goal arrived through a Transfer (ADR-0030) */
  transfer: GoalTransfer.optional(),
  runningSince: z.string().nullable(),
  /**
   * Time Foundry spent working on the goal (Clarify, the run, the goal review, delivery), not counting the waits for the
   * person: interview answers, Brief approval, a block, a milestone pause. Counted up to `activeSince` while it works.
   * Absent on goals made before this was counted: their time runs from `runningSince` (budgetStatus).
   */
  activeMs: z.number().nonnegative().optional(),
  activeSince: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Goal = z.infer<typeof Goal>;
