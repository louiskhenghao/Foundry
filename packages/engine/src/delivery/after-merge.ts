/**
 * What happens on the user's machine once a goal's pull request has merged (ADR-0015): the local base branch is
 * fast-forwarded when that is safe, and once it contains the work, the goal's progress folder, worktrees and local
 * branches are removed. Nothing that could lose work is ever deleted: uncommitted files in the progress folder, or
 * content that is not in the base branch yet, keep everything in place until the human says "clean up anyway".
 */
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { getGoal, listTasks, type Goal } from '@foundry/core';
import type { Engine } from '../engine.ts';
import { git, removeWorktree } from '../git/git.ts';
import { fetchBase, pullFastForward } from '../git/sync.ts';
import { deliveryWorkspacePath, goalWorkspacePath, internalWorkspaceDir, listStackBranches } from '../workspace.ts';

export const baseBranchOf = (goal: Goal) => goal.delivery.policy.baseBranch ?? goal.baseBranch;

/**
 * Is everything on `branch` already in the local `base`? Compared by content, not ancestry, so a squash or rebase
 * merge counts: merging the branch into the base would change nothing. A branch that no longer exists counts as in.
 */
export async function contentInBase(repo: string, base: string, branch: string): Promise<boolean> {
  if ((await git(['rev-parse', '--verify', '-q', `refs/heads/${branch}`], repo)).code !== 0) return true;
  if ((await git(['rev-parse', '--verify', '-q', `refs/heads/${base}`], repo)).code !== 0) return false;
  const merged = await git(['merge-tree', '--write-tree', `refs/heads/${base}`, `refs/heads/${branch}`], repo);
  if (merged.code !== 0) return false;
  const tree = merged.stdout.split('\n')[0]!.trim();
  const baseTree = (await git(['rev-parse', `refs/heads/${base}^{tree}`], repo)).stdout.trim();
  return tree !== '' && tree === baseTree;
}

export interface AfterMergeOptions {
  /** the human pressed "Pull into my checkout": update the local base even when the setting is off */
  pull?: boolean;
  /** the human pressed "Clean up anyway": remove the folders even when something would be lost */
  force?: boolean;
}

/** Run the after-merge steps for a goal whose delivery merged. Safe to call again at any time: every step re-checks. */
export async function afterMerge(engine: Engine, goalId: string, opts: AfterMergeOptions = {}): Promise<void> {
  const goal = getGoal(engine.store.db, goalId);
  if (!goal || goal.delivery.outcome !== 'merged') return;
  const { config, store } = engine;
  const base = baseBranchOf(goal);
  const auto = config.delivery.updateLocalBase;

  // 1. the user's local base branch
  let detail: string;
  if (auto || opts.pull) {
    detail = (await pullFastForward(goal.repoPath, base)).detail;
  } else {
    await fetchBase(goal.repoPath, base);
    detail = `Settings: Foundry does not update your local ${base} after a merge`;
  }
  const upToDate = await contentInBase(goal.repoPath, base, goal.branch);
  store.append({ type: 'delivery.local_synced', goalId, payload: { upToDate, detail: upToDate ? `your local ${base} has the work (${detail})` : detail } });

  // 2. tidy the goal's folders and branches
  const cleaned = (done: boolean, why: string): void => {
    store.append({ type: 'delivery.cleaned', goalId, payload: { done, detail: why } });
  };
  if (getGoal(store.db, goalId)!.delivery.cleanup?.done) return;
  if (!auto && !opts.force) return cleaned(false, 'Settings: Foundry does not tidy up after a merge — delete the goal to remove its folders');
  if (!upToDate && !opts.force) return cleaned(false, `your local ${base} does not contain this work yet, so the progress folder stays`);
  const ws = goalWorkspacePath(config.dataDir, goal);
  if (existsSync(ws) && !opts.force) {
    const dirty = (await git(['status', '--porcelain'], ws)).stdout.split('\n').filter(Boolean);
    if (dirty.length) return cleaned(false, `the progress folder has ${dirty.length} uncommitted change${dirty.length === 1 ? '' : 's'}; commit them, or clean up anyway`);
  }
  await engine.withGoalWsLock(goal.id, async () => {
    let worktrees = 0;
    for (const t of listTasks(store.db, goal.id)) {
      if (!t.worktreePath || t.worktreePath === ws) continue;
      if (existsSync(t.worktreePath)) worktrees++;
      await removeWorktree(goal.repoPath, t.worktreePath, { deleteBranch: t.branch ?? undefined }).catch(() => {});
    }
    await removeWorktree(goal.repoPath, deliveryWorkspacePath(config.dataDir, goal)).catch(() => {});
    if (existsSync(ws)) worktrees++;
    const exists = async (b: string) => (await git(['rev-parse', '--verify', '-q', `refs/heads/${b}`], goal.repoPath)).code === 0;
    const hadBranch = await exists(goal.branch);
    await removeWorktree(goal.repoPath, ws, { deleteBranch: goal.branch }).catch(() => {});
    let branches = hadBranch && !(await exists(goal.branch)) ? 1 : 0;
    for (const b of await listStackBranches(goal.repoPath, goal.branch)) if ((await git(['branch', '-D', b], goal.repoPath)).code === 0) branches++;
    rmSync(ws, { recursive: true, force: true });
    const internal = internalWorkspaceDir(goal);
    // screenshots and review records stay: the goal page's history shows them
    if (internal) for (const d of ['tasks', 'delivery', 'resolve', 'baseline']) rmSync(join(internal, d), { recursive: true, force: true });
    else rmSync(join(config.dataDir, 'worktrees', goal.id), { recursive: true, force: true });
    cleaned(true, `removed the progress folder, ${worktrees} worktree${worktrees === 1 ? '' : 's'} and ${branches} local branch${branches === 1 ? '' : 'es'}${opts.force ? ' (cleaned up anyway)' : ''}; screenshots and the goal's history are kept`);
  });
}
