import { join } from 'node:path';
import type { Goal, Task } from '@ai-engine/core';
import { ensureWorktree, git, headRef, removeWorktree } from './git/git.ts';
import { copyProjectSkills } from './skills/autoskills.ts';

export function goalWorkspacePath(dataDir: string, goalId: string): string {
  return join(dataDir, 'worktrees', goalId, '_goal');
}
/** Scratch worktree where delivery builds the stacked per-task branches. */
export function deliveryWorkspacePath(dataDir: string, goalId: string): string {
  return join(dataDir, 'worktrees', goalId, '_delivery');
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
