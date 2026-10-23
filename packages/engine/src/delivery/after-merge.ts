/**
 * What happens on the user's machine once a goal's pull request has merged (ADR-0015): the local base branch is
 * fast-forwarded when that is safe, and once it contains the work, the goal's progress folder, worktrees and local
 * branches are removed. Nothing that could lose work is ever deleted: uncommitted files in the progress folder,
 * content that is not in the base branch yet and a goal run again after its merge keep everything in place until the
 * human says "clean up anyway", and so, for a goal that keeps artifacts (ADR-0033), do artifacts the output folder does
 * not have as they are now, files a landing could not copy out of a kept task worktree, and a delivery still copying
 * (it runs the tidy-up once it ends; clean up anyway waits for it a while, then holds).
 */
import { existsSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { getGoal, listTasks, type Goal } from '@foundry/core';
import type { Engine } from '../engine.ts';
import { git, removeWorktree } from '../git/git.ts';
import { fetchBase, pullFastForward } from '../git/sync.ts';
import { ARTIFACTS_DIR, contentHash, copyIdentity, deliveryWorkspacePath, goalWorkspacePath, internalWorkspaceDir, isStyleSample, listArtifacts, listStackBranches, trackedArtifacts } from '../workspace.ts';
import { goalUsesArtifacts, unlandedFiles } from '../goal-artifacts.ts';
import { pendingStackEntries } from './stack-entries.ts';
import { conversationWorkspacePath } from '../conversation/workspace.ts';

export const baseBranchOf = (goal: Goal) => goal.delivery.policy.baseBranch ?? goal.baseBranch;

/** the engine's folders of a goal the tidy-up removes; its screenshots, review diffs, preview, milestone and docs worktrees stay */
const TIDIED = ['tasks', 'delivery', 'resolve', 'baseline', 'overlay', 'conversation'] as const;


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

/**
 * Whether the goal went back to running after its delivery began: what it made since is in no pull request, even when
 * the merge was only noticed later. A delivery begins once the goal has finished.
 */
function ranAgainSinceDelivery(engine: Engine, goalId: string): boolean {
  const events = engine.store.listByGoalOfTypes(goalId, ['delivery.started', 'goal.state_changed']);
  const began = events.filter((e) => e.type === 'delivery.started').at(-1);
  return !!began && events.some((e) => e.type === 'goal.state_changed' && (e.payload as { to: string }).to === 'running' && e.seq > began.seq);
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
  // the goal's last event as this began: a run again after it (while this waited) keeps everything
  const since = store.listByGoal(goalId, 1)[0]?.seq ?? 0;
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
  // and once it finished again, what it made since is in no merge: its folders stay unless asked to go
  if (!opts.force && ranAgainSinceDelivery(engine, goalId)) return cleaned(false, 'the goal ran again after its merge, so its progress folder holds work the merge did not carry; clean up anyway to remove it');
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
    // may be newer than what the folder got), and still there as that copy: the very copy it made, else a file of the
    // same content (a network share may change a file's inode number or time). One removed from the output folder,
    // replaced there by another goal's delivery or changed is no copy
    const at = run?.status === 'ok' ? Date.parse(run.startedAt ?? run.at) : 0;
    const sent = async (f: string) => {
      try {
        if (!delivered.has(f)) return false;
        const mine = statSync(join(ws, ARTIFACTS_DIR, f));
        if (mine.mtimeMs > at) return false;
        const theirs = statSync(join(run!.dest, f));
        if (theirs.size !== mine.size) return false;
        const made = run!.copies?.[f];
        return (!!made && copyIdentity(theirs) === made) || (await contentHash(join(run!.dest, f))) === (await contentHash(join(ws, ARTIFACTS_DIR, f)));
      } catch {
        return false;
      }
    };
    // what git tracks is in the base already; the Brief's style samples were only there to choose a look by
    const tracked = await trackedArtifacts(ws);
    const kept: string[] = [];
    for (const f of listArtifacts(ws)) if (!tracked.has(f) && !isStyleSample(f) && !(await sent(f))) kept.push(f);
    const copied = kept.filter((f) => delivered.has(f)).length;
    const what = !copied ? 'no output folder received' : copied === kept.length ? 'whose copy in the output folder is missing or older' : 'no output folder received, or whose copy there is missing or older';
    if (kept.length) return cleaned(false, `the progress folder holds ${kept.length} artifact${kept.length === 1 ? '' : 's'} ${what} (${kept.slice(0, 3).join(', ')}${kept.length > 3 ? ', …' : ''}); copy them out, or clean up anyway`);
  }
  // clean up anyway waits for a copy still running, not for ever (one into a share that stopped answering never ends),
  // and does not remove the files it has not copied yet from under it: it holds, and the person presses again once it
  // ended. Nor for ever for the progress folder's lock, which such a delivery holds while it copies what a landing missed
  const waitMs = config.delivery.copyWaitMs ?? 30_000;
  const deadline = Date.now() + waitMs;
  const within = async <T>(work: Promise<T>): Promise<{ done: true; value: T } | { done: false }> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<{ done: false }>((r) => (timer = setTimeout(() => r({ done: false }), Math.max(0, deadline - Date.now()))));
    try {
      return await Promise.race([work.then((value) => ({ done: true as const, value })), late]);
    } finally {
      clearTimeout(timer);
    }
  };
  const copying = engine.artifactDelivery(goalId);
  if (copying && !(await within(copying.catch(() => {}))).done) return cleaned(false, `the copy to the output folder is still running after ${Math.round(waitMs / 1000)}s; press Clean up anyway again once it ends (restart Foundry if the output folder stopped answering)`);
  let started = false;
  let gaveUp = false;
  const remove = async () => {
    let worktrees = 0;
    for (const t of listTasks(store.db, goal.id)) {
      if (!t.worktreePath || t.worktreePath === ws) continue;
      if (existsSync(t.worktreePath)) worktrees++;
      await removeWorktree(goal.repoPath, t.worktreePath, { deleteBranch: t.branch ?? undefined }).catch(() => {});
    }
    await removeWorktree(goal.repoPath, deliveryWorkspacePath(config.dataDir, goal)).catch(() => {});
    // the Explainer's worktree too (a later question builds one from the base branch, ADR-0073)
    await removeWorktree(goal.repoPath, conversationWorkspacePath(config.dataDir, goal)).catch(() => {});
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
  };
  const tidied = engine.withGoalWsLock(goal.id, async () => {
    // given up on before its turn came: nothing goes behind the person's back once the copy ends
    if (gaveUp) return;
    started = true;
    // the delivery that ended meanwhile may have tidied up already (or another press of the button did)
    if (getGoal(store.db, goalId)!.delivery.cleanup?.done) return;
    // and the goal may have been restarted while this waited for a copy or for the lock, or be restarting now: nothing
    // of it goes then. No restart begins while the folders go (Engine.restartGoal)
    if (engine.restarting.has(goalId) || store.listByGoalOfTypes(goalId, ['goal.state_changed']).some((e) => (e.payload as { to: string }).to === 'running' && e.seq > since)) return cleaned(false, 'the goal ran again, so its folders stay');
    engine.removingFolders.add(goalId);
    try {
      await remove();
    } finally {
      engine.removingFolders.delete(goalId);
    }
  });
  // removing has begun: it runs to its end (git and the folders, not a copy into a share)
  if ((await within(tidied)).done || started) return void (await tidied);
  gaveUp = true;
  cleaned(false, `the progress folder is still busy after ${Math.round(waitMs / 1000)}s; press Clean up anyway again in a while`);
}
