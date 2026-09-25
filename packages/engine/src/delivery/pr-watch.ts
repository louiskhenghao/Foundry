/**
 * Pull requests that merge after the delivery finished — auto-merge that took longer than the wait, or a PR the human
 * merged on GitHub in "Open a PR" mode — are noticed here: goals whose delivery left a PR open are checked on a slow
 * timer (and whenever their page is opened). A merge runs the after-merge steps; a PR closed without merging is
 * recorded and nothing is removed. Only `gh pr view`, never a model.
 */
import { getGoal, listGoals, type Goal } from '@foundry/core';
import type { Engine } from '../engine.ts';
import { git } from '../git/git.ts';
import { afterMerge } from './after-merge.ts';
import { repoSlug } from './policy.ts';

/** a PR is watched this long after its delivery finished */
export const PR_WATCH_DAYS = 14;

const watched = (g: Goal, now = Date.now()) =>
  g.delivery.status === 'delivered' &&
  (g.delivery.outcome === 'pr_open' || g.delivery.outcome === 'automerge_armed') &&
  g.delivery.prs.some((p) => p.state === 'open' && p.number != null) &&
  (!g.delivery.finishedAt || now - Date.parse(g.delivery.finishedAt) < PR_WATCH_DAYS * 86_400_000);

/** owner/name the delivery talked to, read from the remote the way the pipeline does */
async function repoOf(goal: Goal): Promise<string | null> {
  const r = await git(['remote', 'get-url', goal.delivery.policy.remote], goal.repoPath);
  return r.code === 0 && r.stdout.trim() ? repoSlug(r.stdout.trim()) : null;
}

/** Check one goal's open PRs on GitHub. Returns true when the whole delivery turned out merged. */
export async function checkGoalPrs(engine: Engine, goalId: string): Promise<boolean> {
  const goal = getGoal(engine.store.db, goalId);
  if (!goal || !watched(goal)) return false;
  const repo = await repoOf(goal);
  if (!repo) return false;
  for (const pr of goal.delivery.prs) {
    if (pr.state !== 'open' || pr.number == null) continue;
    const view = await engine.gh.prView(goal.repoPath, { repo, number: pr.number }).catch(() => null);
    if (view?.state === 'MERGED') engine.store.append({ type: 'delivery.merged', goalId, payload: { prNumber: pr.number, method: goal.delivery.policy.mergeMethod, ref: view.mergeCommit, taskId: pr.taskId } });
    else if (view?.state === 'CLOSED') engine.store.append({ type: 'delivery.pr_closed', goalId, payload: { prNumber: pr.number } });
  }
  const after = getGoal(engine.store.db, goalId)!;
  const prs = after.delivery.prs.filter((p) => p.number != null);
  if (!prs.length || !prs.every((p) => p.state === 'merged')) return false;
  // the delivery's own cleanup step never ran for a late merge: tidy the remote branches the policy allows
  if (after.delivery.policy.deleteRemoteBranch) {
    for (const p of prs) await git(['push', after.delivery.policy.remote, '--delete', p.branch], after.repoPath).catch(() => null);
  }
  engine.store.append({ type: 'delivery.completed', goalId, payload: { outcome: 'merged' } });
  engine.config.log(`[delivery] ${goalId}: merged on GitHub after the delivery finished`);
  await afterMerge(engine, goalId);
  return true;
}

/** One pass over every goal with an open PR. */
export async function checkOpenPrs(engine: Engine): Promise<void> {
  for (const g of listGoals(engine.store.db)) {
    if (!watched(g)) continue;
    await checkGoalPrs(engine, g.id).catch((err) => engine.config.log(`[delivery] PR check for ${g.id} failed: ${String((err as Error).message ?? err)}`));
  }
}
