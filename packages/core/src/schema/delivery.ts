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
  deleteRemoteBranch: z.boolean().default(true),
});
export type DeliveryPolicy = z.infer<typeof DeliveryPolicy>;
export const LOCAL_POLICY: DeliveryPolicy = DeliveryPolicy.parse({});

export const DeliveryStep = z.enum(['preflight', 'ensure-remote', 'sync-base', 'build-stack', 'push', 'open-pr', 'wait-checks', 'fix-ci', 'merge', 'cleanup']);
export type DeliveryStep = z.infer<typeof DeliveryStep>;
export const DeliveryStatus = z.enum(['idle', 'running', 'delivered', 'failed']);
export type DeliveryStatus = z.infer<typeof DeliveryStatus>;
export const DeliveryOutcome = z.enum(['pushed', 'pr_open', 'automerge_armed', 'merged']);
export type DeliveryOutcome = z.infer<typeof DeliveryOutcome>;
export const ChecksState = z.enum(['pending', 'passing', 'failing', 'none']);
export type ChecksState = z.infer<typeof ChecksState>;

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
});
export type DeliveryPr = z.infer<typeof DeliveryPr>;

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
  error: z.string().nullable().default(null),
  startedAt: z.string().nullable().default(null),
  finishedAt: z.string().nullable().default(null),
});
export type DeliveryState = z.infer<typeof DeliveryState>;
export const IDLE_DELIVERY: DeliveryState = DeliveryState.parse({});

export const DeliveryPlanStep = z.object({ step: DeliveryStep, command: z.string().nullable(), note: z.string() });
export type DeliveryPlanStep = z.infer<typeof DeliveryPlanStep>;
