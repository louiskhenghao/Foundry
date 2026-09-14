import type { AttemptState, GoalState, TaskState } from '../schema/index.ts';

export class IllegalTransition extends Error {
  constructor(entity: string, from: string, to: string) {
    super(`Illegal ${entity} transition: ${from} -> ${to}`);
  }
}

const GOAL: Record<GoalState, GoalState[]> = {
  draft: ['clarifying', 'cancelled'],
  clarifying: ['awaiting_brief_approval', 'blocked', 'failed', 'cancelled'],
  awaiting_brief_approval: ['running', 'clarifying', 'cancelled'],
  running: ['goal_review', 'blocked', 'failed', 'cancelled', 'done', 'awaiting_feedback'],
  goal_review: ['done', 'over_delivered', 'running', 'blocked', 'failed', 'cancelled'],
  blocked: ['running', 'goal_review', 'clarifying', 'awaiting_feedback', 'failed', 'cancelled'],
  awaiting_feedback: ['running', 'blocked', 'failed', 'cancelled'],
  // terminal goals can be restarted by the human (tasks are reset first)
  done: ['running'],
  over_delivered: ['running'],
  failed: ['running'],
  cancelled: ['running'],
};

const TASK: Record<TaskState, TaskState[]> = {
  pending: ['ready', 'failed'],
  ready: ['running', 'failed', 'pending'],
  running: ['observing', 'ready', 'blocked', 'failed'],
  observing: ['merging', 'ready', 'blocked', 'failed', 'done'],
  merging: ['done', 'blocked', 'failed', 'observing'],
  blocked: ['ready', 'failed', 'done', 'merging', 'skipped'],
  done: [],
  // a failed upstream task is treated as skipped when the human restarts from a task below it
  failed: ['skipped'],
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
