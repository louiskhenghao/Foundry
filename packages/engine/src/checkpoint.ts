import type { Check, FeedbackPlan, Goal, Task } from '@foundry/core';
import { FINAL_WALK, IdPrefix, getGoal, getTask, listTasks, newId } from '@foundry/core';
import type { Engine } from './engine.ts';
import { raiseEscalation } from './escalation.ts';
import { createFixTasks } from './fix-tasks.ts';
import { type CaptureOptions, type MilestoneEvidence, captureMilestone } from './checks/walkthrough.ts';
import { MILESTONE_CHECK_PREFIX, milestoneCheckSpec, milestoneCommand } from './checks/milestone-script.ts';

/**
 * A milestone due for a human look: the first time a milestone task lands, and once more after feedback-fix tasks for
 * it landed (a second look confirms the fix; there is no third — later feedback becomes hints).
 */
export function dueCheckpoint(tasks: Task[]): { task: Task; recheck: boolean } | null {
  const done = tasks.filter((t) => t.state === 'done');
  const first = done.find((t) => t.milestone && t.milestoneVisits === 0);
  if (first) return { task: first, recheck: false };
  for (const fix of done) {
    if (!fix.checkpointOf) continue;
    const m = tasks.find((t) => t.id === fix.checkpointOf);
    if (m?.milestone && m.milestoneVisits === 1) return { task: m, recheck: true };
  }
  return null;
}

/**
 * Pause the goal at a milestone: state → awaiting_feedback, the preview starts (best effort), and a `milestone` escalation
 * reaches the Inbox and the notification channels with what to look at.
 */
export async function openCheckpoint(engine: Engine, goal: Goal, due: { task: Task; recheck: boolean }, opts: { capture?: boolean } = {}): Promise<void> {
  const { store, config } = engine;
  const lookFor = due.task.milestone ?? '';
  store.append({ type: 'goal.checkpoint_opened', goalId: goal.id, payload: { taskId: due.task.id, lookFor, recheck: due.recheck } });
  store.append({ type: 'goal.state_changed', goalId: goal.id, payload: { from: 'running', to: 'awaiting_feedback', reason: `${due.recheck ? 'second look at' : 'milestone'} "${due.task.title}"` } });
  let previewUrl: string | null = null;
  try {
    previewUrl = (await engine.preview.start(goal, 'milestone')).url;
  } catch (err) {
    config.log(`[preview] ${goal.id}: not started at the milestone: ${String((err as Error).message ?? err)}`);
  }
  raiseEscalation(engine, {
    goal,
    trigger: 'milestone',
    message: `${due.recheck ? 'Second look after your feedback — ' : ''}"${due.task.title}" landed. ${lookFor}${previewUrl ? `\n\nPreview: ${previewUrl}` : ''}`,
    payload: { kind: 'milestone', taskId: due.task.id, recheck: due.recheck, previewUrl },
  });
  // what it looks like, recorded for the card and the notification channels
  if (opts.capture !== false) void captureMilestone(engine, goal, due.task);
}

/**
 * A milestone landed in a goal that does not pause for it ("Have a look" off): the notification channels are told what
 * to look at, and the goal goes on.
 */
export function passMilestone(engine: Engine, goal: Goal, task: Task): void {
  engine.store.append({ type: 'goal.milestone_passed', goalId: goal.id, payload: { taskId: task.id, lookFor: task.milestone ?? '' } });
  void recordMilestone(engine, goal, task);
}

/** the title of the task that repairs a scripted milestone whose script failed after it landed */
export const repairTitle = (task: Task) => `fix the ${(task.milestoneScript ?? '').split('/').pop()!.replace(/\.(spec|test)\.[cm]?[jt]sx?$/, '')} milestone script`.slice(0, 60);

/**
 * Record a milestone, and when its script fails in a running goal, repair it once: a task that makes the script pass
 * (the app, how the config starts it, or the script), with the script as its check. When the script still fails after
 * that repair landed, the goal pauses at the milestone with what Foundry saw, so the person decides.
 */
export async function recordMilestone(engine: Engine, goal: Goal, task: Task, opts: CaptureOptions = {}): Promise<MilestoneEvidence | null> {
  const ev = await captureMilestone(engine, goal, task, opts);
  if (ev?.status === 'fail' && task.milestoneScript && !opts.final) afterScriptFailed(engine, task, ev);
  return ev;
}

/** the goal states in which a failed script is repaired: the goal still works (a pause for a look included) */
const WORKING = new Set(['running', 'awaiting_feedback']);

/**
 * A scripted milestone's script failed: repair it once; when it fails again after that, the goal pauses at it — by the
 * scheduler, once no task is in flight (a recording never pauses the goal under a running task). False = nothing done.
 */
function afterScriptFailed(engine: Engine, task: Task, ev: MilestoneEvidence): boolean {
  const goal = getGoal(engine.store.db, task.goalId);
  if (!goal || !WORKING.has(goal.state)) return false;
  if (repairMilestone(engine, goal, task, ev)) return true;
  if (goal.milestonePause === false) {
    engine.store.append({ type: 'engine.note', goalId: goal.id, payload: { level: 'warn', message: `the "${task.title}" milestone script still fails after its repair: ${ev.error ?? 'see its log'}` } });
    return false;
  }
  engine.pauseDue.set(goal.id, task.id);
  engine.tick(goal.id);
  return true;
}

/** a repair task for a failed milestone script, unless one was made already; true = made now */
export function repairMilestone(engine: Engine, goal: Goal, task: Task, ev: MilestoneEvidence): boolean {
  const { store } = engine;
  const title = repairTitle(task);
  if (listTasks(store.db, goal.id).some((t) => t.checkpointOf === task.id && t.title === title)) return false;
  const spec = [
    `The milestone "${task.title}" landed, but its script fails when Foundry runs \`${milestoneCommand(task.milestoneScript!)}\` in the goal's folder:`,
    '```',
    (ev.error ?? 'no reason given').slice(0, 1500),
    '```',
    `Make it pass. Find what is wrong: the app itself, how \`playwright.config\` starts it on a bare checkout (its \`webServer\`: commands that exist on a plain machine, \`docker compose up -d --wait\` for the services, migrations and seed data, PORT and API_PORT), or the script. Fix that; never weaken what the script shows or asserts.`,
  ].join('\n');
  const [id] = createFixTasks(engine, goal, [{ title, spec, relevantFiles: [task.milestoneScript!, 'playwright.config.ts'] }], null, { origin: 'feedback-fix', checkpointOf: task.id });
  if (!id) return false;
  const check: Check = { id: newId(IdPrefix.check), goalId: goal.id, taskId: id, name: `${MILESTONE_CHECK_PREFIX}${task.milestoneScript}`, tier: 'must', spec: milestoneCheckSpec(task.milestoneScript!) };
  store.append({ type: 'check.created', goalId: goal.id, payload: { check } });
  store.append({ type: 'engine.note', goalId: goal.id, payload: { level: 'info', message: `the "${task.title}" milestone script failed after it landed; "${title}" repairs it` } });
  return true;
}

/** the goal's scripted milestones that landed: what the final walkthrough runs */
export function scriptedMilestones(tasks: Task[]): Task[] {
  return tasks.filter((t) => t.milestone && t.milestoneScript && t.state === 'done');
}

/**
 * The final walkthrough: once every task is done, every milestone script runs again on the finished goal branch, so a
 * later task that broke an earlier feature shows. A script that fails gets its repair task (once); the goal then goes on
 * to the look at the end, or to its review.
 */
export async function runFinalWalk(engine: Engine, goal: Goal): Promise<void> {
  const { store } = engine;
  const startedAt = new Date().toISOString();
  const milestones = scriptedMilestones(listTasks(store.db, goal.id));
  const failed: { task: Task; ev: MilestoneEvidence | null }[] = [];
  for (const t of milestones) {
    const ev = await captureMilestone(engine, goal, t, { final: true });
    if (ev?.status !== 'pass') failed.push({ task: t, ev });
  }
  // a task created while it ran (a repair after a recording, a sync with the base) is not covered: it runs again later
  const tasks = listTasks(store.db, goal.id);
  if (tasks.some((t) => t.createdAt > startedAt || (t.state !== 'done' && t.state !== 'skipped'))) return;
  // recorded first: a repair task created after it makes the final walkthrough due again once it lands
  store.append({ type: 'milestone.final_walk', goalId: goal.id, payload: { passed: failed.length === 0, failed: failed.map((f) => f.task.id) } });
  const now = getGoal(store.db, goal.id);
  if (!now || !WORKING.has(now.state)) return;
  for (const f of failed) if (f.ev) repairMilestone(engine, now, f.task, f.ev);
}

/** Pause for the look at the end: every feature's latest recording on one card, then continue or give feedback. */
export async function openFinalCheckpoint(engine: Engine, goal: Goal, recheck: boolean): Promise<void> {
  const { store, config } = engine;
  const milestones = scriptedMilestones(listTasks(store.db, goal.id));
  const failed = goal.finalWalk?.passed === false;
  const lookFor = `Every feature, one after another: ${milestones.map((t) => `"${t.title}"`).join(', ')}.${failed ? ' Some scripts still fail: their recordings say why.' : ''}`;
  store.append({ type: 'goal.checkpoint_opened', goalId: goal.id, payload: { taskId: FINAL_WALK, lookFor, recheck } });
  store.append({ type: 'goal.state_changed', goalId: goal.id, payload: { from: 'running', to: 'awaiting_feedback', reason: recheck ? 'second look at the final walkthrough' : 'final walkthrough' } });
  let previewUrl: string | null = null;
  try {
    previewUrl = (await engine.preview.start(goal, 'milestone')).url;
  } catch (err) {
    config.log(`[preview] ${goal.id}: not started for the final walkthrough: ${String((err as Error).message ?? err)}`);
  }
  raiseEscalation(engine, {
    goal,
    trigger: 'milestone',
    message: `${recheck ? 'Second look after your feedback — ' : ''}Every task is done and the final walkthrough ran each feature's script${failed ? '; some still fail' : ''}. ${lookFor}${previewUrl ? `\n\nPreview: ${previewUrl}` : ''}`,
    payload: { kind: 'milestone', taskId: FINAL_WALK, recheck, previewUrl },
  });
}

/** whether the look at the end is due: the first one, or the one second look after fixes from feedback there landed */
export function finalLookDue(goal: Goal, tasks: Task[]): { recheck: boolean } | null {
  if (goal.milestonePause === false || !goal.finalWalk?.ranAt) return null;
  const looks = goal.finalWalk.looks;
  if (looks === 0) return { recheck: false };
  if (looks === 1 && tasks.some((t) => t.checkpointOf === FINAL_WALK && t.state === 'done')) return { recheck: true };
  return null;
}

/** The human continued or gave feedback: the goal runs again. */
export function closeCheckpoint(engine: Engine, goal: Goal, close: { action: 'continue' | 'feedback'; feedback: string | null; plan: FeedbackPlan | null }): void {
  const { store } = engine;
  if (!goal.checkpoint) return;
  store.append({ type: 'goal.checkpoint_closed', goalId: goal.id, payload: { taskId: goal.checkpoint.taskId, action: close.action, feedback: close.feedback, plan: close.plan } });
  if (goal.state === 'awaiting_feedback') store.append({ type: 'goal.state_changed', goalId: goal.id, payload: { from: 'awaiting_feedback', to: 'running', reason: close.action === 'continue' ? 'human: continue' : `human feedback → ${close.plan?.kind ?? 'hint'}` } });
}

/** A second look allows hints only: anything heavier folds into the hint text. */
export function hintOnly(plan: FeedbackPlan): FeedbackPlan {
  if (plan.kind === 'hint') return plan;
  const hint = [plan.hint, plan.decision, ...plan.fixTasks.map((f) => `${f.title}: ${f.spec}`)].filter(Boolean).join('\n');
  return { kind: 'hint', rationale: plan.rationale, hint: hint || null, fixTasks: [], decision: null };
}

/**
 * Apply a confirmed plan: hint → every task still to run gets it; fix → fix tasks that re-open this milestone once they
 * land; decision → recorded with the Brief's Decisions (every later session sees it) plus the hint and any fix tasks.
 */
export function applyFeedback(engine: Engine, goal: Goal, feedback: string, planIn: FeedbackPlan): FeedbackPlan {
  const { store } = engine;
  const cp = goal.checkpoint;
  if (!cp) throw new Error('no milestone is open');
  const final = cp.taskId === FINAL_WALK;
  // the look at the end leaves no task to carry a hint: what the person says there always becomes work
  let plan = cp.recheck && !final ? hintOnly(planIn) : planIn;
  if (final && !plan.fixTasks.length) {
    const what = [plan.hint, plan.kind === 'decision' ? plan.decision : null].filter(Boolean).join('\n') || feedback;
    plan = { ...plan, fixTasks: [{ title: 'apply the feedback from the final walkthrough', spec: `The person looked at every feature at the end and said:\n\n${feedback}\n\nWhat it asks for:\n${what}`, relevantFiles: [] }] };
  }
  const milestone = final ? { title: 'the final walkthrough' } : getTask(store.db, cp.taskId);
  const hintText = [plan.hint, plan.kind === 'decision' ? plan.decision : null].filter(Boolean).join('\n');
  if (hintText) {
    for (const t of listTasks(store.db, goal.id)) {
      if (t.state !== 'pending' && t.state !== 'ready') continue;
      store.append({ type: 'task.hint_set', goalId: goal.id, payload: { taskId: t.id, hint: [t.hint, hintText].filter(Boolean).join('\n'), extraAttempts: 0 } });
    }
  }
  if (plan.kind === 'decision' && plan.decision) {
    store.append({ type: 'brief.decision_added', goalId: goal.id, payload: { id: newId('q'), text: `Feedback at milestone "${milestone?.title ?? cp.taskId}": ${feedback.slice(0, 300)}`, answer: plan.decision } });
  }
  if (plan.fixTasks.length) createFixTasks(engine, goal, plan.fixTasks, plan.hint, { origin: 'feedback-fix', checkpointOf: cp.taskId });
  return plan;
}
