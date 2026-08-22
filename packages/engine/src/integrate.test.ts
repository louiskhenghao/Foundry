import { beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { getGoal, listTasks } from '@ai-engine/core';
import { defaultConfig } from './config.ts';
import { Engine } from './engine.ts';
import { FakeRunner, makeRepo, sh, terminal, waitFor } from './test-helpers.ts';

const ROOT = resolve(import.meta.dir, '../../..');
let dataDir: string;
let repo: string;
beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'ai-engine-integrate-'));
  repo = await makeRepo();
});
const cfg = () => defaultConfig(ROOT, { dataDir, claudeHome: join(dataDir, 'claude-home'), alwaysReviewTasks: false, log: () => {} });
const t = (key: string, title: string, deps: string[], parallel: boolean, kind: 'feature' | 'bug' = 'feature', scope: string | null = null) => ({ key, title, spec: `write ${title}.txt`, kind, scope, scenario: 'general' as const, areaKey: null, dependsOnKeys: deps, parallelizable: parallel, relevantFiles: [] });
const c = (key: string, taskKey: string | null, cmd: string) => ({ key, name: key, tier: 'must' as const, taskKey, areaKey: null, spec: { type: 'command' as const, cmd, timeoutMs: 60_000, expectExitCode: 0 } });
// the worker writes "<title>.txt" (title comes from the attempt label "attempt <title> #n")
const worker = () =>
  new FakeRunner((spec) => {
    const title = spec.label?.replace(/^attempt /, '').replace(/ #\d+$/, '') ?? 'x';
    writeFileSync(join(spec.cwd, `${title}.txt`), 'ok');
  });

describe('task integration: one Conventional Commit per task', () => {
  test('sequential tasks in the goal workspace are squashed onto the goal branch', async () => {
    const engine = new Engine(cfg(), worker());
    const goal = await engine.createGoal({
      prompt: 'two steps',
      repoPath: repo,
      brief: {
        title: 'feat(demo): add two files',
        understanding: 'u',
        areas: [],
        assumptions: [],
        questions: [],
        costEstimateUsd: 0,
        timeEstimateMin: 0,
        tasks: [t('T1', 'add first file', [], false, 'feature', 'demo'), t('T2', 'fix second file', ['T1'], false, 'bug')],
        checks: [c('C1', 'T1', 'test -f "add first file.txt"'), c('C2', 'T2', 'test -f "fix second file.txt"'), c('G', null, 'test -f "fix second file.txt"')],
      },
    });
    await waitFor(() => terminal(getGoal(engine.store.db, goal.id)!.state), 20_000);
    expect(getGoal(engine.store.db, goal.id)!.state).toBe('done');
    const ws = join(dataDir, 'worktrees', goal.id, '_goal');
    const log = (await sh(`git log --format=%s main..${goal.branch}`, ws)).split('\n');
    expect(log).toEqual(['fix: fix second file', 'feat(demo): add first file']);
    const tasks = listTasks(engine.store.db, goal.id);
    for (const task of tasks) {
      expect(task.baseRef).toBeTruthy();
      expect(task.commitRef).toBeTruthy();
      expect(task.commitMessage).toContain(`Task: ${task.id}`);
      expect(await sh(`git log -1 --format=%s ${task.commitRef}`, ws)).toBe(task.commitMessage!.split('\n')[0]!);
    }
    // no attempt snapshot survives on the branch
    expect(log.some((l) => l.includes('attempt'))).toBe(false);
    const ev = engine.store.listByGoal(goal.id, 5000).map((e) => e.type);
    expect(ev.filter((x) => x === 'task.committed').length).toBe(2);
    const before = engine.store.snapshotReadModels();
    engine.store.replay();
    expect(engine.store.snapshotReadModels()).toEqual(before);
  }, 30_000);

  test('parallel tasks in their own worktrees are squash-merged, one commit each', async () => {
    const engine = new Engine(cfg(), worker());
    const goal = await engine.createGoal({
      prompt: 'parallel',
      repoPath: repo,
      brief: {
        title: '',
        understanding: 'u',
        areas: [],
        assumptions: [],
        questions: [],
        costEstimateUsd: 0,
        timeEstimateMin: 0,
        tasks: [t('T1', 'add alpha', [], true), t('T2', 'add beta', [], true)],
        checks: [c('C1', 'T1', 'test -f "add alpha.txt"'), c('C2', 'T2', 'test -f "add beta.txt"'), c('G', null, 'test -f "add alpha.txt" && test -f "add beta.txt"')],
      },
    });
    await waitFor(() => terminal(getGoal(engine.store.db, goal.id)!.state), 20_000);
    expect(getGoal(engine.store.db, goal.id)!.state).toBe('done');
    const ws = join(dataDir, 'worktrees', goal.id, '_goal');
    const log = (await sh(`git log --format=%s main..${goal.branch}`, ws)).split('\n').sort();
    expect(log).toEqual(['feat: add alpha', 'feat: add beta']);
    // squash merges leave no merge commits
    expect(await sh(`git rev-list --merges --count main..${goal.branch}`, ws)).toBe('0');
    expect(listTasks(engine.store.db, goal.id).every((x) => x.commitRef)).toBe(true);
    // task branches are gone, the worktrees too
    expect((await sh("git branch --format='%(refname:short)'", repo)).split('\n').some((b) => b.startsWith('task/'))).toBe(false);
  }, 30_000);
});
