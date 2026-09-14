import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { listGoals, listTasks } from '@foundry/core';
import type { Engine } from './engine.ts';
import { git } from './git/git.ts';
import { baselineWorkspacePath, defaultWorkspaceDir, deliveryWorkspacePath, goalWorkspacePath, legacyWorkspaceRoot, resolveWorkspacePath, taskWorkspacePath } from './workspace.ts';

const TERMINAL = ['done', 'over_delivered', 'failed', 'cancelled'];

/**
 * Goals created before progress folders keep their worktrees under `<dataDir>/worktrees/<id>`. At start-up — no session
 * runs yet — every goal still in flight is moved next to its repository with `git worktree move`, so the person finds the
 * work where they expect it. Scratch worktrees (delivery, baseline) are dropped and rebuilt on demand. A goal whose move
 * fails stays where it is with a note; nothing blocks. Finished goals are left alone.
 */
export async function relocateLegacyWorkspaces(engine: Engine): Promise<number> {
  const { store, config } = engine;
  let moved = 0;
  for (const goal of listGoals(store.db)) {
    if (goal.workspaceDir || TERMINAL.includes(goal.state)) continue;
    const target = defaultWorkspaceDir(config.workspacesRoot, goal);
    const legacy = { id: goal.id, workspaceDir: null };
    const next = { id: goal.id, workspaceDir: target };
    try {
      const oldGoalWs = goalWorkspacePath(config.dataDir, legacy);
      if (existsSync(oldGoalWs)) {
        for (const scratch of [deliveryWorkspacePath(config.dataDir, legacy), baselineWorkspacePath(config.dataDir, legacy)]) {
          if (existsSync(scratch)) await git(['worktree', 'remove', '--force', scratch], goal.repoPath);
        }
        mkdirSync(dirname(target), { recursive: true });
        await move(goal.repoPath, oldGoalWs, target);
        for (const t of listTasks(store.db, goal.id)) {
          if (t.worktreePath && existsSync(t.worktreePath)) {
            const dest = taskWorkspacePath(config.dataDir, next, t.id);
            mkdirSync(dirname(dest), { recursive: true });
            await move(goal.repoPath, t.worktreePath, dest);
            store.append({ type: 'task.workspace_assigned', goalId: goal.id, payload: { taskId: t.id, branch: t.branch, worktreePath: dest } });
          }
          const oldResolve = resolveWorkspacePath(config.dataDir, legacy, t.id);
          if (existsSync(oldResolve)) {
            const dest = resolveWorkspacePath(config.dataDir, next, t.id);
            mkdirSync(dirname(dest), { recursive: true });
            await move(goal.repoPath, oldResolve, dest);
          }
        }
        await git(['worktree', 'prune'], goal.repoPath);
        rmSync(legacyWorkspaceRoot(config.dataDir, goal.id), { recursive: true, force: true });
      }
      store.append({ type: 'goal.workspace_set', goalId: goal.id, payload: { dir: target, reason: 'migrated' } });
      moved++;
      config.log(`[workspace] ${goal.id}: progress folder → ${target}`);
    } catch (err) {
      store.append({ type: 'engine.note', goalId: goal.id, payload: { level: 'warn', message: `could not move the workspace to ${target}: ${String((err as Error).message ?? err).slice(0, 300)} — it stays under ${legacyWorkspaceRoot(config.dataDir, goal.id)}` } });
    }
  }
  return moved;
}

async function move(repo: string, from: string, to: string): Promise<void> {
  const r = await git(['worktree', 'move', from, to], repo);
  if (r.code !== 0) throw new Error(r.stderr.trim() || `git worktree move exited ${r.code}`);
}
