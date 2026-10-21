import { z } from 'zod';

export const DeliveryMode = z.enum(['local', 'push', 'pr', 'pr-automerge']);
export type DeliveryMode = z.infer<typeof DeliveryMode>;
export const MergeMethod = z.enum(['squash', 'merge', 'rebase']);
export type MergeMethod = z.infer<typeof MergeMethod>;
/**
 * `goal` = one branch / one PR for the whole goal. `task` = one branch / one PR per task, built from
 * the tasks' commits and stacked bottom-up (PR n is based on PR n-1); auto-merge walks the stack in order.
 */
export const DeliveryUnit = z.enum(['goal', 'task']);
export type DeliveryUnit = z.infer<typeof DeliveryUnit>;

/** What the human authorised the ENGINE to do with the goal branch once the goal is done. */
export const DeliveryPolicy = z.object({
  mode: DeliveryMode.default('local'),
  /** default keeps policies recorded before the field existed on the whole-goal path */
  unit: DeliveryUnit.default('goal'),
  remote: z.string().min(1).default('origin'),
  /** null = goal.baseBranch */
  baseBranch: z.string().nullable().default(null),
  /** add the remote by URL when it does not exist (works without gh) */
  remoteUrl: z.string().nullable().default(null),
  /** create the GitHub repo when no remote exists (needs gh) */
  createRepo: z.object({ owner: z.string().min(1), name: z.string().min(1), visibility: z.enum(['private', 'public']).default('private') }).nullable().default(null),
  mergeMethod: MergeMethod.default('squash'),
  requireChecks: z.boolean().default(true),
  mergeIfNoChecks: z.boolean().default(true),
  autoResolveConflicts: z.boolean().default(true),
  fixCiCycles: z.number().int().min(0).max(2).default(1),
  /** rounds of review comments on the pull request Foundry addresses by itself (ADR-0053); more on the person's click */
  fixReviewCycles: z.number().int().min(0).max(3).default(1),
  deleteRemoteBranch: z.boolean().default(true),
});
export type DeliveryPolicy = z.infer<typeof DeliveryPolicy>;
export const LOCAL_POLICY: DeliveryPolicy = DeliveryPolicy.parse({});

export const DeliveryStep = z.enum(['preflight', 'ensure-remote', 'sync-base', 'build-stack', 'push', 'open-pr', 'fix-review', 'wait-checks', 'fix-ci', 'merge', 'cleanup']);
export type DeliveryStep = z.infer<typeof DeliveryStep>;
export const DeliveryStatus = z.enum(['idle', 'running', 'delivered', 'failed']);
export type DeliveryStatus = z.infer<typeof DeliveryStatus>;
/** `by_you`: the human marked the delivery done after handling it themselves (nothing on the machine is changed) */
export const DeliveryOutcome = z.enum(['pushed', 'pr_open', 'automerge_armed', 'merged', 'by_you']);
export type DeliveryOutcome = z.infer<typeof DeliveryOutcome>;
export const ChecksState = z.enum(['pending', 'passing', 'failing', 'none']);
export type ChecksState = z.infer<typeof ChecksState>;

/** A check that failed on a pull request, as GitHub reports it: its name, the status description (e.g. a deploy
 * integration's "Deployment was blocked") and where to read more. */
export const FailingCheck = z.object({ name: z.string(), description: z.string().nullable(), url: z.string().nullable() });
export type FailingCheck = z.infer<typeof FailingCheck>;

/** One pull request of a delivery. Whole-goal deliveries have exactly one (taskId null); stacked deliveries one per task. */
export const DeliveryPr = z.object({
  taskId: z.string().nullable(),
  /** 1-based position in the stack */
  index: z.number().int().positive(),
  branch: z.string(),
  base: z.string(),
  title: z.string(),
  number: z.number().int().nullable(),
  url: z.string().nullable(),
  state: z.enum(['pending', 'open', 'merged', 'closed', 'failed']),
  checks: ChecksState.nullable(),
  mergedRef: z.string().nullable(),
  /** the checks failing on it at the last look (empty when none, or not known) */
  failing: z.array(FailingCheck).default([]),
  /** the delivery step running on this PR right now, or null */
  activity: DeliveryStep.nullable().default(null),
  /** merged (or waiting to) without waiting for CI, because the policy said so */
  ciSkipped: z.boolean().default(false),
  /** its remote branch was deleted after the merge */
  branchDeleted: z.boolean().default(false),
  /** how it was last brought up to date with the base branch */
  sync: z.enum(['current', 'rebased', 'merged', 'resolved']).nullable().default(null),
});
export type DeliveryPr = z.infer<typeof DeliveryPr>;

/**
 * One comment of a review on a pull request Foundry opened (ADR-0053): an inline comment on the diff, or a review that
 * requested changes (its body). A plain conversation comment, an approval, and anything a bot wrote are not ones.
 */
export const ReviewComment = z.object({
  /** GitHub's id of the comment (inline) or of the review */
  id: z.number().int(),
  kind: z.enum(['inline', 'review']),
  author: z.string().nullable().default(null),
  body: z.string(),
  /** inline: the file and line the comment is on, with the diff around it */
  path: z.string().nullable().default(null),
  line: z.number().int().nullable().default(null),
  diffHunk: z.string().nullable().default(null),
  url: z.string().nullable().default(null),
  createdAt: z.string().nullable().default(null),
});
export type ReviewComment = z.infer<typeof ReviewComment>;

/** The review comments one look at a pull request brought, addressed together by one fix task (ADR-0053). */
export const ReviewRound = z.object({
  id: z.string(),
  prNumber: z.number().int(),
  at: z.string(),
  comments: z.array(ReviewComment),
  /** pending = not addressed yet; fixing = the fix task runs; addressed = a fix was pushed and replied; nochange = looked
   * at, nothing to change, replied; failed = the fix task could not (the delivery stopped) */
  status: z.enum(['pending', 'fixing', 'addressed', 'nochange', 'failed']).default('pending'),
  /** the person asked for this round to be addressed (Fix review comments), budget or not */
  requested: z.boolean().default(false),
  /** the fix commit pushed to the pull request's branch */
  commit: z.string().nullable().default(null),
  /** how many comments got a reply */
  replied: z.number().int().nonnegative().default(0),
  detail: z.string().nullable().default(null),
  finishedAt: z.string().nullable().default(null),
});
export type ReviewRound = z.infer<typeof ReviewRound>;

export const DeliveryState = z.object({
  policy: DeliveryPolicy.default(() => LOCAL_POLICY),
  status: DeliveryStatus.default('idle'),
  step: DeliveryStep.nullable().default(null),
  /** the first (or only) PR — kept for older readers; `prs` is the full picture */
  pr: z.object({ number: z.number().int(), url: z.string() }).nullable().default(null),
  prs: z.array(DeliveryPr).default([]),
  checks: ChecksState.nullable().default(null),
  outcome: DeliveryOutcome.nullable().default(null),
  mergedRef: z.string().nullable().default(null),
  fixCycles: z.number().int().nonnegative().default(0),
  /** every round of review comments on the delivery's pull requests, oldest first (ADR-0053) */
  reviews: z.array(ReviewRound).default([]),
  /** rounds the engine addressed by itself; the policy's fixReviewCycles caps it, Resume and Retry reset it */
  reviewCycles: z.number().int().nonnegative().default(0),
  error: z.string().nullable().default(null),
  startedAt: z.string().nullable().default(null),
  finishedAt: z.string().nullable().default(null),
  /** after a merge: does the user's local base branch contain the work (fast-forwarded by the engine, or pulled by hand)? */
  local: z.object({ upToDate: z.boolean(), detail: z.string(), at: z.string() }).nullable().default(null),
  /** after a merge: were the progress folder, worktrees and local goal branches removed? `waiting`: kept until the
   * artifact delivery in flight ends, which runs the tidy-up again */
  cleanup: z.object({ done: z.boolean(), detail: z.string(), at: z.string(), waiting: z.boolean().optional() }).nullable().default(null),
});
export type DeliveryState = z.infer<typeof DeliveryState>;
export const IDLE_DELIVERY: DeliveryState = DeliveryState.parse({});

export const DeliveryPlanStep = z.object({ step: DeliveryStep, command: z.string().nullable(), note: z.string() });
export type DeliveryPlanStep = z.infer<typeof DeliveryPlanStep>;
