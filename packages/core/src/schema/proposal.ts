import { z } from 'zod';
import { TaskDifficulty, TaskKind, TaskScenario } from './task.ts';

/**
 * A Proposal (ADR-0075): what the Explainer suggests be done to the goal, in a ```foundry-proposal block at the end of
 * its answer — only when the person asked for a change. It becomes a card the person applies; nothing changes before.
 */
export const ProposalType = z.enum(['task', 'decision', 'note', 'follow-up', 'fulfil']);
export type ProposalType = z.infer<typeof ProposalType>;

export const ProposalInput = z.object({
  type: ProposalType,
  /** the card's title, a few words */
  title: z.string().min(1),
  /** one or two sentences: what applying it does */
  summary: z.string().default(''),
  /** a new task of this goal (`task`) */
  task: z
    .object({
      title: z.string().min(1),
      spec: z.string().min(1),
      kind: TaskKind.exclude(['goal']).default('feature'),
      scenario: TaskScenario.default('general'),
      difficulty: TaskDifficulty.default('standard'),
      /** tasks it runs after, by id or title; none = after everything done so far */
      dependsOn: z.array(z.string()).default([]),
      relevantFiles: z.array(z.string()).default([]),
      /** command checks of its own, on top of the goal's must commands */
      checks: z.array(z.object({ name: z.string().min(1), cmd: z.string().min(1) })).default([]),
    })
    .optional(),
  /** a constraint for the rest of the goal (`decision`) */
  decision: z.object({ text: z.string().min(1) }).optional(),
  /** a Note on the Brief while it awaits approval (`note`) */
  note: z.object({ text: z.string().min(1) }).optional(),
  /** a Follow-up goal's prompt, once this goal is over (`follow-up`) */
  followUp: z.object({ prompt: z.string().min(1) }).optional(),
  /** files the person gave in the Conversation, handed to an open Request or a material of the Brief (`fulfil`) */
  fulfil: z
    .object({
      requestId: z.string().nullable().default(null),
      materialKey: z.string().nullable().default(null),
      /** ids of the attachments on the person's questions in this Conversation */
      attachmentIds: z.array(z.string()).default([]),
      note: z.string().nullable().default(null),
    })
    .optional(),
});
export type ProposalInput = z.infer<typeof ProposalInput>;

export const Proposal = ProposalInput.extend({
  id: z.string(),
  /** set once the person applied it: when, who, and what came of it (a task id, a path, a word) */
  applied: z.object({ at: z.string(), by: z.string().nullable(), result: z.string() }).nullable().default(null),
});
export type Proposal = z.infer<typeof Proposal>;

const FENCE = /```foundry-proposal[^\n]*\n([\s\S]*?)```/g;

/** every proposal block in an answer that parses (an object or an array of them); the ones that do not are dropped */
export function parseProposalBlocks(text: string | null | undefined): ProposalInput[] {
  if (!text) return [];
  const out: ProposalInput[] = [];
  for (const m of text.matchAll(FENCE)) {
    let raw: unknown;
    try {
      raw = JSON.parse((m[1] ?? '').trim());
    } catch {
      continue;
    }
    for (const item of Array.isArray(raw) ? raw : [raw]) {
      const parsed = ProposalInput.safeParse(item);
      // a proposal must carry the part its type names
      if (parsed.success && parsed.data[parsed.data.type === 'follow-up' ? 'followUp' : parsed.data.type]) out.push(parsed.data);
    }
  }
  return out;
}

/** the answer without its proposal blocks, for the page (the cards stand in for them) */
export const withoutProposalBlocks = (text: string): string => text.replace(FENCE, '').replace(/\n{3,}/g, '\n\n').trimEnd();
