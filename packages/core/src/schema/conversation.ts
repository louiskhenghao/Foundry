import { z } from 'zod';
import { Attachment } from './attachment.ts';
import { Proposal } from './proposal.ts';

/**
 * A Conversation (ADR-0073): the person's running exchange with the goal's coding agent about the goal, on its page. A
 * read-only Explainer answers from the goal's code and its records; the goal itself is never changed by it. A goal may
 * have several; the newest is the one that goes on, the earlier ones stay readable.
 */

/** how an answer ended: finished, cut by its turn / cost / time cap, stopped by the person, or failed before it said anything */
export const AnswerStatus = z.enum(['done', 'cut', 'stopped', 'failed']);
export type AnswerStatus = z.infer<typeof AnswerStatus>;

export const ConversationMessage = z.object({
  id: z.string(),
  role: z.enum(['person', 'explainer']),
  text: z.string(),
  at: z.string(),
  /** who asked (Access, ADR-0061); null when Access is off, and on the Explainer's messages */
  by: z.string().nullable().default(null),
  /** the question an Explainer message answers; null on the person's */
  askedId: z.string().nullable().default(null),
  /** how an Explainer message ended; null on the person's */
  status: AnswerStatus.nullable().default(null),
  /** why it was cut, stopped or failed */
  reason: z.string().nullable().default(null),
  /** what the answer cost; 0 is unknown when `costAvailable` is false (Codex, Antigravity, a session cut before its result line) */
  costUsd: z.number().nonnegative().default(0),
  costAvailable: z.boolean().default(true),
  model: z.string().nullable().default(null),
  durationMs: z.number().nonnegative().default(0),
  /** what the person attached to a question (pictures, files, links), kept under the goal's attachments folder; none on the Explainer's */
  attachments: z.array(Attachment).default([]),
  /** what the Explainer proposed with its answer (ADR-0075): a task, a decision, a note, a follow-up, a hand-over; applied by the person */
  proposals: z.array(Proposal).optional(),
});
export type ConversationMessage = z.infer<typeof ConversationMessage>;

export const Conversation = z.object({
  id: z.string(),
  goalId: z.string(),
  /** the first question's opening words; '' until it is asked */
  title: z.string().default(''),
  startedAt: z.string(),
  updatedAt: z.string(),
  /** who started it (Access); null when Access is off */
  by: z.string().nullable().default(null),
  /** the Explainer's session, resumed turn by turn; null before the first answer, and once it was lost */
  sessionId: z.string().nullable().default(null),
  /** what its answers cost so far (the measured ones) */
  costUsd: z.number().nonnegative().default(0),
  messages: z.array(ConversationMessage).default([]),
});
export type Conversation = z.infer<typeof Conversation>;

/** a question is one message of the person's, bounded; a document is not a question */
export const CONVERSATION_QUESTION_MAX = 8_000;
export const CONVERSATION_TITLE_MAX = 60;
/** pictures and files on one question */
export const CONVERSATION_ATTACHMENTS_MAX = 8;
/** the words of a question that is only its attachments */
export const CONVERSATION_FILES_ONLY_TEXT = 'See the attached files.';

/** a Conversation is titled by its first question's opening words, on one line */
export function conversationTitle(question: string): string {
  const line = question.replace(/\s+/g, ' ').trim();
  return line.length > CONVERSATION_TITLE_MAX ? `${line.slice(0, CONVERSATION_TITLE_MAX - 1).trimEnd()}…` : line;
}

/** the person's questions no answer has followed yet, oldest first */
export function pendingQuestions(c: Pick<Conversation, 'messages'>): ConversationMessage[] {
  const answered = new Set(c.messages.filter((m) => m.role === 'explainer' && m.askedId).map((m) => m.askedId));
  return c.messages.filter((m) => m.role === 'person' && !answered.has(m.id));
}
