import { z } from 'zod';
import { CheckResult } from './check.ts';

export const ReviewerVerdict = z.object({
  pass: z.boolean(),
  blockers: z.array(z.string()),
  notes: z.string().optional(),
});
export type ReviewerVerdict = z.infer<typeof ReviewerVerdict>;

export const ChangedFile = z.object({
  path: z.string(),
  insertions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
});

export const ObservationReport = z.object({
  attemptId: z.string(),
  taskId: z.string(),
  goalId: z.string(),
  results: z.array(CheckResult),
  reviewerVerdict: ReviewerVerdict.nullable(),
  changedFiles: z.array(ChangedFile),
  /** What the next Attempt receives. Already distilled. */
  summary: z.string(),
  allMustPassed: z.boolean(),
  failedCount: z.number().int().nonnegative(),
});
export type ObservationReport = z.infer<typeof ObservationReport>;
