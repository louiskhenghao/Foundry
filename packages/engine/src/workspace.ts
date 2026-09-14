import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import type { Goal, Task } from '@foundry/core';
import { ensureWorktree, git, headRef, removeWorktree } from './git/git.ts';
import { copyProjectSkills } from './skills/autoskills.ts';

/** Where media tasks generate their files, workspace-relative. Kept out of git; delivered to the goal's output folder at done. */
export const ARTIFACTS_DIR = 'artifacts';

/** Every file under a workspace's artifacts/, as paths relative to that folder. */
export function listArtifacts(ws: string): string[] {
  const root = join(ws, ARTIFACTS_DIR);
  if (!existsSync(root)) return [];
  try {
    return readdirSync(root, { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => relative(root, join(e.parentPath, e.name)))
      .sort();
  } catch {
    return [];
  }
}

/**
 * Merge one workspace's artifacts into another's (task worktree → goal workspace after integrate:
 * the squash merge cannot carry them, they are git-excluded). Existing files are overwritten —
 * parallel media tasks write disjoint names by convention (their manifests declare them).
 */
export function copyArtifacts(fromWs: string, toWs: string): number {
  const files = listArtifacts(fromWs);
  for (const f of files) {
    const dest = join(toWs, ARTIFACTS_DIR, f);
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(join(fromWs, ARTIFACTS_DIR, f), dest);
  }
  return files.length;
}

/**
 * `artifacts/samples/` holds the Brief's style sample images; the chosen one is the reference image the worker prompt tells
 * every task to open, so it must exist in each task worktree, not only in the goal workspace where it was generated.
 */
export function copyStyleSamples(fromWs: string, toWs: string): number {
  const src = join(fromWs, ARTIFACTS_DIR, 'samples');
  if (!existsSync(src)) return 0;
  const dest = join(toWs, ARTIFACTS_DIR, 'samples');
  mkdirSync(dest, { recursive: true });
  let n = 0;
  for (const f of readdirSync(src)) {
    if (existsSync(join(dest, f))) continue;
    cpSync(join(src, f), join(dest, f));
    n++;
  }
  return n;
}

/** what the path helpers need of a goal: its id (legacy layout) and its progress folder (current layout) */
export type WorkspaceRef = Pick<Goal, 'id' | 'workspaceDir'>;

/** `<dataDir>/worktrees/<goalId>`: the layout goals had before progress folders; still read for goals created then */
export const legacyWorkspaceRoot = (dataDir: string, goalId: string) => join(dataDir, 'worktrees', goalId);

/**
 * The engine's own worktrees of a goal live beside its progress folder, hidden: `<root>/.foundry/<folder>/{tasks,delivery,
 * resolve,baseline}`. Never inside it — docs generation and merges run `git add -A` in the goal worktree and would sweep
 * nested worktrees up.
 */
export function internalWorkspaceDir(goal: WorkspaceRef): string | null {
  return goal.workspaceDir ? join(dirname(goal.workspaceDir), '.foundry', basename(goal.workspaceDir)) : null;
}

/** The goal worktree on the goal branch — the progress folder a person opens. */
export function goalWorkspacePath(dataDir: string, goal: WorkspaceRef): string {
  return goal.workspaceDir ?? join(legacyWorkspaceRoot(dataDir, goal.id), '_goal');
}
/** Scratch worktree where delivery builds the stacked per-task branches. */
export function deliveryWorkspacePath(dataDir: string, goal: WorkspaceRef): string {
  const internal = internalWorkspaceDir(goal);
  return internal ? join(internal, 'delivery') : join(legacyWorkspaceRoot(dataDir, goal.id), '_delivery');
}
/** detached worktree where a human resolves one task's conflicted integration by hand (one per task) */
export function resolveWorkspacePath(dataDir: string, goal: WorkspaceRef, taskId: string): string {
  const internal = internalWorkspaceDir(goal);
  return internal ? join(internal, 'resolve', taskId) : join(legacyWorkspaceRoot(dataDir, goal.id), '_resolve', taskId);
}
/** throw-away worktree at a base commit where the baseline must checks run */
export function baselineWorkspacePath(dataDir: string, goal: WorkspaceRef): string {
  const internal = internalWorkspaceDir(goal);
  return internal ? join(internal, 'baseline') : join(legacyWorkspaceRoot(dataDir, goal.id), '_baseline');
}
export function taskWorkspacePath(dataDir: string, goal: WorkspaceRef, taskId: string): string {
  const internal = internalWorkspaceDir(goal);
  return internal ? join(internal, 'tasks', taskId) : join(legacyWorkspaceRoot(dataDir, goal.id), taskId);
}

/** characters no file system accepts in a name, plus control characters */
const UNSAFE = /[\\/:*?"<>|\u0000-\u001f]/g;
/** sentence breaks (ASCII and full-width): the folder is named after the title up to the first one */
const SENTENCE_BREAK = /[,，.。;；:：!！?？(（\[【\n]/;
/**
 * `<title up to its first sentence break, ≤40 chars>-<last 6 chars of the goal id>`: readable to a person — the title
 * stays in its own language, a slug would delete every Chinese character — and unique per goal. Fixed at creation.
 */
export function workspaceFolderName(title: string, goalId: string): string {
  const head = title.split(SENTENCE_BREAK)[0] ?? '';
  const clean = head.replace(UNSAFE, '').replace(/\s+/g, ' ').trim().slice(0, 40).trim().replace(/\.+$/, '');
  return `${clean || 'goal'}-${goalId.slice(-6)}`;
}
/**
 * Where a new goal's progress folder goes: `<root>/<repo-name>/<folder>` under Settings → engine.workspacesRoot, or with
 * no root set, next to the repository as `<repo-name>-foundry/<folder>` — a place a person finds without knowing Foundry.
 */
export function defaultWorkspaceDir(root: string | null, goal: { id: string; title: string; repoPath: string }): string {
  const repo = resolve(goal.repoPath);
  const base = root ? join(resolve(root), basename(repo)) : join(dirname(repo), `${basename(repo)}-foundry`);
  return join(base, workspaceFolderName(goal.title, goal.id));
}

/**
 * `goal/<id>-<n>-<slug>`: the n-th branch of a stacked delivery. A sibling of the goal branch, not a
 * child (`goal/<id>/…` cannot exist while `goal/<id>` does — git refs are files).
 */
export const stackBranchName = (goalBranch: string, index: number, slug: string) => `${goalBranch}-${index}-${slug}`;
export const isStackBranch = (goalBranch: string, branch: string) => /^-\d+-/.test(branch.slice(goalBranch.length)) && branch.startsWith(goalBranch);
export async function listStackBranches(repo: string, goalBranch: string): Promise<string[]> {
  const r = await git(['for-each-ref', '--format=%(refname:short)', `refs/heads/${goalBranch}-*`], repo);
  return r.code === 0 ? r.stdout.split('\n').filter((b) => isStackBranch(goalBranch, b)) : [];
}
export const taskBranch = (taskId: string) => `task/${taskId}`;

/** The goal worktree on `goal/<id>`; `startRef` (e.g. `origin/main`) only matters the first time, when the branch is created. */
export async function ensureGoalWorkspace(dataDir: string, goal: Goal, opts: { startRef?: string } = {}): Promise<string> {
  const path = goalWorkspacePath(dataDir, goal);
  await ensureWorktree(goal.repoPath, path, goal.branch, opts.startRef ?? goal.baseBranch);
  return path;
}

/** Create a task worktree branched from the goal branch's current HEAD. */
export async function ensureTaskWorkspace(dataDir: string, goal: Goal, task: Task): Promise<{ path: string; branch: string }> {
  const goalPath = goalWorkspacePath(dataDir, goal);
  const base = await headRef(goalPath);
  const path = taskWorkspacePath(dataDir, goal, task.id);
  const branch = taskBranch(task.id);
  await ensureWorktree(goal.repoPath, path, branch, base);
  // project skills and the Brief's style samples are git-excluded, so a fresh checkout lacks them: copy them over from the goal workspace
  copyProjectSkills(goalPath, path);
  copyStyleSamples(goalPath, path);
  return { path, branch };
}

export async function dropTaskWorkspace(goal: Goal, task: Task): Promise<void> {
  if (!task.worktreePath) return;
  await removeWorktree(goal.repoPath, task.worktreePath, { deleteBranch: task.branch ?? undefined });
}
