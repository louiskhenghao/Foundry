import type { FeedbackPlan, Goal, Task } from '@foundry/core';
import { getTask, listTasks, newId } from '@foundry/core';
import type { Engine } from './engine.ts';
import { raiseEscalation } from './escalation.ts';
import { createFixTasks } from './fix-tasks.ts';

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
export async function openCheckpoint(engine: Engine, goal: Goal, due: { task: Task; recheck: boolean }): Promise<void> {
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
  const plan = cp.recheck ? hintOnly(planIn) : planIn;
  const milestone = getTask(store.db, cp.taskId);
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
