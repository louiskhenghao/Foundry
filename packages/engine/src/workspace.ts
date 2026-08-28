import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
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

export function goalWorkspacePath(dataDir: string, goalId: string): string {
  return join(dataDir, 'worktrees', goalId, '_goal');
}
/** Scratch worktree where delivery builds the stacked per-task branches. */
export function deliveryWorkspacePath(dataDir: string, goalId: string): string {
  return join(dataDir, 'worktrees', goalId, '_delivery');
}

/** detached worktree where a human resolves one task's conflicted integration by hand (one per task) */
export function resolveWorkspacePath(dataDir: string, goalId: string, taskId: string): string {
  return join(dataDir, 'worktrees', goalId, '_resolve', taskId);
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
export function taskWorkspacePath(dataDir: string, goalId: string, taskId: string): string {
  return join(dataDir, 'worktrees', goalId, taskId);
}
export const taskBranch = (taskId: string) => `task/${taskId}`;

/** The goal worktree on `goal/<id>`; `startRef` (e.g. `origin/main`) only matters the first time, when the branch is created. */
export async function ensureGoalWorkspace(dataDir: string, goal: Goal, opts: { startRef?: string } = {}): Promise<string> {
  const path = goalWorkspacePath(dataDir, goal.id);
  await ensureWorktree(goal.repoPath, path, goal.branch, opts.startRef ?? goal.baseBranch);
  return path;
}

/** Create a task worktree branched from the goal branch's current HEAD. */
export async function ensureTaskWorkspace(dataDir: string, goal: Goal, task: Task): Promise<{ path: string; branch: string }> {
  const goalPath = goalWorkspacePath(dataDir, goal.id);
  const base = await headRef(goalPath);
  const path = taskWorkspacePath(dataDir, goal.id, task.id);
  const branch = taskBranch(task.id);
  await ensureWorktree(goal.repoPath, path, branch, base);
  // project skills are git-excluded, so a fresh checkout lacks them: copy them over from the goal workspace
  copyProjectSkills(goalPath, path);
  return { path, branch };
}

export async function dropTaskWorkspace(goal: Goal, task: Task): Promise<void> {
  if (!task.worktreePath) return;
  await removeWorktree(goal.repoPath, task.worktreePath, { deleteBranch: task.branch ?? undefined });
}
