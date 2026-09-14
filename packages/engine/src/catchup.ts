import type { Goal, Task } from '@foundry/core';
import type { Engine } from './engine.ts';
import { commitAll, conflictedFiles, git, headRef } from './git/git.ts';
import { taskCommitMessage } from './git/conventional.ts';
import { mergeBranchInto } from './merge.ts';
import { goalWorkspacePath } from './workspace.ts';

export interface CatchUp {
  /** the goal branch has commits the task branch does not have */
  moved: boolean;
  /** those commits are now merged into the task worktree (cleanly or through a Merge Attempt) */
  merged: boolean;
  /** subjects of the goal-branch commits the task was missing */
  commits: string[];
  /** files that conflicted and could not be resolved automatically */
  conflictFiles: string[];
}

const NONE: CatchUp = { moved: false, merged: true, commits: [], conflictFiles: [] };

/**
 * Catch-up: bring the goal branch into a task's own worktree *before* the task is worked on or integrated.
 *
 * Parallel tasks start from the goal branch as it was; by the time one finishes, others have landed. Merging the
 * goal branch into the task branch first means (a) a retry builds on the current code instead of a stale base,
 * and (b) the final squash into the goal branch cannot conflict — any conflict is met here, inside the task's
 * worktree, where the Merge Attempt has the task's own context. With `escalate: false` an unresolved conflict
 * is reported back (the worker is told to merge by hand) instead of blocking the task.
 */
export async function catchUp(engine: Engine, goal: Goal, task: Task, opts: { escalate: boolean }): Promise<CatchUp> {
  if (!task.worktreePath || !task.branch) return NONE;
  // a merge the worker (or an orphaned attempt) left open: never reset it — conclude it if it is clean, else hand it back
  const open = await git(['rev-parse', '-q', '--verify', 'MERGE_HEAD'], task.worktreePath);
  if (open.code === 0) {
    const files = await conflictedFiles(task.worktreePath);
    if (files.length) {
      engine.store.append({ type: 'engine.note', goalId: goal.id, payload: { level: 'warn', message: `catch-up: ${task.branch} has an unfinished merge with conflicts in ${files.slice(0, 4).join(', ')}; leaving it for the worker` } });
      return { moved: true, merged: false, commits: [], conflictFiles: files };
    }
    await git(['-c', 'user.name=foundry', '-c', 'user.email=foundry@local', 'commit', '-q', '--no-edit'], task.worktreePath);
  }
  // uncommitted work of an interrupted attempt becomes a snapshot commit first, so nothing below can discard it
  await commitAll(task.worktreePath, taskCommitMessage(goal, task, { attempt: 0 })).catch(() => {});
  const goalWs = goalWorkspacePath(engine.config.dataDir, goal);
  const goalHead = await headRef(goalWs).catch(() => null);
  const taskHead = await headRef(task.worktreePath).catch(() => null);
  if (!goalHead || !taskHead) return NONE;
  const ancestor = await git(['merge-base', '--is-ancestor', goalHead, taskHead], task.worktreePath);
  if (ancestor.code === 0) return NONE;
  const log = await git(['log', '--no-merges', '--format=%s', `${taskHead}..${goalHead}`], task.worktreePath);
  const commits = log.stdout.split('\n').filter(Boolean);
  const intent = `Other tasks of this goal landed on the goal branch while this task was in progress:\n${commits.map((c) => `- ${c}`).join('\n') || '- (merge commits only)'}\nThe task branch (${task.branch}) is being brought up to date; its own work — "${task.title}" — must survive on top of them.`;
  const merged = await mergeBranchInto(engine, goal, task, { ref: goalHead, label: goal.branch, intent }, { cwd: task.worktreePath, into: task.branch, escalate: opts.escalate });
  if (merged) {
    engine.store.append({ type: 'engine.note', goalId: goal.id, payload: { level: 'info', message: `catch-up: merged ${commits.length} goal-branch commit(s) into ${task.branch} before ${task.title}` } });
    return { moved: true, merged: true, commits, conflictFiles: [] };
  }
  const conflict = [...engine.store.listByGoal(goal.id, 2000)].reverse().find((e) => e.type === 'merge.conflict' && (e.payload as { taskId: string }).taskId === task.id);
  return { moved: true, merged: false, commits, conflictFiles: (conflict?.payload as { files?: string[] } | undefined)?.files ?? [] };
}

/** Do two tasks declare overlapping files (exact path, or one inside the other's directory)? */
export function filesOverlap(a: string[], b: string[]): string[] {
  const norm = (p: string) => p.replace(/^\.\//, '').replace(/\/+$/, '');
  const hits: string[] = [];
  for (const x of a.map(norm)) {
    for (const y of b.map(norm)) {
      if (x === y || x.startsWith(`${y}/`) || y.startsWith(`${x}/`)) hits.push(x.length >= y.length ? x : y);
    }
  }
  return [...new Set(hits)];
}
