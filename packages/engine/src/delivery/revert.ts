/**
 * Revert (ADR-0059): a merged delivery undone through a pull request, on the person's click. A branch from the online
 * base reverts the merge commit of each of the goal's pull requests, newest first, in a throw-away worktree; it is
 * pushed and a pull request opened — merged right away when asked, with the policy's merge method, GitHub's auto-merge
 * armed when branch protections hold it. The revert is recorded on the delivery and told under Delivery; a merge of
 * its pull request later is noticed by the pull request watch. The goal, its branch and its page stay as they are;
 * the person's checkout is touched only as a merge touches it (the base fast-forwarded when safe, ADR-0015). Only git
 * and gh, never a model.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getGoal, IdPrefix, isHistory, newId, type DeliveryRevert, type Goal, type MergeMethod } from '@foundry/core';
import type { Engine } from '../engine.ts';
import { commitStaged, conflictedFiles, ensureDetachedWorktree, exec, git, gitOk, removeWorktree, type ExecResult } from '../git/git.ts';
import { fetchBase, pullFastForward } from '../git/sync.ts';
import { revertWorkspacePath } from '../workspace.ts';
import { baseBranchOf } from './after-merge.ts';
import { diffStats } from './pipeline.ts';
import { blastRadius, repoSlug, type DiffStats } from './policy.ts';

export interface RevertRequest {
  /** why, in the person's words: it goes into the pull request and stays on the revert */
  reason?: string;
  /** merge the revert's pull request right away, with the policy's merge method */
  merge?: boolean;
}

/** What a Revert would undo, and whether one can start now (the Delivery tab's dialog reads it). */
export interface RevertInfo {
  ok: boolean;
  /** what stops it, when `ok` is false */
  why: string | null;
  /** the merges it would undo, newest first */
  reverts: { prNumber: number | null; ref: string; title: string }[];
  base: string;
  remote: string;
  method: MergeMethod;
  running: boolean;
  /** the revert whose pull request is open or armed, if any */
  open: DeliveryRevert | null;
}

const running = new Map<string, Promise<void>>();
export const reverting = (goalId: string) => running.has(goalId);
/** the reverts in flight; the engine's stop waits for them */
export const revertWork = () => [...running.values()];

/** The merges of a merged delivery, newest first: a stack merges bottom-up, so its top pull request is undone first. */
export function mergesOf(goal: Goal): RevertInfo['reverts'] {
  return goal.delivery.prs
    .filter((p) => p.state === 'merged')
    .sort((a, b) => b.index - a.index)
    .map((p) => ({ prNumber: p.number, ref: p.mergedRef ?? '', title: p.title }));
}

export function revertInfo(engine: Engine, goal: Goal): RevertInfo {
  const d = goal.delivery;
  const open = [...d.reverts].reverse().find((r) => r.status === 'open' || r.status === 'armed') ?? null;
  const info = { reverts: mergesOf(goal), base: baseBranchOf(goal), remote: d.policy.remote, method: d.policy.mergeMethod, running: reverting(goal.id), open };
  const no = (why: string): RevertInfo => ({ ok: false, why, ...info });
  if (isHistory(goal)) return no("an imported goal's pull requests are the other computer's to revert");
  if (d.status === 'running') return no('the delivery is running');
  if (d.outcome !== 'merged') return no(d.outcome === 'by_you' ? 'the delivery was finished by you, so Foundry does not know what merged' : d.policy.mode === 'local' ? 'a Local only goal merged nothing Foundry knows of' : 'the delivery has not merged');
  if (!info.reverts.length) return no('no merged pull request is recorded on the delivery');
  const unknown = info.reverts.find((r) => !r.ref);
  if (unknown) return no(`the merge commit of pull request #${unknown.prNumber} is not known`);
  if (info.running) return no('a revert of this goal is running');
  if (open) return no(`revert pull request #${open.pr?.number} is ${open.status === 'armed' ? 'waiting for GitHub to merge it' : 'open'}`);
  const last = d.reverts.at(-1);
  if (last?.status === 'merged') return no(`the goal was reverted by pull request #${last.pr?.number}; reverting that pull request on GitHub, or a follow-up goal, brings the work back`);
  return { ok: true, why: null, ...info };
}

/** Start a Revert: what is wrong is thrown at once; the rest runs in the background and is recorded on the delivery. */
export function startRevert(engine: Engine, goalId: string, req: RevertRequest = {}): void {
  const goal = getGoal(engine.store.db, goalId);
  if (!goal) throw new Error(`goal ${goalId} not found`);
  const info = revertInfo(engine, goal);
  if (!info.ok) throw new Error(info.why!);
  const reason = (req.reason ?? '').trim().slice(0, 2000);
  const merge = !!req.merge;
  const id = newId(IdPrefix.revert);
  engine.store.append({ type: 'delivery.revert_started', goalId, payload: { id, reason, merge, reverts: info.reverts } });
  const p = run(engine, goal, id, info, reason, merge)
    .catch((err): Finish => ({ status: 'failed', detail: `the revert could not run: ${String((err as Error).message ?? err)}` }))
    .then((f) => {
      // the record says the revert is over only once its worktree is gone and nothing of it runs any more
      running.delete(goalId);
      finish(engine, goalId, id, f);
    });
  running.set(goalId, p);
}

interface Finish {
  status: 'open' | 'armed' | 'merged' | 'failed';
  branch?: string | null;
  pr?: { number: number; url: string } | null;
  commits?: string[];
  mergedRef?: string | null;
  detail: string;
}
function finish(engine: Engine, goalId: string, id: string, f: Finish): void {
  engine.store.append({ type: 'delivery.revert_finished', goalId, payload: { id, status: f.status, branch: f.branch ?? null, pr: f.pr ?? null, commits: f.commits ?? [], mergedRef: f.mergedRef ?? null, detail: f.detail } });
}

async function run(engine: Engine, goal: Goal, id: string, info: RevertInfo, reason: string, merge: boolean): Promise<Finish> {
  const { store, config, gh } = engine;
  const { base, remote } = info;
  const repoPath = goal.repoPath;
  const fail = (detail: string): Finish => ({ status: 'failed', detail });
  /** every command of the revert goes into the delivery's audit, under the `revert` step */
  const note = (command: string[], cwd: string, output: string, ms: number, code = 0) =>
    store.append({ type: 'delivery.command', goalId: goal.id, payload: { step: 'revert', command: command.join(' '), cwd, exitCode: code, durationMs: ms, outputTail: output.trim().slice(-600) } });
  const cmd = async (argv: string[], cwd: string): Promise<ExecResult> => {
    const t0 = Date.now();
    const r = await exec(argv, cwd, { timeoutMs: 180_000 });
    note(argv, cwd, r.stdout + r.stderr, Date.now() - t0, r.code);
    return r;
  };

  const a = await gh.available().catch(() => ({ installed: false, authenticated: false }));
  if (!a.installed) return fail('GitHub CLI (gh) is not installed. Run: brew install gh && gh auth login --web');
  if (!a.authenticated) return fail('GitHub CLI is not logged in. Run: gh auth login --web');
  const url = await git(['remote', 'get-url', remote], repoPath);
  if (url.code !== 0 || !url.stdout.trim()) return fail(`remote "${remote}" is not set in ${repoPath}`);
  const repo = repoSlug(url.stdout.trim());

  // the base as it is online, with every merge still on it
  const s = await fetchBase(repoPath, base, { remote });
  if (!s.remoteRef) return fail(s.error ?? `${remote}/${base} is not known here`);
  for (const r of info.reverts) {
    if ((await git(['merge-base', '--is-ancestor', r.ref, s.remoteRef], repoPath)).code !== 0) {
      const known = (await git(['cat-file', '-e', `${r.ref}^{commit}`], repoPath)).code === 0;
      return fail(`the merge ${r.ref.slice(0, 7)} of pull request #${r.prNumber} is not on ${remote}/${base}${known ? ' any more' : ': the commit is not known here'}`);
    }
  }

  const earlier = goal.delivery.reverts.filter((r) => r.id !== id).length;
  const branch = `${goal.branch}-revert${earlier ? `-${earlier + 1}` : ''}`;
  const ws = revertWorkspacePath(config.dataDir, goal);
  const commits: string[] = [];
  try {
    // a throw-away worktree at the online base, on the revert branch; what an earlier attempt left (its worktree, then
    // its branch, which that worktree may have held) goes first
    await ensureDetachedWorktree(repoPath, ws, s.remoteRef);
    await git(['branch', '-D', branch], repoPath);
    await gitOk(['checkout', '-q', '-b', branch], ws);
    for (const r of info.reverts) {
      const parents = (await gitOk(['rev-list', '--parents', '-n', '1', r.ref], ws)).trim().split(/\s+/).length - 1;
      // a rebase merge put the pull request's commits on the base one by one; the recorded ref is the last of them
      const count = parents > 1 || info.method !== 'rebase' || r.prNumber == null ? 1 : await gh.prCommits(repoPath, { repo, number: r.prNumber }).catch(() => 1);
      const rv = await cmd(['git', 'revert', '--no-commit', ...(parents > 1 ? ['-m', '1'] : []), count > 1 ? `${r.ref}~${count}..${r.ref}` : r.ref], ws);
      if (rv.code !== 0) {
        const files = await conflictedFiles(ws).catch(() => [] as string[]);
        await git(['revert', '--abort'], ws);
        return fail(files.length ? `reverting the merge of pull request #${r.prNumber} conflicts with what ${base} got since, in ${files.join(', ')}. Revert it by hand, or start a follow-up goal that undoes it` : `git revert failed: ${(rv.stderr || rv.stdout).trim().slice(0, 300)}`);
      }
      const subject = r.title ? `Revert "${r.title}"${r.prNumber != null ? ` (#${r.prNumber})` : ''}` : `Revert the merge of pull request #${r.prNumber}`;
      const { ref, committed } = await commitStaged(ws, `${subject}\n\nThis reverts commit ${r.ref}${r.prNumber != null ? `, the merge of pull request #${r.prNumber}` : ''}, of the goal "${goal.title}".${reason ? `\n\nReason: ${reason}` : ''}`);
      await git(['revert', '--quit'], ws);
      if (!committed) return fail(`reverting the merge of pull request #${r.prNumber} changes nothing: ${base} no longer has what it brought`);
      commits.push(ref);
    }
    const push = await cmd(['git', 'push', '-u', remote, `refs/heads/${branch}:refs/heads/${branch}`], ws);
    if (push.code !== 0) return fail(`git push failed: ${(push.stderr || push.stdout).trim().slice(0, 300)}`);

    const one = info.reverts.length === 1 ? info.reverts[0]! : null;
    const title = one?.title ? `Revert "${one.title}"` : `Revert "${goal.title}"`;
    const dir = join(config.dataDir, 'delivery', goal.id);
    mkdirSync(dir, { recursive: true });
    const bodyFile = join(dir, `revert-${id}.md`);
    writeFileSync(bodyFile, revertBody(goal, info, reason, commits, await diffStats(ws, `${remote}/${base}...HEAD`)));
    const create = ['gh', 'pr', 'create', '-R', repo, '--base', base, '--head', branch, '--title', JSON.stringify(title)];
    const t0 = Date.now();
    let pr: { number: number; url: string };
    try {
      pr = await gh.prCreate(ws, { repo, head: branch, base, title, bodyFile });
    } catch (err) {
      const msg = String((err as Error).message ?? err);
      note(create, ws, msg, Date.now() - t0, 1);
      return fail(`the pull request could not be opened: ${msg}. The branch ${branch} is on ${remote}`);
    }
    note(create, ws, pr.url, Date.now() - t0);
    if (!merge) return { status: 'open', branch, pr, commits, detail: `pull request #${pr.number} opened; merging it undoes the goal's work on ${base}` };

    // merge right away; branch protections leave it to GitHub's auto-merge, as a delivery does
    const argv = ['gh', 'pr', 'merge', String(pr.number), '-R', repo, `--${info.method}`];
    const t1 = Date.now();
    const m = await gh.prMerge(config.dataDir, { repo, number: pr.number, method: info.method, auto: false });
    note(argv, config.dataDir, m.stdout + m.stderr, Date.now() - t1, m.code);
    if (m.code === 0) {
      const v = await gh.prView(repoPath, { repo, number: pr.number }).catch(() => null);
      const after = await afterRevertMerged(engine, goal, branch);
      return { status: 'merged', branch, pr, commits, mergedRef: v?.mergeCommit ?? null, detail: `pull request #${pr.number} merged with ${info.method}; ${after}` };
    }
    if (/protect|review|required status|not mergeable|auto-merge/i.test(m.stderr + m.stdout)) {
      const t2 = Date.now();
      const auto = await gh.prMerge(config.dataDir, { repo, number: pr.number, method: info.method, auto: true });
      note([...argv, '--auto'], config.dataDir, auto.stdout + auto.stderr, Date.now() - t2, auto.code);
      if (auto.code === 0) return { status: 'armed', branch, pr, commits, detail: `auto-merge armed on pull request #${pr.number}; GitHub merges it once the branch protections are satisfied` };
    }
    return { status: 'open', branch, pr, commits, detail: `pull request #${pr.number} opened, but it could not be merged: ${(m.stderr || m.stdout).trim().slice(0, 300)}. Merge it yourself` };
  } finally {
    await removeWorktree(repoPath, ws, { deleteBranch: branch }).catch(() => {});
  }
}

/** Once the revert's pull request merged: the remote branch goes when the policy says so, and the person's base follows (ADR-0015). */
export async function afterRevertMerged(engine: Engine, goal: Goal, branch: string | null): Promise<string> {
  const base = baseBranchOf(goal);
  const { remote, deleteRemoteBranch } = goal.delivery.policy;
  const parts: string[] = [];
  if (branch && deleteRemoteBranch) {
    const r = await git(['push', remote, '--delete', branch], goal.repoPath);
    if (r.code === 0) parts.push(`${remote}/${branch} deleted`);
  }
  if (engine.config.delivery.updateLocalBase) {
    const p = await pullFastForward(goal.repoPath, base);
    parts.push(p.ok ? `your local ${base}: ${p.detail}` : `your local ${base} was not updated: ${p.detail}`);
  } else parts.push(`Settings: Foundry does not update your local ${base} after a merge`);
  return parts.join('; ');
}

/** The pull request's description: the merges undone, the reason, and the merge danger as the `pr` template has it. */
function revertBody(goal: Goal, info: RevertInfo, reason: string, commits: string[], stats: DiffStats | null): string {
  const n = info.reverts.length;
  const list = info.reverts.map((r, i) => `- ${r.prNumber != null ? `#${r.prNumber}` : 'the merge'}${r.title ? ` ${r.title}` : ''} — merge \`${r.ref.slice(0, 7)}\` undone by \`${commits[i]?.slice(0, 7) ?? '?'}\``).join('\n');
  const size = stats ? `${stats.files} file${stats.files === 1 ? '' : 's'}, +${stats.insertions} −${stats.deletions}` : 'the diff was not measured';
  return [
    `## Summary\n\nReverts "${goal.title}": ${n === 1 ? 'the merge of its pull request' : `the merges of its ${n} pull requests, newest first`}, each undone by one commit.\n\n${list}\n\n**Reason:** ${reason || 'none given'}`,
    `## Merge Danger\n\n**Door:** two-way · reverting this pull request once it merged, or a follow-up goal in Foundry, brings the work back.\n\n**Blast Radius:** ${blastRadius(stats)} · ${size} — exactly what the merge${n === 1 ? '' : 's'} changed.`,
    `---\n_Opened by Foundry · goal \`${goal.id}\`_`,
  ].join('\n\n');
}
