import { z } from 'zod';

/** Closed enum. Nothing else ever asks the human. */
export const EscalationTrigger = z.enum([
  'brief_question',
  'retries_exhausted',
  'boundary_action',
  'budget_exceeded',
  'permission_denial',
]);
export type EscalationTrigger = z.infer<typeof EscalationTrigger>;

export const EscalationState = z.enum(['open', 'answered', 'dismissed']);

export const EscalationAction = z.enum([
  'retry_with_hint',
  'skip_task',
  'abort_goal',
  'approve',
  'deny',
  'raise_budget',
]);
export type EscalationAction = z.infer<typeof EscalationAction>;

export const EscalationAnswer = z.object({
  action: EscalationAction,
  hint: z.string().optional(),
  extraAttempts: z.number().int().positive().optional(),
  newMaxCostUsd: z.number().positive().optional(),
  newMaxDurationMin: z.number().positive().optional(),
});
export type EscalationAnswer = z.infer<typeof EscalationAnswer>;

export const Escalation = z.object({
  id: z.string(),
  goalId: z.string(),
  taskId: z.string().nullable(),
  attemptId: z.string().nullable(),
  trigger: EscalationTrigger,
  /** human-readable summary */
  message: z.string(),
  payload: z.record(z.unknown()),
  state: EscalationState,
  answer: EscalationAnswer.nullable(),
  createdAt: z.string(),
  answeredAt: z.string().nullable(),
});
export type Escalation = z.infer<typeof Escalation>;

/** Which actions make sense for which trigger. */
export const ACTIONS_BY_TRIGGER: Record<EscalationTrigger, EscalationAction[]> = {
  brief_question: [],
  retries_exhausted: ['retry_with_hint', 'skip_task', 'abort_goal'],
  boundary_action: ['approve', 'deny'],
  budget_exceeded: ['raise_budget', 'abort_goal'],
  permission_denial: ['retry_with_hint', 'skip_task', 'abort_goal'],
};
