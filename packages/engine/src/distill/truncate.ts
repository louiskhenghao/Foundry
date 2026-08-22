const ERROR_RE = /\b(error|fail(ed|ure)?|exception|panic|✗|✘|FAIL|assert|expected|received|not ok|Cannot|undefined is not)\b/i;

export interface TruncateOptions {
  head?: number;
  tail?: number;
  maxErrorLines?: number;
  maxBytes?: number;
}

/**
 * Distill a long command output into something a model can use without reading it all:
 * first N lines, last M lines, plus every line that smells like an error (deduped, capped).
 */
export function truncateOutput(text: string, opts: TruncateOptions = {}): string {
  const head = opts.head ?? 20;
  const tail = opts.tail ?? 60;
  const maxErr = opts.maxErrorLines ?? 40;
  const maxBytes = opts.maxBytes ?? 4096;
  const clean = text.replace(/\x1b\[[0-9;]*m/g, '');
  const lines = clean.split('\n');
  if (clean.length <= maxBytes) return clean.trimEnd();

  const headLines = lines.slice(0, head);
  const tailLines = lines.slice(Math.max(head, lines.length - tail));
  const middle = lines.slice(head, Math.max(head, lines.length - tail));
  const errLines: string[] = [];
  const seen = new Set<string>();
  for (const l of middle) {
    if (ERROR_RE.test(l)) {
      const key = l.trim();
      if (!seen.has(key)) {
        seen.add(key);
        errLines.push(l);
        if (errLines.length >= maxErr) break;
      }
    }
  }
  const parts = [
    ...headLines,
    `... [${middle.length} lines omitted; ${errLines.length} error-like lines kept below] ...`,
    ...errLines,
    ...(errLines.length ? ['... [tail] ...'] : []),
    ...tailLines,
  ];
  let out = parts.join('\n');
  if (out.length > maxBytes) out = out.slice(0, maxBytes - 40) + '\n... [truncated to fit budget]';
  return out.trimEnd();
}
