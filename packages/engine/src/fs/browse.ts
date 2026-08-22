/**
 * Folder browsing for the New Goal page: list directories (git-aware), well-known roots,
 * and — on macOS — the native "choose folder" dialog via osascript.
 * Read-only; never lists files, never leaves the allowed roots.
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { exec } from '../git/git.ts';

export interface DirEntry {
  name: string;
  path: string;
  /** has a .git directory/file */
  isGitRepo: boolean;
}
export interface DirListing {
  path: string;
  parent: string | null;
  entries: DirEntry[];
  /** true when the listing was cut at the cap */
  truncated: boolean;
}

const SKIP = new Set(['node_modules', 'Library', '.Trash']);
const CAP = 500;

export class BrowseError extends Error {
  constructor(
    message: string,
    public readonly code: 'forbidden' | 'not-found' | 'not-dir',
  ) {
    super(message);
  }
}

/** Default roots the browser may enter: the home directory and mounted volumes. */
export function defaultAllowedRoots(home = homedir()): string[] {
  return [home, '/Volumes', '/tmp', '/private/tmp'].filter((p) => existsSync(p));
}

export function assertAllowed(path: string, roots: string[]): string {
  const abs = resolve(path);
  const ok = roots.some((r) => {
    const root = resolve(r);
    return abs === root || abs.startsWith(root.endsWith('/') ? root : root + '/');
  });
  if (!ok) throw new BrowseError(`${abs} is outside the browsable roots`, 'forbidden');
  return abs;
}

export function listDirs(path: string, opts: { roots?: string[]; showHidden?: boolean } = {}): DirListing {
  const roots = opts.roots ?? defaultAllowedRoots();
  const abs = assertAllowed(path, roots);
  if (!existsSync(abs)) throw new BrowseError(`${abs} does not exist`, 'not-found');
  if (!statSync(abs).isDirectory()) throw new BrowseError(`${abs} is not a directory`, 'not-dir');
  const entries: DirEntry[] = [];
  let truncated = false;
  let names: string[];
  try {
    names = readdirSync(abs);
  } catch {
    names = [];
  }
  names.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  for (const name of names) {
    if (!opts.showHidden && name.startsWith('.')) continue;
    if (SKIP.has(name)) continue;
    const full = join(abs, name);
    let isDir = false;
    try {
      isDir = statSync(full).isDirectory();
    } catch {
      continue; // broken symlink / permission
    }
    if (!isDir) continue;
    if (entries.length >= CAP) {
      truncated = true;
      break;
    }
    entries.push({ name, path: full, isGitRepo: existsSync(join(full, '.git')) });
  }
  const parentPath = dirname(abs);
  const parent = parentPath !== abs && roots.some((r) => parentPath === resolve(r) || parentPath.startsWith(resolve(r) + '/')) ? parentPath : null;
  return { path: abs, parent, entries, truncated };
}

export interface Root {
  label: string;
  path: string;
}

/** Well-known places people keep code, filtered to those that exist. */
export function wellKnownRoots(home = homedir()): Root[] {
  const candidates: [string, string][] = [
    ['Home', home],
    ['Projects', join(home, 'Projects')],
    ['Developer', join(home, 'Developer')],
    ['Code', join(home, 'Code')],
    ['code', join(home, 'code')],
    ['src', join(home, 'src')],
    ['repos', join(home, 'repos')],
    ['git', join(home, 'git')],
    ['GitHub', join(home, 'Documents', 'GitHub')],
    ['Desktop', join(home, 'Desktop')],
    ['Documents', join(home, 'Documents')],
  ];
  const seen = new Set<string>();
  return candidates.filter(([, p]) => existsSync(p) && !seen.has(p) && seen.add(p)).map(([label, path]) => ({ label, path }));
}

export interface PickResult {
  path: string | null;
  cancelled: boolean;
}

let pickInFlight: Promise<PickResult> | null = null;

/**
 * macOS native folder dialog. Serialised: a second call while one dialog is open returns the same promise.
 * Throws `BrowseError('forbidden')`-like errors only for unsupported platforms (caller maps to 501).
 */
export function pickFolder(opts: { defaultDir?: string; prompt?: string; timeoutMs?: number; platform?: string; run?: typeof exec } = {}): Promise<PickResult> {
  const platform = opts.platform ?? process.platform;
  if (platform !== 'darwin') return Promise.reject(new Error('native folder picker is only available on macOS'));
  if (pickInFlight) return pickInFlight;
  const run = opts.run ?? exec;
  const prompt = (opts.prompt ?? 'Choose the repository folder for this goal').replace(/"/g, '\\"');
  const def = opts.defaultDir && existsSync(opts.defaultDir) ? ` default location POSIX file "${opts.defaultDir.replace(/"/g, '\\"')}"` : '';
  const script = [
    '-e',
    'tell application "System Events" to activate',
    '-e',
    `POSIX path of (choose folder with prompt "${prompt}"${def})`,
  ];
  pickInFlight = run(['osascript', ...script], homedir(), { timeoutMs: opts.timeoutMs ?? 120_000 })
    .then((r) => {
      if (r.code === 0) {
        const p = r.stdout.trim().replace(/\/+$/, '');
        return { path: p || null, cancelled: !p };
      }
      // user pressed Cancel → "User canceled. (-128)"
      if (/-128/.test(r.stderr) || /cancel/i.test(r.stderr)) return { path: null, cancelled: true };
      throw new Error(`osascript failed (${r.code}): ${r.stderr.trim() || r.stdout.trim()}`);
    })
    .finally(() => {
      pickInFlight = null;
    });
  return pickInFlight;
}

export const folderLabel = (p: string) => basename(p) || p;
