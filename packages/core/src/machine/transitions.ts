import type { AttemptState, GoalState, TaskState } from '../schema/index.ts';

export class IllegalTransition extends Error {
  constructor(entity: string, from: string, to: string) {
    super(`Illegal ${entity} transition: ${from} -> ${to}`);
  }
}

const GOAL: Record<GoalState, GoalState[]> = {
  draft: ['clarifying', 'cancelled'],
  clarifying: ['awaiting_brief_approval', 'blocked', 'failed', 'cancelled', 'paused'],
  awaiting_brief_approval: ['running', 'clarifying', 'cancelled'],
  running: ['goal_review', 'blocked', 'failed', 'cancelled', 'done', 'awaiting_feedback', 'paused'],
  goal_review: ['done', 'over_delivered', 'running', 'blocked', 'failed', 'cancelled'],
  blocked: ['running', 'goal_review', 'clarifying', 'awaiting_feedback', 'failed', 'cancelled'],
  awaiting_feedback: ['running', 'blocked', 'failed', 'cancelled'],
  // the person paused it (ADR-0080): Resume takes it back to where it was
  paused: ['running', 'clarifying', 'cancelled', 'failed'],
  // terminal goals can be restarted by the human (tasks are reset first), and a failed or cancelled one resumed where it
  // stopped (ADR-0080): with its tasks, before its Brief was approved, or before it had one
  done: ['running'],
  over_delivered: ['running'],
  failed: ['running', 'awaiting_brief_approval', 'clarifying'],
  cancelled: ['running', 'awaiting_brief_approval', 'clarifying'],
};

const TASK: Record<TaskState, TaskState[]> = {
  // skipped: carried over to a goal made to finish it (ADR-0081)
  pending: ['ready', 'failed', 'skipped'],
  ready: ['running', 'failed', 'pending', 'skipped'],
  running: ['observing', 'ready', 'blocked', 'failed'],
  observing: ['merging', 'ready', 'blocked', 'failed', 'done'],
  merging: ['done', 'blocked', 'failed', 'observing'],
  blocked: ['ready', 'failed', 'done', 'merging', 'skipped'],
  // a finished task runs again for an Adjustment of the goal's result (ADR-0078): its session resumed with the person's words
  done: ['ready'],
  // a failed upstream task is treated as skipped when the human restarts from a task below it; it runs again (ready, or
  // pending while what it waits for is not done) when the person resumes the goal (ADR-0080)
  failed: ['skipped', 'ready', 'pending'],
  skipped: [],
};

const ATTEMPT: Record<AttemptState, AttemptState[]> = {
  created: ['running', 'aborted', 'error', 'interrupted'],
  running: ['observing', 'error', 'aborted', 'failed', 'interrupted'],
  observing: ['passed', 'failed', 'error', 'aborted', 'interrupted'],
  // resumed as a Continuation (same attempt, same session)
  interrupted: ['running', 'error', 'aborted'],
  passed: [],
  failed: [],
  error: [],
  aborted: [],
};

export function assertGoalTransition(from: GoalState, to: GoalState): void {
  if (!GOAL[from].includes(to)) throw new IllegalTransition('goal', from, to);
}
export function assertTaskTransition(from: TaskState, to: TaskState): void {
  if (!TASK[from].includes(to)) throw new IllegalTransition('task', from, to);
}
export function assertAttemptTransition(from: AttemptState, to: AttemptState): void {
  if (!ATTEMPT[from].includes(to)) throw new IllegalTransition('attempt', from, to);
}

export const TERMINAL_GOAL_STATES: GoalState[] = ['done', 'over_delivered', 'failed', 'cancelled'];
export const TERMINAL_TASK_STATES: TaskState[] = ['done', 'failed'];
export const TERMINAL_ATTEMPT_STATES: AttemptState[] = ['passed', 'failed', 'error', 'aborted'];
