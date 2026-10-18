import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Check, CheckResult, Goal, Task } from '@foundry/core';
import { getEscalation, getGoal, getTask, listChecks, listEscalations } from '@foundry/core';
import { runCommandCheck } from './checks/command.ts';
import type { Engine } from './engine.ts';
import { taskCommitMessage } from './git/conventional.ts';
import { abortInProgress, conflictedFiles, ensureDetachedWorktree, git, gitIdent, gitOk, headRef, removeWorktree, withCoauthor } from './git/git.ts';
import { artifactsForChecks, goalUsesArtifacts, landTaskArtifacts, snapshotGoalExports, type Landing } from './goal-artifacts.ts';
import { dropTaskWorkspace, goalWorkspacePath, resolveExportsPath, resolveWorkspacePath } from './workspace.ts';
import { stuckIn } from './take-back.ts';

/**
 * Manual resolution of a conflicted task integration.
 *
 * When the Merge Attempts give up, the task is blocked with a `retries_exhausted` escalation of kind `merge`.
 * The human can then take over: the conflict is re-created in a detached `_resolve` worktree (so other tasks keep
 * integrating into the goal workspace meanwhile), every conflicted file is shown with its three versions, and the
 * human resolves in the browser or in their own editor. Finishing commits the task's Conventional Commit, runs the
 * goal's must command checks, and lands the commit on the goal branch (fast-forward, else cherry-pick).
 */

export interface ResolveFile {
  path: string;
  /** still has unmerged index entries */
  conflicted: boolean;
  /** working-tree content (with conflict markers while conflicted) */
  current: string;
  /** goal-branch side (`:2:`) — null for a file that does not exist there */
  ours: string | null;
  /** task-branch side (`:3:`) */
  theirs: string | null;
  /** common ancestor (`:1:`) */
  base: string | null;
  binary: boolean;
}

export interface ResolveState {
  taskId: string;
  path: string;
  branch: string;
  into: string;
  files: ResolveFile[];
  remaining: number;
}

export interface FinishResult {
  ok: boolean;
  ref: string | null;
  checks: { name: string; status: CheckResult['status']; summary: string }[];
  /** why it did not finish (conflicts left, checks failed without force, landing failed) */
  reason: string | null;
}

const MARKER = /^(<{7}|={7}|>{7}|\|{7})( |$)/m;

/** the goal's workspace ref for the path helpers; a deleted goal falls back to the legacy layout so cleanup paths still resolve */
const refOf = (engine: Engine, goalId: string) => getGoal(engine.store.db, goalId) ?? { id: goalId, workspaceDir: null };

function mergeEscalation(engine: Engine, goalId: string, taskId: string) {
  return listEscalations(engine.store.db, { goalId, openOnly: true }).find((e) => e.taskId === taskId && e.trigger === 'retries_exhausted' && (e.payload as { kind?: string }).kind === 'merge') ?? null;
}

/**
 * What a task's latest resolution start recorded: the goal-branch commit it started from, the task branch's tip it
 * merged, and the files that conflicted (base and tip are null for a start recorded before they were).
 */
function resolutionStart(engine: Engine, goalId: string, taskId: string): { base: string | null; tip: string | null; files: string[] } | null {
  const started = engine.store
    .listByGoalOfTypes(goalId, ['merge.manual_started'])
    .map((e) => e.payload as { taskId: string; files: string[]; base?: string; tip?: string })
    .filter((p) => p.taskId === taskId)
    .at(-1);
  return started ? { base: started.base ?? null, tip: started.tip ?? null, files: started.files } : null;
}

/** git's own record of a squash merge not yet committed */
async function squashPending(path: string): Promise<boolean> {
  const r = await git(['rev-parse', '--git-path', 'SQUASH_MSG'], path);
  return r.code === 0 && existsSync(resolve(path, r.stdout.trim()));
}

/**
 * Whether a resolve worktree holds anything of the resolution: git's squash merge in it (SQUASH_MSG), a change to a
 * tracked file (staged or not), or a commit made on top of where it started (a Finish cut short). SQUASH_MSG alone is
 * not enough: an unstage or an editor's commit removes it while the person's work stays. Untracked files do not count
 * (a mergetool's *.orig, a check's output are not a resolution), and a status that cannot be read counts as work. A
 * worktree with none of these was left before its merge, or emptied (a stash keeps the work in the stash), and is safe
 * to start over.
 */
async function holdsWork(path: string, base: string | null): Promise<boolean> {
  if (await squashPending(path)) return true;
  const status = await git(['status', '--porcelain', '--untracked-files=no'], path);
  if (status.code !== 0 || status.stdout.trim()) return true;
  return !!base && (await headRef(path)) !== base;
}

/** the task branch moved since the resolution merged it (a retry ran more attempts): the resolution is of older work */
async function staleTip(goal: Goal, task: Task, tip: string | null): Promise<boolean> {
  if (!tip || !task.branch) return false;
  const now = (await git(['rev-parse', '-q', '--verify', `refs/heads/${task.branch}`], goal.repoPath)).stdout.trim();
  return !!now && now !== tip;
}

/** a resolution session to keep: its worktree is there, of the task's current work, and holds something of the resolution */
async function liveSession(engine: Engine, goal: Goal, task: Task, path: string): Promise<boolean> {
  if (!existsSync(path) || (await git(['rev-parse', '--git-dir'], path)).code !== 0) return false;
  const start = resolutionStart(engine, goal.id, task.id);
  if (await staleTip(goal, task, start?.tip ?? null)) return false;
  return holdsWork(path, start?.base ?? null);
}

/** edits and Finish only while the task still waits on its merge (not after a skip, or a retry that runs it again) */
function mustStillResolve(engine: Engine, goalId: string, taskId: string): void {
  const can = canResolve(engine, goalId, taskId);
  if (!can.ok) throw new Error(can.reason!);
}

/** one change at a time per task's resolution: a Finish running its checks never meets a start, an edit or an abort */
const resolving = new Map<string, Promise<unknown>>();
function serial<T>(goalId: string, taskId: string, fn: () => Promise<T>): Promise<T> {
  const key = `${goalId}:${taskId}`;
  const next = (resolving.get(key) ?? Promise.resolve()).catch(() => {}).then(fn);
  resolving.set(key, next);
  void next.finally(() => {
    if (resolving.get(key) === next) resolving.delete(key);
  }).catch(() => {});
  return next;
}

function mustTask(engine: Engine, goalId: string, taskId: string): { goal: Goal; task: Task } {
  const goal = getGoal(engine.store.db, goalId);
  const task = getTask(engine.store.db, taskId);
  if (!goal || !task || task.goalId !== goalId) throw new Error(`task ${taskId} not found in goal ${goalId}`);
  return { goal, task };
}

/** A task can be resolved by hand when it is blocked on a merge escalation and worked in its own worktree. */
export function canResolve(engine: Engine, goalId: string, taskId: string): { ok: boolean; reason: string | null } {
  const task = getTask(engine.store.db, taskId);
  if (!task) return { ok: false, reason: 'task not found' };
  if (task.kind === 'goal') return { ok: false, reason: "this task is done by a delegated goal: merge the goal branch into that goal's folder by hand, then retry the task" };
  if (!task.branch) return { ok: false, reason: 'this task worked directly on the goal branch; there is nothing to merge' };
  if (task.state !== 'blocked') return { ok: false, reason: `task is ${task.state}; manual resolution is offered once the automatic merge attempts gave up` };
  if (!mergeEscalation(engine, goalId, taskId)) return { ok: false, reason: 'the task is blocked for another reason than a merge conflict' };
  return { ok: true, reason: null };
}

/** (Re)create the conflict in the `_resolve` worktree and describe it. Idempotent: a session that holds work is kept. */
export function startResolution(engine: Engine, goalId: string, taskId: string, opts: { fresh?: boolean } = {}): Promise<ResolveState> {
  return serial(goalId, taskId, () => startUnlocked(engine, goalId, taskId, opts));
}

async function startUnlocked(engine: Engine, goalId: string, taskId: string, opts: { fresh?: boolean }): Promise<ResolveState> {
  const { goal, task } = mustTask(engine, goalId, taskId);
  const can = canResolve(engine, goalId, taskId);
  if (!can.ok) throw new Error(can.reason!);
  const path = resolveWorkspacePath(engine.config.dataDir, refOf(engine, goalId), taskId);
  const goalWs = goalWorkspacePath(engine.config.dataDir, refOf(engine, goalId));
  if (!(await liveSession(engine, goal, task, path)) || opts.fresh) {
    // the goal branch as it stands between landings (read under the goal workspace's lock, never a merge attempt's commit
    // before its checks are done), and never a commit an attempt could not take back, this task's or another's: neither
    // the resolution nor its baseline starts on one
    const read = await engine.withGoalWsLock(goalId, async () => {
      const held = await stuckIn(engine, goal, [goalWs, task.worktreePath]);
      return held ? { held, head: '' } : { held: null, head: await headRef(goalWs) };
    });
    if (read.held) throw new Error(read.held);
    const head = read.head;
    const tip = (await git(['rev-parse', '-q', '--verify', `refs/heads/${task.branch}`], goal.repoPath)).stdout.trim() || undefined;
    await ensureDetachedWorktree(goal.repoPath, path, head);
    const r = await git(['merge', '--squash', '--no-commit', task.branch!], path);
    const files = await conflictedFiles(path);
    if (r.code === 0 || !files.length) {
      // the conflict is gone (the goal branch moved on): nothing to resolve by hand, let the engine integrate again
      await abortInProgress(path).catch(() => {});
      await removeWorktree(goal.repoPath, path).catch(() => {});
      throw new Error(r.code === 0 ? 'the merge no longer conflicts — use "Retry with hint" (no hint needed) and the engine will integrate it' : `squash merge failed without conflicts: ${r.stderr.slice(0, 300)}`);
    }
    // recorded first: a restart while the exports below are copied still knows where this resolution started
    engine.store.append({ type: 'merge.manual_started', goalId, payload: { taskId, files, path, base: head, ...(tip ? { tip } : {}) } });
    // the checks that judge the resolution see the exports as the merged goal will have them (git-excluded, so the merge
    // did not bring them): the goal's own (never a merge attempt's laid over them), then what the task changed
    if (goalUsesArtifacts(engine, goal)) {
      const snap = resolveExportsPath(engine.config.dataDir, refOf(engine, goalId), taskId);
      await snapshotGoalExports(engine, goal, snap)
        .then(() => artifactsForChecks(engine, goal, snap, path, `resolution of "${task.title}"`))
        .catch((err) => engine.store.append({ type: 'engine.note', goalId, payload: { level: 'warn', message: `resolution of "${task.title}": ${String((err as Error)?.message ?? err).slice(0, 200)}; Finish copies them again` } }));
    }
    if (task.worktreePath) await artifactsForChecks(engine, goal, task.worktreePath, path, `resolution of "${task.title}"`, { onlyChanged: true });
  }
  return describeResolution(engine, goalId, taskId);
}

export async function describeResolution(engine: Engine, goalId: string, taskId: string): Promise<ResolveState> {
  const { goal, task } = mustTask(engine, goalId, taskId);
  const path = resolveWorkspacePath(engine.config.dataDir, refOf(engine, goalId), taskId);
  // a worktree that holds nothing of the resolution, or a resolution of the task's older work, is reported as none, so the
  // page starts it again (nothing of the current work is lost)
  if (!(await liveSession(engine, goal, task, path))) throw new Error('no manual resolution in progress for this task');
  const all = new Set<string>(resolutionStart(engine, goalId, taskId)?.files ?? []);
  const conflicted = new Set(await conflictedFiles(path));
  for (const f of conflicted) all.add(f);
  const files: ResolveFile[] = [];
  for (const p of [...all].sort()) {
    const stage = async (n: 1 | 2 | 3) => {
      const r = await git(['show', `:${n}:${p}`], path);
      return r.code === 0 ? r.stdout : null;
    };
    const current = await Bun.file(join(path, p))
      .text()
      .catch(() => '');
    const binary = /\0/.test(current.slice(0, 8000));
    // stages exist only while the file is unmerged; afterwards HEAD vs the task branch tell the story
    const [base, ours, theirs] = conflicted.has(p) ? await Promise.all([stage(1), stage(2), stage(3)]) : await Promise.all([Promise.resolve(null), git(['show', `HEAD:${p}`], path).then((r) => (r.code === 0 ? r.stdout : null)), git(['show', `${task.branch}:${p}`], path).then((r) => (r.code === 0 ? r.stdout : null))]);
    files.push({ path: p, conflicted: conflicted.has(p), current: binary ? '' : current, ours: binary ? null : ours, theirs: binary ? null : theirs, base: binary ? null : base, binary });
  }
  return { taskId, path, branch: task.branch!, into: goal.branch, files, remaining: conflicted.size };
}

/** Write the human's version of one file and stage it (no markers allowed). */
export function resolveFile(engine: Engine, goalId: string, taskId: string, file: string, content: string): Promise<ResolveState> {
  return serial(goalId, taskId, async () => {
  mustStillResolve(engine, goalId, taskId);
  const path = resolveWorkspacePath(engine.config.dataDir, refOf(engine, goalId), taskId);
  if (!existsSync(path)) throw new Error('no manual resolution in progress');
  if (file.includes('..') || file.startsWith('/')) throw new Error('bad path');
  if (MARKER.test(content)) throw new Error('the file still contains conflict markers (<<<<<<< ======= >>>>>>>)');
  await Bun.write(join(path, file), content);
  await gitOk(['add', '--', file], path);
  return describeResolution(engine, goalId, taskId);
  });
}

/** Take one side of a conflicted file wholesale. `both` = ours followed by theirs (for append-style conflicts). */
export function takeSide(engine: Engine, goalId: string, taskId: string, file: string, side: 'ours' | 'theirs' | 'both'): Promise<ResolveState> {
  return serial(goalId, taskId, async () => {
  mustStillResolve(engine, goalId, taskId);
  const path = resolveWorkspacePath(engine.config.dataDir, refOf(engine, goalId), taskId);
  if (!existsSync(path)) throw new Error('no manual resolution in progress');
  if (file.includes('..') || file.startsWith('/')) throw new Error('bad path');
  if (side === 'both') {
    const [ours, theirs] = await Promise.all([git(['show', `:2:${file}`], path), git(['show', `:3:${file}`], path)]);
    const content = (ours.code === 0 ? ours.stdout : '') + (theirs.code === 0 ? theirs.stdout : '');
    await Bun.write(join(path, file), content);
  } else {
    const r = await git(['checkout', `--${side}`, '--', file], path);
    if (r.code !== 0) {
      // the side deleted the file: resolve by deleting
      await git(['rm', '-q', '--', file], path);
      return describeResolution(engine, goalId, taskId);
    }
  }
  await gitOk(['add', '--', file], path);
  return describeResolution(engine, goalId, taskId);
  });
}

/** Re-create the conflict for one file (undo the human's resolution of it). */
export function unresolveFile(engine: Engine, goalId: string, taskId: string, file: string): Promise<ResolveState> {
  return serial(goalId, taskId, async () => {
  mustStillResolve(engine, goalId, taskId);
  const path = resolveWorkspacePath(engine.config.dataDir, refOf(engine, goalId), taskId);
  if (!existsSync(path)) throw new Error('no manual resolution in progress');
  if (file.includes('..') || file.startsWith('/')) throw new Error('bad path');
  await gitOk(['checkout', '-m', '--', file], path);
  return describeResolution(engine, goalId, taskId);
  });
}

/**
 * Commit the resolution as the task's Conventional Commit, run the goal's must command checks, and land it on the
 * goal branch. With `force`, failing checks do not stop the landing (the goal review will judge the result).
 */
export function finishResolution(engine: Engine, goalId: string, taskId: string, opts: { force?: boolean } = {}): Promise<FinishResult> {
  return serial(goalId, taskId, () => finishUnlocked(engine, goalId, taskId, opts));
}

async function finishUnlocked(engine: Engine, goalId: string, taskId: string, opts: { force?: boolean }): Promise<FinishResult> {
  const { store, config } = engine;
  const { goal, task } = mustTask(engine, goalId, taskId);
  const path = resolveWorkspacePath(config.dataDir, refOf(engine, goalId), taskId);
  if (!existsSync(path)) throw new Error('no manual resolution in progress');
  // not after a skip, or a retry that runs the task again (it would mark the task done under a running attempt)
  const can = canResolve(engine, goalId, taskId);
  if (!can.ok) return { ok: false, ref: null, checks: [], reason: can.reason };
  const start = resolutionStart(engine, goalId, taskId);
  const startedAt = start?.base ?? null;
  if (await staleTip(goal, task, start?.tip ?? null)) return { ok: false, ref: null, checks: [], reason: 'the task changed since this resolution started (a retry ran it again) — start the resolution again' };
  // a worktree that holds nothing of the resolution: finishing would land nothing and drop the task's work
  if (!(await holdsWork(path, startedAt))) return { ok: false, ref: null, checks: [], reason: 'this resolution has no merge in progress — start the resolution again' };
  const message = `${taskCommitMessage(goal, task)}\n\nResolved manually by the human`;
  if (startedAt && !(await squashPending(path)) && (await headRef(path)) !== startedAt) {
    // only a commit made on top of where the resolution started is taken back: a worktree moved anywhere else would land
    // a tree that drops goal commits
    if ((await git(['merge-base', '--is-ancestor', startedAt, 'HEAD'], path)).code !== 0) return { ok: false, ref: null, checks: [], reason: "the resolution's worktree moved off the commit it started from — start the resolution again" };
    // a Finish cut short after its commit (a restart). Landed already (the goal branch carries it): what was left is the
    // bookkeeping and the exports. Not landed: the commit goes back into the index, so one commit carries the whole
    // resolution and it is landed, not read as "nothing staged"
    const landedBefore = await alreadyLanded(goalWorkspacePath(config.dataDir, refOf(engine, goalId)), startedAt, taskId);
    if (landedBefore) {
      store.append({ type: 'engine.note', goalId, payload: { level: 'info', message: `"${task.title}": its resolution had landed (${landedBefore.slice(0, 7)}) before the engine stopped; finishing what was left` } });
      return complete(engine, goal, task, path, { ref: landedBefore, resolved: await headRef(path), base: startedAt, message, landsCode: true, passed: true, checks: [] });
    }
    await gitOk(['reset', '--soft', startedAt], path);
  }
  const remaining = await conflictedFiles(path);
  if (remaining.length) return { ok: false, ref: null, checks: [], reason: `${remaining.length} file(s) still conflicted: ${remaining.slice(0, 5).join(', ')}` };
  // markers left in a file that was staged anyway
  for (const f of (await gitOk(['diff', '--cached', '--name-only'], path)).split('\n').filter(Boolean)) {
    const txt = await Bun.file(join(path, f))
      .text()
      .catch(() => '');
    if (MARKER.test(txt)) return { ok: false, ref: null, checks: [], reason: `${f} still contains conflict markers` };
  }
  // the tracked files the resolution changed (the squash merge staged the task's new files already); an untracked
  // leftover (a mergetool's *.orig, a check's output) is not part of the task's commit
  await gitOk(['add', '-u'], path);
  const existing = await git(['diff', '--cached', '--quiet'], path);
  let ref: string;
  if (existing.code === 0) {
    // nothing staged: the resolution produced no change against the goal branch
    ref = await headRef(path);
  } else {
    const c = await git([...(await gitIdent(path)), 'commit', '-q', '-m', withCoauthor(message)], path);
    if (c.code !== 0) return { ok: false, ref: null, checks: [], reason: `commit failed: ${c.stderr.slice(0, 300)}` };
    ref = await headRef(path);
  }

  const must = listChecks(store.db, goalId).filter((c) => c.spec.type === 'command' && c.tier === 'must');
  const checks: FinishResult['checks'] = [];
  // the checks see the exports as the goal has them now (other tasks may have landed since the start), with the task's
  // changes over them; the baseline measures the goal's own, so a regression the task's exports cause is not excused
  // a copy of the goal's exports as they are now (never a merge attempt's laid over them, nor one an unfinished undo left):
  // the resolution's checks get it, and its baseline measures it, so another task's merge meanwhile changes neither
  const snap = goalUsesArtifacts(engine, goal) ? resolveExportsPath(config.dataDir, refOf(engine, goalId), taskId) : null;
  if (snap) {
    await snapshotGoalExports(engine, goal, snap);
    await artifactsForChecks(engine, goal, snap, path, `resolution of "${task.title}"`);
  }
  if (task.worktreePath) await artifactsForChecks(engine, goal, task.worktreePath, path, `resolution of "${task.title}"`, { onlyChanged: true });
  // the resolve worktree started at `base`; checks already red there are not this resolution's fault
  const base = startedAt ?? (existing.code === 0 ? ref : (await git(['rev-parse', 'HEAD~1'], path)).stdout.trim());
  const baseline = await engine.baseline.failing(goal, base, snap ?? undefined);
  let passed = true;
  for (const c of must) {
    const r = await runCommandCheck(c as Check, { cwd: path, outputDir: join(config.dataDir, 'check-output'), attemptId: `manual-${taskId}` });
    store.append({ type: 'check.finished', goalId, payload: { result: r } });
    const preexisting = r.status !== 'pass' && baseline.has(c.id);
    checks.push({ name: c.name, status: r.status, summary: (preexisting ? '(already failing on the goal branch before this merge — not counted) ' : '') + r.summary.slice(0, 600) });
    if (r.status !== 'pass' && !preexisting) passed = false;
  }
  if (!passed && !opts.force) {
    // the resolution stays as it was before Finish (the commit taken back into the index), so finishing again or anyway
    // commits and lands it, instead of finding nothing staged and landing nothing
    if (existing.code !== 0) await gitOk(['reset', '--soft', base], path);
    return { ok: false, ref, checks, reason: 'must checks regressed in the resolved workspace — fix and finish again, or finish anyway' };
  }

  // land on the goal branch: fast-forward if it did not move, otherwise carry the squash commit over; the task's exports
  // land in the same step, so another task's integration never comes between the commit and them
  const kept = existing.code !== 0 ? await keptGoalSide(path, base, task.branch!, ref).catch(() => [] as string[]) : [];
  const landed = await engine.withGoalWsLock(goalId, async (): Promise<{ ok: boolean; ref: string | null; artifacts: Landing | null; error?: string; reason?: string }> => {
    const goalWs = goalWorkspacePath(config.dataDir, refOf(engine, goalId));
    // the task may have been skipped, or run again, while this Finish waited for the lock
    const still = canResolve(engine, goalId, taskId);
    if (!still.ok) return { ok: false, ref: null, artifacts: null, reason: still.reason ?? 'the task no longer waits on its merge' };
    if (await staleTip(goal, task, start?.tip ?? null)) return { ok: false, ref: null, artifacts: null, reason: 'the task changed since this resolution started (a retry ran it again) — start the resolution again' };
    // nothing lands on a commit another merge attempt could not take back
    const held = await stuckIn(engine, goal, [goalWs]);
    if (held) return { ok: false, ref: null, artifacts: null, reason: `the goal branch ends at an unverified resolution: ${held}` };
    if (existing.code === 0) return { ok: true, ref: await headRef(goalWs), artifacts: null };
    const withExports = async () => ({ ok: true, ref: await headRef(goalWs), artifacts: await landExports(engine, goal, task, kept) });
    const ff = await git(['merge', '--ff-only', ref], goalWs);
    if (ff.code === 0) return withExports();
    const cp = await git([...(await gitIdent(goalWs)), 'cherry-pick', '--allow-empty', ref], goalWs);
    if (cp.code === 0) return withExports();
    await abortInProgress(goalWs);
    return { ok: false, ref: null, artifacts: null, error: `the goal branch moved and the resolution no longer applies cleanly: ${cp.stderr.slice(0, 300)}` };
  });
  if (!landed.ok) return { ok: false, ref, checks, reason: landed.reason ?? `${landed.error} — start the resolution again from the current goal branch` };
  return complete(engine, goal, task, path, { ref: landed.ref!, resolved: ref, base, message, landsCode: existing.code !== 0, passed, checks, landing: landed.artifacts ? { artifacts: landed.artifacts, kept } : undefined });
}

/** the task's exports after its resolution landed: only those the goal lacks where the resolution kept the goal's side (`kept`) */
function landExports(engine: Engine, goal: Goal, task: Task, kept: string[]): Promise<Landing> {
  return landTaskArtifacts(engine, getGoal(engine.store.db, goal.id) ?? goal, task, { keepExisting: kept.length > 0 }).catch((err) => ({ files: [] as string[], failed: [String((err as Error)?.message ?? err)] }));
}

/** the commit on the goal branch since `since` that already carries this task's manual resolution, or null */
async function alreadyLanded(goalWs: string, since: string, taskId: string): Promise<string | null> {
  const r = await git(['log', '--format=%H', '--fixed-strings', '--all-match', `--grep=Task: ${taskId}`, '--grep=Resolved manually by the human', `${since}..HEAD`], goalWs);
  return r.code === 0 ? (r.stdout.split('\n').find(Boolean) ?? null) : null;
}

/** the files the task changed that the resolution left as the goal branch had them: it kept the goal's side there */
async function keptGoalSide(path: string, base: string, branch: string, resolved: string): Promise<string[]> {
  const names = async (args: string[]) => (await git(['diff', '--name-only', ...args], path)).stdout.split('\n').filter(Boolean);
  const resolvedChanged = new Set(await names([base, resolved]));
  return (await names([`${base}...${branch}`])).filter((f) => !resolvedChanged.has(f));
}

/**
 * Everything after the resolution landed: the task's exports, the events that close the merge and the task, and its
 * worktrees. The exports (git-excluded) follow the code that landed: none when the resolution kept the goal's side
 * throughout; when it kept the goal's side for some files the task changed, only the exports the goal does not have yet,
 * so the goal's stay consistent with the source it kept, said in a note. They come with the commit (`landing`), or here
 * for a resolution that had landed before the engine stopped. The task's worktree is kept when an export could not be
 * copied, so nothing is lost.
 */
async function complete(engine: Engine, goal: Goal, task: Task, path: string, r: { ref: string; resolved: string; base: string; message: string; landsCode: boolean; passed: boolean; checks: FinishResult['checks']; landing?: { artifacts: Landing; kept: string[] } }): Promise<FinishResult> {
  const { store } = engine;
  const goalId = goal.id;
  const taskId = task.id;
  let artifacts: Landing = { files: [], failed: [] };
  if (r.landsCode) {
    const kept = r.landing?.kept ?? (await keptGoalSide(path, r.base, task.branch!, r.resolved).catch(() => [] as string[]));
    artifacts = r.landing?.artifacts ?? (await engine.withGoalWsLock(goalId, () => landExports(engine, goal, task, kept)));
    if (kept.length) store.append({ type: 'engine.note', goalId, payload: { level: 'warn', message: `"${task.title}": the resolution kept the goal's version of ${kept.length} file(s) the task changed (${kept.slice(0, 3).join(', ')}): only the task's new exports were landed and the goal's existing ones kept; re-export where they depend on those files` } });
  }
  store.append({ type: 'merge.completed', goalId, payload: { taskId, ref: r.ref } });
  store.append({ type: 'task.committed', goalId, payload: { taskId, ref: r.landsCode ? r.ref : null, message: r.message } });
  store.append({ type: 'merge.manual_finished', goalId, payload: { taskId, ref: r.ref, checksPassed: r.passed, forced: !r.passed } });
  const esc = mergeEscalation(engine, goalId, taskId);
  if (esc) store.append({ type: 'escalation.answered', goalId, payload: { escalationId: esc.id, answer: { action: 'resolve_manually' } } });
  const fresh = getTask(store.db, taskId)!;
  store.append({ type: 'task.state_changed', goalId, payload: { taskId, from: fresh.state, to: 'done', reason: `resolved manually, committed ${r.ref.slice(0, 7)}` } });
  await removeWorktree(goal.repoPath, path).catch(() => {});
  await rm(resolveExportsPath(engine.config.dataDir, refOf(engine, goalId), taskId), { recursive: true, force: true }).catch(() => {});
  if (artifacts.failed.length) {
    store.append({ type: 'engine.note', goalId, payload: { level: 'warn', message: `"${task.title}": ${artifacts.failed.length} artifact(s) could not be copied to the goal workspace (${artifacts.failed.slice(0, 3).join(', ')}); its worktree is kept so they are not lost` } });
  } else {
    await dropTaskWorkspace(goal, fresh).catch(() => {});
    if (fresh.worktreePath) store.append({ type: 'task.workspace_assigned', goalId, payload: { taskId, branch: null, worktreePath: null } });
  }
  const g = getGoal(store.db, goalId)!;
  if (g.state === 'blocked' && !listEscalations(store.db, { goalId, openOnly: true }).length) store.append({ type: 'goal.state_changed', goalId, payload: { from: 'blocked', to: 'running', reason: 'merge resolved manually' } });
  engine.tick(goalId);
  return { ok: true, ref: r.ref, checks: r.checks, reason: null };
}

/** Drop the `_resolve` worktree; the task stays blocked on its escalation. */
export function abortResolution(engine: Engine, goalId: string, taskId: string, reason = 'aborted by the human'): Promise<void> {
  return serial(goalId, taskId, async () => {
    const { goal } = mustTask(engine, goalId, taskId);
    const path = resolveWorkspacePath(engine.config.dataDir, refOf(engine, goalId), taskId);
    if (!existsSync(path)) return;
    await abortInProgress(path).catch(() => {});
    await removeWorktree(goal.repoPath, path).catch(() => {});
    await rm(resolveExportsPath(engine.config.dataDir, refOf(engine, goalId), taskId), { recursive: true, force: true }).catch(() => {});
    engine.store.append({ type: 'merge.manual_aborted', goalId, payload: { taskId, reason } });
  });
}

export { getEscalation };
