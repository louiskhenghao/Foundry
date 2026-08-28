import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import type { AgentLogItem } from './types.ts';

/** A parsed transcript line. The format is Claude Code internal — treat every field as optional. */
export type Envelope = Record<string, any>;

/** Metadata derivable from the tail of a transcript without reading the whole file. */
export interface TranscriptMeta {
  model: string | null;
  contextUsedTokens: number | null;
  title: string | null;
  lastPrompt: string | null;
  slug: string | null;
  cwd: string | null;
  gitBranch: string | null;
  entrypoint: string | null;
  version: string | null;
  lastTs: string | null;
}

const EMPTY_META: TranscriptMeta = { model: null, contextUsedTokens: null, title: null, lastPrompt: null, slug: null, cwd: null, gitBranch: null, entrypoint: null, version: null, lastTs: null };

/** Parse the complete lines in the last `maxBytes` of the file (the first, possibly partial, line is dropped). */
export function tailLines(path: string, maxBytes = 64 * 1024): Envelope[] {
  let fd: number;
  try {
    fd = openSync(path, 'r');
  } catch {
    return [];
  }
  try {
    const size = fstatSync(fd).size;
    const start = Math.max(0, size - maxBytes);
    const buf = Buffer.alloc(size - start);
    readSync(fd, buf, 0, buf.length, start);
    let text = buf.toString('utf8');
    if (start > 0) {
      const nl = text.indexOf('\n');
      if (nl < 0) return [];
      text = text.slice(nl + 1);
    }
    return parseLines(text);
  } catch {
    return [];
  } finally {
    closeSync(fd);
  }
}

export function parseLines(text: string): Envelope[] {
  const out: Envelope[] = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      const v = JSON.parse(t);
      if (v && typeof v === 'object') out.push(v);
    } catch {
      // partial or corrupt line — skip
    }
  }
  return out;
}

function isRealAssistant(e: Envelope): boolean {
  return e.type === 'assistant' && e.message?.model && e.message.model !== '<synthetic>';
}

export function deriveMeta(lines: Envelope[]): TranscriptMeta {
  const meta = { ...EMPTY_META };
  for (const e of lines) {
    if (e.cwd) meta.cwd = e.cwd;
    if (e.gitBranch) meta.gitBranch = e.gitBranch;
    if (e.entrypoint) meta.entrypoint = e.entrypoint;
    if (e.version) meta.version = e.version;
    if (e.slug) meta.slug = e.slug;
    if (typeof e.timestamp === 'string') meta.lastTs = e.timestamp;
    if (e.type === 'ai-title' && e.aiTitle) meta.title = String(e.aiTitle);
    if (e.type === 'last-prompt' && e.lastPrompt) meta.lastPrompt = String(e.lastPrompt);
    if (isRealAssistant(e)) {
      meta.model = e.message.model;
      const u = e.message.usage;
      if (u && typeof u === 'object') {
        const used = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
        meta.contextUsedTokens = used > 0 ? used : meta.contextUsedTokens;
      }
    }
  }
  return meta;
}

/**
 * Tail-derive metadata: 64KB first, one 256KB retry when the tail held no assistant line
 * (tool-result-heavy transcripts). Never parses a large file front-to-back.
 */
export function deriveMetaFromFile(path: string): TranscriptMeta {
  let meta = deriveMeta(tailLines(path));
  if (meta.model === null) {
    const wide = deriveMeta(tailLines(path, 256 * 1024));
    // the wide read saw everything the narrow one did
    if (wide.lastTs || wide.model) meta = wide;
  }
  return meta;
}

/** First-line envelope (first 4KB) — for startedAt of finished sessions. */
export function firstLine(path: string): Envelope | null {
  let fd: number;
  try {
    fd = openSync(path, 'r');
  } catch {
    return null;
  }
  try {
    const buf = Buffer.alloc(4096);
    const n = readSync(fd, buf, 0, buf.length, 0);
    const text = buf.toString('utf8', 0, n);
    const nl = text.indexOf('\n');
    return parseLines(nl >= 0 ? text.slice(0, nl + 1) : text)[0] ?? null;
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}

export interface Slice {
  lines: Envelope[];
  nextOffset: number;
  size: number;
  eof: boolean;
}

/**
 * Incremental byte-offset read: returns complete lines in [offset, offset+maxBytes), consuming only
 * through the last newline. `offset > size` (file replaced/truncated) resets to 0.
 */
export function readSlice(path: string, offset: number, maxBytes = 2 * 1024 * 1024): Slice {
  let fd: number;
  try {
    fd = openSync(path, 'r');
  } catch {
    return { lines: [], nextOffset: 0, size: 0, eof: true };
  }
  try {
    const size = fstatSync(fd).size;
    let at = offset > size || offset < 0 ? 0 : offset;
    const len = Math.min(size - at, maxBytes);
    if (len <= 0) return { lines: [], nextOffset: at, size, eof: true };
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, at);
    let end = buf.lastIndexOf(0x0a) + 1; // consume through the last newline
    if (end === 0) {
      // no newline in the slice: an unfinished trailing line (wait for more), unless the slice is
      // full — then it's one degenerate >maxBytes line; skip it rather than stall forever
      if (len < maxBytes) return { lines: [], nextOffset: at, size, eof: true };
      return { lines: [], nextOffset: at + len, size, eof: at + len >= size };
    }
    const lines = parseLines(buf.toString('utf8', 0, end));
    const nextOffset = at + end;
    return { lines, nextOffset, size, eof: nextOffset >= size };
  } catch {
    return { lines: [], nextOffset: offset, size: 0, eof: true };
  } finally {
    closeSync(fd);
  }
}

const TOOL_INPUT_CAP = 4 * 1024;
const TOOL_RESULT_CAP = 8 * 1024;

function cap(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}… [truncated]` : s;
}

function blockText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((b: any) => (typeof b === 'string' ? b : (b?.text ?? ''))).join('\n');
  return '';
}

const NOTICE_CAP = 500;

/**
 * A "user" line is not always the person typing: slash commands, their stdout, IDE notifications and
 * injected reminders all arrive as user text wrapped in XML-ish markers. Split them into typed items
 * so the viewer can render the human's words as the human's words and the rest as machinery.
 */
function userTextItems(raw: string, ts: string | null): AgentLogItem[] {
  const out: AgentLogItem[] = [];
  let text = raw
    .replace(/<system-reminder>[\s\S]*?(<\/system-reminder>|$)/g, '') // injected context, not the user's words
    .replace(/<(ide_opened_file|ide_selection|ide_diagnostics|local-command-caveat)>[\s\S]*?(<\/\1>|$)/g, ''); // IDE noise
  const name = /<command-name>([\s\S]*?)<\/command-name>/.exec(text)?.[1]?.trim();
  if (name) {
    const args = /<command-args>([\s\S]*?)<\/command-args>/.exec(text)?.[1]?.trim() ?? '';
    out.push({ kind: 'command', name: name.replace(/^\//, ''), args, ts });
  }
  text = text.replace(/<(command-name|command-message|command-args|command-contents)>[\s\S]*?(<\/\1>|$)/g, '');
  text = text.replace(/<local-command-stdout>([\s\S]*?)(<\/local-command-stdout>|$)/g, (_, body: string) => {
    const t = body.trim();
    if (t) out.push({ kind: 'notice', text: cap(t, NOTICE_CAP), ts });
    return '';
  });
  text = text.replace(/\[Request interrupted by user[^\]]*\]/g, () => {
    out.push({ kind: 'notice', text: 'interrupted by user', ts });
    return '';
  });
  text = text.trim();
  if (text) out.push({ kind: 'user', text, ts });
  return out;
}

/**
 * Envelope lines → renderable conversation items. Skip-unknown everywhere: the transcript is an
 * internal Claude Code format and drifts across versions.
 *
 * `sidechain: true` when parsing a subagent's own file — there every line is marked isSidechain;
 * in a main transcript those marks are legacy inline sidechains and stay out of the view.
 */
export function toLogItems(lines: Envelope[], opts: { sidechain?: boolean } = {}): AgentLogItem[] {
  const out: AgentLogItem[] = [];
  for (const e of lines) {
    if (e.isMeta || (e.isSidechain && !opts.sidechain)) continue;
    const ts = typeof e.timestamp === 'string' ? e.timestamp : null;
    if (e.type === 'system' && e.subtype === 'compact_boundary') {
      const m = e.compactMetadata ?? {};
      out.push({ kind: 'compact', preTokens: m.preTokens ?? 0, postTokens: m.postTokens ?? 0, ts });
      continue;
    }
    if (e.type === 'user') {
      const content = e.message?.content;
      if (typeof content === 'string') {
        out.push(...userTextItems(content, ts));
        continue;
      }
      if (!Array.isArray(content)) continue;
      for (const b of content) {
        if (b?.type === 'text' && b.text?.trim()) out.push(...userTextItems(b.text, ts));
        else if (b?.type === 'tool_result') out.push({ kind: 'tool_result', forId: b.tool_use_id ?? '', content: cap(blockText(b.content), TOOL_RESULT_CAP), isError: !!b.is_error, ts });
      }
      continue;
    }
    if (isRealAssistant(e)) {
      const model = e.message.model ?? null;
      const content = e.message.content;
      if (!Array.isArray(content)) continue;
      for (const b of content) {
        if (b?.type === 'text' && b.text) out.push({ kind: 'assistant', text: b.text, ts, model });
        else if (b?.type === 'thinking' && b.thinking) out.push({ kind: 'thinking', text: b.thinking, ts });
        else if (b?.type === 'tool_use') {
          let input = '';
          try {
            input = JSON.stringify(b.input ?? {});
          } catch {}
          out.push({ kind: 'tool_use', id: b.id ?? '', name: b.name ?? 'tool', input: cap(input, TOOL_INPUT_CAP), ts });
        }
      }
    }
    // ai-title / last-prompt / mode / summary / queue-operation / unknown types: skipped
  }
  return out;
}
