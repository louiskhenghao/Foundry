import { z } from 'zod';

/** `interrupted` = the session was cut (engine restart) and can be resumed as a Continuation */
export const AttemptState = z.enum(['created', 'running', 'observing', 'passed', 'failed', 'error', 'aborted', 'interrupted']);
export type AttemptState = z.infer<typeof AttemptState>;

export const AttemptKind = z.enum(['work', 'merge']);
export type AttemptKind = z.infer<typeof AttemptKind>;

/** One Claude session that belonged to an attempt: a worker segment, the task reviewer, a merger. */
export const AttemptSession = z.object({
  role: z.enum(['worker', 'reviewer', 'merger']),
  /** worker segment number (0 = first, n = nth continuation); reviewer/merger sessions carry the segment they followed */
  segment: z.number().int().nonnegative(),
  sessionId: z.string().nullable(),
  /** resolved model id as reported by the session's init (falls back to the requested name) */
  model: z.string().nullable(),
  costUsd: z.number().nonnegative(),
  numTurns: z.number().int().nonnegative(),
  durationMs: z.number().nonnegative(),
  subtype: z.string().nullable(),
  startedAt: z.string(),
  endedAt: z.string(),
});
export type AttemptSession = z.infer<typeof AttemptSession>;

export const Attempt = z.object({
  id: z.string(),
  goalId: z.string(),
  taskId: z.string(),
  index: z.number().int().positive(),
  kind: AttemptKind,
  sessionId: z.string().nullable(),
  model: z.string().nullable(),
  state: AttemptState,
  costUsd: z.number().nonnegative(),
  numTurns: z.number().int().nonnegative(),
  resultSubtype: z.string().nullable(),
  /** git ref before this attempt, for rollback */
  baseRef: z.string().nullable(),
  /** git ref after this attempt committed its work */
  endRef: z.string().nullable(),
  pid: z.number().int().nullable(),
  cwd: z.string().nullable(),
  transcriptPath: z.string().nullable(),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  /** skills the session invoked with the Skill tool (observed from the stream) */
  skillsUsed: z.array(z.string()).default([]),
  /** how many times this attempt's session was resumed (Continuations); cost/turns are cumulative */
  continuations: z.number().int().nonnegative().default(0),
  /** every session that ran for this attempt (worker segments, reviewer, merger), in order */
  sessions: z.array(AttemptSession).default([]),
});
export type Attempt = z.infer<typeof Attempt>;
