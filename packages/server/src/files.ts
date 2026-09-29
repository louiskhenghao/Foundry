import { existsSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { basename, extname, isAbsolute, join, sep } from 'node:path';
import type { Goal, Task } from '@foundry/core';
import { attachmentsDir, goalWorkspacePath, internalWorkspaceDir, legacyWorkspaceRoot, screenshotsDir } from '@foundry/engine';

/** What the preview dialog does with a file: picked from the extension, never from the content. */
export type FileKind = 'image' | 'pdf' | 'video' | 'audio' | 'markdown' | 'json' | 'text' | 'binary';

const KIND: Record<string, FileKind> = {};
for (const e of ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'svg', 'ico']) KIND[e] = 'image';
for (const e of ['mp4', 'webm', 'mov', 'm4v']) KIND[e] = 'video';
for (const e of ['mp3', 'wav', 'm4a', 'ogg', 'oga', 'flac', 'aac']) KIND[e] = 'audio';
for (const e of ['md', 'markdown', 'mdx']) KIND[e] = 'markdown';
for (const e of ['json', 'jsonl', 'geojson', 'webmanifest']) KIND[e] = 'json';
KIND.pdf = 'pdf';
// source and plain text; anything unknown is shown as text only when it has no extension (Dockerfile, Makefile…)
for (const e of ['txt', 'log', 'csv', 'tsv', 'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'css', 'scss', 'less', 'html', 'htm', 'xml', 'yml', 'yaml', 'toml', 'ini', 'conf', 'sh', 'bash', 'zsh', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift', 'c', 'h', 'cpp', 'hpp', 'cs', 'php', 'sql', 'graphql', 'gql', 'vue', 'svelte', 'astro', 'prisma', 'proto', 'lock', 'gitignore', 'dockerignore', 'editorconfig', 'mts', 'cts', 'dart', 'lua', 'r', 'scala', 'ex', 'exs', 'erl', 'hs', 'clj', 'pl', 'ps1', 'bat', 'cmd', 'nix', 'zig', 'sol', 'tf', 'hcl', 'gradle', 'properties', 'example', 'sample', 'env', 'diff', 'patch'])
  KIND[e] = 'text';

export function fileKind(name: string): FileKind {
  const ext = extname(name).slice(1).toLowerCase();
  return KIND[ext] ?? (ext ? 'binary' : 'text');
}

const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp', svg: 'image/svg+xml', ico: 'image/x-icon',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', m4v: 'video/mp4',
  mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', ogg: 'audio/ogg', oga: 'audio/ogg', flac: 'audio/flac', aac: 'audio/aac',
  pdf: 'application/pdf',
};

/** The content type a file is served with. Text of every kind (HTML included) goes out as plain text, so it never runs here. */
export function servedType(name: string): string {
  const ext = extname(name).slice(1).toLowerCase();
  if (MIME[ext]) return MIME[ext]!;
  const kind = fileKind(name);
  return kind === 'binary' ? 'application/octet-stream' : 'text/plain; charset=utf-8';
}

/**
 * The folders of one goal whose files the UI may show: the repository, the progress folder, the engine's own worktrees
 * next to it (tasks, delivery), every task worktree, the attachments and the self-check screenshots.
 */
export function goalRoots(dataDir: string, goal: Goal, tasks: Pick<Task, 'worktreePath'>[]): string[] {
  return [goal.repoPath, goalWorkspacePath(dataDir, goal), internalWorkspaceDir(goal) ?? legacyWorkspaceRoot(dataDir, goal.id), attachmentsDir(dataDir, goal.id), screenshotsDir(dataDir, goal), ...tasks.map((t) => t.worktreePath)].filter((p): p is string => !!p);
}

/**
 * A path inside a task worktree that is gone (removed once the task merged) → the same file in the goal's progress
 * folder, where the task's work now lives; null when the path is not in a removed task worktree of these goals.
 */
export function landedPath(path: string, dataDir: string, goals: Goal[]): string | null {
  if (existsSync(path)) return null;
  for (const g of goals) {
    const tasksDir = join(internalWorkspaceDir(g) ?? legacyWorkspaceRoot(dataDir, g.id), 'tasks');
    if (!path.startsWith(tasksDir + sep)) continue;
    const rest = path.slice(tasksDir.length + 1).split(sep).slice(1).join(sep);
    const landed = rest && join(goalWorkspacePath(dataDir, g), rest);
    return landed && existsSync(landed) ? landed : null;
  }
  return null;
}

export class FileRefused extends Error {
  constructor(
    readonly status: 400 | 403 | 404,
    message: string,
  ) {
    super(message);
  }
}

const inside = (path: string, root: string) => path === root || path.startsWith(root.endsWith(sep) ? root : root + sep);

/**
 * The real path of a file the UI asked for by absolute path, or a refusal: it must exist, be a regular file, lie inside
 * one of `roots` after symlinks are resolved, and be neither inside `.git` nor a `.env` file.
 */
export function resolveServable(path: string, roots: string[]): { abs: string; size: number } {
  if (!path || !isAbsolute(path) || path.includes('\0')) throw new FileRefused(400, 'an absolute file path is required');
  if (!existsSync(path)) throw new FileRefused(404, 'file not found');
  const abs = realpathSync(path);
  const realRoots = roots.filter((r) => existsSync(r)).map((r) => realpathSync(r));
  if (!realRoots.some((r) => inside(abs, r))) throw new FileRefused(403, "outside this goal's folders");
  if (abs.split(sep).includes('.git') || /^\.env(\.|$)/.test(basename(abs))) throw new FileRefused(403, 'not shown: git internals and .env files stay private');
  const st = statSync(abs);
  if (!st.isFile()) throw new FileRefused(400, 'not a file');
  return { abs, size: st.size };
}

/** `git diff --name-status -z` → paths that still exist on the new side (renames give their new name) */
export function parseNameStatus(z: string): string[] {
  const f = z.split('\0').filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < f.length; ) {
    const st = f[i]!;
    const n = /^[RC]/.test(st) ? 2 : 1;
    if (!st.startsWith('D')) out.push(f[i + n]!);
    i += n + 1;
  }
  return out;
}

/** `git status --porcelain -z` → added, changed and untracked paths (a rename entry is followed by its old name) */
export function parsePorcelain(z: string): string[] {
  const f = z.split('\0').filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < f.length; i++) {
    const xy = f[i]!.slice(0, 2);
    if (!xy.includes('D')) out.push(f[i]!.slice(3));
    if (/[RC]/.test(xy)) i++;
  }
  return out;
}

// ---- a task's files after its folders are gone: its commit in the repository ----

type Exec = (cmd: string[], cwd: string) => Promise<{ code: number; stdout: string }>;

/** Where one file can be read now: a folder on disk, or a blob in the task's commit (which outlives every folder). */
export type FileSource = { kind: 'folder'; abs: string; size: number } | { kind: 'commit'; repo: string; ref: string; rel: string; size: number };

/** a repository-relative path the UI may ask for: no absolute path, no `..`, nothing in .git, no .env file */
export function safeRel(rel: string): boolean {
  return !!rel && !rel.startsWith('/') && !rel.includes('\0') && !rel.split('/').some((s) => s === '..' || s === '' || s === '.git') && !/^\.env(\.|$)/.test(basename(rel));
}

/** Every file of a commit with its size (`git ls-tree -r -l -z`); empty when the commit is not in the repository. */
export async function commitTree(repo: string, ref: string, exec: Exec): Promise<Map<string, number>> {
  const r = await exec(['git', 'ls-tree', '-r', '-l', '-z', ref], repo);
  const out = new Map<string, number>();
  if (r.code !== 0) return out;
  for (const entry of r.stdout.split('\0')) {
    const tab = entry.indexOf('\t');
    if (tab < 0) continue;
    const [, type, , size] = entry.slice(0, tab).split(/\s+/);
    if (type === 'blob') out.set(entry.slice(tab + 1), Number(size) || 0);
  }
  return out;
}

const finished = (t: Pick<Task, 'state'>) => t.state === 'done' || t.state === 'skipped' || t.state === 'failed';

/**
 * Where a file of a task (path relative to the repository) can be read now: a running task's own worktree; for a
 * finished one, the version its commit holds; else the progress folder, else the user's checkout. Null when none has it.
 */
export async function taskFileSource(dataDir: string, goal: Goal, task: Task, rel: string, exec: Exec, tree?: Map<string, number>): Promise<FileSource | null> {
  if (!safeRel(rel)) return null;
  const roots = goalRoots(dataDir, goal, [task]);
  const folder = (dir: string | null): FileSource | null => {
    if (!dir || !existsSync(join(dir, rel))) return null;
    try {
      const { abs, size } = resolveServable(join(dir, rel), roots);
      return { kind: 'folder', abs, size };
    } catch {
      return null;
    }
  };
  if (task.worktreePath && !finished(task)) {
    const live = folder(task.worktreePath);
    if (live) return live;
  }
  if (task.commitRef) {
    const files = tree ?? (await commitTree(goal.repoPath, task.commitRef, exec));
    if (files.has(rel)) return { kind: 'commit', repo: goal.repoPath, ref: task.commitRef, rel, size: files.get(rel)! };
  }
  return folder(goalWorkspacePath(dataDir, goal)) ?? folder(goal.repoPath);
}

/**
 * The goal, task and repository-relative path an absolute path names when it points into a task worktree (current
 * `<.foundry>/tasks/<task>/…` or legacy `<data>/worktrees/<goal>/<task>/…` layout) or into a goal's progress folder.
 */
export function pathInGoal(path: string, dataDir: string, goals: { goal: Goal; tasks: Task[] }[]): { goal: Goal; task: Task | null; rel: string } | null {
  const under = (dir: string | null) => (dir && path.startsWith(dir + sep) ? path.slice(dir.length + 1) : null);
  for (const { goal, tasks } of goals) {
    for (const t of tasks) {
      const rel = under(t.worktreePath) ?? under(join(internalWorkspaceDir(goal) ?? legacyWorkspaceRoot(dataDir, goal.id), 'tasks', t.id)) ?? under(join(legacyWorkspaceRoot(dataDir, goal.id), t.id));
      if (rel) return { goal, task: t, rel };
    }
    const rel = under(goalWorkspacePath(dataDir, goal));
    if (rel) return { goal, task: null, rel };
  }
  return null;
}

/** A goal-level path (the progress folder is gone): the newest task commit that holds the file. */
export async function goalFileSource(goal: Goal, tasks: Task[], rel: string, exec: Exec): Promise<FileSource | null> {
  if (!safeRel(rel)) return null;
  for (const t of [...tasks].filter((x) => x.commitRef).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))) {
    const r = await exec(['git', 'cat-file', '-s', `${t.commitRef}:${rel}`], goal.repoPath);
    if (r.code === 0) return { kind: 'commit', repo: goal.repoPath, ref: t.commitRef!, rel, size: Number(r.stdout.trim()) || 0 };
  }
  return null;
}

/**
 * What a task made, as repository-relative paths plus media written outside git: for a finished task the files its
 * commit added or changed; for a running one its worktree's changes; and, for image and video goals, the artifacts
 * written while the task ran (they are never committed).
 */
export async function taskMadeFiles(dataDir: string, goal: Goal, task: Task, attempts: { startedAt: string; endedAt: string | null }[], exec: Exec): Promise<{ rels: string[]; artifacts: string[] }> {
  let rels: string[] = [];
  if (task.worktreePath && existsSync(task.worktreePath) && !finished(task)) {
    const wt = task.worktreePath;
    const committed = task.baseRef ? parseNameStatus((await exec(['git', 'diff', '--name-status', '-z', `${task.baseRef}..HEAD`], wt)).stdout) : [];
    const pending = parsePorcelain((await exec(['git', 'status', '--porcelain', '-z', '--untracked-files=all'], wt)).stdout);
    rels = [...new Set([...committed, ...pending])];
  } else if (task.commitRef) {
    const r = await exec(['git', 'show', '--name-status', '-z', '--format=', task.commitRef], goal.repoPath);
    if (r.code === 0) rels = parseNameStatus(r.stdout);
  }
  const artifactsDir = join(goalWorkspacePath(dataDir, goal), 'artifacts');
  const from = attempts.length ? Date.parse(attempts[0]!.startedAt) : NaN;
  const last = attempts.at(-1);
  const to = last?.endedAt ? Date.parse(last.endedAt) + 60_000 : finished(task) ? Date.parse(task.updatedAt) + 60_000 : Date.now();
  const inWindow = Number.isNaN(from) || !existsSync(artifactsDir) ? [] : walkFiles(artifactsDir).filter((p) => {
    const m = statSync(p).mtimeMs;
    return m >= from && m <= to;
  });
  // tasks that ran side by side share a window: when the task's plan names some of these files, those are its own
  const plan = [task.spec ?? '', ...(task.relevantFiles ?? [])].join('\n');
  const named = inWindow.filter((p) => plan.includes(basename(p)));
  return { rels, artifacts: named.length ? named : inWindow };
}

function walkFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walkFiles(p));
    else if (e.isFile()) out.push(p);
  }
  return out;
}
