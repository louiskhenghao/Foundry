import type { Escalation, EscalationAnswer, EscalationTrigger, Goal, Task } from '@foundry/core';
import { ACTIONS_BY_TRIGGER, IdPrefix, getEscalation, getGoal, getTask, listEscalations, newId } from '@foundry/core';
import type { Engine } from './engine.ts';
import { exec } from './git/git.ts';
import { type FixSpec, createFixTasks, genericFixSpec } from './fix-tasks.ts';
import { goalWorkspacePath } from './workspace.ts';

export interface RaiseInput {
  goal: Goal;
  task?: Task | null;
  attemptId?: string | null;
  trigger: EscalationTrigger;
  message: string;
  payload?: Record<string, unknown>;
  /** Block the whole goal (triggers 4, goal review) instead of just the task. */
  blockGoal?: boolean;
}

export function raiseEscalation(engine: Engine, i: RaiseInput): Escalation {
  const { store } = engine;
  // de-dup: one open escalation per (goal, task, trigger)
  const existing = listEscalations(store.db, { goalId: i.goal.id, openOnly: true }).find((e) => e.trigger === i.trigger && e.taskId === (i.task?.id ?? null));
  if (existing) return existing;
  const esc: Escalation = {
    id: newId(IdPrefix.escalation),
    goalId: i.goal.id,
    taskId: i.task?.id ?? null,
    attemptId: i.attemptId ?? null,
    trigger: i.trigger,
    message: i.message,
    payload: i.payload ?? {},
    state: 'open',
    answer: null,
    createdAt: new Date().toISOString(),
    answeredAt: null,
    suggestion: null,
  };
  store.append({ type: 'escalation.raised', goalId: i.goal.id, payload: { escalation: esc } });
  if (i.task && i.task.state !== 'blocked' && i.task.state !== 'done' && i.task.state !== 'failed' && i.task.state !== 'skipped') {
    store.append({ type: 'task.state_changed', goalId: i.goal.id, payload: { taskId: i.task.id, from: i.task.state, to: 'blocked', reason: `escalation ${i.trigger}` } });
  }
  const goal = getGoal(store.db, i.goal.id)!;
  if (i.blockGoal && goal.state !== 'blocked' && !['done', 'over_delivered', 'failed', 'cancelled'].includes(goal.state)) {
    store.append({ type: 'goal.state_changed', goalId: goal.id, payload: { from: goal.state, to: 'blocked', reason: `escalation ${i.trigger}` } });
  }
  engine.notify(esc);
  return esc;
}

export async function answerEscalation(engine: Engine, id: string, answer: EscalationAnswer): Promise<void> {
  const { store } = engine;
  const esc = getEscalation(store.db, id);
  if (!esc) throw new Error(`escalation ${id} not found`);
  if (esc.state !== 'open') throw new Error(`escalation ${id} is already ${esc.state}`);
  if (!ACTIONS_BY_TRIGGER[esc.trigger].includes(answer.action)) throw new Error(`action ${answer.action} is not valid for ${esc.trigger}`);
  // the engine records this answer itself when a manual merge resolution is finished (merge-resolve.ts)
  if (answer.action === 'resolve_manually') throw new Error('resolve the merge on the Resolve page; the escalation is answered when you finish');
  store.append({ type: 'escalation.answered', goalId: esc.goalId, payload: { escalationId: id, answer } });

  const goal = getGoal(store.db, esc.goalId)!;
  const task = esc.taskId ? getTask(store.db, esc.taskId) : null;

  // where the goal resumes when this answer unblocks it; null = where it was blocked
  let resumeTo: 'running' | null = null;
  switch (answer.action) {
    case 'retry_with_hint': {
      if (!task) {
        // goal-review escalation: the reviewer's findings become fix tasks carrying the human's hint, and the goal runs them before
        // it is reviewed again. Re-running the same review on the same branch would only re-roll the verdict (a paid loop with no exit).
        const p = esc.payload as { kind?: string; fixTasks?: FixSpec[]; failing?: { name: string; summary: string }[] };
        if (p.kind === 'goal-review' && (p.fixTasks?.length || p.failing?.length)) {
          const ids = createFixTasks(engine, goal, p.fixTasks?.length ? p.fixTasks : [genericFixSpec(p.failing!)], answer.hint?.trim() || null);
          store.append({ type: 'engine.note', goalId: goal.id, payload: { level: 'info', message: `human: retry goal review with ${ids.length} fix task(s)${answer.hint?.trim() ? ' and a hint' : ''}` } });
          resumeTo = 'running';
        }
        break;
      }
      store.append({ type: 'task.hint_set', goalId: goal.id, payload: { taskId: task.id, hint: answer.hint ?? null, extraAttempts: answer.extraAttempts ?? 1 } });
      const terminalGoal = ['done', 'over_delivered'].includes(goal.state);
      if (terminalGoal && (task.origin === 'merge' || task.origin === 'delivery-fix')) {
        // delivery-time task: re-arm the (idempotent) pipeline instead of the scheduler
        if (task.state === 'blocked') store.append({ type: 'task.state_changed', goalId: goal.id, payload: { taskId: task.id, from: 'blocked', to: 'failed', reason: 'superseded by a new delivery run' } });
        store.append({ type: 'delivery.policy_set', goalId: goal.id, payload: { policy: goal.delivery.policy, source: 'retry' } });
      } else if (task.state === 'blocked') store.append({ type: 'task.state_changed', goalId: goal.id, payload: { taskId: task.id, from: 'blocked', to: 'ready', reason: 'human: retry with hint' } });
      break;
    }
    case 'skip_task': {
      // goal-level review escalation: "skip" = accept the result as-is and finish — re-running the same
      // review would fail the same checks and escalate again (a paid loop with no exit)
      if (!task && (esc.payload as { kind?: string }).kind === 'goal-review') {
        if (!['done', 'over_delivered', 'failed', 'cancelled'].includes(goal.state)) {
          store.append({ type: 'review.goal.finished', goalId: goal.id, payload: { passed: true, overDelivered: false, mustResults: [], stretchResults: [], fixTaskIds: [], notes: 'human accepted the goal as-is; the failing checks are waived' } });
          store.append({ type: 'goal.state_changed', goalId: goal.id, payload: { from: goal.state, to: 'done', reason: 'human: accepted despite failing goal checks' } });
        }
        break;
      }
      if (!task) break;
      // skipped ≠ failed: dependents continue and the goal review judges the whole; the human can restart it later
      if (task.state === 'blocked') store.append({ type: 'task.state_changed', goalId: goal.id, payload: { taskId: task.id, from: 'blocked', to: 'skipped', reason: 'human: skipped' } });
      break;
    }
    case 'abort_goal': {
      engine.killGoal(goal.id, 'human: abort');
      if (!['done', 'over_delivered', 'failed', 'cancelled'].includes(goal.state))
        store.append({ type: 'goal.state_changed', goalId: goal.id, payload: { from: goal.state, to: 'failed', reason: 'human: abort' } });
      return;
    }
    case 'raise_budget': {
      // null limits stay null (unlimited); otherwise double unless the human gave a number
      const budgets = {
        ...goal.budgets,
        maxCostUsd: answer.newMaxCostUsd ?? (goal.budgets.maxCostUsd == null ? null : goal.budgets.maxCostUsd * 2),
        maxDurationMin: answer.newMaxDurationMin ?? (goal.budgets.maxDurationMin == null ? null : goal.budgets.maxDurationMin * 2),
      };
      store.append({ type: 'goal.budgets_changed', goalId: goal.id, payload: { budgets, reason: 'human: raise budget' } });
      break;
    }
    case 'approve': {
      const command = String(esc.payload.command ?? '');
      const cwd = String(esc.payload.cwd ?? goalWorkspacePath(engine.config.dataDir, goal.id));
      if (command) {
        const r = await exec(['sh', '-lc', command], cwd, { timeoutMs: 5 * 60_000 });
        store.append({
          type: 'engine.note',
          goalId: goal.id,
          payload: { level: r.code === 0 ? 'info' : 'warn', message: `human-approved boundary command \`${command}\` exited ${r.code}\n${(r.stdout + r.stderr).slice(-1500)}` },
        });
      }
      break;
    }
    case 'deny':
      break;
  }

  // unblock the goal if nothing else keeps it blocked
  const fresh = getGoal(store.db, goal.id)!;
  const stillOpen = listEscalations(store.db, { goalId: goal.id, openOnly: true }).filter((e) => e.trigger === 'budget_exceeded' || (e.taskId === null && e.trigger === 'retries_exhausted'));
  if (fresh.state === 'blocked' && stillOpen.length === 0) {
    const to = resumeTo ?? (fresh.stateBeforeBlock && fresh.stateBeforeBlock !== 'blocked' ? fresh.stateBeforeBlock : 'running');
    store.append({ type: 'goal.state_changed', goalId: goal.id, payload: { from: 'blocked', to, reason: 'escalation answered' } });
  }
  engine.tick(goal.id);
}
