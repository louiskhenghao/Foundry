import { existsSync } from 'node:fs';
import { ARTIFACT_SCENARIOS, type Goal, type Task } from '@foundry/core';
import type { Engine } from './engine.ts';
import { copyArtifactFiles, goalWorkspacePath } from './workspace.ts';

/**
 * Bring a landed task's artifacts into the goal workspace: they are git-excluded, so its commit cannot carry them. What
 * the task inherited and left as it was stays the goal's (copyArtifacts). The files that came are recorded as
 * `task.artifacts_landed`, which is how a milestone of files tells the task's own files from the goal's others; a task
 * whose deliverables are files records an empty landing too, so "it made nothing" is not mistaken for "not recorded".
 */
export function landTaskArtifacts(engine: Engine, goal: Goal, task: Task): string[] {
  if (!task.worktreePath || !existsSync(task.worktreePath)) return [];
  const files = copyArtifactFiles(task.worktreePath, goalWorkspacePath(engine.config.dataDir, goal));
  if (files.length || ARTIFACT_SCENARIOS.includes(task.scenario)) engine.store.append({ type: 'task.artifacts_landed', goalId: goal.id, payload: { taskId: task.id, files } });
  if (files.length) engine.config.log(`[artifacts] ${task.id}: ${files.length} file(s) copied to the goal workspace`);
  return files;
}

/**
 * The files a task's landings brought into the goal workspace (relative to artifacts/). Null when none was recorded: a
 * goal from before landings were, or a task that worked in the goal workspace itself.
 */
export function landedArtifacts(engine: Engine, goalId: string, taskId: string): Set<string> | null {
  const landings = engine.store.listByGoalOfTypes(goalId, ['task.artifacts_landed']).filter((e) => (e.payload as { taskId: string }).taskId === taskId);
  return landings.length ? new Set(landings.flatMap((e) => (e.payload as { files: string[] }).files)) : null;
}
