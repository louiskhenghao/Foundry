import { z } from 'zod';
import { Attachment, AttachmentMarkdown } from './schema/attachment.ts';
import {
  Attempt,
  Brief,
  Budgets,
  ChecksState,
  DeliveryOutcome,
  DeliveryPolicy,
  DeliveryStep,
  Check,
  CheckResult,
  Escalation,
  EscalationAnswer,
  Goal,
  GoalState,
  ObservationReport,
  ReviewerVerdict,
  Task,
  TaskState,
  AttemptState,
} from './schema/index.ts';

const base = { id: z.string(), ts: z.string(), goalId: z.string().nullable() };

function ev<T extends string, P extends z.ZodRawShape>(type: T, payload: P) {
  return z.object({ ...base, type: z.literal(type), payload: z.object(payload) });
}

export const EngineEvent = z.discriminatedUnion('type', [
  ev('goal.created', { goal: Goal }),
  ev('goal.state_changed', { from: GoalState, to: GoalState, reason: z.string() }),
  ev('goal.budgets_changed', { budgets: Budgets, reason: z.string().optional() }),
  ev('goal.cost_added', { costUsd: z.number(), source: z.string() }),
  ev('goal.attachment_added', { attachment: Attachment }),
  /** one executed skills updater run (informational audit, goalId null; not projected) */
  ev('skills.update_run', {
    sourceId: z.string(),
    updater: z.string(),
    command: z.array(z.string()),
    cwd: z.string(),
    exitCode: z.number().nullable(),
    durationMs: z.number(),
    outputTail: z.string(),
    changed: z.array(z.object({ name: z.string(), from: z.string().nullable(), to: z.string().nullable() })),
    error: z.string().nullable(),
  }),
  ev('goal.attachment_removed', { attachmentId: z.string() }),
  ev('goal.attachment_converted', { attachmentId: z.string(), markdown: AttachmentMarkdown }),
  /** tombstone: read models for the goal are dropped; the log keeps its history */
  ev('goal.deleted', { title: z.string(), deletedBranch: z.string().nullable(), reason: z.string() }),
  /** a session's model was unavailable and the engine fell back to another one; tier updates the goal's model snapshot */
  ev('goal.models_changed', { tier: z.enum(['strong', 'cheap', 'worker']).nullable(), from: z.string(), to: z.string(), reason: z.string() }),
  /** Clarify is being run again from scratch (fresh fetch, workspace rebuilt); the next brief.proposed replaces the Brief */
  ev('goal.reclarified', { reason: z.string(), workspaceRebuilt: z.boolean(), /** rendered Decisions of the discarded Brief, carried into the new Clarify */ decisions: z.string().default('') }),
  /** the base branch was fetched before the goal branch was created; says where the goal started from */
  ev('goal.base_synced', { remote: z.string().nullable(), base: z.string(), localRef: z.string().nullable(), remoteRef: z.string().nullable(), ahead: z.number().int(), behind: z.number().int(), fetched: z.boolean(), startedFrom: z.enum(['local', 'remote']), detail: z.string() }),
  /** per-goal autoskills run: project skills matched to the repository's stack, installed in the goal workspace */
  ev('goal.autoskills', { status: z.enum(['installed', 'skipped', 'failed']), skills: z.array(z.string()), detail: z.string() }),
  /** settings changed from the Settings page / API (goalId null); values are not recorded, only which keys */
  ev('settings.changed', { keys: z.array(z.string()), restartNeeded: z.array(z.string()) }),

  ev('clarify.started', { attemptId: z.string().nullable() }),
  ev('brief.proposed', { brief: Brief }),
  ev('brief.edited', { brief: Brief }),
  ev('brief.approved', { brief: Brief }),

  ev('task.created', { task: Task }),
  ev('task.state_changed', { taskId: z.string(), from: TaskState, to: TaskState, reason: z.string() }),
  ev('task.workspace_assigned', { taskId: z.string(), branch: z.string().nullable(), worktreePath: z.string().nullable() }),
  ev('task.hint_set', { taskId: z.string(), hint: z.string().nullable(), extraAttempts: z.number().int() }),
  /** human restarted the task (and its dependents): back to pending with a fresh attempt budget */
  ev('task.restarted', { taskId: z.string(), extraAttempts: z.number().int(), reason: z.string() }),
  /** goal-branch HEAD when the task first started; the squash target */
  ev('task.base_ref', { taskId: z.string(), ref: z.string() }),
  /** the task's attempts were squashed into one Conventional Commit on the goal branch (ref null = no changes) */
  ev('task.committed', { taskId: z.string(), ref: z.string().nullable(), message: z.string() }),
  ev('check.created', { check: Check }),

  ev('attempt.started', { attempt: Attempt }),
  ev('attempt.session', { attemptId: z.string(), sessionId: z.string(), model: z.string().nullable(), pid: z.number().nullable() }),
  ev('attempt.finished', {
    attemptId: z.string(),
    state: AttemptState,
    resultSubtype: z.string().nullable(),
    costUsd: z.number(),
    numTurns: z.number().int(),
    endRef: z.string().nullable(),
    permissionDenials: z.array(z.object({ tool_name: z.string(), tool_input: z.unknown() })),
    /** Skill-tool invocations observed in the stream (e.g. "tdd", "mattpocock-skills:tdd") */
    skillsUsed: z.array(z.string()).default([]),
    /** tool name → call count */
    toolsUsed: z.record(z.number()).default({}),
  }),

  ev('attempt.concluded', { attemptId: z.string(), state: AttemptState, reason: z.string() }),
  /** the attempt's Claude session is resumed instead of a new attempt being started */
  ev('attempt.continued', { attemptId: z.string(), reason: z.string(), sessionId: z.string().nullable() }),

  ev('check.finished', { result: CheckResult }),
  ev('review.task.finished', { attemptId: z.string(), taskId: z.string(), verdict: ReviewerVerdict }),
  ev('observation.reported', { report: ObservationReport }),

  ev('workspace.committed', { taskId: z.string().nullable(), attemptId: z.string().nullable(), ref: z.string() }),
  ev('workspace.rolled_back', { taskId: z.string(), toRef: z.string(), reason: z.string() }),

  ev('merge.started', { taskId: z.string(), into: z.string() }),
  ev('merge.conflict', { taskId: z.string(), files: z.array(z.string()) }),
  ev('merge.completed', { taskId: z.string(), ref: z.string() }),
  /** the human took over a conflicted integration in the `_resolve` worktree */
  ev('merge.manual_started', { taskId: z.string(), files: z.array(z.string()), path: z.string() }),
  ev('merge.manual_finished', { taskId: z.string(), ref: z.string(), checksPassed: z.boolean(), forced: z.boolean() }),
  ev('merge.manual_aborted', { taskId: z.string(), reason: z.string() }),

  ev('review.goal.finished', {
    passed: z.boolean(),
    overDelivered: z.boolean(),
    mustResults: z.array(CheckResult),
    stretchResults: z.array(CheckResult),
    fixTaskIds: z.array(z.string()),
    notes: z.string(),
  }),

  ev('escalation.raised', { escalation: Escalation }),
  ev('escalation.answered', { escalationId: z.string(), answer: EscalationAnswer }),

  ev('budget.snapshot', { costUsd: z.number(), elapsedMin: z.number() }),
  ev('session.usage', {
    sessionId: z.string().nullable(),
    kind: z.string(),
    model: z.string().nullable(),
    inputTokens: z.number(),
    outputTokens: z.number(),
    cacheReadTokens: z.number(),
    cacheCreateTokens: z.number(),
    costUsd: z.number(),
    durationMs: z.number(),
    subtype: z.string(),
    rateLimit: z.object({ status: z.string(), resetsAt: z.number().nullable(), rateLimitType: z.string().nullable(), isUsingOverage: z.boolean() }).nullable(),
    skillsUsed: z.array(z.string()).default([]),
  }),
  ev('delivery.policy_set', { policy: DeliveryPolicy, source: z.enum(['create', 'deliver', 'retry']) }),
  ev('delivery.started', { policy: DeliveryPolicy, plan: z.array(z.string()) }),
  ev('delivery.step', { step: DeliveryStep, status: z.enum(['started', 'ok', 'skipped', 'failed']), detail: z.string() }),
  ev('delivery.command', { step: DeliveryStep, command: z.string(), cwd: z.string(), exitCode: z.number().nullable(), durationMs: z.number(), outputTail: z.string() }),
  ev('delivery.repo_created', { owner: z.string(), name: z.string(), url: z.string(), visibility: z.string() }),
  ev('delivery.pushed', { remote: z.string(), branch: z.string(), ref: z.string(), taskId: z.string().nullable().default(null) }),
  /** the stacked branches built from the tasks' commits (unit = task), bottom first */
  ev('delivery.stack_built', { branches: z.array(z.object({ taskId: z.string().nullable(), index: z.number().int(), branch: z.string(), base: z.string(), commit: z.string(), title: z.string() })) }),
  ev('delivery.pr_opened', { number: z.number().int(), url: z.string(), base: z.string(), head: z.string(), taskId: z.string().nullable().default(null), title: z.string().default('') }),
  ev('delivery.checks', { state: ChecksState, summary: z.string(), prNumber: z.number().int().nullable().default(null) }),
  ev('delivery.merged', { prNumber: z.number().int().nullable(), method: z.string(), ref: z.string().nullable(), taskId: z.string().nullable().default(null) }),
  /** something the pipeline decided on its own (e.g. fell back from a stack to one PR) */
  ev('delivery.note', { message: z.string() }),
  ev('delivery.completed', { outcome: DeliveryOutcome }),
  ev('delivery.failed', { step: DeliveryStep, reason: z.string() }),
  ev('rate_limit.paused', { rateLimitType: z.string().nullable(), until: z.string(), reason: z.string() }),
  ev('rate_limit.resumed', { reason: z.string() }),
  ev('boundary.blocked', { taskId: z.string().nullable(), attemptId: z.string().nullable(), command: z.string() }),
  ev('engine.note', { level: z.enum(['info', 'warn', 'error']), message: z.string() }),
]);

export type EngineEvent = z.infer<typeof EngineEvent>;
export type EngineEventType = EngineEvent['type'];
export type EventOf<T extends EngineEventType> = Extract<EngineEvent, { type: T }>;
export type EventPayload<T extends EngineEventType> = EventOf<T>['payload'];

/** An event before it is stamped with id/ts by the store. */
export type NewEvent = {
  [T in EngineEventType]: { type: T; goalId: string | null; payload: EventPayload<T> };
}[EngineEventType];
