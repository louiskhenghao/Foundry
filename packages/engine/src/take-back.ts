/**
 * Taking a merge attempt's commit back when the merge did not land (ADR-0033): right after the attempt, at the next start
 * for an attempt the engine stopped during, and later for a commit git would not take back then (an escalation names it).
 */
import { existsSync } from 'node:fs';
import { listEscalations, type Goal } from '@foundry/core';
import type { Engine } from './engine.ts';
import { git, gitOk, headRef, resetHard } from './git/git.ts';
import { goalWorkspacePath } from './workspace.ts';

/** a merge attempt's commit that git would not take back: the worktree it is in, where the attempt started, and the commit */
export interface StuckCommit {
  cwd: string;
  base: string;
  ref: string;
  /** the branch that holds it (escalations raised before it was recorded name none: the worktree's HEAD stands in) */
  branch?: string;
}

/**
 * Take a merge attempt's commit back to where the attempt started. A lock another program holds (an editor refreshing
 * its git status) is let go in a moment, so it tries a few times. `keep`: leave the worktree's other uncommitted changes
 * (git refuses when they touch the files the commit changed); otherwise everything goes back, as right after an attempt
 * aborted. Says why when git still refused, null once the branch is back (a clean of untracked files that failed after
 * the reset went through does not count).
 */
export async function takeBack(cwd: string, base: string | null, opts: { keep?: boolean } = {}): Promise<string | null> {
  if (!base || (await headRef(cwd)) === base) return null;
  let why = '';
  for (let i = 0; i < 3; i++) {
    if (i) await Bun.sleep(500);
    try {
      if (opts.keep) await gitOk(['reset', '--keep', base], cwd);
      else await resetHard(cwd, base);
      return null;
    } catch (err) {
      why = String((err as Error)?.message ?? err).split('\n')[0]!.slice(0, 200);
      if ((await headRef(cwd)) === base) return null;
    }
  }
  return why;
}

/**
 * A merge attempt the engine stopped during may have committed its resolution before its checks ran: the commit it
 * recorded making (`made`; an attempt from before that was recorded: its resolution on top of where it started). When
 * the branch ends at that commit it is taken back, and the worktree's other uncommitted changes stay; any other commit
 * there (a later attempt's, verified) is left alone. One with commits on top of it (made while the engine was stopped)
 * cannot be taken back without them: it is named (`why`) for the person to revert. `taken` says whether there was one
 * (`ref`); `why`, what stood in the way.
 */
export async function takeBackOrphaned(cwd: string, base: string, attempt: { index: number; made: string | null }): Promise<{ taken: boolean; why: string | null; ref: string | null }> {
  const none = { taken: false, why: null, ref: null };
  if (!existsSync(cwd)) return none;
  const head = await headRef(cwd);
  if (head === base) return none;
  if (attempt.made) {
    if (head === attempt.made) return { taken: true, why: await takeBack(cwd, base, { keep: true }), ref: head };
    if ((await git(['merge-base', '--is-ancestor', attempt.made, head], cwd)).code === 0) return { taken: true, why: 'commits landed on top of it while the engine was stopped', ref: attempt.made };
    return none;
  }
  if ((await git(['rev-parse', '-q', '--verify', 'HEAD^1'], cwd)).stdout.trim() !== base) return none;
  if (!new RegExp(`^Resolved by merge attempt ${attempt.index}$`, 'm').test((await git(['log', '-1', '--format=%B'], cwd)).stdout)) return none;
  return { taken: true, why: await takeBack(cwd, base, { keep: true }), ref: head };
}

/**
 * What `git <args>` changes, line by line, without line numbers or blob names: the same for a commit and one that makes
 * the very same changes, whitespace included, wherever the lines moved. Null when git could not tell.
 */
const changes = async (cwd: string, args: string[]): Promise<string | null> => {
  const r = await git([...args.slice(0, 1), '-U0', '--binary', '--no-color', '--no-ext-diff', ...args.slice(1)], cwd);
  if (r.code !== 0) return null;
  // only the newlines around it go: a changed line's own trailing whitespace counts
  return r.stdout
    .split('\n')
    .filter((l) => !l.startsWith('index '))
    .map((l) => (l.startsWith('@@') ? '@@' : l))
    .join('\n')
    .replace(/^\n+|\n+$/g, '');
};

/**
 * Whether the commits on top of a stuck commit, up to `tip`, undo it: by what they change rather than what their messages
 * say. Each whose changes are its exact inverse (a revert) takes it out, each that makes its changes again (a revert of
 * that revert) puts it back. Compared without context lines, so a revert below other edits to the same files counts.
 */
async function undone(stuck: StuckCommit, tip: string, cwd: string): Promise<boolean> {
  const undo = await changes(cwd, ['diff', stuck.ref, stuck.base]);
  if (undo === null) return false;
  if (!undo) return true;
  const redo = await changes(cwd, ['diff', stuck.base, stuck.ref]);
  const commits = (await git(['rev-list', '--no-merges', '--max-count=200', `${stuck.ref}..${tip}`], cwd)).stdout.split('\n').filter(Boolean);
  let applied = 1;
  for (const c of commits) {
    const made = await changes(cwd, ['show', '--format=', c]);
    if (made === undo) applied--;
    else if (made === redo) applied++;
  }
  return applied <= 0;
}

/**
 * Settle a commit git would not take back before: taken back now when its branch still ends at it, nothing to do once it
 * is off the branch (reset by hand) or the commits on top of it undo it (a revert). The branch decides, not the folder:
 * a worktree gone, or moved off the branch, settles nothing. Says what the person still has to do otherwise: revert it
 * under the commits that landed on top of it, or reset by hand while git refuses. The worktree's other uncommitted
 * changes stay. In the goal workspace this runs under its lock (`locked`: the caller holds it); one settled already
 * waits for nothing.
 */
export async function takeBackStuck(engine: Engine, goal: Goal, stuck: StuckCommit, opts: { locked?: boolean } = {}): Promise<string | null> {
  const short = (r: string) => r.slice(0, 7);
  const here = () => existsSync(stuck.cwd);
  const at = () => (here() ? stuck.cwd : goal.repoPath);
  const tip = async (): Promise<string | null> => {
    if (!stuck.branch) return here() ? headRef(stuck.cwd).catch(() => null) : null;
    const r = await git(['rev-parse', '-q', '--verify', `refs/heads/${stuck.branch}`], at());
    return r.code === 0 ? r.stdout.trim() : null;
  };
  const holds = async (t: string | null) => !!t && (await git(['merge-base', '--is-ancestor', stuck.ref, t], at())).code === 0;
  if (!(await holds(await tip()))) return null;
  const settle = async (): Promise<string | null> => {
    const t = await tip();
    if (!(await holds(t))) return null;
    if (t !== stuck.ref) return (await undone(stuck, t!, at())) ? null : `other commits landed on top of the unverified resolution ${short(stuck.ref)}: revert it in ${stuck.cwd} (git revert ${short(stuck.ref)}), then answer`;
    // the reset moves what the worktree has checked out: only the branch itself, there, will do
    const byHand = `${stuck.branch ? `the branch ${stuck.branch}` : stuck.cwd} still ends at the unverified resolution ${short(stuck.ref)}: reset it to ${short(stuck.base)} by hand, then answer`;
    if (!here() || (await headRef(stuck.cwd)) !== stuck.ref) return byHand;
    if (stuck.branch && (await git(['symbolic-ref', '-q', 'HEAD'], stuck.cwd)).stdout.trim() !== `refs/heads/${stuck.branch}`) return byHand;
    const why = await takeBack(stuck.cwd, stuck.base, { keep: true });
    if (why) return `git still refuses to take back the unverified resolution ${short(stuck.ref)} (${why}): reset ${stuck.cwd} to ${short(stuck.base)} by hand, then answer`;
    if (await holds(await tip())) return byHand;
    engine.store.append({ type: 'engine.note', goalId: goal.id, payload: { level: 'info', message: `took back the unverified resolution ${short(stuck.ref)} a merge attempt had left in ${stuck.cwd}` } });
    return null;
  };
  return !opts.locked && stuck.cwd === goalWorkspacePath(engine.config.dataDir, goal) ? engine.withGoalWsLock(goal.id, settle) : settle();
}

/**
 * The commits a goal's open merge escalations say git would not take back; `all`: also those of escalations answered
 * since (an aborted goal's stay on its branch until it is restarted)
 */
export function stuckCommits(engine: Engine, goalId: string, opts: { all?: boolean } = {}): StuckCommit[] {
  return listEscalations(engine.store.db, { goalId, openOnly: !opts.all }).flatMap((e) => {
    const p = e.payload as { kind?: string; stuck?: StuckCommit };
    return p.kind === 'merge' && p.stuck ? [p.stuck] : [];
  });
}

/**
 * Settle every commit git would not take back before (takeBackStuck) and say what is left to do about one in `cwds`:
 * nothing may build on it there, neither a landing nor a catch-up with the goal branch nor a new worktree. The caller
 * holds the goal workspace's lock.
 */
export async function stuckIn(engine: Engine, goal: Goal, cwds: (string | null)[]): Promise<string | null> {
  let held: string | null = null;
  for (const stuck of stuckCommits(engine, goal.id)) {
    const left = await takeBackStuck(engine, goal, stuck, { locked: true });
    if (left && !held && cwds.includes(stuck.cwd)) held = left;
  }
  return held;
}
