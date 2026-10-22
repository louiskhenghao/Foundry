/**
 * "Open in …" for the Goal page: detect editors/terminals on this machine and open a directory in one of them.
 * The server only ever opens directories it owns or the goal's own repository (callers resolve the path; this
 * module verifies it exists and is a directory), and one file of its own in an editor (a theme of the person's).
 */
import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { exec as defaultExec } from '../git/git.ts';

export type OpenTargetId = 'vscode' | 'cursor' | 'zed' | 'windsurf' | 'finder' | 'terminal' | 'iterm' | 'warp';

export interface OpenTarget {
  id: OpenTargetId;
  label: string;
  /** what it opens: an editor folders and files, a file manager or a terminal folders */
  kind: 'editor' | 'files' | 'terminal';
  available: boolean;
  /** how it will be launched (for the tooltip) */
  via: string | null;
}

export interface OpenDeps {
  platform?: string;
  which?: (bin: string) => string | null;
  exists?: (p: string) => boolean;
  exec?: typeof defaultExec;
  home?: string;
}

interface Spec {
  id: OpenTargetId;
  label: string;
  /** CLI launcher(s) to try first (cross-platform) */
  cli?: string[];
  /** macOS app bundle names */
  app?: string[];
  /** linux fallbacks */
  linux?: string[];
  kind: 'editor' | 'files' | 'terminal';
}

const SPECS: Spec[] = [
  { id: 'vscode', label: 'VS Code', cli: ['code'], app: ['Visual Studio Code'], kind: 'editor' },
  { id: 'cursor', label: 'Cursor', cli: ['cursor'], app: ['Cursor'], kind: 'editor' },
  { id: 'zed', label: 'Zed', cli: ['zed'], app: ['Zed'], kind: 'editor' },
  { id: 'windsurf', label: 'Windsurf', cli: ['windsurf'], app: ['Windsurf'], kind: 'editor' },
  { id: 'finder', label: 'Finder', app: [], linux: ['xdg-open'], kind: 'files' },
  { id: 'terminal', label: 'Terminal', app: ['Terminal'], linux: ['gnome-terminal', 'konsole', 'x-terminal-emulator'], kind: 'terminal' },
  { id: 'iterm', label: 'iTerm', app: ['iTerm'], kind: 'terminal' },
  { id: 'warp', label: 'Warp', app: ['Warp'], kind: 'terminal' },
];

function appBundle(name: string, home: string, exists: (p: string) => boolean): string | null {
  for (const dir of ['/Applications', join(home, 'Applications'), '/System/Applications', '/System/Applications/Utilities', '/Applications/Utilities']) {
    const p = join(dir, `${name}.app`);
    if (exists(p)) return p;
  }
  return null;
}

interface Resolved {
  target: OpenTarget;
  argv: ((path: string) => string[]) | null;
}

function resolveAll(deps: OpenDeps): Resolved[] {
  const platform = deps.platform ?? process.platform;
  const which = deps.which ?? ((b) => Bun.which(b));
  const exists = deps.exists ?? existsSync;
  const home = deps.home ?? homedir();
  return SPECS.map((s) => {
    const cli = s.cli?.map(which).find((p): p is string => !!p) ?? null;
    if (cli && s.kind === 'editor') return { target: { id: s.id, label: s.label, kind: s.kind, available: true, via: cli }, argv: (p) => [cli, p] };
    if (platform === 'darwin') {
      if (s.id === 'finder') return { target: { id: s.id, label: s.label, kind: s.kind, available: true, via: 'open' }, argv: (p) => ['open', p] };
      const bundle = s.app?.map((a) => appBundle(a, home, exists)).find((p): p is string => !!p) ?? null;
      if (bundle) return { target: { id: s.id, label: s.label, kind: s.kind, available: true, via: `open -a ${bundle}` }, argv: (p) => ['open', '-a', bundle, p] };
      return { target: { id: s.id, label: s.label, kind: s.kind, available: false, via: null }, argv: null };
    }
    if (platform === 'linux') {
      if (s.id === 'finder') {
        const xdg = which('xdg-open');
        return { target: { id: s.id, label: 'File manager', kind: s.kind, available: !!xdg, via: xdg }, argv: xdg ? (p) => [xdg, p] : null };
      }
      const term = s.linux?.map(which).find((p): p is string => !!p) ?? null;
      if (term && s.kind === 'terminal') return { target: { id: s.id, label: s.label, kind: s.kind, available: true, via: term }, argv: (p) => [term, `--working-directory=${p}`] };
      return { target: { id: s.id, label: s.label, kind: s.kind, available: false, via: null }, argv: null };
    }
    return { target: { id: s.id, label: s.label, kind: s.kind, available: false, via: null }, argv: null };
  });
}

let cache: { at: number; all: Resolved[] } | null = null;

/** Editors / file managers / terminals available on this machine (cached 60 s). */
export function detectOpenTargets(deps: OpenDeps = {}, now = Date.now()): OpenTarget[] {
  const fresh = Object.keys(deps).length === 0;
  if (fresh && cache && now - cache.at < 60_000) return cache.all.map((r) => r.target);
  const all = resolveAll(deps);
  if (fresh) cache = { at: now, all };
  return all.map((r) => r.target);
}

export class OpenError extends Error {
  constructor(
    message: string,
    public readonly code: 'unknown-target' | 'unavailable' | 'not-a-directory' | 'not-a-file' | 'not-an-editor' | 'launch-failed',
  ) {
    super(message);
  }
}

/** Open `path` (must be an existing directory) with the given target. */
export async function openPath(target: OpenTargetId, path: string, deps: OpenDeps = {}): Promise<{ ok: true; command: string[] }> {
  const exists = deps.exists ?? existsSync;
  const isDir = (p: string) => {
    try {
      return statSync(p).isDirectory();
    } catch {
      return false;
    }
  };
  if (!exists(path) || (!deps.exists && !isDir(path))) throw new OpenError(`${path} is not a directory`, 'not-a-directory');
  return launch(target, path, path, deps);
}

/** Open one file (it must exist) in an editor, from its folder: a file manager or a terminal opens folders only. */
export async function openFile(target: OpenTargetId, file: string, deps: OpenDeps = {}): Promise<{ ok: true; command: string[] }> {
  const exists = deps.exists ?? existsSync;
  const isFile = (p: string) => {
    try {
      return statSync(p).isFile();
    } catch {
      return false;
    }
  };
  if (!exists(file) || (!deps.exists && !isFile(file))) throw new OpenError(`${file} is not a file`, 'not-a-file');
  const spec = SPECS.find((s) => s.id === target);
  if (!spec) throw new OpenError(`unknown target ${target}`, 'unknown-target');
  if (spec.kind !== 'editor') throw new OpenError(`${spec.label} opens folders, not a file: choose an editor`, 'not-an-editor');
  return launch(target, file, dirname(file), deps);
}

/** runs the target on `path` from `cwd` */
async function launch(target: OpenTargetId, path: string, cwd: string, deps: OpenDeps): Promise<{ ok: true; command: string[] }> {
  const all = Object.keys(deps).length === 0 && cache ? cache.all : resolveAll(deps);
  const r = all.find((x) => x.target.id === target);
  if (!r) throw new OpenError(`unknown target ${target}`, 'unknown-target');
  if (!r.argv || !r.target.available) throw new OpenError(`${r.target.label} is not available on this machine`, 'unavailable');
  const argv = r.argv(path);
  const run = deps.exec ?? defaultExec;
  const res = await run(argv, cwd, { timeoutMs: 20_000 });
  if (res.code !== 0) throw new OpenError(`${argv.join(' ')} failed: ${(res.stderr || res.stdout).trim().slice(0, 200)}`, 'launch-failed');
  return { ok: true, command: argv };
}
