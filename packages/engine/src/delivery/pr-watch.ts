/**
 * Pull requests that merge after the delivery stopped waiting — auto-merge that took longer than the wait, a PR the
 * human merged on GitHub in "Open a PR" mode, or one they merged by hand after the delivery failed — are noticed here:
 * goals whose delivery left a PR open are checked on a slow timer (and whenever their page is opened). A merge of the
 * last open PR finishes the delivery and runs the after-merge steps; a PR closed without merging is recorded and nothing
 * is removed. Only `gh pr view`, never a model.
 */
import { getGoal, listGoals, type Goal } from '@foundry/core';
import type { Engine } from '../engine.ts';
import { git } from '../git/git.ts';
import { afterMerge } from './after-merge.ts';
import { failingChecks, reduceChecks } from './gh.ts';
import { closeDeliveryFailures } from './inbox.ts';
import { repoSlug } from './policy.ts';

/** a PR is watched this long after its delivery stopped */
export const PR_WATCH_DAYS = 14;

const hasOpenPr = (g: Goal) => g.delivery.prs.some((p) => p.state === 'open' && p.number != null);
const watched = (g: Goal, now = Date.now()) =>
  hasOpenPr(g) &&
  ((g.delivery.status === 'delivered' && (g.delivery.outcome === 'pr_open' || g.delivery.outcome === 'automerge_armed')) || g.delivery.status === 'failed') &&
  (!g.delivery.finishedAt || now - Date.parse(g.delivery.finishedAt) < PR_WATCH_DAYS * 86_400_000);

/** owner/name the delivery talked to, read from the remote the way the pipeline does */
async function repoOf(goal: Goal): Promise<string | null> {
  const r = await git(['remote', 'get-url', goal.delivery.policy.remote], goal.repoPath);
  return r.code === 0 && r.stdout.trim() ? repoSlug(r.stdout.trim()) : null;
}

/**
 * Read one PR on GitHub and record what changed: merged, closed, or its checks (with what is failing).
 * Returns the reduced checks state of a PR that is still open, else null.
 */
async function readPr(engine: Engine, goal: Goal, repo: string, number: number): Promise<'pending' | 'passing' | 'failing' | 'none' | null> {
  const pr = goal.delivery.prs.find((p) => p.number === number);
  if (!pr || pr.state !== 'open') return null;
  const view = await engine.gh.prView(goal.repoPath, { repo, number }).catch(() => null);
  if (!view) return null;
  if (view.state === 'MERGED') {
    engine.store.append({ type: 'delivery.merged', goalId: goal.id, payload: { prNumber: number, method: goal.delivery.policy.mergeMethod, ref: view.mergeCommit, taskId: pr.taskId } });
    return null;
  }
  if (view.state === 'CLOSED') {
    engine.store.append({ type: 'delivery.pr_closed', goalId: goal.id, payload: { prNumber: number } });
    return null;
  }
  const state = reduceChecks(view.checks);
  const failing = failingChecks(view.checks).map(({ name, description, url }) => ({ name, description, url }));
  if (state !== pr.checks || JSON.stringify(failing) !== JSON.stringify(pr.failing)) {
    engine.store.append({ type: 'delivery.checks', goalId: goal.id, payload: { state, summary: view.checks.map((c) => `${c.name}: ${c.conclusion ?? c.status}`).join(', ') || 'no checks reported', prNumber: number, failing } });
  }
  return state;
}

/** When every PR of the delivery is merged: finish it as merged, tidy the remote branches, run the after-merge steps. */
async function finishIfAllMerged(engine: Engine, goalId: string, why: string): Promise<boolean> {
  const after = getGoal(engine.store.db, goalId)!;
  const prs = after.delivery.prs.filter((p) => p.number != null);
  if (!prs.length || !prs.every((p) => p.state === 'merged')) return false;
  // the delivery's own cleanup step never ran for these merges: tidy the remote branches the policy allows
  if (after.delivery.policy.deleteRemoteBranch) {
    for (const p of prs) await git(['push', after.delivery.policy.remote, '--delete', p.branch], after.repoPath).catch(() => null);
  }
  engine.store.append({ type: 'delivery.completed', goalId, payload: { outcome: 'merged' } });
  closeDeliveryFailures(engine, goalId, 'mark_delivered');
  engine.config.log(`[delivery] ${goalId}: ${why}`);
  await afterMerge(engine, goalId);
  return true;
}

/** Check one goal's open PRs on GitHub. Returns true when the whole delivery turned out merged. */
export async function checkGoalPrs(engine: Engine, goalId: string): Promise<boolean> {
  const goal = getGoal(engine.store.db, goalId);
  if (!goal || !watched(goal)) return false;
  const repo = await repoOf(goal);
  if (!repo) return false;
  for (const pr of goal.delivery.prs) if (pr.number != null) await readPr(engine, getGoal(engine.store.db, goalId)!, repo, pr.number);
  return finishIfAllMerged(engine, goalId, 'merged on GitHub after the delivery stopped');
}

/**
 * "Re-check" on one pull request: read it on GitHub now. Merged → recorded (and the delivery finishes when it was the
 * last one); closed → recorded; still open → its checks are recorded. Returns the open PR's checks state, else null.
 */
export async function recheckPr(engine: Engine, goalId: string, number: number): Promise<'pending' | 'passing' | 'failing' | 'none' | null> {
  const goal = getGoal(engine.store.db, goalId);
  if (!goal) throw new Error(`goal ${goalId} not found`);
  if (!goal.delivery.prs.some((p) => p.number === number)) throw new Error(`PR #${number} is not part of this goal's delivery`);
  const repo = await repoOf(goal);
  if (!repo) throw new Error(`remote "${goal.delivery.policy.remote}" is not a GitHub repository`);
  const state = await readPr(engine, goal, repo, number);
  await finishIfAllMerged(engine, goalId, `PR #${number} re-checked: every pull request is merged`);
  return state;
}

/**
 * "Mark as delivered": read the PRs on GitHub first. All merged → the delivery finishes as merged (after-merge steps
 * run). Otherwise it is recorded as delivered by the human, and nothing on the machine is changed or removed.
 */
export async function markDelivered(engine: Engine, goalId: string): Promise<void> {
  const goal = getGoal(engine.store.db, goalId);
  if (!goal) throw new Error(`goal ${goalId} not found`);
  const repo = hasOpenPr(goal) ? await repoOf(goal) : null;
  if (repo) for (const pr of goal.delivery.prs) if (pr.number != null) await readPr(engine, getGoal(engine.store.db, goalId)!, repo, pr.number);
  if (await finishIfAllMerged(engine, goalId, 'marked as delivered: every pull request is merged')) return;
  engine.store.append({ type: 'delivery.completed', goalId, payload: { outcome: 'by_you' } });
  closeDeliveryFailures(engine, goalId, 'mark_delivered');
}

/** One pass over every goal with an open PR. */
export async function checkOpenPrs(engine: Engine): Promise<void> {
  for (const g of listGoals(engine.store.db)) {
    if (!watched(g)) continue;
    await checkGoalPrs(engine, g.id).catch((err) => engine.config.log(`[delivery] PR check for ${g.id} failed: ${String((err as Error).message ?? err)}`));
  }
}
