import { AgentProvider } from './schema/provider.ts';
import { AgentAccount } from './schema/account.ts';
import { z } from 'zod';
import { Attachment, AttachmentMarkdown } from './schema/attachment.ts';
import { FeedbackPlan } from './schema/feedback.ts';
import { InterviewQuestion } from './schema/interview.ts';
import { Learning } from './schema/learnings.ts';
import { Schedule } from './schema/schedule.ts';
import { DeployProvider, SmokeScript } from './schema/deploy.ts';
import {
  Attempt,
  AuditFinding,
  GoalReference,
  Brief,
  Budgets,
  ChecksState,
  FailingCheck,
  DeliveryOutcome,
  DeliveryPolicy,
  ReviewRound,
  DeliveryStep,
  Check,
  CheckResult,
  DocType,
  Escalation,
  EscalationSuggestion,
  EscalationAnswer,
  Goal,
  GoalNature,
  GoalState,
  PreviewPlace,
  ObservationReport,
  ReviewerVerdict,
  Task,
  TaskState,
  AttemptState,
  AttemptSession,
  LikenessVerdict,
  SubjectPicture,
  QaResult,
} from './schema/index.ts';

const base = { id: z.string(), ts: z.string(), goalId: z.string().nullable() };

function ev<T extends string, P extends z.ZodRawShape>(type: T, payload: P) {
  return z.object({ ...base, type: z.literal(type), payload: z.object(payload) });
}

export const EngineEvent = z.discriminatedUnion('type', [
  ev('goal.created', { goal: Goal }),
  ev('goal.provider_assigned', { provider: AgentProvider }),
  ev('goal.state_changed', { from: GoalState, to: GoalState, reason: z.string() }),
  ev('goal.budgets_changed', { budgets: Budgets, reason: z.string().optional() }),
  ev('goal.cost_added', { costUsd: z.number(), source: z.string() }),
  ev('goal.attachment_added', { attachment: Attachment }),
  /** one executed skills updater run (informational audit, goalId null; not projected) */
  ev('skills.update_run', {
    provider: AgentProvider.optional(),
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
  ev('goal.base_synced', { remote: z.string().nullable(), base: z.string(), localRef: z.string().nullable(), remoteRef: z.string().nullable(), ahead: z.number().int(), behind: z.number().int(), fetched: z.boolean(), startedFrom: z.enum(['local', 'remote', 'previous']), detail: z.string() }),
  /** the human marked the goal as a Follow-up of an earlier goal of the same repository (relationship only, no code or branch change) */
  ev('goal.follow_up_linked', { follows: z.object({ goalId: z.string(), title: z.string() }) }),
  /** the goal's progress folder was chosen at creation, or the goal was moved there from the legacy data-dir layout */
  ev('goal.workspace_set', { dir: z.string(), reason: z.enum(['created', 'migrated']) }),
  /**
   * the goal arrived through a Transfer (ADR-0030) and is history until Reattached; `bundle` / `artifacts` are what the
   * Transfer file carried (data-dir-relative), `remap` maps the other computer's data-dir paths to this one's
   */
  ev('goal.imported', {
    transferId: z.string(),
    from: z.object({ release: z.string(), hostname: z.string(), exportedAt: z.string() }),
    unfinished: z.boolean(),
    bundle: z.string().nullable(),
    artifacts: z.string().nullable(),
    transcripts: z.boolean(),
    remap: z.record(z.string(), z.string()),
  }),
  /** an Imported Goal's repository was mapped to a checkout on this computer: found at the same path, or chosen by the human */
  ev('goal.repo_mapped', { from: z.string(), to: z.string(), how: z.enum(['same-path', 'chosen']) }),
  /** an Imported Goal's branch was restored into its mapped repository from the bundle the Transfer file carried */
  ev('goal.branch_restored', { branch: z.string(), head: z.string() }),
  /** an unfinished Imported Goal got a progress folder on this computer and carries on */
  ev('goal.reattached', { workspaceDir: z.string() }),
  /** the goal paused at a milestone task for the human to look (state awaiting_feedback); recheck = the one second look after feedback fixes */
  ev('goal.checkpoint_opened', { taskId: z.string(), lookFor: z.string(), recheck: z.boolean() }),
  /** the human continued or gave feedback at a milestone; plan = what the feedback became (null on continue) */
  ev('goal.checkpoint_closed', { taskId: z.string(), action: z.enum(['continue', 'feedback']), feedback: z.string().nullable(), plan: FeedbackPlan.nullable() }),
  /** a Decision recorded mid-goal from milestone feedback; every later session receives it with the Brief's Decisions */
  ev('brief.decision_added', { id: z.string(), text: z.string(), answer: z.string() }),
  /** the Clarifier asked a round of questions before writing the Brief; the goal waits for the human */
  ev('interview.round_asked', { round: z.number().int().positive(), sessionId: z.string().nullable(), questions: z.array(InterviewQuestion) }),
  /** the human answered a round (finish = write the Brief with what there is; note = what they wrote unasked) */
  ev('interview.round_answered', { round: z.number().int().positive(), answers: z.record(z.string()), finish: z.boolean(), note: z.string().nullable().default(null) }),
  /** the interview ended: the Brief was written (or the Clarifier had nothing to ask) */
  ev('interview.finished', { rounds: z.number().int().nonnegative(), reason: z.enum(['brief', 'nothing_to_ask', 'cap', 'human']) }),
  /** a Revise asked the human a round of questions before proposing; the page waits for the answers (round 1 starts a new Revise) */
  ev('revise.round_asked', { round: z.number().int().positive(), sessionId: z.string().nullable(), questions: z.array(InterviewQuestion) }),
  /** the human answered a Revise round (finish = propose with what there is; note = what they wrote unasked) */
  ev('revise.round_answered', { round: z.number().int().positive(), answers: z.record(z.string()), finish: z.boolean(), note: z.string().nullable().default(null) }),
  /** the Revise that asked is over: it proposed, the human let it go (abandoned: cancelled, or the Brief approved meanwhile), or it hit the round cap */
  ev('revise.finished', { rounds: z.number().int().nonnegative(), reason: z.enum(['proposal', 'abandoned', 'cap', 'failed']) }),
  /** the human switched the goal's headless self-check on or off */
  ev('goal.selfcheck_set', { on: z.boolean() }),
  /** the human switched whether the goal pauses at its milestones ("Have a look") */
  ev('goal.milestone_pause_set', { on: z.boolean() }),
  /** the human switched Ponytail (the lazy senior dev) on or off for the goal; applies from its next session */
  ev('goal.ponytail_set', { on: z.boolean() }),
  /** a milestone landed in a goal that does not pause for it: the human is told, the goal goes on */
  ev('goal.milestone_passed', { taskId: z.string(), lookFor: z.string() }),
  /** the branch a finished goal's preview runs from; null = the goal branch while its folder exists, else the base branch */
  ev('goal.preview_ref_set', { ref: z.string().nullable() }),
  /** where a finished goal's preview runs: the person's checkout, Foundry's preview folder, or whichever fits (auto) */
  ev('goal.preview_place_set', { place: PreviewPlace }),
  /** the engine started / stopped one app of the goal's preview (the run command in the progress folder); app absent = written before several apps */
  ev('preview.started', { port: z.number().int(), url: z.string(), command: z.string(), app: z.string().optional() }),
  ev('preview.stopped', { reason: z.string(), app: z.string().optional() }),
  /** the headless self-check looked at the preview after a task landed (taskId) or at goal review (null); screenshot is a file name under the goal's screenshots folder */
  /** what a milestone looks like, recorded in the preview without the person: a video and screenshots (file names under the goal's screenshots folder) */
  /** `app`: the preview app walked through; `mock`: it ran against fake data because the real one could not be shown */
  /** `script`: the milestone's Playwright script that produced it; `status`: pass, fail (the script failed or nothing could be
   * shown) or unverified (only fake data could be shown); `clips`: one video per scripted test; `outputs`: text a script
   * attached (an API's responses); `log`: the runner's output; `steps`: the walkthrough Foundry planned, replayed on a rerun;
   * `final`: recorded by the final walkthrough; `kind: 'files'`: a milestone of files, what a task produced, whose
   * `files` are the models, drawings and too-large clips it names (relative to artifacts/), and whose shots' and clips'
   * captions are the paths of the files they were copied from (relative to artifacts/: what the output folder receives) */
  ev('milestone.evidence', {
    taskId: z.string(),
    video: z.string().nullable(),
    shots: z.array(z.object({ file: z.string(), caption: z.string() })),
    summary: z.string(),
    error: z.string().nullable(),
    app: z.string().nullable().optional(),
    mock: z.boolean().optional(),
    script: z.string().nullable().optional(),
    status: z.enum(['pass', 'fail', 'unverified']).optional(),
    clips: z.array(z.object({ file: z.string(), caption: z.string() })).optional(),
    outputs: z.array(z.object({ file: z.string(), caption: z.string() })).optional(),
    log: z.string().nullable().optional(),
    steps: z.array(z.record(z.unknown())).optional(),
    final: z.boolean().optional(),
    kind: z.enum(['files']).optional(),
    files: z.array(z.string()).optional(),
  }),
  /** the final walkthrough ran every milestone script once all tasks were done; failed = the milestone tasks whose script failed */
  ev('milestone.final_walk', { passed: z.boolean(), failed: z.array(z.string()) }),
  /** the Likeness review compared a milestone's recording (its milestone.evidence event at `evidenceAt`) with the Subjects' pictures; `fixTaskId`: the fix task it added for the major differences */
  ev('milestone.likeness', { taskId: z.string(), evidenceAt: z.string(), status: z.enum(['ok', 'failed']), verdict: LikenessVerdict.nullable(), detail: z.string(), costUsd: z.number(), fixTaskId: z.string().nullable() }),
  ev('selfcheck.finished', { taskId: z.string().nullable(), status: z.enum(['pass', 'fail', 'error']), url: z.string().nullable(), screenshot: z.string().nullable(), errors: z.array(z.string()), summary: z.string() }),
  /** per-goal autoskills run: project skills matched to the repository's stack, installed in the goal workspace */
  ev('goal.autoskills', { status: z.enum(['installed', 'skipped', 'failed']), skills: z.array(z.string()), detail: z.string() }),
  /** the goal's nature was settled (user chose it at creation, or the Clarifier decided for an `auto` goal) */
  ev('goal.nature_set', { nature: GoalNature, reason: z.string() }),
  /** media artifacts were copied from the goal workspace to the goal's output folder at done; `startedAt`: when the copy
   * began (a file written after it may not be what the folder received), and `startedAfter` the id of the goal's last
   * state change then (a run again after it is delivered again); `copies`: each copy's identity in the output folder as
   * it was made (inode, size, time), so a copy replaced or changed there since is told apart (a file left as it was
   * there, or not delivered this time, keeps its earlier one); all absent on deliveries before they were recorded */
  ev('goal.artifacts_delivered', { status: z.enum(['ok', 'skipped', 'failed']), files: z.array(z.string()), dest: z.string(), detail: z.string(), model: z.string().nullable().optional(), startedAt: z.string().optional(), startedAfter: z.string().optional(), copies: z.record(z.string(), z.string()).optional() }),
  /** completion actions chosen at Brief approval (defaults inferred from the tasks' scenarios when the UI sends nothing) */
  ev('goal.completion_set', { graphRefresh: z.boolean(), docs: z.array(DocType), audit: z.boolean().optional(), qa: z.boolean().optional(), reason: z.string() }),
  /** ponytail-audit ran on the finished branch (once per goal): what it found, and the fix tasks its in-scope must-fix findings became */
  /** the browser QA ran on the finished app (ADR-0057): what it tried, and the fix tasks its failed must checks became */
  ev('goal.qa_finished', { status: z.enum(['ok', 'skipped', 'failed']), summary: z.string(), results: z.array(QaResult), fixTaskIds: z.array(z.string()), costUsd: z.number(), detail: z.string() }),
  ev('goal.audit_finished', { status: z.enum(['ok', 'skipped', 'failed']), summary: z.string(), findings: z.array(AuditFinding), fixTaskIds: z.array(z.string()), costUsd: z.number(), detail: z.string() }),
  /** the docs-generation session ran (after the goal review passed); files are repo-relative paths it committed */
  /** `ref`: the docs commit on the goal branch (absent on events written before it was recorded) */
  /** docs written after the goal's work merged went out on a branch of their own, as this pull request */
  ev('goal.docs_pr_opened', { number: z.number().int(), url: z.string(), branch: z.string() }),
  ev('goal.docs_generated', { status: z.enum(['ok', 'skipped', 'failed']), types: z.array(DocType), files: z.array(z.string()), costUsd: z.number(), detail: z.string(), ref: z.string().nullable().optional() }),
  /** the post-delivery graph refresh ran (graphify / gitnexus, whichever is on PATH) */
  ev('goal.completion_ran', { tools: z.array(z.object({ name: z.string(), status: z.enum(['ok', 'skipped', 'failed']), detail: z.string() })) }),
  /** settings changed from the Settings page / API (goalId null); values are not recorded, only which keys */
  ev('settings.changed', { keys: z.array(z.string()), restartNeeded: z.array(z.string()) }),
  /**
   * a repository's Learnings, whole (ADR-0040): written by Foundry from a finished goal (`goalId`) or edited by the person.
   * A global event (no goal on the envelope), so a Transfer of the goal does not carry one machine's notebook to another.
   */
  ev('learnings.set', { repoPath: z.string(), learnings: z.array(Learning), source: z.enum(['distill', 'human']), goalId: z.string().nullable(), note: z.string().nullable() }),
  /**
   * Memory (ADR-0071): what the folder's Hindsight bank answered a stage before it ran (`text` null = nothing came, `error`
   * says why), and what Foundry wrote into the bank (`count` 0 with an `error` = the write failed; `git` is the seeding
   * of a folder's bank from its commits, a global event like the Learnings)
   */
  ev('memory.recalled', { stage: z.enum(['attempt', 'clarify', 'replan', 'review_task', 'review_goal']), bankId: z.string(), query: z.string(), text: z.string().nullable(), ms: z.number().int().nonnegative(), error: z.string().nullable(), taskId: z.string().nullable().default(null), attemptId: z.string().nullable().default(null) }),
  ev('memory.retained', { source: z.enum(['record', 'learnings', 'brief', 'review', 'plan', 'transcript', 'git']), bankId: z.string(), documentId: z.string().nullable(), count: z.number().int().nonnegative(), chars: z.number().int().nonnegative(), error: z.string().nullable(), taskId: z.string().nullable().default(null), attemptId: z.string().nullable().default(null) }),
  /** a Schedule saved whole (ADR-0054): made, edited, enabled or disabled. A global event, like the Learnings. */
  ev('schedule.set', { schedule: Schedule }),
  ev('schedule.deleted', { scheduleId: z.string(), name: z.string() }),
  /** a Schedule fired: the goal it made (the envelope's goal), or why none was made; `late` = past its time by more than an hour (the engine was off) */
  ev('schedule.fired', { scheduleId: z.string(), name: z.string(), at: z.string(), skipped: z.string().nullable(), late: z.boolean(), manual: z.boolean() }),

  ev('clarify.started', { attemptId: z.string().nullable() }),
  /**
   * where Clarify is: REA studying the references, a wait for a free session slot (every slot taken, the one beyond the
   * limit included), the Clarifier reading the repository and writing its answer (a round or the Brief), or the planner
   * splitting the goal into tasks
   */
  ev('clarify.stage', { stage: z.enum(['investigating', 'queued', 'clarifying', 'planning']) }),
  /** the human changed the shipped software the goal learns from */
  ev('goal.references_set', { references: z.array(GoalReference) }),
  /** the investigation of the references is wanted again (a re-run of Clarify, a changed reference, the person's request) */
  ev('goal.investigation_requested', {}),
  /** REA investigated the references: the report is attachment `attachmentId` and the document `docPath` on the goal branch */
  ev('goal.investigation_finished', { status: z.enum(['ok', 'failed', 'skipped']), summary: z.string(), attachmentId: z.string().nullable(), docPath: z.string().nullable(), docRef: z.string().nullable().optional(), costUsd: z.number(), detail: z.string() }),
  /** one style sample was generated for a Style Proposal (file appended to its samples, never replacing) */
  ev('brief.style_sampled', { styleKey: z.string(), file: z.string(), costUsd: z.number(), status: z.enum(['ok', 'failed']), detail: z.string() }),
  /** a Subject was named on the Brief, or its name or what must match changed (its pictures and search stay) */
  ev('brief.subject_set', { subject: z.object({ key: z.string(), name: z.string(), lookFor: z.string() }) }),
  ev('brief.subject_removed', { subjectKey: z.string() }),
  /** pictures of a Subject the person added (an upload, an attached image) or removed (file names in the goal's subjects folder) */
  ev('brief.subject_pictures', { subjectKey: z.string(), added: z.array(SubjectPicture), removed: z.array(z.string()) }),
  /** Foundry's search for pictures of a Subject ended; the pictures it kept are appended */
  ev('brief.subject_searched', { subjectKey: z.string(), status: z.enum(['ok', 'failed']), pictures: z.array(SubjectPicture), costUsd: z.number(), detail: z.string() }),
  /** the Clarifier's Brief without its tasks (ADR-0046): shown and editable while the planner works; `brief.proposed` follows with the plan filled in */
  ev('brief.skeleton_proposed', { brief: Brief }),
  ev('brief.proposed', { brief: Brief }),
  ev('brief.edited', { brief: Brief }),
  ev('brief.approved', { brief: Brief, by: z.string().nullable().optional() }),
  /** a second opinion on the Brief (ADR-0051): the revised Brief a reviewer that did not write it proposes; the page shows its diff against the Brief as it is now */
  ev('brief.second_opinion', { auto: z.boolean(), costUsd: z.number(), changeSummary: z.string(), revised: Brief.omit({ goalId: true }) }),
  /** no second opinion came in — the reviewer ran out, or returned no usable proposal: why, for the page, until one does; what it cost is the goal's all the same */
  ev('brief.second_opinion_failed', { auto: z.boolean(), costUsd: z.number(), reason: z.string() }),

  ev('task.created', { task: Task }),
  ev('task.state_changed', { taskId: z.string(), from: TaskState, to: TaskState, reason: z.string() }),
  ev('task.workspace_assigned', { taskId: z.string(), branch: z.string().nullable(), worktreePath: z.string().nullable() }),
  /** a landed task's artifacts (git-excluded, so outside its commit) were copied into the goal workspace: the files it made or changed, relative to artifacts/; `failed`: those that could not be copied; `settled`: earlier failures a retry read through (what they held came over, or nothing was left to copy) */
  ev('task.artifacts_landed', { taskId: z.string(), files: z.array(z.string()), failed: z.array(z.string()).optional(), settled: z.array(z.string()).optional() }),
  ev('task.hint_set', { taskId: z.string(), hint: z.string().nullable(), extraAttempts: z.number().int() }),
  /** human restarted the task (and its dependents): back to pending with a fresh attempt budget */
  ev('task.restarted', { taskId: z.string(), extraAttempts: z.number().int(), reason: z.string() }),
  /** goal-branch HEAD when the task first started; the squash target */
  ev('task.base_ref', { taskId: z.string(), ref: z.string() }),
  /** a `goal` task is done by a Delegated goal: created now, or started again (the main goal waits for it) */
  ev('task.delegated', { taskId: z.string(), goalId: z.string(), title: z.string() }),
  /** the Delegated goal of a `goal` task failed and the engine restarted its failed tasks (n = how many times so far) */
  ev('task.delegation_restarted', { taskId: z.string(), goalId: z.string(), restarted: z.array(z.string()), n: z.number().int() }),
  /** what a landed task delivered, for the tasks that depend on it (written when a Delegated goal's result lands) */
  ev('task.summary_set', { taskId: z.string(), summary: z.string() }),
  /** Replan: the planner touched up a task that has not started, after a Delegated goal landed (`afterTaskId`); null fields keep what the task has */
  ev('task.revised', { taskId: z.string(), spec: z.string(), relevantFiles: z.array(z.string()).nullable(), delivers: z.array(z.string()).nullable(), reason: z.string(), afterTaskId: z.string().nullable() }),
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

  /** a merge attempt committed its resolution, before its checks: the one commit a restart takes back when they never finished */
  ev('attempt.committed', { attemptId: z.string(), ref: z.string() }),
  ev('attempt.concluded', { attemptId: z.string(), state: AttemptState, reason: z.string() }),
  /** one session (worker segment / reviewer / merger) of an attempt ended: model, cost, turns, duration */
  ev('attempt.session_finished', { attemptId: z.string(), session: AttemptSession }),
  /** the AI analysed an escalation and proposed what to do */
  ev('escalation.suggested', { escalationId: z.string(), suggestion: EscalationSuggestion }),
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
  /** `base`: the goal-branch commit the resolution started from; `tip`: the task branch's commit it merged (both absent on events written before they were recorded) */
  ev('merge.manual_started', { taskId: z.string(), files: z.array(z.string()), path: z.string(), base: z.string().optional(), tip: z.string().optional() }),
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
  ev('escalation.answered', { escalationId: z.string(), answer: EscalationAnswer, by: z.string().nullable().optional() }),

  ev('budget.snapshot', { costUsd: z.number(), elapsedMin: z.number() }),
  ev('session.usage', {
    provider: AgentProvider.optional(),
    sessionId: z.string().nullable(),
    kind: z.string(),
    model: z.string().nullable(),
    inputTokens: z.number(),
    outputTokens: z.number(),
    cacheReadTokens: z.number(),
    cacheCreateTokens: z.number(),
    costUsd: z.number(),
    /** `unavailable`: the coding agent reported no dollar cost (Codex never does; a cut Claude Code session did not), so `costUsd` 0 is unknown, not free */
    costStatus: z.enum(['reported', 'unavailable']).optional(),
    durationMs: z.number(),
    subtype: z.string(),
    rateLimit: z.object({ status: z.string(), resetsAt: z.number().nullable(), rateLimitType: z.string().nullable(), isUsingOverage: z.boolean() }).nullable(),
    skillsUsed: z.array(z.string()).default([]),
    /** which of the coding agent's accounts ran the session (ADR-0065); absent = the native login, or written before accounts */
    accountId: z.string().optional(),
  }),
  /** sets the policy and (unless one runs) starts a delivery; `resume` carries on with open PRs, `start-over` follows closing them */
  /** `review` = a run the engine started itself to address review comments on an open pull request (ADR-0053) */
  ev('delivery.policy_set', { policy: DeliveryPolicy, source: z.enum(['create', 'deliver', 'retry', 'resume', 'start-over', 'review']) }),
  /** the human saved the policy without starting anything; a running delivery picks the switches up at its next step */
  ev('delivery.policy_saved', { policy: DeliveryPolicy }),
  ev('delivery.started', { policy: DeliveryPolicy, plan: z.array(z.string()) }),
  /** `branch`: the stacked (or goal) branch the step works on, when it is about one PR */
  ev('delivery.step', { step: DeliveryStep, status: z.enum(['started', 'ok', 'skipped', 'failed']), detail: z.string(), branch: z.string().nullable().optional() }),
  ev('delivery.command', { step: DeliveryStep, command: z.string(), cwd: z.string(), exitCode: z.number().nullable(), durationMs: z.number(), outputTail: z.string() }),
  /** the person deployed the goal's web app (ADR-0041): to which host, preview or production, which commit, what the app is */
  ev('deploy.started', { provider: DeployProvider, production: z.boolean(), ref: z.string().nullable(), framework: z.string().nullable(), dir: z.string() }),
  /** one command of a deploy, its tokens never in it */
  ev('deploy.command', { provider: DeployProvider, label: z.string(), command: z.string(), exitCode: z.number().nullable(), durationMs: z.number(), outputTail: z.string() }),
  ev('deploy.finished', { provider: DeployProvider, production: z.boolean(), url: z.string() }),
  ev('deploy.failed', { provider: DeployProvider, production: z.boolean(), reason: z.string() }),
  /** the smoke of a deploy (ADR-0058): the goal's milestone scripts against the deployed address; `deployedAt` names the deploy (its `at`) */
  ev('deploy.smoke_started', { provider: DeployProvider, production: z.boolean(), url: z.string(), deployedAt: z.string(), scripts: z.array(z.string()) }),
  ev('deploy.smoke_finished', { provider: DeployProvider, production: z.boolean(), url: z.string(), deployedAt: z.string(), status: z.enum(['pass', 'fail', 'skipped']), detail: z.string(), scripts: z.array(SmokeScript) }),
  ev('delivery.repo_created', { owner: z.string(), name: z.string(), url: z.string(), visibility: z.string() }),
  ev('delivery.pushed', { remote: z.string(), branch: z.string(), ref: z.string(), taskId: z.string().nullable().default(null) }),
  /** the stacked branches built from the tasks' commits (unit = task), bottom first */
  ev('delivery.stack_built', { branches: z.array(z.object({ taskId: z.string().nullable(), index: z.number().int(), branch: z.string(), base: z.string(), commit: z.string(), title: z.string() })) }),
  ev('delivery.pr_opened', { number: z.number().int(), url: z.string(), base: z.string(), head: z.string(), taskId: z.string().nullable().default(null), title: z.string().default('') }),
  ev('delivery.checks', { state: ChecksState, summary: z.string(), prNumber: z.number().int().nullable().default(null), failing: z.array(FailingCheck).default([]), skipped: z.boolean().optional() }),
  /** a branch was brought up to date with the base: already was, rebased onto it, merged it, or merged with conflicts resolved; `from` is its tip before */
  ev('delivery.synced', { branch: z.string(), how: z.enum(['current', 'rebased', 'merged', 'resolved']), from: z.string().nullable(), to: z.string().nullable() }),
  ev('delivery.branch_deleted', { branch: z.string() }),
  ev('delivery.merged', { prNumber: z.number().int().nullable(), method: z.string(), ref: z.string().nullable(), taskId: z.string().nullable().default(null) }),
  /** something the pipeline decided on its own (e.g. fell back from a stack to one PR) */
  ev('delivery.note', { message: z.string() }),
  ev('delivery.completed', { outcome: DeliveryOutcome }),
  /** after a merge: whether the user's local base branch now contains the work, and why not when it does not */
  ev('delivery.local_synced', { upToDate: z.boolean(), detail: z.string() }),
  /** after a merge: the progress folder, worktrees and local goal branches removed (done) or kept, with the reason;
   * `waiting`: kept until the artifact delivery in flight ends, which runs the tidy-up again */
  ev('delivery.cleaned', { done: z.boolean(), detail: z.string(), waiting: z.boolean().optional() }),
  /** a pull request was closed on GitHub without being merged (noticed after the delivery finished) */
  ev('delivery.pr_closed', { prNumber: z.number().int() }),
  /** review comments found on an open pull request (ADR-0053): `fixing` = a run addresses them now, `waiting` = the budget is used up, the person decides */
  ev('delivery.review_received', { round: ReviewRound, action: z.enum(['fixing', 'waiting']) }),
  /** the person pressed Fix review comments: the round is addressed whatever the budget */
  ev('delivery.review_requested', { roundId: z.string() }),
  ev('delivery.review_started', { roundId: z.string() }),
  ev('delivery.review_addressed', { roundId: z.string(), status: z.enum(['addressed', 'nochange', 'failed']), commit: z.string().nullable(), replied: z.number().int().nonnegative(), detail: z.string() }),
  // a Revert of a merged delivery (ADR-0059): started on the person's click; finished with its pull request open (or
  // merged / armed when asked), or failed with why; merged or closed later on GitHub, noticed by the pull request watch
  ev('delivery.revert_started', { id: z.string(), reason: z.string(), merge: z.boolean(), reverts: z.array(z.object({ prNumber: z.number().int().nullable(), ref: z.string(), title: z.string().default('') })) }),
  ev('delivery.revert_finished', { id: z.string(), status: z.enum(['open', 'armed', 'merged', 'failed']), branch: z.string().nullable(), pr: z.object({ number: z.number().int(), url: z.string() }).nullable(), commits: z.array(z.string()), mergedRef: z.string().nullable(), detail: z.string() }),
  ev('delivery.revert_merged', { id: z.string(), prNumber: z.number().int().nullable(), ref: z.string().nullable(), detail: z.string() }),
  ev('delivery.revert_closed', { id: z.string(), prNumber: z.number().int().nullable() }),
  ev('delivery.failed', { step: DeliveryStep, reason: z.string() }),
  ev('rate_limit.paused', { provider: AgentProvider.optional(), rateLimitType: z.string().nullable(), until: z.string(), reason: z.string() }),
  ev('rate_limit.resumed', { provider: AgentProvider.optional(), reason: z.string() }),
  // a coding agent's sign-ins beside the machine's own, and which one new sessions run on (ADR-0065)
  ev('account.added', { account: AgentAccount }),
  ev('account.removed', { provider: AgentProvider, accountId: z.string() }),
  /** the order the added accounts are tried in after the native one */
  ev('account.reordered', { provider: AgentProvider, order: z.array(z.string()) }),
  /** new sessions of the coding agent run on `to` from now; `auto` = a usage limit moved them (auto switch) */
  ev('account.switched', { provider: AgentProvider, from: z.string(), to: z.string(), auto: z.boolean(), reason: z.string() }),
  /** an account's usage limit stopped a session: it is passed over until `until` */
  ev('account.limited', { provider: AgentProvider, accountId: z.string(), until: z.string(), reason: z.string() }),
  /** a Release newer than this instance appeared on the version source (announced once per version) */
  ev('update.available', { current: z.string(), latest: z.string(), mode: z.enum(['docker', 'local', 'unknown']) }),
  /** one self-update attempt ran to its end (success or rolled back) */
  ev('update.run', { mode: z.enum(['docker', 'local', 'unknown']), from: z.string(), to: z.string(), ok: z.boolean(), error: z.string().nullable(), durationMs: z.number() }),
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
