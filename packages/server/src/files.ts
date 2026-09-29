import { existsSync, realpathSync, statSync } from 'node:fs';
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
for (const e of ['txt', 'log', 'csv', 'tsv', 'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'css', 'scss', 'less', 'html', 'htm', 'xml', 'yml', 'yaml', 'toml', 'ini', 'conf', 'sh', 'bash', 'zsh', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift', 'c', 'h', 'cpp', 'hpp', 'cs', 'php', 'sql', 'graphql', 'gql', 'vue', 'svelte', 'astro', 'prisma', 'proto', 'lock', 'gitignore', 'dockerignore', 'editorconfig'])
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

/** Absolute paths of the files a task added or changed: its commit once it merged, its worktree while it runs. */
export async function taskFiles(dataDir: string, goal: Goal, task: Task, exec: (cmd: string[], cwd: string) => Promise<{ code: number; stdout: string }>): Promise<string[]> {
  if (task.worktreePath && existsSync(task.worktreePath)) {
    const wt = task.worktreePath;
    const committed = task.baseRef ? parseNameStatus((await exec(['git', 'diff', '--name-status', '-z', `${task.baseRef}..HEAD`], wt)).stdout) : [];
    const pending = parsePorcelain((await exec(['git', 'status', '--porcelain', '-z', '--untracked-files=all'], wt)).stdout);
    return [...new Set([...committed, ...pending])].map((r) => join(wt, r)).filter((p) => existsSync(p));
  }
  const ws = goalWorkspacePath(dataDir, goal);
  if (!task.commitRef || !existsSync(ws)) return [];
  const r = await exec(['git', 'show', '--name-status', '-z', '--format=', task.commitRef], ws);
  return r.code === 0 ? parseNameStatus(r.stdout).map((p) => join(ws, p)).filter((p) => existsSync(p)) : [];
}
