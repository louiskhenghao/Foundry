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
  /** the Request (escalation id) this attachment answers, when it came with one (ADR-0074) */
  requestId: z.string().nullable().optional(),
  /** the Brief material (`provides[].key`) this attachment delivers, when it does (ADR-0074) */
  materialKey: z.string().nullable().optional(),
  /** the Adjustment this attachment came with (ADR-0078), when it did */
  adjustId: z.string().nullable().optional(),
  /** the design the result follows (ADR-0092): a picture, an HTML export or a zip of it; what it shows is made as it shows it. Absent on attachments from before, read as not the design */
  design: z.boolean().optional(),
  /** a zip's extracted files (ADR-0092): the folder (relative to dataDir), how many files, and the page to open first; absent or null on other files */
  extracted: z.object({ dir: z.string(), files: z.number().int().nonnegative(), entry: z.string().nullable().default(null) }).nullable().optional(),
  addedAt: z.string(),
  /** markdown rendition; null = not applicable / never attempted. Default keeps older events replayable. */
  markdown: AttachmentMarkdown.nullable().default(null),
});
export type Attachment = z.infer<typeof Attachment>;

export const ATTACHMENT_LIMITS = { maxFileBytes: 25 * 1024 * 1024, maxMediaFileBytes: 200 * 1024 * 1024, maxPerGoal: 20 } as const;

const MEDIA_EXT = /\.(mp4|m4v|mov|webm|mkv|avi|wav|mp3|m4a|aac|flac|ogg|oga|opus|aiff?)$/i;
/** is this attachment audio or video: a reference film, a music track (ADR-0077) */
export const isMediaAttachment = (a: { name: string; mime: string | null }): boolean => !!(a.mime && /^(audio|video)\//.test(a.mime)) || MEDIA_EXT.test(a.name);
/** what one attachment may weigh: audio and video get the larger cap */
export const attachmentMaxBytes = (a: { name: string; mime: string | null }): number => (isMediaAttachment(a) ? ATTACHMENT_LIMITS.maxMediaFileBytes : ATTACHMENT_LIMITS.maxFileBytes);

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

const ARCHIVE_EXT = /\.zip$/i;
/** is this attachment a zip archive (a design tool's export, a folder of pictures), by name or by mime */
export const isArchiveAttachment = (a: Pick<Attachment, 'kind' | 'mime' | 'name'>): boolean => a.kind === 'file' && (ARCHIVE_EXT.test(a.name) || a.mime === 'application/zip' || a.mime === 'application/x-zip-compressed');

/**
 * Could this attachment be the design the result follows (ADR-0092): a picture of it, an HTML page (what Claude Design
 * or Figma export), or a zip of one. The New goal form marks such a file as the design reference when it is attached;
 * the person may untick it. Documents, text and links are never the design.
 */
export const isDesignCandidate = (a: Pick<Attachment, 'kind' | 'mime' | 'name'>): boolean => a.kind === 'file' && (attachmentKindLabel(a) === 'image' || /\.html?$/i.test(a.name) || isArchiveAttachment(a));

/** the attachments marked as the design reference, in the order they were attached */
export const designReferences = <T extends Pick<Attachment, 'design'>>(atts: T[]): T[] => atts.filter((a) => a.design === true);

/** design tools whose pages need a sign-in (or draw themselves in the browser), so a session cannot read a link to them */
const UNREADABLE_DESIGN_HOSTS: [RegExp, string][] = [
  [/(^|\.)claude\.ai$/i, 'Claude'],
  [/(^|\.)figma\.com$/i, 'Figma'],
  [/(^|\.)canva\.com$/i, 'Canva'],
  [/(^|\.)framer\.com$/i, 'Framer'],
];

/** the design tool a link points into when Foundry's sessions cannot open it (ADR-0092): 'Claude', 'Figma', 'Canva', 'Framer'; null for any other link */
export function unreadableDesignLink(url: string): string | null {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return null;
  }
  return UNREADABLE_DESIGN_HOSTS.find(([re]) => re.test(host))?.[1] ?? null;
}

/** the links in a text (a goal's description) that point into a design tool a session cannot open, once each, in order */
export function unreadableDesignLinksIn(text: string): { url: string; tool: string }[] {
  const out: { url: string; tool: string }[] = [];
  for (const m of text.matchAll(/https?:\/\/[^\s<>"'()]+/g)) {
    const url = m[0].replace(/[.,;:!?]+$/, '');
    const tool = unreadableDesignLink(url);
    if (tool && !out.some((o) => o.url === url)) out.push({ url, tool });
  }
  return out;
}

/** the links of a goal (in its description, and link attachments) that point into a design tool no session can open, once each */
export function unreadableDesignLinks(goal: { prompt?: string | null; attachments?: Pick<Attachment, 'kind' | 'url'>[] | null }): { url: string; tool: string }[] {
  const out = unreadableDesignLinksIn(goal.prompt ?? '');
  for (const a of goal.attachments ?? []) {
    if (a.kind !== 'link' || !a.url) continue;
    const tool = unreadableDesignLink(a.url);
    if (tool && !out.some((o) => o.url === a.url)) out.push({ url: a.url, tool });
  }
  return out;
}
