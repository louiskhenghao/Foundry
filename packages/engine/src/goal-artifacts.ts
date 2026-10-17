import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ARTIFACT_NATURES, ARTIFACT_SCENARIOS, listAttempts, listTasks, type Goal, type Task } from '@foundry/core';
import type { Engine } from './engine.ts';
import { ARTIFACTS_DIR, copyArtifactFiles, copyUntrackedArtifacts, goalWorkspacePath, listArtifacts, trackedArtifacts } from './workspace.ts';

/** what a landing brought into the goal workspace, and what it could not copy */
export interface Landing {
  files: string[];
  failed: string[];
}

/**
 * Bring a landed task's artifacts into the goal workspace: they are git-excluded, so its commit cannot carry them. What
 * the task inherited and left as it was stays the goal's (copyArtifacts), and what git tracks came through the commit,
 * so a copy never puts the task's version over a merged one. A file that cannot be copied is reported and the others
 * still go: the caller keeps the task's worktree then, so nothing is lost. A task that worked in the goal workspace
 * wrote its files there itself: they are the ones changed since its first attempt started, less what other tasks'
 * landings brought meanwhile. The files are recorded as `task.artifacts_landed`, which is how a milestone of files
 * tells the task's own files from the goal's others; a task whose deliverables are files records an empty landing too,
 * so "it made nothing" is not mistaken for "not recorded".
 */
export async function landTaskArtifacts(engine: Engine, goal: Goal, task: Task): Promise<Landing> {
  const goalWs = goalWorkspacePath(engine.config.dataDir, goal);
  const failed: string[] = [];
  let files: string[];
  if (task.worktreePath && task.worktreePath !== goalWs) {
    if (!existsSync(task.worktreePath)) return { files: [], failed };
    const [mine, theirs] = await Promise.all([trackedArtifacts(task.worktreePath), trackedArtifacts(goalWs)]);
    files = copyArtifactFiles(task.worktreePath, goalWs, { skip: new Set([...mine, ...theirs]), onError: (f) => failed.push(f) });
    if (files.length) engine.config.log(`[artifacts] ${task.id}: ${files.length} file(s) copied to the goal workspace`);
  } else if (ARTIFACT_SCENARIOS.includes(task.scenario)) {
    files = changedInGoalWorkspace(engine, goal, task, goalWs);
  } else {
    return { files: [], failed };
  }
  if (files.length || failed.length || ARTIFACT_SCENARIOS.includes(task.scenario)) engine.store.append({ type: 'task.artifacts_landed', goalId: goal.id, payload: { taskId: task.id, files } });
  return { files, failed };
}

/** the artifacts a task that worked in the goal workspace changed there: since its first attempt started, less other tasks' landings meanwhile */
function changedInGoalWorkspace(engine: Engine, goal: Goal, task: Task, goalWs: string): string[] {
  const since = Math.min(...listAttempts(engine.store.db, task.id).map((a) => Date.parse(a.startedAt)).filter((n) => !Number.isNaN(n)), Number.POSITIVE_INFINITY);
  if (!Number.isFinite(since)) return [];
  const others = new Set(
    engine.store
      .listByGoalOfTypes(goal.id, ['task.artifacts_landed'])
      .filter((e) => (e.payload as { taskId: string }).taskId !== task.id && Date.parse(e.ts) >= since)
      .flatMap((e) => (e.payload as { files: string[] }).files),
  );
  return listArtifacts(goalWs).filter((f) => {
    if (f.startsWith('samples/') || others.has(f)) return false;
    try {
      return statSync(join(goalWs, ARTIFACTS_DIR, f)).mtimeMs >= since;
    } catch {
      return false;
    }
  });
}

/**
 * The files a task's landings brought into the goal workspace (relative to artifacts/). Null when none was recorded: a
 * goal from before landings were, or a task that worked in the goal workspace itself.
 */
export function landedArtifacts(engine: Engine, goalId: string, taskId: string): Set<string> | null {
  const landings = engine.store.listByGoalOfTypes(goalId, ['task.artifacts_landed']).filter((e) => (e.payload as { taskId: string }).taskId === taskId);
  return landings.length ? new Set(landings.flatMap((e) => (e.payload as { files: string[] }).files)) : null;
}

/** whether Foundry keeps artifacts/ for this goal: a goal judged by its files, or one with a task whose deliverables are files */
export function goalUsesArtifacts(engine: Engine, goal: Goal): boolean {
  return ARTIFACT_NATURES.includes(goal.nature) || listTasks(engine.store.db, goal.id).some((t) => ARTIFACT_SCENARIOS.includes(t.scenario));
}

/**
 * Give a worktree that runs the goal's checks the artifacts of another (the goal workspace, a task's worktree), which
 * git never carries: only for a goal that keeps artifacts, and never over a file git tracks. A copy that fails is noted
 * and the checks run without it, except where `strict` says a missing export would make the result wrong (a baseline).
 */
export async function artifactsForChecks(engine: Engine, goal: Goal, fromWs: string, toWs: string, where: string, opts: { onlyChanged?: boolean; strict?: boolean } = {}): Promise<void> {
  if (!existsSync(fromWs) || !goalUsesArtifacts(engine, goal)) return;
  try {
    await copyUntrackedArtifacts(fromWs, toWs, opts);
  } catch (err) {
    // a baseline without the exports would excuse a real regression as "already failing": it fails instead
    if (opts.strict) throw err;
    engine.store.append({ type: 'engine.note', goalId: goal.id, payload: { level: 'warn', message: `${where}: the artifacts could not be copied (${String((err as Error)?.message ?? err)}); a check that measures an export may fail there` } });
  }
}
