import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Check, CheckResult, Goal, Task } from '@foundry/core';
import { getEscalation, getGoal, getTask, listChecks, listEscalations } from '@foundry/core';
import { runCommandCheck } from './checks/command.ts';
import type { Engine } from './engine.ts';
import { taskCommitMessage } from './git/conventional.ts';
import { abortInProgress, conflictedFiles, ensureDetachedWorktree, git, gitIdent, gitOk, headRef, removeWorktree, withCoauthor } from './git/git.ts';
import { dropTaskWorkspace, goalWorkspacePath, resolveWorkspacePath } from './workspace.ts';

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
  if (!task.branch) return { ok: false, reason: 'this task worked directly on the goal branch; there is nothing to merge' };
  if (task.state !== 'blocked') return { ok: false, reason: `task is ${task.state}; manual resolution is offered once the automatic merge attempts gave up` };
  if (!mergeEscalation(engine, goalId, taskId)) return { ok: false, reason: 'the task is blocked for another reason than a merge conflict' };
  return { ok: true, reason: null };
}

/** (Re)create the conflict in the `_resolve` worktree and describe it. Idempotent: an existing session is kept. */
export async function startResolution(engine: Engine, goalId: string, taskId: string, opts: { fresh?: boolean } = {}): Promise<ResolveState> {
  const { goal, task } = mustTask(engine, goalId, taskId);
  const can = canResolve(engine, goalId, taskId);
  if (!can.ok) throw new Error(can.reason!);
  const path = resolveWorkspacePath(engine.config.dataDir, refOf(engine, goalId), taskId);
  const goalWs = goalWorkspacePath(engine.config.dataDir, refOf(engine, goalId));
  const inProgress = existsSync(path) && (await git(['rev-parse', '--git-dir'], path)).code === 0;
  if (!inProgress || opts.fresh) {
    const head = await headRef(goalWs);
    await ensureDetachedWorktree(goal.repoPath, path, head);
    const r = await git(['merge', '--squash', '--no-commit', task.branch!], path);
    const files = await conflictedFiles(path);
    if (r.code === 0 || !files.length) {
      // the conflict is gone (the goal branch moved on): nothing to resolve by hand, let the engine integrate again
      await abortInProgress(path).catch(() => {});
      await removeWorktree(goal.repoPath, path).catch(() => {});
      throw new Error(r.code === 0 ? 'the merge no longer conflicts — use "Retry with hint" (no hint needed) and the engine will integrate it' : `squash merge failed without conflicts: ${r.stderr.slice(0, 300)}`);
    }
    engine.store.append({ type: 'merge.manual_started', goalId, payload: { taskId, files, path } });
  }
  return describeResolution(engine, goalId, taskId);
}

export async function describeResolution(engine: Engine, goalId: string, taskId: string): Promise<ResolveState> {
  const { goal, task } = mustTask(engine, goalId, taskId);
  const path = resolveWorkspacePath(engine.config.dataDir, refOf(engine, goalId), taskId);
  if (!existsSync(path)) throw new Error('no manual resolution in progress for this task');
  const started = engine.store.listByGoal(goalId, 5000).filter((e) => e.type === 'merge.manual_started' && (e.payload as { taskId: string }).taskId === taskId).at(-1);
  const all = new Set<string>((started?.payload as { files?: string[] } | undefined)?.files ?? []);
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
export async function resolveFile(engine: Engine, goalId: string, taskId: string, file: string, content: string): Promise<ResolveState> {
  const path = resolveWorkspacePath(engine.config.dataDir, refOf(engine, goalId), taskId);
  if (!existsSync(path)) throw new Error('no manual resolution in progress');
  if (file.includes('..') || file.startsWith('/')) throw new Error('bad path');
  if (MARKER.test(content)) throw new Error('the file still contains conflict markers (<<<<<<< ======= >>>>>>>)');
  await Bun.write(join(path, file), content);
  await gitOk(['add', '--', file], path);
  return describeResolution(engine, goalId, taskId);
}

/** Take one side of a conflicted file wholesale. `both` = ours followed by theirs (for append-style conflicts). */
export async function takeSide(engine: Engine, goalId: string, taskId: string, file: string, side: 'ours' | 'theirs' | 'both'): Promise<ResolveState> {
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
}

/** Re-create the conflict for one file (undo the human's resolution of it). */
export async function unresolveFile(engine: Engine, goalId: string, taskId: string, file: string): Promise<ResolveState> {
  const path = resolveWorkspacePath(engine.config.dataDir, refOf(engine, goalId), taskId);
  if (!existsSync(path)) throw new Error('no manual resolution in progress');
  if (file.includes('..') || file.startsWith('/')) throw new Error('bad path');
  await gitOk(['checkout', '-m', '--', file], path);
  return describeResolution(engine, goalId, taskId);
}

/**
 * Commit the resolution as the task's Conventional Commit, run the goal's must command checks, and land it on the
 * goal branch. With `force`, failing checks do not stop the landing (the goal review will judge the result).
 */
export async function finishResolution(engine: Engine, goalId: string, taskId: string, opts: { force?: boolean } = {}): Promise<FinishResult> {
  const { store, config } = engine;
  const { goal, task } = mustTask(engine, goalId, taskId);
  const path = resolveWorkspacePath(config.dataDir, refOf(engine, goalId), taskId);
  if (!existsSync(path)) throw new Error('no manual resolution in progress');
  const remaining = await conflictedFiles(path);
  if (remaining.length) return { ok: false, ref: null, checks: [], reason: `${remaining.length} file(s) still conflicted: ${remaining.slice(0, 5).join(', ')}` };
  // markers left in a file that was staged anyway
  for (const f of (await gitOk(['diff', '--cached', '--name-only'], path)).split('\n').filter(Boolean)) {
    const txt = await Bun.file(join(path, f))
      .text()
      .catch(() => '');
    if (MARKER.test(txt)) return { ok: false, ref: null, checks: [], reason: `${f} still contains conflict markers` };
  }
  await gitOk(['add', '-A'], path);
  const message = `${taskCommitMessage(goal, task)}\n\nResolved manually by the human`;
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
  // the resolve worktree started at `base`; checks already red there are not this resolution's fault
  const base = (await git(['rev-parse', 'HEAD~0'], path)).stdout.trim();
  const baseline = await engine.baseline.failing(goal, existing.code === 0 ? base : (await git(['rev-parse', 'HEAD~1'], path)).stdout.trim());
  let passed = true;
  for (const c of must) {
    const r = await runCommandCheck(c as Check, { cwd: path, outputDir: join(config.dataDir, 'check-output'), attemptId: `manual-${taskId}` });
    store.append({ type: 'check.finished', goalId, payload: { result: r } });
    const preexisting = r.status !== 'pass' && baseline.has(c.id);
    checks.push({ name: c.name, status: r.status, summary: (preexisting ? '(already failing on the goal branch before this merge — not counted) ' : '') + r.summary.slice(0, 600) });
    if (r.status !== 'pass' && !preexisting) passed = false;
  }
  if (!passed && !opts.force) return { ok: false, ref, checks, reason: 'must checks regressed in the resolved workspace — fix and finish again, or finish anyway' };

  // land on the goal branch: fast-forward if it did not move, otherwise carry the squash commit over
  const landed = await engine.withGoalWsLock(goalId, async () => {
    const goalWs = goalWorkspacePath(config.dataDir, refOf(engine, goalId));
    if (existing.code === 0) return { ok: true, ref: await headRef(goalWs) };
    const ff = await git(['merge', '--ff-only', ref], goalWs);
    if (ff.code === 0) return { ok: true, ref: await headRef(goalWs) };
    const cp = await git([...(await gitIdent(goalWs)), 'cherry-pick', '--allow-empty', ref], goalWs);
    if (cp.code === 0) return { ok: true, ref: await headRef(goalWs) };
    await abortInProgress(goalWs);
    return { ok: false, ref: null, error: `the goal branch moved and the resolution no longer applies cleanly: ${cp.stderr.slice(0, 300)}` };
  });
  if (!landed.ok) return { ok: false, ref, checks, reason: `${landed.error} — start the resolution again from the current goal branch` };

  store.append({ type: 'merge.completed', goalId, payload: { taskId, ref: landed.ref! } });
  store.append({ type: 'task.committed', goalId, payload: { taskId, ref: existing.code === 0 ? null : landed.ref!, message } });
  store.append({ type: 'merge.manual_finished', goalId, payload: { taskId, ref: landed.ref!, checksPassed: passed, forced: !passed } });
  const esc = mergeEscalation(engine, goalId, taskId);
  if (esc) store.append({ type: 'escalation.answered', goalId, payload: { escalationId: esc.id, answer: { action: 'resolve_manually' } } });
  const fresh = getTask(store.db, taskId)!;
  store.append({ type: 'task.state_changed', goalId, payload: { taskId, from: fresh.state, to: 'done', reason: `resolved manually, committed ${landed.ref!.slice(0, 7)}` } });
  await removeWorktree(goal.repoPath, path).catch(() => {});
  await dropTaskWorkspace(goal, fresh).catch(() => {});
  if (fresh.worktreePath) store.append({ type: 'task.workspace_assigned', goalId, payload: { taskId, branch: null, worktreePath: null } });
  const g = getGoal(store.db, goalId)!;
  if (g.state === 'blocked' && !listEscalations(store.db, { goalId, openOnly: true }).length) store.append({ type: 'goal.state_changed', goalId, payload: { from: 'blocked', to: 'running', reason: 'merge resolved manually' } });
  engine.tick(goalId);
  return { ok: true, ref: landed.ref!, checks, reason: null };
}

/** Drop the `_resolve` worktree; the task stays blocked on its escalation. */
export async function abortResolution(engine: Engine, goalId: string, taskId: string, reason = 'aborted by the human'): Promise<void> {
  const { goal } = mustTask(engine, goalId, taskId);
  const path = resolveWorkspacePath(engine.config.dataDir, refOf(engine, goalId), taskId);
  if (!existsSync(path)) return;
  await abortInProgress(path).catch(() => {});
  await removeWorktree(goal.repoPath, path).catch(() => {});
  engine.store.append({ type: 'merge.manual_aborted', goalId, payload: { taskId, reason } });
}

export { getEscalation };
