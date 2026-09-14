import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { IDLE_DELIVERY, getGoal, getTask, type Goal, type Task } from '@foundry/core';
import type { ClaudeRunner } from '@foundry/runner';
import { defaultConfig } from './config.ts';
import { Engine } from './engine.ts';
import { ensureWorktree } from './git/git.ts';
import { relocateLegacyWorkspaces } from './workspace-migrate.ts';
import { defaultWorkspaceDir, goalWorkspacePath, legacyWorkspaceRoot, resolveWorkspacePath, taskWorkspacePath } from './workspace.ts';

const ROOT = resolve(import.meta.dir, '../../..');
/** no session ever runs here: the engine is never started */
const noRunner = { active: () => 0, run: async () => { throw new Error('no sessions in this test'); } } as unknown as ClaudeRunner;

let dataDir: string;
let repo: string;
beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'foundry-migrate-data-'));
  repo = mkdtempSync(join(tmpdir(), 'foundry-migrate-repo-'));
  writeFileSync(join(repo, 'README.md'), 'fixture\n');
  await Bun.$`git -C ${repo} init -q -b main && git -C ${repo} -c user.name=t -c user.email=t@t add -A && git -C ${repo} -c user.name=t -c user.email=t@t commit -q -m init`.quiet();
});
afterEach(() => {
  for (const d of [dataDir, repo, `${repo}-foundry`]) rmSync(d, { recursive: true, force: true });
});

const legacyGoal = (id: string, state: Goal['state']): Goal => {
  const now = new Date().toISOString();
  return {
    id, title: '把按钮改成蓝色，其它不动', prompt: 'p', workspaceDir: null, checkpoint: null, selfCheck: false, repoPath: repo, baseBranch: 'main', branch: `goal/${id}`,
    budgets: { maxCostUsd: 5, maxDurationMin: 120, maxConcurrent: 3, attemptsPerTask: 3 }, budgetPreset: 'custom', mode: 'expert', workflow: { tdd: 'off', pace: 'thorough' },
    models: { strong: 'opus', cheap: 'haiku', worker: 'opus' }, state, stateBeforeBlock: null, costUsd: 0, fixCycles: 0, delivery: IDLE_DELIVERY, attachments: [], baseSync: null, autoskills: null,
    completion: { graphRefresh: false, docs: [], docsRun: null, graphRun: null, artifactsRun: null }, nature: 'auto', outputDir: null, runningSince: null, createdAt: now, updatedAt: now,
  };
};
const legacyTask = (id: string, goalId: string): Task => {
  const now = new Date().toISOString();
  return { id, goalId, title: 't', spec: 's', kind: 'feature', scope: null, scenario: 'general', area: null, tdd: 'inherit', dependsOn: [], relevantFiles: [], parallelizable: false, retryBudget: 3, origin: 'brief', milestone: null, milestoneVisits: 0, checkpointOf: null, state: 'running', branch: null, worktreePath: null, baseRef: null, commitRef: null, commitMessage: null, hint: null, extraAttempts: 0, createdAt: now, updatedAt: now };
};

describe('relocateLegacyWorkspaces', () => {
  test('moves a running goal, its live task worktree and a resolve worktree next to the repo; leaves finished goals; runs once', async () => {
    const engine = new Engine(defaultConfig(ROOT, { dataDir, claudeHome: join(dataDir, 'claude-home'), log: () => {} }), noRunner);
    const { store } = engine;
    const g = legacyGoal('g_migrate01', 'running');
    store.append({ type: 'goal.created', goalId: g.id, payload: { goal: g } });
    const done = legacyGoal('g_finished1', 'done');
    store.append({ type: 'goal.created', goalId: done.id, payload: { goal: done } });
    const legacy = { id: g.id, workspaceDir: null };
    const goalWs = goalWorkspacePath(dataDir, legacy);
    await ensureWorktree(repo, goalWs, g.branch, 'main');
    writeFileSync(join(goalWs, 'untracked.txt'), 'travels with the folder');
    const t = legacyTask('t_migrate01', g.id);
    store.append({ type: 'task.created', goalId: g.id, payload: { task: t } });
    const taskWs = taskWorkspacePath(dataDir, legacy, t.id);
    await ensureWorktree(repo, taskWs, `task/${t.id}`, g.branch);
    store.append({ type: 'task.workspace_assigned', goalId: g.id, payload: { taskId: t.id, branch: `task/${t.id}`, worktreePath: taskWs } });
    const resolveWs = resolveWorkspacePath(dataDir, legacy, t.id);
    await ensureWorktree(repo, resolveWs, `resolve/${t.id}`, g.branch);

    expect(await relocateLegacyWorkspaces(engine)).toBe(1);

    const target = defaultWorkspaceDir(null, g);
    const moved = getGoal(store.db, g.id)!;
    expect(moved.workspaceDir).toBe(target);
    expect(target.startsWith(`${repo}-foundry/`)).toBe(true);
    expect(existsSync(join(target, 'untracked.txt'))).toBe(true);
    expect(getTask(store.db, t.id)!.worktreePath).toBe(taskWorkspacePath(dataDir, moved, t.id));
    expect(existsSync(taskWorkspacePath(dataDir, moved, t.id))).toBe(true);
    expect(existsSync(resolveWorkspacePath(dataDir, moved, t.id))).toBe(true);
    expect(existsSync(legacyWorkspaceRoot(dataDir, g.id))).toBe(false);
    // git agrees: the worktrees are registered at their new paths
    const list = (await Bun.$`git -C ${repo} worktree list --porcelain`.text()).split('\n');
    expect(list).toContain(`worktree ${realpathSync(target)}`);
    expect(list).toContain(`worktree ${realpathSync(taskWorkspacePath(dataDir, moved, t.id))}`);
    // finished goals keep the legacy layout; a second run has nothing to do
    expect(getGoal(store.db, done.id)!.workspaceDir).toBeNull();
    expect(await relocateLegacyWorkspaces(engine)).toBe(0);
    expect(store.listByGoal(g.id).filter((e) => e.type === 'goal.workspace_set')).toHaveLength(1);
    await engine.stop();
  });

  test('a goal whose worktree does not exist yet only gets its folder recorded', async () => {
    const engine = new Engine(defaultConfig(ROOT, { dataDir, claudeHome: join(dataDir, 'claude-home'), log: () => {} }), noRunner);
    const g = legacyGoal('g_migrate02', 'clarifying');
    engine.store.append({ type: 'goal.created', goalId: g.id, payload: { goal: g } });
    expect(await relocateLegacyWorkspaces(engine)).toBe(1);
    const target = defaultWorkspaceDir(null, g);
    expect(getGoal(engine.store.db, g.id)!.workspaceDir).toBe(target);
    expect(existsSync(target)).toBe(false);
    await engine.stop();
  });
});
