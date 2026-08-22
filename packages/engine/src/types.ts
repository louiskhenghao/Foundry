import type { RunnerEvent } from '@ai-engine/runner';

/** Live stream of a running Claude session. Not persisted in the event log (transcript file is). */
export interface StreamEvent {
  goalId: string;
  taskId: string | null;
  attemptId: string;
  event: RunnerEvent;
  ts: string;
}

export type StreamListener = (s: StreamEvent) => void;
