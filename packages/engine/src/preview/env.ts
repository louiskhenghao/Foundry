import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Variables for preview processes that a project keeps out of git (API keys, bot tokens, database URLs). The person
 * enters them for a repository, or imports them from their checkout's untracked env files with one click; nothing is
 * read from the checkout on its own. They are handed to the preview's processes as environment, never written into
 * the goal's folder, and redacted from the preview's output and the self-check's report.
 */

/** env files a checkout may hold outside git, lowest priority first (the order Next.js and dotenv-flow apply them in) */
export const ENV_FILES = ['.env', '.env.development', '.env.local', '.env.development.local'];
/** files that document which variables a project needs */
export const EXAMPLE_FILES = ['.env.example', '.env.sample', '.env.template', '.env.local.example'];
export const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Parse dotenv text like dotenv: `KEY=value`, `export KEY=value`, single, double or backtick quotes (a quoted value may
 * span lines; double quotes turn \n and \r into line breaks), comments on their own line or after an unquoted value.
 * An unterminated quote is read as a plain one-line value. No `${VAR}` expansion; values with NUL bytes are dropped.
 */
export function parseDotenv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(lines[i]!);
    if (!m) continue;
    const raw = m[2]!;
    let value: string;
    const quote = raw[0];
    const close = quote === '"' || quote === "'" || quote === '`' ? closingQuote(lines, i, raw.slice(1), quote) : null;
    if (close) {
      value = close.value;
      i = close.line;
      if (quote === '"') value = value.replace(/\\n/g, '\n').replace(/\\r/g, '\r');
    } else {
      value = raw.replace(/\s+#.*$/, '').trim();
    }
    if (!value.includes('\0')) out[m[1]!] = value;
  }
  return out;
}

/** the quoted value starting at line `i` and the line it closes on; null when the quote never closes */
function closingQuote(lines: string[], i: number, first: string, quote: string): { value: string; line: number } | null {
  let body = first;
  for (let line = i; ; ) {
    for (let j = 0; j < body.length; j++) {
      if (quote === '"' && body[j] === '\\') j++;
      else if (body[j] === quote) return { value: body.slice(0, j), line };
    }
    if (++line >= lines.length) return null;
    body += `\n${lines[line]}`;
  }
}

/** keys an example file documents, with the example value and the comment written for it as hints */
export function exampleKeys(ws: string, dirs: string[]): { key: string; example: string; file: string; comment: string | null }[] {
  const seen = new Map<string, { key: string; example: string; file: string; comment: string | null }>();
  for (const dir of ['', ...dirs]) {
    for (const name of EXAMPLE_FILES) {
      const file = join(dir, name);
      const text = readText(join(ws, file));
      if (text == null) continue;
      const comments = exampleComments(text);
      for (const [key, example] of Object.entries(parseDotenv(text))) if (!seen.has(key)) seen.set(key, { key, example, file, comment: comments[key] ?? null });
    }
  }
  return [...seen.values()];
}

/**
 * The comment an example file gives each key: the `#` lines right above it (a blank line ends a block; a section
 * heading above a blank line belongs to no key) and a `# …` after an unquoted value. Commented-out assignments
 * (`# KEY=value`) are not comments.
 */
export function exampleComments(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  let block: string[] = [];
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    const t = line.trim();
    if (!t) {
      block = [];
      continue;
    }
    if (t.startsWith('#')) {
      const body = t.replace(/^#+\s?/, '').trim();
      if (/^(export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=/.test(body)) block = [];
      else if (body && !/^[-=#*_\s]+$/.test(body)) block.push(body);
      continue;
    }
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) {
      block = [];
      continue;
    }
    const raw = m[2]!;
    const inline = /^["'`]/.test(raw) ? null : /\s#\s*(.+)$/.exec(raw)?.[1]?.trim();
    const parts = [...block, ...(inline ? [inline] : [])];
    if (parts.length) out[m[1]!] = parts.join(' ');
    block = [];
  }
  return out;
}

/**
 * Files that mention each key (up to three per key), so a person filling a value in can see what reads it. One `git
 * grep` for every key, over tracked and not-ignored files; env and example files and lockfiles are left out.
 */
export function keyUsage(ws: string, keys: string[]): Record<string, string[]> {
  const valid = keys.filter((k) => ENV_KEY.test(k));
  if (!valid.length || !existsSync(ws)) return {};
  try {
    const r = Bun.spawnSync(['git', '-c', 'core.quotePath=false', 'grep', '--untracked', '-I', '-o', '-w', '-E', `(${valid.join('|')})`, '--', '.', ':(exclude)*.env*', ':(exclude)**/.env*', ':(exclude)*.lock', ':(exclude)*lock.json', ':(exclude)*lock.yaml'], { cwd: ws, stdout: 'pipe', stderr: 'ignore', timeout: 5000 });
    const out: Record<string, string[]> = {};
    for (const line of r.stdout.toString().split('\n')) {
      const i = line.lastIndexOf(':');
      if (i <= 0) continue;
      const file = line.slice(0, i);
      const key = line.slice(i + 1);
      const list = (out[key] ??= []);
      if (!list.includes(file) && list.length < 3) list.push(file);
    }
    return out;
  } catch {
    return {};
  }
}

/** keys the env files present in a folder tree define (the worktree's tracked ones, which the apps load themselves) */
export function fileKeys(root: string, dirs: string[]): Set<string> {
  const keys = new Set<string>();
  for (const dir of ['', ...dirs]) for (const name of ENV_FILES) for (const k of Object.keys(parseDotenv(readText(join(root, dir, name)) ?? ''))) keys.add(k);
  return keys;
}

/**
 * The checkout's untracked env files (git ignores them, so the goal's worktree never has them) for the root and the
 * given app folders, merged in priority order. Tracked env files are already in the worktree and are left alone.
 */
export function checkoutEnv(repoPath: string, dirs: string[], tracked: (files: string[]) => Set<string> = gitTracked(repoPath)): { files: string[]; vars: Record<string, string> } {
  const candidates = ['', ...dirs].flatMap((dir) => ENV_FILES.map((name) => join(dir, name))).filter((f) => existsSync(join(repoPath, f)));
  const skip = candidates.length ? tracked(candidates) : new Set<string>();
  const files = candidates.filter((f) => !skip.has(f));
  const vars: Record<string, string> = {};
  // root first, then each app folder, each in ENV_FILES order: the more specific file wins
  for (const f of files) Object.assign(vars, parseDotenv(readText(join(repoPath, f)) ?? ''));
  return { files, vars };
}

function gitTracked(repoPath: string) {
  return (files: string[]): Set<string> => {
    try {
      // quotePath off and NUL-separated: a tracked file in a folder like "Telegram平台" must match its candidate
      const r = Bun.spawnSync(['git', '-c', 'core.quotePath=false', '-C', repoPath, 'ls-files', '-z', '--', ...files], { stdout: 'pipe', stderr: 'ignore' });
      return new Set(r.stdout.toString().split('\0').filter(Boolean));
    } catch {
      return new Set();
    }
  };
}

function readText(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

export class EnvConflictError extends Error {}

type Doc = { version: 1; repos: Record<string, { rev: number; vars: Record<string, string> }> };

/**
 * Variables the person entered for a repository's previews, kept in the data directory (owner-only file permissions,
 * never in a repository) and shared by every goal of that repository. Each repository's set has a revision, so a save
 * made from an outdated view (another tab, another goal of the same repository) is refused instead of losing changes.
 */
export class PreviewEnvStore {
  private readonly file: string;
  constructor(dataDir: string) {
    this.file = join(dataDir, 'preview-env.json');
  }

  get(repoPath: string): { rev: number; vars: Record<string, string> } {
    const entry = this.read().repos[repoPath];
    return { rev: entry?.rev ?? 0, vars: { ...(entry?.vars ?? {}) } };
  }

  /**
   * Replace the set: a null value keeps the stored value of that key (the UI never receives values), absent keys are
   * removed. `rev` must be the revision the change was made from.
   */
  set(repoPath: string, next: Record<string, string | null>, rev: number): { rev: number; vars: Record<string, string> } {
    const keys = Object.keys(next);
    const bad = keys.filter((k) => !ENV_KEY.test(k));
    if (bad.length) throw new Error(`not a variable name: ${bad.join(', ')}`);
    if (keys.length > 200) throw new Error('at most 200 variables per repository');
    for (const [k, v] of Object.entries(next)) {
      if (v === null) continue;
      if (typeof v !== 'string' || v.length > 32_768) throw new Error(`${k}: a value is text of at most 32 KB`);
      if (v.includes('\0')) throw new Error(`${k}: a value cannot contain a NUL character`);
    }
    const doc = this.read();
    const current = doc.repos[repoPath] ?? { rev: 0, vars: {} };
    if (rev !== current.rev) throw new EnvConflictError('these variables changed elsewhere (another tab or goal of this repository); reload and try again');
    const vars: Record<string, string> = {};
    for (const [k, v] of Object.entries(next)) {
      // "keep" only means something for a name that has a value; anything else (a renamed row) would lose a secret
      if (v === null && !(k in current.vars)) throw new Error(`${k}: no saved value to keep; enter its value`);
      vars[k] = v ?? current.vars[k]!;
    }
    // an emptied set keeps its revision, so a tab still showing an older one cannot save over it
    doc.repos[repoPath] = { rev: current.rev + 1, vars };
    this.write(doc);
    return { rev: current.rev + 1, vars };
  }

  /** every repository's variables, by repository path (what a Transfer reads) */
  all(): Record<string, Record<string, string>> {
    return Object.fromEntries(Object.entries(this.read().repos).map(([repo, e]) => [repo, { ...e.vars }]));
  }

  /** add the given variables, keeping keys that are already set; returns the keys added */
  merge(repoPath: string, add: Record<string, string>): string[] {
    const { rev, vars } = this.get(repoPath);
    const added = Object.keys(add).filter((k) => !(k in vars) && ENV_KEY.test(k) && !add[k]!.includes('\0'));
    if (!added.length) return [];
    this.set(repoPath, { ...Object.fromEntries(Object.keys(vars).map((k) => [k, null])), ...Object.fromEntries(added.map((k) => [k, add[k]!])) }, rev);
    return added;
  }

  private read(): Doc {
    if (!existsSync(this.file)) return { version: 1, repos: {} };
    // a file that exists but does not parse is not overwritten with an empty set: that would lose every repository
    const doc = JSON.parse(readFileSync(this.file, 'utf8'));
    if (!doc || typeof doc !== 'object' || !doc.repos || typeof doc.repos !== 'object') throw new Error(`${this.file} is not a preview environment file; fix or remove it`);
    return { version: 1, repos: doc.repos };
  }

  private write(doc: Doc): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(doc, null, 2), { mode: 0o600 });
    renameSync(tmp, this.file);
    chmodSync(this.file, 0o600);
  }
}

/**
 * Replace every occurrence of the given secret values in a text; values shorter than 6 characters are left alone. Each
 * line of a multi-line value (a private key) is a secret too, because output is handled line by line.
 */
export function redactor(values: string[]): (text: string) => string {
  const parts = values.flatMap((v) => [v, ...(v.includes('\n') ? v.split('\n').map((l) => l.trim()) : [])]);
  const secrets = [...new Set(parts.filter((v) => v.length >= 6))].sort((a, b) => b.length - a.length);
  if (!secrets.length) return (t) => t;
  return (text) => secrets.reduce((t, s) => t.split(s).join('••••'), text);
}
