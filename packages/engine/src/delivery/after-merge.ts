/**
 * What happens on the user's machine once a goal's pull request has merged (ADR-0015): the local base branch is
 * fast-forwarded when that is safe, and once it contains the work, the goal's progress folder, worktrees and local
 * branches are removed. Nothing that could lose work is ever deleted: uncommitted files in the progress folder and
 * content that is not in the base branch yet keep everything in place until the human says "clean up anyway", and so,
 * for a goal that keeps artifacts (ADR-0033), do artifacts the output folder does not have as they are now, files a
 * landing could not copy out of a kept task worktree, and a delivery still copying (it runs the tidy-up once it ends).
 */
import { existsSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { getGoal, listTasks, type Goal } from '@foundry/core';
import type { Engine } from '../engine.ts';
import { git, removeWorktree } from '../git/git.ts';
import { fetchBase, pullFastForward } from '../git/sync.ts';
import { ARTIFACTS_DIR, deliveryWorkspacePath, goalWorkspacePath, internalWorkspaceDir, isStyleSample, listArtifacts, listStackBranches, trackedArtifacts } from '../workspace.ts';
import { goalUsesArtifacts, unlandedFiles } from '../goal-artifacts.ts';
import { pendingStackEntries } from './stack-entries.ts';

export const baseBranchOf = (goal: Goal) => goal.delivery.policy.baseBranch ?? goal.baseBranch;

/** the engine's folders of a goal the tidy-up removes; its screenshots, review diffs, preview, milestone and docs worktrees stay */
const TIDIED = ['tasks', 'delivery', 'resolve', 'baseline', 'overlay'] as const;


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

/**
 * Does the local `base` contain the last merged pull request? A stacked delivery rebuilds each task's commit on the
 * base (conflicts resolved, fix-CI commits added), so the goal branch's content never matches the base exactly even
 * when everything merged; the merge commit GitHub recorded is the reliable sign.
 */
export async function mergedInBase(repo: string, base: string, ref: string | null): Promise<boolean> {
  if (!ref) return false;
  if ((await git(['cat-file', '-e', `${ref}^{commit}`], repo)).code !== 0) return false;
  return (await git(['merge-base', '--is-ancestor', ref, `refs/heads/${base}`], repo)).code === 0;
}

export interface AfterMergeOptions {
  /** the human pressed "Pull into my checkout": update the local base even when the setting is off */
  pull?: boolean;
  /** the human pressed "Clean up anyway": remove the folders even when something would be lost */
  force?: boolean;
  /** the artifact delivery this tidy-up was put off for has ended: it is not put off again */
  afterDelivery?: boolean;
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
  // a stack entry not delivered yet (the docs commit of a goal delivered before it became its own PR) is work the base lacks
  const pending = goal.delivery.policy.unit === 'task' ? pendingStackEntries(engine, goal) : [];
  const upToDate = (!pending.length && (await mergedInBase(goal.repoPath, base, goal.delivery.mergedRef))) || (await contentInBase(goal.repoPath, base, goal.branch));
  const why = pending.length ? `${detail}; not delivered yet: ${pending.map((p) => p.task.title).join(', ')} (press Resume delivery)` : detail;
  store.append({ type: 'delivery.local_synced', goalId, payload: { upToDate, detail: upToDate ? `your local ${base} has the work (${detail})` : why } });

  // 2. tidy the goal's folders and branches
  const cleaned = (done: boolean, why: string, waiting = false): void => {
    // a hold never undoes a tidy-up that finished meanwhile (Clean up anyway, or the one the delivery ran)
    if (!done && getGoal(store.db, goalId)!.delivery.cleanup?.done) return;
    store.append({ type: 'delivery.cleaned', goalId, payload: { done, detail: why, ...(waiting ? { waiting } : {}) } });
  };
  if (getGoal(store.db, goalId)!.delivery.cleanup?.done) return;
  // a goal restarted after its merge works in those folders again: nothing of them goes, not even when asked to
  if (!['done', 'over_delivered'].includes(getGoal(store.db, goalId)!.state)) return cleaned(false, 'the goal is running again, so its folders stay');
  if (!auto && !opts.force) return cleaned(false, 'Settings: Foundry does not tidy up after a merge — delete the goal to remove its folders');
  if (!upToDate && !opts.force) return cleaned(false, `your local ${base} does not contain this work yet, so the progress folder stays`);
  const ws = goalWorkspacePath(config.dataDir, goal);
  if (existsSync(ws) && !opts.force) {
    const dirty = (await git(['status', '--porcelain'], ws)).stdout.split('\n').filter(Boolean);
    if (dirty.length) return cleaned(false, `the progress folder has ${dirty.length} uncommitted change${dirty.length === 1 ? '' : 's'}; commit them, or clean up anyway`);
  }
  // files that exist nowhere else, for a goal that keeps artifacts (a code goal's git-ignored artifacts/ is build output):
  // what a task made that never reached the progress folder (its worktree was kept for them), and artifacts no output
  // folder received — git never carries either
  const fresh = getGoal(store.db, goalId)!;
  if (!opts.force && goalUsesArtifacts(engine, fresh)) {
    // the files may still be on their way to the output folder: the delivery runs this again once they are there (the
    // hold says so, so a delivery that ended while the engine was stopped still does)
    if (!opts.afterDelivery && engine.artifactDelivery(goalId)) return cleaned(false, 'the artifacts are still being copied to the output folder; the tidy-up follows once they are there', true);
    const unlanded = listTasks(store.db, goalId).flatMap((t) => unlandedFiles(engine, fresh, t).map((f) => `${t.title}: ${f}`));
    if (unlanded.length) return cleaned(false, `${unlanded.length} file${unlanded.length === 1 ? '' : 's'} a task made could not be copied into the progress folder and ${unlanded.length === 1 ? 'is' : 'are'} only in its worktree (${unlanded.slice(0, 3).join(', ')}${unlanded.length > 3 ? ', …' : ''}); copy them out, or clean up anyway`);
    const run = fresh.completion.artifactsRun;
    const delivered = new Set(run?.status === 'ok' ? run.files : []);
    // delivered means as the file was when the copy began (one written since, during the copy or by a task run again,
    // may be newer than what the folder got), and still there: a copy removed from the output folder, or replaced by
    // another goal delivering into the same folder (its size differs), is no copy
    const at = run?.status === 'ok' ? Date.parse(run.startedAt ?? run.at) : 0;
    const sent = (f: string) => {
      try {
        if (!delivered.has(f)) return false;
        const mine = statSync(join(ws, ARTIFACTS_DIR, f));
        return mine.mtimeMs <= at && statSync(join(run!.dest, f)).size === mine.size;
      } catch {
        return false;
      }
    };
    // what git tracks is in the base already; the Brief's style samples were only there to choose a look by
    const tracked = await trackedArtifacts(ws);
    const kept = listArtifacts(ws).filter((f) => !sent(f) && !tracked.has(f) && !isStyleSample(f));
    const copied = kept.filter((f) => delivered.has(f)).length;
    const what = !copied ? 'no output folder received' : copied === kept.length ? 'whose copy in the output folder is missing or older' : 'no output folder received, or whose copy there is missing or older';
    if (kept.length) return cleaned(false, `the progress folder holds ${kept.length} artifact${kept.length === 1 ? '' : 's'} ${what} (${kept.slice(0, 3).join(', ')}${kept.length > 3 ? ', …' : ''}); copy them out, or clean up anyway`);
  }
  // clean up anyway never pulls the folder out from under a copy still running
  await engine.artifactDelivery(goalId)?.catch(() => {});
  await engine.withGoalWsLock(goal.id, async () => {
    // the delivery that ended meanwhile may have tidied up already (or another press of the button did)
    if (getGoal(store.db, goalId)!.delivery.cleanup?.done) return;
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
    if (internal) for (const d of TIDIED) rmSync(join(internal, d), { recursive: true, force: true });
    else rmSync(join(config.dataDir, 'worktrees', goal.id), { recursive: true, force: true });
    cleaned(true, `removed the progress folder, ${worktrees} worktree${worktrees === 1 ? '' : 's'} and ${branches} local branch${branches === 1 ? '' : 'es'}${opts.force ? ' (cleaned up anyway)' : ''}; screenshots and the goal's history are kept`);
  });
}
