import type { RunnerEvent } from '@ai-engine/runner';

/** Live stream of a running Claude session. Not persisted in the event log (transcript file is). */
export interface StreamEvent {
  goalId: string;
  taskId: string | null;
  attemptId: string;
  event: RunnerEvent;
  ts: string;
  /** which session produced it when several share a channel (the task reviewer streams on the attempt's channel) */
  role?: 'worker' | 'reviewer' | 'merger' | 'clarifier' | 'goal-reviewer';
}

export type StreamListener = (s: StreamEvent) => void;
