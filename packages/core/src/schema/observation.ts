import { z } from 'zod';
import { CheckResult } from './check.ts';

/** the axes a reviewer scores when a rubric asks for scores: a film's critique (ADR-0076) */
export const VERDICT_AXES = ['hook', 'readability', 'motion', 'variety', 'composition', 'brand', 'sound'] as const;
export type VerdictAxis = (typeof VERDICT_AXES)[number];
const score = z.number().int().min(1).max(10).optional();
export const VerdictScores = z.object({ hook: score, readability: score, motion: score, variety: score, composition: score, brand: score, sound: score });
export type VerdictScores = z.infer<typeof VerdictScores>;

export const ReviewerVerdict = z.object({
  pass: z.boolean(),
  blockers: z.array(z.string()),
  notes: z.string().optional(),
  /** 1–10 per axis the rubric scores; absent when it scores none */
  scores: VerdictScores.optional(),
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
