/**
 * Goal attachments: files live under <dataDir>/attachments/<goalId>/<attId>/<name>; uploads are staged under
 * attachments/_staging/<attId>/ until the goal exists. Nothing here ever deletes user bytes — removal moves to _trash.
 */
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import type { Attachment, Goal } from '@foundry/core';
import { ATTACHMENT_LIMITS, IdPrefix, attachmentKindLabel, newId } from '@foundry/core';

export class AttachmentError extends Error {
  constructor(
    message: string,
    public readonly code: 'too-large' | 'too-many' | 'bad-name' | 'not-found' | 'bad-url',
  ) {
    super(message);
  }
}

export const attachmentsRoot = (dataDir: string) => join(dataDir, 'attachments');
export const attachmentsDir = (dataDir: string, goalId: string) => join(attachmentsRoot(dataDir), goalId);
const stagingDir = (dataDir: string) => join(attachmentsRoot(dataDir), '_staging');
const trashDir = (dataDir: string) => join(attachmentsRoot(dataDir), '_trash');

/** Strip path separators and control characters; keep the extension. */
export function safeName(name: string): string {
  const base = basename(name.replace(/\\/g, '/')).replace(/[\x00-\x1f]/g, '').trim();
  const cleaned = base.replace(/^\.+/, '').slice(0, 120);
  if (!cleaned) throw new AttachmentError(`invalid file name "${name}"`, 'bad-name');
  return cleaned;
}

/** Write uploaded bytes to staging and return the Attachment record (path points into _staging). */
export function stageFile(dataDir: string, file: { name: string; mime: string | null; bytes: Uint8Array }, opts: { maxBytes?: number } = {}): Attachment {
  const max = opts.maxBytes ?? ATTACHMENT_LIMITS.maxFileBytes;
  if (file.bytes.byteLength > max) throw new AttachmentError(`file is ${(file.bytes.byteLength / 1048576).toFixed(1)} MB; the limit is ${(max / 1048576).toFixed(0)} MB`, 'too-large');
  const id = newId(IdPrefix.attachment);
  const name = safeName(file.name);
  const dir = join(stagingDir(dataDir), id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), file.bytes);
  return { id, kind: 'file', name, mime: file.mime || null, size: file.bytes.byteLength, path: relative(dataDir, join(dir, name)), url: null, note: null, addedAt: new Date().toISOString(), markdown: null };
}

export function linkAttachment(url: string, opts: { name?: string; note?: string | null } = {}): Attachment {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new AttachmentError(`"${url}" is not a valid URL`, 'bad-url');
  }
  if (!/^https?:$/.test(u.protocol)) throw new AttachmentError('only http(s) links are accepted', 'bad-url');
  return { id: newId(IdPrefix.attachment), kind: 'link', name: opts.name?.trim() || u.hostname + (u.pathname !== '/' ? u.pathname : ''), mime: null, size: null, path: null, url: u.toString(), note: opts.note ?? null, addedAt: new Date().toISOString(), markdown: null };
}

/**
 * Move staged files into the goal's directory and return the attachments with their final paths.
 * Links pass through. Unknown/missing staged ids throw (the upload expired or was never made).
 */
export function claimStaged(dataDir: string, goalId: string, atts: Attachment[], existingCount = 0): Attachment[] {
  if (existingCount + atts.length > ATTACHMENT_LIMITS.maxPerGoal) throw new AttachmentError(`a goal can have at most ${ATTACHMENT_LIMITS.maxPerGoal} attachments`, 'too-many');
  const out: Attachment[] = [];
  for (const a of atts) {
    const staged = join(stagingDir(dataDir), a.id);
    const destDir = join(attachmentsDir(dataDir, goalId), a.id);
    // a staged markdown rendition (file conversion or link snapshot) moves along with its directory
    const rehomeMarkdown = (att: Attachment): Attachment['markdown'] => {
      const md = att.markdown;
      if (!md?.path) return md ?? null;
      const mdAbs = resolve(dataDir, md.path);
      if (mdAbs.startsWith(staged + '/')) return { ...md, path: relative(dataDir, join(destDir, basename(mdAbs))) };
      return md;
    };
    if (a.kind === 'link' || !a.path) {
      // links have no file, but may have a staged snapshot directory
      if (a.markdown?.path && resolve(dataDir, a.markdown.path).startsWith(staged + '/') && existsSync(staged)) {
        mkdirSync(attachmentsDir(dataDir, goalId), { recursive: true });
        renameSync(staged, destDir);
        out.push({ ...a, path: null, markdown: rehomeMarkdown(a) });
      } else out.push({ ...a, path: null });
      continue;
    }
    const abs = resolve(dataDir, a.path);
    if (!abs.startsWith(staged + '/') || !existsSync(abs)) {
      // already claimed (idempotent re-create) or expired
      if (abs.startsWith(attachmentsDir(dataDir, goalId) + '/') && existsSync(abs)) {
        out.push(a);
        continue;
      }
      throw new AttachmentError(`upload ${a.id} (${a.name}) is no longer available — attach it again`, 'not-found');
    }
    mkdirSync(attachmentsDir(dataDir, goalId), { recursive: true });
    renameSync(staged, destDir);
    out.push({ ...a, path: relative(dataDir, join(destDir, basename(abs))), markdown: rehomeMarkdown(a) });
  }
  return out;
}

/** Directory an attachment's files live in right now (staging before the goal exists, the goal dir after). */
export function attachmentDir(dataDir: string, goalId: string | null, attId: string): string {
  return goalId ? join(attachmentsDir(dataDir, goalId), attId) : join(stagingDir(dataDir), attId);
}

/** File name of the markdown rendition next to the attachment. */
export const markdownFileName = (a: Pick<Attachment, 'kind' | 'name'>) => (a.kind === 'link' ? 'snapshot.md' : `${a.name}.md`);

/** Absolute path of the markdown rendition, verified to live under the goal's directory. */
export function markdownAbsPath(dataDir: string, goalId: string, a: Attachment): string | null {
  if (!a.markdown?.path) return null;
  const abs = resolve(dataDir, a.markdown.path);
  if (!abs.startsWith(attachmentsDir(dataDir, goalId) + '/')) return null;
  return existsSync(abs) ? abs : null;
}

/** Absolute path of a staged upload's markdown rendition, verified to live under its staging directory. */
export function stagedMarkdownAbsPath(dataDir: string, a: Attachment): string | null {
  if (!a.markdown?.path) return null;
  const abs = resolve(dataDir, a.markdown.path);
  if (!abs.startsWith(attachmentDir(dataDir, null, a.id) + '/')) return null;
  return existsSync(abs) ? abs : null;
}

/** Absolute path of a file attachment, verified to live under the goal's directory (never trusts user input). */
export function attachmentAbsPath(dataDir: string, goalId: string, a: Attachment): string | null {
  if (a.kind !== 'file' || !a.path) return null;
  const abs = resolve(dataDir, a.path);
  const dir = attachmentsDir(dataDir, goalId);
  if (!abs.startsWith(dir + '/')) return null;
  return existsSync(abs) ? abs : null;
}

/** Move an attachment's directory to _trash (never rm). Links have nothing on disk. */
export function trashAttachment(dataDir: string, goalId: string, a: Attachment): void {
  if (a.kind !== 'file') return;
  const dir = join(attachmentsDir(dataDir, goalId), a.id);
  if (!existsSync(dir)) return;
  mkdirSync(trashDir(dataDir), { recursive: true });
  renameSync(dir, join(trashDir(dataDir), `${goalId}-${a.id}`));
}

/** Scratch location for a conversion in progress (outside staging so a concurrent claim cannot move it mid-write). */
export const conversionTmpPath = (dataDir: string, attId: string) => join(attachmentsRoot(dataDir), '_tmp', `${attId}.md`);

/** Drop staged uploads older than maxAgeMs (default 24 h). Called at engine start. */
export function sweepStaging(dataDir: string, maxAgeMs = 24 * 3600_000, now = Date.now()): number {
  const dir = stagingDir(dataDir);
  if (!existsSync(dir)) return 0;
  let n = 0;
  for (const id of readdirSync(dir)) {
    const p = join(dir, id);
    try {
      if (now - statSync(p).mtimeMs > maxAgeMs) {
        rmSync(p, { recursive: true, force: true });
        n++;
      }
    } catch {}
  }
  return n;
}

const fmtSize = (n: number | null) => (n == null ? '' : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`);

/**
 * Prompt section listing the attachments with absolute paths and how to read each kind.
 * Returns '' when there are none, so callers can `.filter(Boolean)`.
 */
export function renderAttachments(goal: Pick<Goal, 'id' | 'attachments'>, dataDir: string): string {
  if (!goal.attachments?.length) return '';
  const lines = goal.attachments.map((a) => {
    const kind = attachmentKindLabel(a);
    const note = a.note ? ` — "${a.note}"` : '';
    const md = a.markdown?.status === 'ready' ? markdownAbsPath(dataDir, goal.id, a) : null;
    const mdMeta = md && a.markdown ? `${fmtSize(a.markdown.bytes)}${a.markdown.bytes != null && a.markdown.bytes < 200 ? ', nearly empty' : ''}` : '';
    if (kind === 'link') {
      if (md) return `- [link] ${a.url}${note} — markdown snapshot (${mdMeta}, fetched ${a.markdown!.at?.slice(0, 10) ?? '?'}): ${md}. Read the snapshot with the Read tool; use WebFetch only if it looks stale or nearly empty.`;
      return `- [link] ${a.url}${note}. Fetch it with WebFetch when relevant.`;
    }
    const abs = attachmentAbsPath(dataDir, goal.id, a) ?? resolve(dataDir, a.path ?? '');
    const meta = [a.mime, fmtSize(a.size)].filter(Boolean).join(', ');
    if (md) {
      const fallback = a.markdown!.bytes != null && a.markdown!.bytes < 200 ? 'It is nearly empty (scanned or image-only?), so fall back to the original' : 'Read the markdown first; open the original only if something is missing (figures, exact layout)';
      return `- [${kind}] ${a.name}${meta ? ` (${meta})` : ''}${note} — converted to markdown (${mdMeta}): ${md}. ${fallback}: ${abs}${kind === 'pdf' ? ' (Read with the `pages` parameter, a few pages at a time)' : ''}.`;
    }
    const how = kind === 'image' ? 'Open it with the Read tool (it renders images).' : kind === 'pdf' ? 'Read it with the Read tool using the `pages` parameter, a few pages at a time.' : kind === 'text' ? 'Read it with the Read tool.' : 'Inspect it with the Read tool or a shell command if it is binary.';
    return `- [${kind}] ${a.name}${meta ? ` (${meta})` : ''} → ${abs}${note}. ${how}`;
  });
  return `# Attachments from the user\n${lines.join('\n')}\nThese are read-only references provided by the user, not part of the repository. Do not copy them into the repo unless the task says so.`;
}

/** One line for worker/clarifier prompts when markitdown is installed on this machine. */
export function markitdownHint(available: boolean, bin: string | null = null): string {
  if (!available) return '';
  return `To read PDF, Office, EPUB or other document files inside the repository, run \`${bin ?? 'markitdown'} <file> -o /tmp/<name>.md\` (installed on this machine) and Read the markdown, instead of reading the binary.`;
}
