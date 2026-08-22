import { beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { getGoal, listEscalations, listTasks } from '@ai-engine/core';
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

describe('manual merge resolution', () => {
  test('conflicting parallel tasks → merge attempts fail → human resolves in the _resolve worktree → task done', async () => {
    const { canResolve, startResolution, takeSide, resolveFile, finishResolution } = await import('./merge-resolve.ts');
    // both tasks rewrite the same file with different content; the fake merger never resolves anything
    const runner = new FakeRunner((spec) => {
      if (spec.label?.startsWith('attempt')) writeFileSync(join(spec.cwd, 'shared.txt'), `${spec.label}\n`);
    });
    const engine = new Engine(cfg(), runner);
    const goal = await engine.createGoal({
      prompt: 'conflict',
      repoPath: repo,
      brief: {
        title: 'feat: conflicting',
        understanding: 'u',
        areas: [],
        assumptions: [],
        questions: [],
        costEstimateUsd: 0,
        timeEstimateMin: 0,
        tasks: [t('T1', 'add alpha', [], true), t('T2', 'add beta', [], true)],
        checks: [c('C1', 'T1', 'test -f shared.txt'), c('C2', 'T2', 'test -f shared.txt'), c('G', null, 'test -f shared.txt')],
      },
    });
    await waitFor(() => listEscalations(engine.store.db, { goalId: goal.id, openOnly: true }).some((e) => (e.payload as { kind?: string }).kind === 'merge'), 30_000);
    const esc = listEscalations(engine.store.db, { goalId: goal.id, openOnly: true }).find((e) => (e.payload as { kind?: string }).kind === 'merge')!;
    expect(esc.message).toContain('merge attempts could not resolve it');
    expect((esc.payload as { reasons: string[] }).reasons.length).toBe(2);
    const taskId = esc.taskId!;
    expect(canResolve(engine, goal.id, taskId).ok).toBe(true);

    const state = await startResolution(engine, goal.id, taskId);
    expect(state.files.map((f) => f.path)).toEqual(['shared.txt']);
    const f = state.files[0]!;
    expect(f.conflicted).toBe(true);
    expect(f.current).toContain('<<<<<<<');
    expect(f.ours).toContain('attempt add ');
    expect(f.theirs).toContain('attempt add ');
    expect(f.ours).not.toBe(f.theirs);
    // a resolution with markers is refused; taking a side works; then the human edits the result
    await expect(resolveFile(engine, goal.id, taskId, 'shared.txt', f.current)).rejects.toThrow(/conflict markers/);
    const after = await takeSide(engine, goal.id, taskId, 'shared.txt', 'both');
    expect(after.remaining).toBe(0);
    expect(after.files[0]!.current).toBe(`${f.ours}${f.theirs}`);
    const edited = await resolveFile(engine, goal.id, taskId, 'shared.txt', 'alpha and beta\n');
    expect(edited.files[0]!.conflicted).toBe(false);

    const fin = await finishResolution(engine, goal.id, taskId);
    expect(fin.ok).toBe(true);
    expect(fin.checks.every((x) => x.status === 'pass')).toBe(true);
    const task = listTasks(engine.store.db, goal.id).find((x) => x.id === taskId)!;
    expect(task.state).toBe('done');
    expect(task.commitRef).toBe(fin.ref);
    const ws = join(dataDir, 'worktrees', goal.id, '_goal');
    expect(await sh('cat shared.txt', ws)).toBe('alpha and beta');
    expect(await sh(`git log -1 --format=%B`, ws)).toContain('Resolved manually by the human');
    expect(listEscalations(engine.store.db, { goalId: goal.id, openOnly: true })).toHaveLength(0);
    expect(existsSync(join(dataDir, 'worktrees', goal.id, '_resolve', taskId))).toBe(false);
    await waitFor(() => terminal(getGoal(engine.store.db, goal.id)!.state), 20_000);
    expect(getGoal(engine.store.db, goal.id)!.state).toBe('done');
    const before = engine.store.snapshotReadModels();
    engine.store.replay();
    expect(engine.store.snapshotReadModels()).toEqual(before);
  }, 60_000);
});

describe('merge judged on regressions only', () => {
  test('a must check that already fails on the goal branch does not sink a correctly resolved merge', async () => {
    // workers rewrite the same file; the fake merger resolves by writing a clean file and staging it
    const runner = new FakeRunner(async (spec) => {
      if (spec.label?.startsWith('attempt add ')) writeFileSync(join(spec.cwd, 'shared.txt'), `${spec.label}\n`);
      if (spec.label?.startsWith('merge')) {
        writeFileSync(join(spec.cwd, 'shared.txt'), 'merged by the fake merger\n');
        await sh('git add shared.txt', spec.cwd);
      }
    });
    const engine = new Engine(cfg(), runner);
    const goal = await engine.createGoal({
      prompt: 'conflict with a red suite',
      repoPath: repo,
      brief: {
        title: 'feat: conflicting',
        understanding: 'u',
        areas: [],
        assumptions: [],
        questions: [],
        costEstimateUsd: 0,
        timeEstimateMin: 0,
        tasks: [t('T1', 'add alpha', [], true), t('T2', 'add beta', [], true)],
        // the goal-level gate is red from the start (never.txt never exists): unrelated to either task
        checks: [c('C1', 'T1', 'test -f shared.txt'), c('C2', 'T2', 'test -f shared.txt'), c('G', null, 'test -f never.txt')],
      },
    });
    await waitFor(() => ['done', 'over_delivered', 'failed', 'cancelled', 'blocked'].includes(getGoal(engine.store.db, goal.id)!.state) || listEscalations(engine.store.db, { goalId: goal.id, openOnly: true }).length > 0, 40_000);
    // no merge escalation: the pre-existing failure was recognised as baseline
    expect(listEscalations(engine.store.db, { goalId: goal.id, openOnly: true }).filter((e) => (e.payload as { kind?: string }).kind === 'merge')).toHaveLength(0);
    // both Brief tasks landed; what remains open is the goal review's own fix task for never.txt (a real failure, not the merge's)
    const tasks = listTasks(engine.store.db, goal.id);
    expect(tasks.filter((x) => x.origin === 'brief').every((x) => x.state === 'done')).toBe(true);
    const ws = join(dataDir, 'worktrees', goal.id, '_goal');
    expect(await sh('cat shared.txt', ws)).toBe('merged by the fake merger');
    const notes = engine.store.listByGoal(goal.id, 5000).filter((e) => e.type === 'engine.note').map((e) => (e.payload as { message: string }).message);
    expect(notes.some((m) => m.includes('already failing on the goal branch'))).toBe(true);
    expect(existsSync(join(dataDir, 'worktrees', goal.id, '_baseline'))).toBe(false);
  }, 60_000);
});

describe('conflict avoidance', () => {
  test('catch-up: a task that finishes after another landed merges the goal branch into its own worktree first', async () => {
    let engineRef: Engine | null = null;
    let goalId = '';
    const runner = new FakeRunner(async (spec) => {
      const title = spec.label?.replace(/^attempt /, '').replace(/ #\d+$/, '') ?? 'x';
      if (title === 'add beta') {
        // wait until alpha has landed on the goal branch, so beta's worktree is behind
        await waitFor(() => listTasks(engineRef!.store.db, goalId).some((x) => x.title === 'add alpha' && x.state === 'done'), 20_000);
      }
      if (spec.label?.startsWith('attempt')) writeFileSync(join(spec.cwd, `${title}.txt`), 'ok');
    });
    const engine = new Engine(cfg(), runner);
    engineRef = engine;
    const goal = await engine.createGoal({
      prompt: 'two parallel tasks',
      repoPath: repo,
      brief: { title: 'feat: two', understanding: 'u', areas: [], assumptions: [], questions: [], costEstimateUsd: 0, timeEstimateMin: 0, tasks: [t('T1', 'add alpha', [], true), t('T2', 'add beta', [], true)], checks: [c('C1', 'T1', 'test -f "add alpha.txt"'), c('C2', 'T2', 'test -f "add beta.txt"'), c('G', null, 'test -f "add alpha.txt" && test -f "add beta.txt"')] },
    });
    goalId = goal.id;
    await waitFor(() => terminal(getGoal(engine.store.db, goal.id)!.state), 40_000);
    expect(getGoal(engine.store.db, goal.id)!.state).toBe('done');
    const beta = listTasks(engine.store.db, goal.id).find((x) => x.title === 'add beta')!;
    const ev = engine.store.listByGoal(goal.id, 5000);
    // the catch-up merged the goal branch into beta's task branch before landing
    expect(ev.some((e) => e.type === 'merge.started' && (e.payload as any).taskId === beta.id && (e.payload as any).into === beta.branch)).toBe(true);
    expect(ev.some((e) => e.type === 'engine.note' && String((e.payload as any).message).startsWith('catch-up: merged 1 goal-branch commit'))).toBe(true);
    expect(ev.filter((e) => e.type === 'merge.conflict')).toHaveLength(0);
    const ws = join(dataDir, 'worktrees', goal.id, '_goal');
    expect((await sh(`git log --format=%s main..${goal.branch}`, ws)).split('\n')).toEqual(['feat: add beta', 'feat: add alpha']);
  }, 60_000);

  test('overlap: two parallel tasks that declare the same files never run at the same time', async () => {
    let active = 0;
    let peak = 0;
    const runner = new FakeRunner(async (spec) => {
      if (!spec.label?.startsWith('attempt')) return;
      active++;
      peak = Math.max(peak, active);
      await Bun.sleep(400);
      const title = spec.label.replace(/^attempt /, '').replace(/ #\d+$/, '');
      writeFileSync(join(spec.cwd, `${title}.txt`), 'ok');
      active--;
    });
    const engine = new Engine(cfg(), runner);
    const overlapping = (key: string, title: string) => ({ ...t(key, title, [], true), relevantFiles: ['src/shared/schema.gql', `src/${key}.ts`] });
    const goal = await engine.createGoal({
      prompt: 'overlap',
      repoPath: repo,
      brief: { title: 'feat: overlap', understanding: 'u', areas: [], assumptions: [], questions: [], costEstimateUsd: 0, timeEstimateMin: 0, tasks: [overlapping('T1', 'add one'), overlapping('T2', 'add two')], checks: [c('C1', 'T1', 'test -f "add one.txt"'), c('C2', 'T2', 'test -f "add two.txt"'), c('G', null, 'test -f "add one.txt" && test -f "add two.txt"')] },
    });
    await waitFor(() => terminal(getGoal(engine.store.db, goal.id)!.state), 40_000);
    expect(getGoal(engine.store.db, goal.id)!.state).toBe('done');
    expect(peak).toBe(1);
    const notes = engine.store.listByGoal(goal.id, 5000).filter((e) => e.type === 'engine.note').map((e) => String((e.payload as any).message));
    expect(notes.some((m) => m.includes('waits for') && m.includes('src/shared/schema.gql'))).toBe(true);
  }, 60_000);
});

describe('restart from a finished task', () => {
  test('rerun after "restart from here" gets a fresh worktree instead of the dropped one', async () => {
    const runner = worker();
    const engine = new Engine(cfg(), runner);
    const goal = await engine.createGoal({
      prompt: 'parallel then restart',
      repoPath: repo,
      brief: { title: 'feat: two', understanding: 'u', areas: [], assumptions: [], questions: [], costEstimateUsd: 0, timeEstimateMin: 0, tasks: [t('T1', 'add alpha', [], true), t('T2', 'add beta', [], true)], checks: [c('C1', 'T1', 'test -f "add alpha.txt"'), c('C2', 'T2', 'test -f "add beta.txt"'), c('G', null, 'test -f "add alpha.txt"')] },
    });
    await waitFor(() => terminal(getGoal(engine.store.db, goal.id)!.state), 40_000);
    expect(getGoal(engine.store.db, goal.id)!.state).toBe('done');
    const alpha = listTasks(engine.store.db, goal.id).find((x) => x.title === 'add alpha')!;
    expect(alpha.worktreePath).toBeTruthy();
    expect(existsSync(alpha.worktreePath!)).toBe(false); // dropped when it finished
    const r = await engine.restartGoal(goal.id, { fromTaskId: alpha.id });
    expect(r.restarted).toEqual([alpha.id]);
    expect(listTasks(engine.store.db, goal.id).find((x) => x.id === alpha.id)!.worktreePath).toBeNull();
    await waitFor(() => terminal(getGoal(engine.store.db, goal.id)!.state), 40_000);
    expect(getGoal(engine.store.db, goal.id)!.state).toBe('done');
    const ev = engine.store.listByGoal(goal.id, 5000);
    expect(ev.filter((e) => e.type === 'task.workspace_assigned' && (e.payload as any).taskId === alpha.id).length).toBeGreaterThanOrEqual(1);
    expect(ev.some((e) => e.type === 'engine.note' && String((e.payload as any).message).includes('crashed in engine'))).toBe(false);
    expect(listEscalations(engine.store.db, { goalId: goal.id, openOnly: true })).toHaveLength(0);
    const before = engine.store.snapshotReadModels();
    engine.store.replay();
    expect(engine.store.snapshotReadModels()).toEqual(before);
  }, 90_000);
});
