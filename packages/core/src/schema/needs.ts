import { z } from 'zod';
import type { Escalation } from './escalation.ts';

/**
 * A Request (ADR-0074): what a worker asks the person for when the task cannot be finished without something only
 * they can give. The worker ends its segment with a ```foundry-needs fenced JSON block; Foundry also raises one itself
 * for a material the person promised in the Brief (`source: 'foundry'`).
 */
export const NeedsBlock = z.object({
  /** the thing: "the realistic 3D car models (GLB), one per car" */
  what: z.string().min(1),
  /** what it is for */
  why: z.string().default(''),
  /** where or how to get it: links, steps, formats */
  suggestions: z.string().default(''),
  /** the worker could finish with a placeholder or a substitute */
  canProceedWithout: z.boolean().default(false),
});
export type NeedsBlock = z.infer<typeof NeedsBlock>;

/** the payload of a `needs_input` escalation */
export const NeedsPayload = NeedsBlock.extend({
  kind: z.literal('needs_input'),
  source: z.enum(['worker', 'foundry']).default('worker'),
  /** the Brief's material this Request is for (Foundry-raised, or a worker asking for one), or null */
  materialKey: z.string().nullable().default(null),
});
export type NeedsPayload = z.infer<typeof NeedsPayload>;

const FENCE = /```foundry-needs[^\n]*\n([\s\S]*?)```/g;

/** the request block at the end of a worker's final text, when there is one and it parses; the last one wins */
export function parseNeedsBlock(text: string | null | undefined): NeedsBlock | null {
  if (!text) return null;
  let last: string | null = null;
  for (const m of text.matchAll(FENCE)) last = m[1] ?? null;
  if (last == null) return null;
  try {
    const parsed = NeedsBlock.safeParse(JSON.parse(last.trim()));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** the worker's words without the request block, for the summary the person reads */
export const withoutNeedsBlock = (text: string): string => text.replace(FENCE, '').trimEnd();

/** the Request's payload, when the escalation is one */
export function needsOf(e: Pick<Escalation, 'trigger' | 'payload'>): NeedsPayload | null {
  if (e.trigger !== 'needs_input') return null;
  const parsed = NeedsPayload.safeParse(e.payload);
  return parsed.success ? parsed.data : null;
}
