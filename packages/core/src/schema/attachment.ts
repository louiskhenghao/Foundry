import { z } from 'zod';

/**
 * Something the user attached to a Goal that cannot be said in the prompt: a file (image, PDF, text, …)
 * stored under the engine's data directory, or a link. Read-only references for every session of the Goal.
 */
/** Markdown rendition of an attachment produced by markitdown (file) or a fetched snapshot (link). */
export const AttachmentMarkdown = z.object({
  status: z.enum(['pending', 'ready', 'failed', 'skipped']),
  /** relative to dataDir */
  path: z.string().nullable().default(null),
  bytes: z.number().int().nonnegative().nullable().default(null),
  tool: z.string().nullable().default(null),
  error: z.string().nullable().default(null),
  at: z.string().nullable().default(null),
});
export type AttachmentMarkdown = z.infer<typeof AttachmentMarkdown>;

export const Attachment = z.object({
  id: z.string(),
  kind: z.enum(['file', 'link']),
  /** original file name, or a label for links */
  name: z.string().min(1),
  mime: z.string().nullable().default(null),
  size: z.number().int().nonnegative().nullable().default(null),
  /** relative to dataDir, e.g. attachments/<goalId>/<id>/<name> — null for links */
  path: z.string().nullable().default(null),
  url: z.string().url().nullable().default(null),
  /** optional note from the user: what this is for */
  note: z.string().nullable().default(null),
  addedAt: z.string(),
  /** markdown rendition; null = not applicable / never attempted. Default keeps older events replayable. */
  markdown: AttachmentMarkdown.nullable().default(null),
});
export type Attachment = z.infer<typeof Attachment>;

export const ATTACHMENT_LIMITS = { maxFileBytes: 25 * 1024 * 1024, maxPerGoal: 20 } as const;

export const attachmentKindLabel = (a: Pick<Attachment, 'kind' | 'mime' | 'name'>): 'image' | 'pdf' | 'document' | 'text' | 'file' | 'link' => {
  if (a.kind === 'link') return 'link';
  const m = a.mime ?? '';
  if (m.startsWith('image/')) return 'image';
  if (m === 'application/pdf' || /\.pdf$/i.test(a.name)) return 'pdf';
  // Office / OpenDocument / e-books: binary documents markitdown can render (their MIME types contain "xml" — test them first)
  if (/officedocument|ms-?(word|excel|powerpoint)|opendocument|epub/.test(m) || /\.(docx?|xlsx?|pptx?|odt|ods|odp|epub|rtf)$/i.test(a.name)) return 'document';
  if (m.startsWith('text/') || /^application\/(json|ld\+json|xml|x-yaml|yaml|csv|x-sh|toml)$/.test(m) || /\.(md|txt|json|ya?ml|csv|sql|ts|js|py|go|rs|java|kt|swift|sh|toml|ini|env|log|html?)$/i.test(a.name)) return 'text';
  return 'file';
};
