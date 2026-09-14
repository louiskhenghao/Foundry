import { z } from 'zod';

/**
 * What one piece of milestone feedback becomes, decided by a cheap triage session and confirmed by the human:
 * hint = a way of working for the remaining tasks (no plan change); fix = something is missing or wrong in work already
 * landed (new fix tasks after which the milestone re-opens once); decision = an assumption the human overturned (recorded
 * as a Decision every later session receives, plus any fix tasks for landed work).
 */
export const FeedbackPlan = z.object({
  kind: z.enum(['hint', 'fix', 'decision']),
  rationale: z.string(),
  hint: z.string().nullable().default(null),
  fixTasks: z.array(z.object({ title: z.string(), spec: z.string(), relevantFiles: z.array(z.string()).default([]) })).default([]),
  decision: z.string().nullable().default(null),
});
export type FeedbackPlan = z.infer<typeof FeedbackPlan>;
