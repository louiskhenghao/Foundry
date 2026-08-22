import { z } from 'zod';

export const AttemptState = z.enum(['created', 'running', 'observing', 'passed', 'failed', 'error', 'aborted']);
export type AttemptState = z.infer<typeof AttemptState>;

export const AttemptKind = z.enum(['work', 'merge']);
export type AttemptKind = z.infer<typeof AttemptKind>;

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
});
export type Attempt = z.infer<typeof Attempt>;
