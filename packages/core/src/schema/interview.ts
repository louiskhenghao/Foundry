import { z } from 'zod';

/** rounds and questions per round the Clarifier may ask before writing the Brief */
export const INTERVIEW_MAX_ROUNDS = 4;
export const INTERVIEW_MAX_QUESTIONS = 8;

export const InterviewQuestion = z.object({
  /** unique across the interview, e.g. R1Q2 */
  key: z.string(),
  text: z.string(),
  /** concrete choices, the Clarifier's recommendation first; free text stays possible */
  options: z.array(z.string()).default([]),
  /** why it asks: what it found (or could not find) in the repository, the attachments or the goal */
  reason: z.string().default(''),
  /** key of the earlier question whose answer made this one askable */
  dependsOn: z.string().nullable().default(null),
  /** a wrong guess would waste the goal; other questions are assumptions the human may correct */
  blocking: z.boolean().default(true),
});
export type InterviewQuestion = z.infer<typeof InterviewQuestion>;

export const InterviewRound = z.object({
  round: z.number().int().positive(),
  questions: z.array(InterviewQuestion),
  /** question key → the human's answer; null while the round is open */
  answers: z.record(z.string()).nullable().default(null),
  askedAt: z.string(),
  answeredAt: z.string().nullable().default(null),
  /** the human asked for the Brief with these answers, whatever is still open */
  finish: z.boolean().default(false),
});
export type InterviewRound = z.infer<typeof InterviewRound>;

/**
 * The Clarify interview: rounds of questions before the Brief exists, each round reshaped by the answers to the last.
 * `auto` lets the Clarifier skip straight to the Brief when nothing is worth asking; `always` asks at least one round.
 */
export const Interview = z.object({
  mode: z.enum(['auto', 'always']).default('auto'),
  /** thinking = a session is (or must be) running; awaiting_answers = a round is open; done = the Brief was written */
  status: z.enum(['thinking', 'awaiting_answers', 'done']).default('thinking'),
  /** the Clarify session every round resumes; null before the first round or after it was lost */
  sessionId: z.string().nullable().default(null),
  rounds: z.array(InterviewRound).default([]),
});
export type Interview = z.infer<typeof Interview>;
export type InterviewMode = 'auto' | 'always' | 'never';

/** the answered questions of every round so far, for prompts and the Brief's Decisions */
export function interviewAnswers(iv: Pick<Interview, 'rounds'>): { question: InterviewQuestion; answer: string }[] {
  const out: { question: InterviewQuestion; answer: string }[] = [];
  for (const r of iv.rounds) for (const q of r.questions) if (r.answers?.[q.key]?.trim()) out.push({ question: q, answer: r.answers[q.key]!.trim() });
  return out;
}
