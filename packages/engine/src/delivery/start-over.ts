import type { DeliveryPolicy, Goal } from '@foundry/core';
import type { Engine } from '../engine.ts';
import { git, removeWorktree } from '../git/git.ts';
import { deliveryWorkspacePath, listStackBranches } from '../workspace.ts';
import { repoSlug } from './policy.ts';

/** policy fields a running or open delivery is built on: they change only through Start over */
export const STRUCTURAL = ['mode', 'unit', 'mergeMethod', 'baseBranch', 'remote'] as const;

const WITH_PRS = ['pr', 'pr-automerge'];

/**
 * The structural fields `next` changes, by name. Between "open PRs" and "open PRs and merge" the open pull requests
 * stay valid, so that switch is allowed once no run is going.
 */
export function structuralChanges(now: DeliveryPolicy, next: DeliveryPolicy, running: boolean): string[] {
  return STRUCTURAL.filter((k) => JSON.stringify(now[k] ?? null) !== JSON.stringify(next[k] ?? null)).filter((k) => !(k === 'mode' && !running && WITH_PRS.includes(now.mode) && WITH_PRS.includes(next.mode)));
}

/**
 * "Start over": close the goal's open pull requests (with a comment saying why), delete its stacked branches here and
 * on the remote, and deliver again from scratch with `policy`. Work a pull request already merged stays merged and is
 * not delivered again. The goal branch itself is never deleted.
 */
export async function startOver(engine: Engine, goal: Goal, policy: DeliveryPolicy): Promise<string[]> {
  const { store } = engine;
  const notes: string[] = [];
  const remote = goal.delivery.policy.remote;
  const url = await git(['remote', 'get-url', remote], goal.repoPath);
  const repo = url.code === 0 ? repoSlug(url.stdout.trim()) : null;
  const open = goal.delivery.prs.filter((p): p is typeof p & { number: number } => p.state === 'open' && p.number != null);
  if (open.length && !repo) throw new Error(`remote "${remote}" is gone, so the open pull requests cannot be closed; close them on GitHub first`);
  for (const pr of open) {
    const r = await engine.gh.prClose(goal.repoPath, { repo: repo!, number: pr.number, comment: 'Closed by Foundry: the delivery of this goal was started over.' });
    if (r.code !== 0 && !/already closed|is CLOSED|is MERGED/i.test(r.stderr + r.stdout)) throw new Error(`could not close PR #${pr.number}: ${(r.stderr || r.stdout).trim().slice(0, 200)}`);
    store.append({ type: 'delivery.pr_closed', goalId: goal.id, payload: { prNumber: pr.number } });
    notes.push(`closed PR #${pr.number}`);
  }
  // the scratch worktree may have a stacked branch checked out, which would keep it from being deleted
  await removeWorktree(goal.repoPath, deliveryWorkspacePath(engine.config.dataDir, goal)).catch(() => {});
  for (const b of await listStackBranches(goal.repoPath, goal.branch)) {
    await git(['branch', '-D', b], goal.repoPath);
    if (repo) await git(['push', remote, '--delete', `refs/heads/${b}`], goal.repoPath);
    notes.push(`deleted ${b}`);
  }
  if (notes.length) store.append({ type: 'delivery.note', goalId: goal.id, payload: { message: `Start over: ${notes.join('; ')}` } });
  store.append({ type: 'delivery.policy_set', goalId: goal.id, payload: { policy, source: 'start-over' } });
  return notes;
}
