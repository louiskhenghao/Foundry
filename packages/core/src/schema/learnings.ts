import { z } from 'zod';

/** what a learning is about: how to build, test or run the project, where things are, how it is written, what the person wants, what goes wrong */
export const LearningKind = z.enum(['build', 'test', 'run', 'structure', 'convention', 'preference', 'pitfall']);
export type LearningKind = z.infer<typeof LearningKind>;

/** the longest a learning may be, and how many a repository keeps */
export const LEARNING_MAX_CHARS = 300;
export const LEARNINGS_MAX = 30;

/** One thing Foundry (or the person) knows about a repository that saves the next goal time (ADR-0040). */
export const Learning = z.object({
  id: z.string(),
  kind: LearningKind,
  text: z.string().min(1).max(LEARNING_MAX_CHARS),
  /** who wrote it: Foundry from a finished goal, or the person (Foundry never changes or drops the person's) */
  by: z.enum(['foundry', 'human']),
  /** the goal it was learned from; null for the person's own */
  goalId: z.string().nullable(),
  goalTitle: z.string().nullable(),
  at: z.string(),
});
export type Learning = z.infer<typeof Learning>;

/** a repository's notebook, keyed by its folder */
export const RepoLearnings = z.object({
  repoPath: z.string(),
  learnings: z.array(Learning),
  updatedAt: z.string(),
});
export type RepoLearnings = z.infer<typeof RepoLearnings>;
