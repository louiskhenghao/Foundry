/**
 * Goal attachments: files live under <dataDir>/attachments/<goalId>/<attId>/<name>; uploads are staged under
 * attachments/_staging/<attId>/ until the goal exists. Nothing here ever deletes user bytes — removal moves to _trash.
 */
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import type { Attachment, Goal } from '@foundry/core';
import { ATTACHMENT_LIMITS, attachmentMaxBytes, IdPrefix, attachmentKindLabel, designReferences, isArchiveAttachment, newId, unreadableDesignLink } from '@foundry/core';
import { unzipSync } from 'fflate';

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

const ARCHIVE_EXT = /\.zip$/i;
/** what a zip may unpack to: a design export is a few hundred files; a bomb is not */
const EXTRACT_LIMITS = { maxFiles: 2000, maxBytes: 300 * 1024 * 1024 } as const;
/** what archives carry that nobody wants: Finder and Windows metadata, a git folder */
const JUNK_ENTRY = /(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db|\.git)(\/|$)/;

/**
 * Unpack a zip into `destDir` (ADR-0093). Entries that would land outside the folder, junk and anything past the limits
 * are skipped; folders are made as needed. Returns how many files were written and the page to open first (index.html
 * nearest the top, else the shallowest HTML page), or null when the bytes are not a zip.
 */
export function extractZip(bytes: Uint8Array, destDir: string): { files: number; entry: string | null } | null {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes, { filter: (f) => !f.name.endsWith('/') && !JUNK_ENTRY.test(f.name) && f.originalSize <= EXTRACT_LIMITS.maxBytes });
  } catch {
    return null;
  }
  const root = resolve(destDir);
  let files = 0;
  let total = 0;
  const pages: string[] = [];
  for (const [name, data] of Object.entries(entries)) {
    const rel = name.replace(/\\/g, '/').replace(/^\/+/, '');
    const abs = resolve(root, rel);
    if (!abs.startsWith(root + '/')) continue; // an entry that escapes the folder (zip slip)
    if (files >= EXTRACT_LIMITS.maxFiles || total + data.byteLength > EXTRACT_LIMITS.maxBytes) break;
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, data);
    files++;
    total += data.byteLength;
    if (/\.html?$/i.test(rel)) pages.push(rel);
  }
  const depth = (p: string) => p.split('/').length;
  const isIndex = (p: string) => /(^|\/)index\.html?$/i.test(p);
  pages.sort((a, b) => depth(a) - depth(b) || Number(!isIndex(a)) - Number(!isIndex(b)) || a.localeCompare(b));
  return { files, entry: pages[0] ?? null };
}

/** Write uploaded bytes to staging and return the Attachment record (path points into _staging). */
export function stageFile(dataDir: string, file: { name: string; mime: string | null; bytes: Uint8Array }, opts: { maxBytes?: number } = {}): Attachment {
  const max = opts.maxBytes ?? attachmentMaxBytes(file);
  if (file.bytes.byteLength > max) throw new AttachmentError(`file is ${(file.bytes.byteLength / 1048576).toFixed(1)} MB; the limit is ${(max / 1048576).toFixed(0)} MB`, 'too-large');
  const id = newId(IdPrefix.attachment);
  const name = safeName(file.name);
  const dir = join(stagingDir(dataDir), id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), file.bytes);
  // a zip (a design tool's export, a folder of pictures) is unpacked beside itself, so sessions read its files by path (ADR-0093)
  let extracted: Attachment['extracted'] = null;
  if (isArchiveAttachment({ kind: 'file', name, mime: file.mime })) {
    const folder = join(dir, ARCHIVE_EXT.test(name) ? name.replace(ARCHIVE_EXT, '') : `${name}.files`);
    const r = extractZip(file.bytes, folder);
    extracted = r ? { dir: relative(dataDir, folder), ...r } : null;
  }
  return { id, kind: 'file', name, mime: file.mime || null, size: file.bytes.byteLength, path: relative(dataDir, join(dir, name)), url: null, note: null, addedAt: new Date().toISOString(), markdown: null, extracted };
}

/**
 * A copy of an attachment under a new id of its own in this goal's folder: a Conversation's file handed to a Request
 * (ADR-0075) is owned twice, and the Conversation keeps its copy where it was. A link has no file; its record is copied.
 */
export function copyAttachment(dataDir: string, goalId: string, a: Attachment): Attachment {
  const id = newId(IdPrefix.attachment);
  const dir = join(attachmentsDir(dataDir, goalId), id);
  const bring = (rel: string): string => {
    const src = resolve(dataDir, rel);
    if (!existsSync(src)) throw new AttachmentError(`attachment ${a.id} (${a.name}) is no longer available — attach it again`, 'not-found');
    mkdirSync(dir, { recursive: true });
    copyFileSync(src, join(dir, basename(src)));
    return relative(dataDir, join(dir, basename(src)));
  };
  const path = a.kind === 'link' || !a.path ? null : bring(a.path);
  const markdown = a.markdown?.path ? (existsSync(resolve(dataDir, a.markdown.path)) ? { ...a.markdown, path: bring(a.markdown.path) } : { ...a.markdown, path: null }) : (a.markdown ?? null);
  // an unpacked zip's folder comes along (ADR-0093)
  const extracted = a.extracted?.dir && existsSync(resolve(dataDir, a.extracted.dir)) ? (() => {
    const dest = join(dir, basename(a.extracted!.dir));
    cpSync(resolve(dataDir, a.extracted!.dir), dest, { recursive: true });
    return { ...a.extracted!, dir: relative(dataDir, dest) };
  })() : (a.extracted ?? null);
  return { ...a, id, path, markdown, extracted, addedAt: new Date().toISOString() };
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
    // an unpacked zip's folder moved with the directory (ADR-0093)
    const extracted = a.extracted?.dir && resolve(dataDir, a.extracted.dir).startsWith(staged + '/') ? { ...a.extracted, dir: relative(dataDir, join(destDir, relative(staged, resolve(dataDir, a.extracted.dir)))) } : (a.extracted ?? null);
    out.push({ ...a, path: relative(dataDir, join(destDir, basename(abs))), markdown: rehomeMarkdown(a), extracted });
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

/** an unpacked zip's folder, as a prompt names it: where it is, how many files, the page to open first */
const extractedLabel = (a: Pick<Attachment, 'extracted'>, dataDir: string): string => `${resolve(dataDir, a.extracted!.dir)} (${a.extracted!.files} file${a.extracted!.files === 1 ? '' : 's'}${a.extracted!.entry ? `; open ${a.extracted!.entry} first` : ''})`;

/**
 * Prompt section for the attachments marked as the design the result follows (ADR-0093): the law for every role that
 * builds or judges a look. '' when the goal has none. Listed before the other attachments by renderAttachments, and
 * placed by the worker prompt right after the task, before any style direction.
 */
export function renderDesignReferences(goal: Pick<Goal, 'id' | 'attachments'>, dataDir: string): string {
  const refs = designReferences(goal.attachments ?? []);
  if (!refs.length) return '';
  const lines = refs.map((a) => {
    const note = a.note ? ` — "${a.note}"` : '';
    if (a.extracted?.dir) return `- [zip] ${a.name} → ${extractedLabel(a, dataDir)}${note}. Its HTML, CSS and pictures are source material: read the markup, styles and tokens and port them into this codebase.`;
    const abs = attachmentAbsPath(dataDir, goal.id, a) ?? resolve(dataDir, a.path ?? '');
    if (/\.html?$/i.test(a.name)) return `- [html] ${a.name} → ${abs}${note}. It is source material: read its markup, styles and tokens and port them into this codebase.`;
    return `- [${attachmentKindLabel(a)}] ${a.name} → ${abs}${note}. Open it with the Read tool before writing any markup or styles.`;
  });
  return `# Design reference
The person supplied the design the result follows (${refs.length === 1 ? 'the file' : 'the files'} below). What the design shows is made as it shows it: its pages and sections, layout, spacing, copy, colours, type, components and states. Where the design and a style direction or a design skill disagree, the design wins; the skill is for what the design leaves open (states it does not show, responsive behaviour, accessibility, motion), done in the design's own language. Never re-choose the direction. Port from an HTML reference freely, but never commit the reference files themselves.
${lines.join('\n')}`;
}

/**
 * Prompt section listing the attachments with absolute paths and how to read each kind: the design references first
 * (renderDesignReferences), then the rest under their own heading. Returns '' when there are none, so callers can
 * `.filter(Boolean)`.
 */
export function renderAttachments(goal: Pick<Goal, 'id' | 'attachments'>, dataDir: string): string {
  if (!goal.attachments?.length) return '';
  const others = goal.attachments.filter((a) => a.design !== true);
  const lines = others.map((a) => {
    const kind = attachmentKindLabel(a);
    const note = a.note ? ` — "${a.note}"` : '';
    const md = a.markdown?.status === 'ready' ? markdownAbsPath(dataDir, goal.id, a) : null;
    const mdMeta = md && a.markdown ? `${fmtSize(a.markdown.bytes)}${a.markdown.bytes != null && a.markdown.bytes < 200 ? ', nearly empty' : ''}` : '';
    if (kind === 'link') {
      // a page in a design tool behind a sign-in (ADR-0093): no session can read it, and nobody should pretend to
      const tool = a.url ? unreadableDesignLink(a.url) : null;
      if (tool) return `- [link] ${a.url}${note} — a ${tool} page: it needs a sign-in, so no session can open it. Treat it as a design that was not supplied; the person was asked to attach an export (HTML, a zip or screenshots) instead.`;
      if (md) return `- [link] ${a.url}${note} — markdown snapshot (${mdMeta}, fetched ${a.markdown!.at?.slice(0, 10) ?? '?'}): ${md}. Read the snapshot with the Read tool; use WebFetch only if it looks stale or nearly empty.`;
      return `- [link] ${a.url}${note}. Fetch it with WebFetch when relevant.`;
    }
    if (a.extracted?.dir) return `- [zip] ${a.name} → ${extractedLabel(a, dataDir)}${note}. Read the files with the Read tool.`;
    const abs = attachmentAbsPath(dataDir, goal.id, a) ?? resolve(dataDir, a.path ?? '');
    const meta = [a.mime, fmtSize(a.size)].filter(Boolean).join(', ');
    if (md) {
      const fallback = a.markdown!.bytes != null && a.markdown!.bytes < 200 ? 'It is nearly empty (scanned or image-only?), so fall back to the original' : 'Read the markdown first; open the original only if something is missing (figures, exact layout)';
      return `- [${kind}] ${a.name}${meta ? ` (${meta})` : ''}${note} — converted to markdown (${mdMeta}): ${md}. ${fallback}: ${abs}${kind === 'pdf' ? ' (Read with the `pages` parameter, a few pages at a time)' : ''}.`;
    }
    const how = kind === 'image' ? 'Open it with the Read tool (it renders images).' : kind === 'pdf' ? 'Read it with the Read tool using the `pages` parameter, a few pages at a time.' : kind === 'text' ? 'Read it with the Read tool.' : 'Inspect it with the Read tool or a shell command if it is binary.';
    return `- [${kind}] ${a.name}${meta ? ` (${meta})` : ''} → ${abs}${note}. ${how}`;
  });
  const rest = lines.length ? `# Attachments from the user\n${lines.join('\n')}\nThese are read-only references provided by the user, not part of the repository. Do not copy them into the repo unless the task says so.` : '';
  return [renderDesignReferences(goal, dataDir), rest].filter(Boolean).join('\n\n');
}

/** One line for worker/clarifier prompts when markitdown is installed on this machine. */
export function markitdownHint(available: boolean, bin: string | null = null): string {
  if (!available) return '';
  return `To read PDF, Office, EPUB or other document files inside the repository, run \`${bin ?? 'markitdown'} <file> -o /tmp/<name>.md\` (installed on this machine) and Read the markdown, instead of reading the binary.`;
}

/**
 * Files on `ref` of the repository whose content is a design reference file (ADR-0093): the person's design export
 * must stay out of the repository (ported, never copied), and a name pattern would also match the goal's own pages
 * and scripts named after the design, so the match is by content — git's blob hash of each reference file (and of
 * every file an unpacked zip holds) against the tree. Repo-relative paths, sorted; [] without design references.
 */
export async function committedDesignReferences(goal: Pick<Goal, 'id' | 'attachments'>, dataDir: string, repoDir: string, ref: string): Promise<string[]> {
  const files: string[] = [];
  for (const a of designReferences(goal.attachments ?? [])) {
    const abs = attachmentAbsPath(dataDir, goal.id, a);
    if (abs) files.push(abs);
    if (a.extracted?.dir) {
      const dir = resolve(dataDir, a.extracted.dir);
      if (existsSync(dir)) for (const e of readdirSync(dir, { recursive: true, withFileTypes: true })) if (e.isFile()) files.push(join(e.parentPath, e.name));
    }
  }
  if (!files.length) return [];
  const hashes = new Set((await Bun.$`git -C ${repoDir} hash-object ${files}`.quiet().text()).split('\n').filter(Boolean));
  const tree = (await Bun.$`git -C ${repoDir} ls-tree -r ${ref}`.quiet().text()).split('\n').filter(Boolean);
  const out: string[] = [];
  for (const line of tree) {
    const m = /^\d+ blob ([0-9a-f]+)\t(.+)$/.exec(line);
    if (m && hashes.has(m[1]!)) out.push(m[2]!);
  }
  return out.sort();
}
