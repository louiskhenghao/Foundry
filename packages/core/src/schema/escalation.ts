import { z } from 'zod';
import { FeedbackPlan } from './feedback.ts';

/** Closed enum. Nothing else ever asks the human. */
export const EscalationTrigger = z.enum([
  'brief_question',
  'retries_exhausted',
  'boundary_action',
  'budget_exceeded',
  'permission_denial',
  /** the goal paused at a milestone: look at the work, then continue or give feedback */
  'milestone',
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
  /** a merge conflict the human resolved by hand (answered by the engine when the manual resolution is finished) */
  'resolve_manually',
  /** milestone: carry on with the remaining tasks */
  'continue',
  /** milestone: what the human saw becomes a hint, fix tasks or a Decision (the confirmed plan rides along) */
  'feedback',
]);
export type EscalationAction = z.infer<typeof EscalationAction>;

export const EscalationAnswer = z.object({
  action: EscalationAction,
  hint: z.string().optional(),
  extraAttempts: z.number().int().positive().optional(),
  newMaxCostUsd: z.number().positive().optional(),
  newMaxDurationMin: z.number().positive().optional(),
  feedback: z.string().optional(),
  plan: FeedbackPlan.optional(),
});
export type EscalationAnswer = z.infer<typeof EscalationAnswer>;

/** What the AI suggested the human do about an escalation (never applied on its own except retry_with_hint on request). */
export const EscalationSuggestion = z.object({
  diagnosis: z.string(),
  action: z.enum(['retry_with_hint', 'skip_task', 'resolve_manually', 'raise_budget']),
  hint: z.string(),
  confidence: z.enum(['high', 'medium', 'low']),
  costUsd: z.number().nonnegative(),
  at: z.string(),
});
export type EscalationSuggestion = z.infer<typeof EscalationSuggestion>;

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
  /** last AI suggestion for this escalation (default keeps older events replayable) */
  suggestion: EscalationSuggestion.nullable().default(null),
});
export type Escalation = z.infer<typeof Escalation>;

/** Which actions make sense for which trigger. */
export const ACTIONS_BY_TRIGGER: Record<EscalationTrigger, EscalationAction[]> = {
  brief_question: [],
  retries_exhausted: ['retry_with_hint', 'skip_task', 'abort_goal', 'resolve_manually'],
  boundary_action: ['approve', 'deny'],
  budget_exceeded: ['raise_budget', 'abort_goal'],
  permission_denial: ['retry_with_hint', 'skip_task', 'abort_goal'],
  milestone: ['continue', 'feedback'],
};
