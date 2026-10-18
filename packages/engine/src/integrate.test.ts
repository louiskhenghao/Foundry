import { beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { IdPrefix, getGoal, getTask, listEscalations, listTasks, newId, type Check, type Goal, type Task } from '@foundry/core';
import { baselineWorkspacePath, ensureGoalWorkspace, goalWorkspacePath, overlayBackupPath, resolveWorkspacePath, taskWorkspacePath } from './workspace.ts';
import { git } from './git/git.ts';
import { integrateTask, resolveConflicts } from './merge.ts';
import { defaultConfig } from './config.ts';
import { Engine } from './engine.ts';
import { FakeRunner, makeRepo, sh, terminal, waitFor } from './test-helpers.ts';

const ROOT = resolve(import.meta.dir, '../../..');
let dataDir: string;
let repo: string;
beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'foundry-integrate-'));
  repo = await makeRepo();
});
const cfg = () => defaultConfig(ROOT, { dataDir, claudeHome: join(dataDir, 'claude-home'), alwaysReviewTasks: false, log: () => {} });
const t = (key: string, title: string, deps: string[], parallel: boolean, kind: 'feature' | 'bug' = 'feature', scope: string | null = null) => ({ key, title, spec: `write ${title}.txt`, kind, scope, scenario: 'general' as const, areaKey: null, tdd: 'inherit' as const, dependsOnKeys: deps, parallelizable: parallel, relevantFiles: [] });
const c = (key: string, taskKey: string | null, cmd: string) => ({ key, name: key, tier: 'must' as const, taskKey, areaKey: null, spec: { type: 'command' as const, cmd, timeoutMs: 60_000, expectExitCode: 0 } });
// the worker writes "<title>.txt" (title comes from the attempt label "attempt <title> #n")
const worker = () =>
  new FakeRunner((spec) => {
    const title = spec.label?.replace(/^attempt /, '').replace(/ #\d+$/, '') ?? 'x';
    writeFileSync(join(spec.cwd, `${title}.txt`), 'ok');
  });
/** an open escalation of another merge that names a commit git would not take back, as resolveConflicts raises one */
const stuckEscalation = (engine: Engine, goalId: string, taskId: string | null, stuck: { cwd: string; base: string; ref: string }) =>
  engine.store.append({ type: 'escalation.raised', goalId, payload: { escalation: { id: newId(IdPrefix.escalation), goalId, taskId, attemptId: null, trigger: 'retries_exhausted', message: 'another merge', payload: { kind: 'merge', files: [], reasons: [], stuck }, state: 'open', answer: null, createdAt: new Date().toISOString(), answeredAt: null, suggestion: null } } });

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
        questions: [], styleOptions: [],
        costEstimateUsd: 0,
        timeEstimateMin: 0,
        tasks: [t('T1', 'add first file', [], false, 'feature', 'demo'), t('T2', 'fix second file', ['T1'], false, 'bug')],
        checks: [c('C1', 'T1', 'test -f "add first file.txt"'), c('C2', 'T2', 'test -f "fix second file.txt"'), c('G', null, 'test -f "fix second file.txt"')],
      },
    });
    await waitFor(() => terminal(getGoal(engine.store.db, goal.id)!.state), 20_000);
    expect(getGoal(engine.store.db, goal.id)!.state).toBe('done');
    const ws = goalWorkspacePath(dataDir, goal);
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
        questions: [], styleOptions: [],
        costEstimateUsd: 0,
        timeEstimateMin: 0,
        tasks: [t('T1', 'add alpha', [], true), t('T2', 'add beta', [], true)],
        checks: [c('C1', 'T1', 'test -f "add alpha.txt"'), c('C2', 'T2', 'test -f "add beta.txt"'), c('G', null, 'test -f "add alpha.txt" && test -f "add beta.txt"')],
      },
    });
    await waitFor(() => terminal(getGoal(engine.store.db, goal.id)!.state), 20_000);
    expect(getGoal(engine.store.db, goal.id)!.state).toBe('done');
    const ws = goalWorkspacePath(dataDir, goal);
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
        questions: [], styleOptions: [],
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
    const ws = goalWorkspacePath(dataDir, goal);
    expect(await sh('cat shared.txt', ws)).toBe('alpha and beta');
    expect(await sh(`git log -1 --format=%B`, ws)).toContain('Resolved manually by the human');
    expect(listEscalations(engine.store.db, { goalId: goal.id, openOnly: true })).toHaveLength(0);
    expect(existsSync(resolveWorkspacePath(dataDir, goal, taskId))).toBe(false);
    await waitFor(() => terminal(getGoal(engine.store.db, goal.id)!.state), 20_000);
    expect(getGoal(engine.store.db, goal.id)!.state).toBe('done');
    const before = engine.store.snapshotReadModels();
    engine.store.replay();
    expect(engine.store.snapshotReadModels()).toEqual(before);
  }, 60_000);
});

describe('manual merge resolution: finishing safely', () => {
  const conflicting = async (gate: string) => {
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
        questions: [], styleOptions: [],
        costEstimateUsd: 0,
        timeEstimateMin: 0,
        tasks: [t('T1', 'add alpha', [], true), t('T2', 'add beta', [], true)],
        checks: [c('C1', 'T1', 'test -f shared.txt'), c('C2', 'T2', 'test -f shared.txt'), c('G', null, gate)],
      },
    });
    const mergeEsc = () => listEscalations(engine.store.db, { goalId: goal.id, openOnly: true }).find((e) => (e.payload as { kind?: string }).kind === 'merge');
    await waitFor(() => !!mergeEsc(), 30_000);
    return { engine, goal, taskId: mergeEsc()!.taskId! };
  };

  test('finishing anyway after the checks regressed lands the resolution', async () => {
    const { startResolution, resolveFile, finishResolution } = await import('./merge-resolve.ts');
    // the gate passes on the goal branch and fails on the resolution below: a regression the person lands anyway
    const { engine, goal, taskId } = await conflicting('test "$(cat shared.txt)" != broken');
    await startResolution(engine, goal.id, taskId);
    await resolveFile(engine, goal.id, taskId, 'shared.txt', 'broken\n');
    const first = await finishResolution(engine, goal.id, taskId);
    expect(first.ok).toBe(false);
    expect(first.reason).toContain('regressed');
    const forced = await finishResolution(engine, goal.id, taskId, { force: true });
    expect(forced.ok).toBe(true);
    const ws = goalWorkspacePath(dataDir, goal);
    expect(await sh('cat shared.txt', ws)).toBe('broken');
    expect(await sh('git log -1 --format=%B', ws)).toContain('Resolved manually by the human');
  }, 60_000);

  test("a resolution whose squash record is gone keeps the person's edits: a reload neither drops nor restarts it", async () => {
    const { startResolution, describeResolution, resolveFile, finishResolution } = await import('./merge-resolve.ts');
    const { engine, goal, taskId } = await conflicting('test -f shared.txt');
    await startResolution(engine, goal.id, taskId);
    await resolveFile(engine, goal.id, taskId, 'shared.txt', 'resolved by hand\n');
    // an unstage (or a stash and pop, or an editor's commit) removes git's SQUASH_MSG while the edits stay
    const path = resolveWorkspacePath(dataDir, goal, taskId);
    await sh('git reset -q', path);
    expect(await sh('test -e "$(git rev-parse --git-path SQUASH_MSG)" && echo yes || echo no', path)).toBe('no');
    expect((await describeResolution(engine, goal.id, taskId)).path).toBe(path);
    await startResolution(engine, goal.id, taskId);
    expect(await sh('cat shared.txt', path)).toBe('resolved by hand');
    const fin = await finishResolution(engine, goal.id, taskId);
    expect(fin.ok).toBe(true);
    expect(await sh('cat shared.txt', goalWorkspacePath(dataDir, goal))).toBe('resolved by hand');
  }, 60_000);

  test('a Finish cut short after its commit is completed by the next one, which lands the resolution', async () => {
    const { startResolution, resolveFile, finishResolution } = await import('./merge-resolve.ts');
    const { engine, goal, taskId } = await conflicting('test -f shared.txt');
    await startResolution(engine, goal.id, taskId);
    await resolveFile(engine, goal.id, taskId, 'shared.txt', 'resolved before the restart\n');
    // the state a restart leaves between Finish's commit and the landing
    const path = resolveWorkspacePath(dataDir, goal, taskId);
    await sh('git -c user.email=t@t -c user.name=t commit -qm "resolution"', path);
    const fin = await finishResolution(engine, goal.id, taskId);
    expect(fin.ok).toBe(true);
    const ws = goalWorkspacePath(dataDir, goal);
    expect(await sh('cat shared.txt', ws)).toBe('resolved before the restart');
    expect(await sh('git log -1 --format=%B', ws)).toContain('Resolved manually by the human');
  }, 60_000);

  test('a Finish retried after its resolution already landed finishes what was left, without a second commit', async () => {
    const { startResolution, resolveFile, finishResolution } = await import('./merge-resolve.ts');
    const { engine, goal, taskId } = await conflicting('test -f shared.txt');
    await startResolution(engine, goal.id, taskId);
    await resolveFile(engine, goal.id, taskId, 'shared.txt', 'resolved and landed\n');
    // what a Finish stopped by a restart had done: its commit, landed on the goal branch, and nothing recorded after
    const path = resolveWorkspacePath(dataDir, goal, taskId);
    await sh(`git -c user.email=t@t -c user.name=t commit -qm "feat: resolved" -m "Task: ${taskId}" -m "Resolved manually by the human"`, path);
    const ws = goalWorkspacePath(dataDir, goal);
    await sh(`git merge -q --ff-only ${await sh('git rev-parse HEAD', path)}`, ws);
    const before = await sh('git rev-parse HEAD', ws);
    const fin = await finishResolution(engine, goal.id, taskId);
    expect(fin).toMatchObject({ ok: true, ref: before });
    expect(await sh('git rev-parse HEAD', ws)).toBe(before);
    expect(listTasks(engine.store.db, goal.id).find((x) => x.id === taskId)!.state).toBe('done');
  }, 60_000);

  test('a stash that leaves only an untracked leftover is not a resolution to finish: it starts over, and the stash keeps the work', async () => {
    const { startResolution, resolveFile, finishResolution } = await import('./merge-resolve.ts');
    const { engine, goal, taskId } = await conflicting('test -f shared.txt');
    await startResolution(engine, goal.id, taskId);
    await resolveFile(engine, goal.id, taskId, 'shared.txt', 'stashed resolution\n');
    const path = resolveWorkspacePath(dataDir, goal, taskId);
    await sh('git stash -q && echo leftover > shared.txt.orig', path);
    const fin = await finishResolution(engine, goal.id, taskId);
    expect(fin.ok).toBe(false);
    expect(listTasks(engine.store.db, goal.id).find((x) => x.id === taskId)!.state).toBe('blocked');
    expect((await startResolution(engine, goal.id, taskId)).remaining).toBe(1);
  }, 60_000);

  test("a resolution of the task's older work (a retry moved its branch) is refused and replaced, and so is Finish after a skip", async () => {
    const { startResolution, resolveFile, finishResolution } = await import('./merge-resolve.ts');
    const { engine, goal, taskId } = await conflicting('test -f shared.txt');
    await startResolution(engine, goal.id, taskId);
    await resolveFile(engine, goal.id, taskId, 'shared.txt', 'resolved against the first attempt\n');
    const task = listTasks(engine.store.db, goal.id).find((x) => x.id === taskId)!;
    // a retry ran another attempt: the task branch moved past what the resolution merged
    await sh('echo second > shared.txt && git -c user.email=t@t -c user.name=t commit -qam "attempt 2"', task.worktreePath!);
    const fin = await finishResolution(engine, goal.id, taskId);
    expect(fin).toMatchObject({ ok: false });
    expect(fin.reason).toContain('the task changed since this resolution started');
    const again = await startResolution(engine, goal.id, taskId);
    expect(again.files.find((f) => f.path === 'shared.txt')!.theirs).toBe('second\n');
    // skipped meanwhile: Finish does not land it, nor turn the task done
    engine.store.append({ type: 'task.state_changed', goalId: goal.id, payload: { taskId, from: 'blocked', to: 'skipped', reason: 'skipped by the human' } });
    const skipped = await finishResolution(engine, goal.id, taskId);
    expect(skipped.ok).toBe(false);
    expect(listTasks(engine.store.db, goal.id).find((x) => x.id === taskId)!.state).toBe('skipped');
  }, 60_000);

  test('a resolution worktree moved off the commit it started from is refused, not landed over the goal', async () => {
    const { startResolution, finishResolution } = await import('./merge-resolve.ts');
    const { engine, goal, taskId } = await conflicting('test -f shared.txt');
    await startResolution(engine, goal.id, taskId);
    const path = resolveWorkspacePath(dataDir, goal, taskId);
    await sh('git reset -q --hard $(git rev-list --max-parents=0 HEAD)', path);
    const fin = await finishResolution(engine, goal.id, taskId);
    expect(fin.ok).toBe(false);
    expect(fin.reason).toContain('moved off the commit it started from');
  }, 60_000);

  test('a resolution worktree left without its merge is started over, never finished as a resolution without changes', async () => {
    const { startResolution, finishResolution } = await import('./merge-resolve.ts');
    const { engine, goal, taskId } = await conflicting('test -f shared.txt');
    await startResolution(engine, goal.id, taskId);
    // the state an engine crash leaves between creating the worktree and merging into it
    const path = resolveWorkspacePath(dataDir, goal, taskId);
    await sh(`git worktree remove --force "${path}" && git worktree add -q --detach "${path}" ${goal.branch}`, repo);
    const refused = await finishResolution(engine, goal.id, taskId);
    expect(refused.ok).toBe(false);
    expect(refused.reason).toContain('start the resolution again');
    expect(listTasks(engine.store.db, goal.id).find((x) => x.id === taskId)!.state).toBe('blocked');
    const again = await startResolution(engine, goal.id, taskId);
    expect(again.remaining).toBe(1);
  }, 60_000);
});

describe('manual merge resolution of tasks that export files', () => {
  test("a manually resolved task's exports reach the goal workspace, recorded as its landing, and the checks that measure them pass", async () => {
    const { startResolution, takeSide, finishResolution } = await import('./merge-resolve.ts');
    // cad tasks: their exports live under artifacts/, which git never sees; both also rewrite shared.txt, so they conflict
    const runner = new FakeRunner((spec) => {
      if (!spec.label?.startsWith('attempt')) return;
      const title = spec.label.replace(/^attempt /, '').replace(/ #\d+$/, '');
      writeFileSync(join(spec.cwd, 'shared.txt'), `${spec.label}\n`);
      mkdirSync(join(spec.cwd, 'artifacts'), { recursive: true });
      writeFileSync(join(spec.cwd, 'artifacts', `${title.replace(/ /g, '_')}.step`), 'ISO-10303-21;');
    });
    const engine = new Engine(cfg(), runner);
    const cad = (key: string, title: string) => ({ ...t(key, title, [], true), scenario: 'cad' as const });
    const goal = await engine.createGoal({
      prompt: 'conflicting exports',
      repoPath: repo,
      brief: {
        title: 'feat: two parts',
        understanding: 'u',
        areas: [],
        assumptions: [],
        questions: [], styleOptions: [],
        costEstimateUsd: 0,
        timeEstimateMin: 0,
        tasks: [cad('T1', 'add alpha'), cad('T2', 'add beta')],
        checks: [c('C1', 'T1', 'test -s artifacts/add_alpha.step'), c('C2', 'T2', 'test -s artifacts/add_beta.step')],
      },
    });
    const mergeEsc = () => listEscalations(engine.store.db, { goalId: goal.id, openOnly: true }).find((e) => (e.payload as { kind?: string }).kind === 'merge');
    await waitFor(() => !!mergeEsc(), 30_000);
    const taskId = mergeEsc()!.taskId!;
    const file = `${listTasks(engine.store.db, goal.id).find((x) => x.id === taskId)!.title.replace(/ /g, '_')}.step`;
    await startResolution(engine, goal.id, taskId);
    await takeSide(engine, goal.id, taskId, 'shared.txt', 'both');
    const fin = await finishResolution(engine, goal.id, taskId);
    // the resolution sees the exports as the merged goal has them: the other task's (landed) and this task's own
    expect(fin.checks.map((x) => [x.name, x.status])).toEqual([['C1', 'pass'], ['C2', 'pass']]);
    expect(fin.ok).toBe(true);
    // the task's export is in the goal workspace once its worktree is gone, recorded as its landing
    expect(existsSync(join(goalWorkspacePath(dataDir, goal), 'artifacts', file))).toBe(true);
    const landed = engine.store.listByGoal(goal.id, 5000).filter((e) => e.type === 'task.artifacts_landed').map((e) => e.payload);
    expect(landed).toContainEqual({ taskId, files: [file] });
  }, 60_000);
});

describe('manual merge resolution: which exports land', () => {
  // cad tasks rewrite shared.txt (the conflict) and export frame.step and a part of their own; with `own`, each also
  // writes a tracked file of its own, so a resolution that keeps the goal's shared.txt still lands a change
  const conflicted = async (own: boolean) => {
    const runner = new FakeRunner((spec) => {
      if (!spec.label?.startsWith('attempt')) return;
      const slug = spec.label.replace(/^attempt /, '').replace(/ #\d+$/, '').replace(/ /g, '_');
      writeFileSync(join(spec.cwd, 'shared.txt'), `${spec.label}\n`);
      if (own) writeFileSync(join(spec.cwd, `${slug}.txt`), slug);
      mkdirSync(join(spec.cwd, 'artifacts'), { recursive: true });
      writeFileSync(join(spec.cwd, 'artifacts', 'frame.step'), `${slug} frame`);
      writeFileSync(join(spec.cwd, 'artifacts', `${slug}_only.step`), slug);
    });
    const engine = new Engine(cfg(), runner);
    const cad = (key: string, title: string) => ({ ...t(key, title, [], true), scenario: 'cad' as const });
    const goal = await engine.createGoal({
      prompt: 'two parts',
      repoPath: repo,
      brief: { title: 'feat: two parts', understanding: 'u', areas: [], assumptions: [], questions: [], styleOptions: [], costEstimateUsd: 0, timeEstimateMin: 0, tasks: [cad('T1', 'add alpha'), cad('T2', 'add beta')], checks: [c('C1', 'T1', 'test -f shared.txt'), c('C2', 'T2', 'test -f shared.txt')] },
    });
    const mergeEsc = () => listEscalations(engine.store.db, { goalId: goal.id, openOnly: true }).find((e) => (e.payload as { kind?: string }).kind === 'merge');
    await waitFor(() => !!mergeEsc(), 30_000);
    const taskId = mergeEsc()!.taskId!;
    const slug = listTasks(engine.store.db, goal.id).find((x) => x.id === taskId)!.title.replace(/ /g, '_');
    const art = join(goalWorkspacePath(dataDir, goal), 'artifacts');
    return { engine, goal, taskId, slug, art, mergeEsc };
  };
  const resolveKeepingGoalSide = async (own: boolean, watchLanding = false) => {
    const { startResolution, takeSide, finishResolution } = await import('./merge-resolve.ts');
    const { engine, goal, taskId, slug, art } = await conflicted(own);
    const landedFrame = await Bun.file(join(art, 'frame.step')).text();
    // what whoever holds the goal workspace next finds: the resolution's commit without its exports is a gap another
    // task's integration could fall into
    const gaps: string[] = [];
    if (watchLanding) {
      const lock = engine.withGoalWsLock.bind(engine);
      engine.withGoalWsLock = (<T>(goalId: string, fn: () => Promise<T>) =>
        lock(goalId, async () => {
          const r = await fn();
          const head = (await git(['log', '-1', '--format=%B'], goalWorkspacePath(dataDir, goal))).stdout;
          if (head.includes('Resolved manually by the human') && !existsSync(join(art, `${slug}_only.step`))) gaps.push(head.split('\n')[0]!);
          return r;
        })) as Engine['withGoalWsLock'];
    }
    await startResolution(engine, goal.id, taskId);
    await takeSide(engine, goal.id, taskId, 'shared.txt', 'ours');
    expect((await finishResolution(engine, goal.id, taskId)).ok).toBe(true);
    const notes = engine.store.listByGoal(goal.id, 5000).filter((e) => e.type === 'engine.note').map((e) => (e.payload as { message: string }).message);
    return { art, slug, landedFrame, notes, gaps };
  };

  test("a resolution that kept the goal's side for a file the task changed lands only the exports the goal lacks", async () => {
    const { art, slug, landedFrame, notes } = await resolveKeepingGoalSide(true);
    // the goal's frame stays as it was (consistent with the shared file it kept); the task's own part arrives
    expect(await Bun.file(join(art, 'frame.step')).text()).toBe(landedFrame);
    expect(existsSync(join(art, `${slug}_only.step`))).toBe(true);
    expect(notes.some((m) => m.includes("the resolution kept the goal's version of 1 file(s) the task changed (shared.txt)"))).toBe(true);
  }, 60_000);

  test("a resolution's commit and its exports land in one step: nothing on the goal workspace comes between them", async () => {
    const { art, slug, gaps } = await resolveKeepingGoalSide(true, true);
    expect(existsSync(join(art, `${slug}_only.step`))).toBe(true);
    expect(gaps).toEqual([]);
  }, 60_000);

  test('a Finish that waited for the goal workspace while the task was skipped lands nothing', async () => {
    const { startResolution, takeSide, finishResolution } = await import('./merge-resolve.ts');
    const { engine, goal, taskId, mergeEsc } = await conflicted(true);
    await startResolution(engine, goal.id, taskId);
    await takeSide(engine, goal.id, taskId, 'shared.txt', 'ours');
    // another task's merge holds the goal workspace while Finish waits for it
    let release: (() => void) | null = null;
    const held = engine.withGoalWsLock(goal.id, () => new Promise<void>((r) => (release = r)));
    await waitFor(() => release !== null);
    // Finish is past its own first check, waiting for the goal workspace, when the task is skipped
    let waiting = false;
    const lock = engine.withGoalWsLock.bind(engine);
    engine.withGoalWsLock = (<T>(goalId: string, fn: () => Promise<T>) => ((waiting = true), lock(goalId, fn))) as Engine['withGoalWsLock'];
    const finishing = finishResolution(engine, goal.id, taskId);
    await waitFor(() => waiting);
    await engine.answerEscalation(mergeEsc()!.id, { action: 'skip_task' });
    release!();
    await held;
    expect((await finishing).ok).toBe(false);
    expect(getTask(engine.store.db, taskId)!.state).toBe('skipped');
    await engine.stop();
  }, 60_000);

  test("a Finish copies the goal's exports as they are: an overlay another merge left is undone first", async () => {
    const { startResolution, takeSide, finishResolution } = await import('./merge-resolve.ts');
    const { contentHash, overlayBackupPath } = await import('./workspace.ts');
    const { engine, goal, taskId, art } = await conflicted(true);
    await startResolution(engine, goal.id, taskId);
    await takeSide(engine, goal.id, taskId, 'shared.txt', 'ours');
    const own = readFileSync(join(art, 'frame.step'), 'utf8');
    // another task's merge attempt holds the goal workspace, its export laid over the goal's frame.step
    let release: (() => void) | null = null;
    const held = engine.withGoalWsLock(goal.id, () => new Promise<void>((r) => (release = r)));
    await waitFor(() => release !== null);
    const backup = overlayBackupPath(dataDir, goal, 't_other');
    mkdirSync(join(backup, 'files'), { recursive: true });
    writeFileSync(join(backup, 'files', 'frame.step'), own);
    writeFileSync(join(art, 'frame.step'), 'laid over by another merge');
    writeFileSync(join(backup, 'list'), `${JSON.stringify({ f: 'frame.step', saved: true, hash: await contentHash(join(art, 'frame.step')) })}\n`);
    const seen: string[] = [];
    const failing = engine.baseline.failing.bind(engine.baseline);
    engine.baseline.failing = (async (g: Goal, ref: string, from?: string) => (seen.push(readFileSync(join(from ?? goalWorkspacePath(dataDir, g), 'artifacts', 'frame.step'), 'utf8')), failing(g, ref, from))) as typeof engine.baseline.failing;
    const finishing = finishResolution(engine, goal.id, taskId);
    await Bun.sleep(300);
    expect(seen).toEqual([]);
    release!();
    await held;
    expect((await finishing).ok).toBe(true);
    expect(seen).toEqual([own]);
    await engine.stop();
  }, 60_000);

  test("a Finish's baseline reads the exports copied for its checks, whatever another merge lays over the goal's meanwhile", async () => {
    const { startResolution, takeSide, finishResolution } = await import('./merge-resolve.ts');
    const { engine, goal, taskId, art } = await conflicted(true);
    await startResolution(engine, goal.id, taskId);
    await takeSide(engine, goal.id, taskId, 'shared.txt', 'ours');
    const own = readFileSync(join(art, 'frame.step'), 'utf8');
    const seen: string[] = [];
    engine.baseline.failing = (async (g: Goal, _ref: string, from?: string) => {
      // another task's merge attempt lays its export over the goal's just as the baseline is measured
      writeFileSync(join(art, 'frame.step'), 'laid over by another merge');
      seen.push(readFileSync(join(from ?? goalWorkspacePath(dataDir, g), 'artifacts', 'frame.step'), 'utf8'));
      writeFileSync(join(art, 'frame.step'), own);
      return new Set<string>();
    }) as typeof engine.baseline.failing;
    expect((await finishResolution(engine, goal.id, taskId)).ok).toBe(true);
    expect(seen).toEqual([own]);
    await engine.stop();
  }, 60_000);

  test("a Finish does not wait for another task's merge to copy the goal's exports when nothing is laid over them", async () => {
    const { startResolution, takeSide, finishResolution } = await import('./merge-resolve.ts');
    const { engine, goal, taskId } = await conflicted(true);
    await startResolution(engine, goal.id, taskId);
    await takeSide(engine, goal.id, taskId, 'shared.txt', 'ours');
    let release: (() => void) | null = null;
    const held = engine.withGoalWsLock(goal.id, () => new Promise<void>((r) => (release = r)));
    await waitFor(() => release !== null);
    let measured = false;
    const failing = engine.baseline.failing.bind(engine.baseline);
    engine.baseline.failing = (async (g: Goal, ref: string, from?: string) => ((measured = true), failing(g, ref, from))) as typeof engine.baseline.failing;
    const finishing = finishResolution(engine, goal.id, taskId);
    // its checks and baseline run while the other merge still holds the goal workspace; only the landing waits for it
    await waitFor(() => measured, 10_000);
    release!();
    await held;
    expect((await finishing).ok).toBe(true);
    await engine.stop();
  }, 60_000);

  test("a Finish whose copy of the goal's exports would hold one an undo could not put back is refused, saying why", async () => {
    const { startResolution, takeSide, finishResolution } = await import('./merge-resolve.ts');
    const { contentHash, overlayBackupPath } = await import('./workspace.ts');
    const { engine, goal, taskId, art } = await conflicted(true);
    await startResolution(engine, goal.id, taskId);
    await takeSide(engine, goal.id, taskId, 'shared.txt', 'ours');
    // another task's overlay whose undo cannot finish: the goal's saved copy of frame.step is gone
    const backup = overlayBackupPath(dataDir, goal, 't_other');
    mkdirSync(backup, { recursive: true });
    writeFileSync(join(art, 'frame.step'), 'laid over by another merge');
    writeFileSync(join(backup, 'list'), `${JSON.stringify({ f: 'frame.step', saved: true, hash: await contentHash(join(art, 'frame.step')) })}\n`);
    await expect(finishResolution(engine, goal.id, taskId)).rejects.toThrow('could not all be put back');
    expect(getTask(engine.store.db, taskId)!.state).not.toBe('done');
    await engine.stop();
  }, 60_000);

  test("a resolution does not start while another merge attempt's checks run, nor on another task's commit git would not take back", async () => {
    const { startResolution, abortResolution } = await import('./merge-resolve.ts');
    const { engine, goal, taskId } = await conflicted(true);
    const ws = goalWorkspacePath(dataDir, goal);
    const tip = await sh('git rev-parse HEAD', ws);
    // another task's merge attempt holds the goal workspace: its resolution committed, its checks running, then taken back
    let release: (() => void) | null = null;
    const held = engine.withGoalWsLock(goal.id, async () => {
      writeFileSync(join(ws, 'unverified.txt'), 'x\n');
      await sh('git add -A && git commit -qm "feat: other" -m "Resolved by merge attempt 1"', ws);
      await new Promise<void>((r) => (release = r));
      await sh(`git reset -q --keep ${tip}`, ws);
    });
    await waitFor(() => release !== null);
    const starting = startResolution(engine, goal.id, taskId);
    await Bun.sleep(300);
    release!();
    await held;
    await starting;
    expect((engine.store.listByGoalOfTypes(goal.id, ['merge.manual_started']).at(-1)!.payload as { base: string }).base).toBe(tip);
    await abortResolution(engine, goal.id, taskId);
    // another task's commit git would not take back is on the goal branch
    writeFileSync(join(ws, 'unverified.txt'), 'x\n');
    await sh('git add -A && git commit -qm "feat: other" -m "Resolved by merge attempt 1"', ws);
    stuckEscalation(engine, goal.id, null, { cwd: ws, base: tip, ref: await sh('git rev-parse HEAD', ws) });
    const lock = join(await sh('git rev-parse --absolute-git-dir', ws), 'index.lock');
    writeFileSync(lock, '');
    try {
      await expect(startResolution(engine, goal.id, taskId)).rejects.toThrow('still refuses');
    } finally {
      rmSync(lock, { force: true });
    }
    await engine.stop();
  }, 60_000);

  test('a Finish does not land on a commit another merge attempt could not take back', async () => {
    const { startResolution, takeSide, finishResolution, abortResolution } = await import('./merge-resolve.ts');
    const { engine, goal, taskId } = await conflicted(true);
    await startResolution(engine, goal.id, taskId);
    await takeSide(engine, goal.id, taskId, 'shared.txt', 'ours');
    // meanwhile another task's merge attempt left its commit on the goal branch, and a commit landed on top of it
    const ws = goalWorkspacePath(dataDir, goal);
    const base = await sh('git rev-parse HEAD', ws);
    writeFileSync(join(ws, 'third.txt'), 'unverified\n');
    await sh('git add -A && git commit -qm "feat: third" -m "Resolved by merge attempt 1"', ws);
    stuckEscalation(engine, goal.id, null, { cwd: ws, base, ref: await sh('git rev-parse HEAD', ws) });
    await sh('git commit -q --allow-empty -m "feat: on top"', ws);
    const top = await sh('git rev-parse HEAD', ws);
    const r = await finishResolution(engine, goal.id, taskId);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('revert');
    expect(await sh('git rev-parse HEAD', ws)).toBe(top);
    await abortResolution(engine, goal.id, taskId);
    await engine.stop();
  }, 60_000);

  test("a resolution that kept the goal's side throughout lands none of the task's exports", async () => {
    const { art, slug, landedFrame } = await resolveKeepingGoalSide(false);
    expect(await Bun.file(join(art, 'frame.step')).text()).toBe(landedFrame);
    expect(existsSync(join(art, `${slug}_only.step`))).toBe(false);
  }, 60_000);
});

describe('merge attempts of tasks that export files', () => {
  test("a catch-up merge is judged with the task's own exports on both sides, not against exports it never had", async () => {
    // cad tasks write their export under artifacts/ and rewrite shared.txt; beta is slower, so alpha lands first and
    // beta meets the conflict when it catches up, in its own worktree, which never received alpha's export
    const runner = new FakeRunner(async (spec) => {
      if (spec.label?.startsWith('attempt')) {
        const title = spec.label.replace(/^attempt /, '').replace(/ #\d+$/, '');
        if (title === 'add beta') await Bun.sleep(1500);
        writeFileSync(join(spec.cwd, 'shared.txt'), `${spec.label}\n`);
        mkdirSync(join(spec.cwd, 'artifacts'), { recursive: true });
        writeFileSync(join(spec.cwd, 'artifacts', `${title.replace(/ /g, '_')}.step`), 'ISO-10303-21;');
      }
      if (spec.label?.startsWith('merge')) {
        writeFileSync(join(spec.cwd, 'shared.txt'), 'merged by the fake merger\n');
        await sh('git add shared.txt', spec.cwd);
      }
    });
    const engine = new Engine(cfg(), runner);
    const cad = (key: string, title: string) => ({ ...t(key, title, [], true), scenario: 'cad' as const });
    const goal = await engine.createGoal({
      prompt: 'two parts',
      repoPath: repo,
      brief: {
        title: 'feat: two parts',
        understanding: 'u',
        areas: [],
        assumptions: [],
        questions: [], styleOptions: [],
        costEstimateUsd: 0,
        timeEstimateMin: 0,
        tasks: [cad('T1', 'add alpha'), cad('T2', 'add beta')],
        checks: [c('C1', 'T1', 'test -s artifacts/add_alpha.step'), c('C2', 'T2', 'test -s artifacts/add_beta.step')],
      },
    });
    await waitFor(() => terminal(getGoal(engine.store.db, goal.id)!.state) || listEscalations(engine.store.db, { goalId: goal.id, openOnly: true }).length > 0, 40_000);
    expect(listEscalations(engine.store.db, { goalId: goal.id, openOnly: true }).map((e) => e.message)).toEqual([]);
    expect(getGoal(engine.store.db, goal.id)!.state).toBe('done');
    // the catch-up merge attempt ran and was accepted: alpha's check fails in beta's worktree and in its baseline alike
    const merges = engine.store.listByGoal(goal.id, 5000).filter((e) => e.type === 'attempt.concluded').map((e) => e.payload as { state: string; reason: string });
    expect(merges.some((m) => m.reason === 'merged and checks pass')).toBe(true);
    const ws = goalWorkspacePath(dataDir, goal);
    expect(existsSync(join(ws, 'artifacts', 'add_alpha.step')) && existsSync(join(ws, 'artifacts', 'add_beta.step'))).toBe(true);
  }, 60_000);
});

describe('a squash that conflicts at integration (the goal branch moved after the last catch-up)', () => {
  /** the goal holds revision 1 of a part and its export; the task remade both as revision 2; another task's commit conflicts */
  const integrationWindow = async (extraCheck?: string, opts: { noChecks?: boolean; onMerge?: (cwd: string) => Promise<void>; beforeResolve?: (at: { goal: Goal; ws: string }) => void | Promise<void> } = {}) => {
    const runner = new FakeRunner(async (spec) => {
      if (spec.label?.startsWith('merge')) {
        await opts.onMerge?.(spec.cwd);
        writeFileSync(join(spec.cwd, 'shared.txt'), 'merged by the fake merger\n');
        await sh('git add shared.txt', spec.cwd);
      }
    });
    const engine = new Engine(cfg(), runner);
    engine.beginUpdateDrain(); // nothing runs on its own: the integration is driven by hand
    const draft = await engine.createGoal({ prompt: 'a part', repoPath: repo });
    engine.store.append({ type: 'goal.nature_set', goalId: draft.id, payload: { nature: 'cad', reason: 'a model' } });
    const goal = getGoal(engine.store.db, draft.id)!;
    const ws = await ensureGoalWorkspace(dataDir, goal);
    await sh('echo /artifacts/ >> .git/info/exclude', repo);
    writeFileSync(join(ws, 'params.txt'), 'rev1\n');
    writeFileSync(join(ws, 'shared.txt'), 'base\n');
    await sh('git add -A && git commit -qm "feat: part rev1"', ws);
    mkdirSync(join(ws, 'artifacts'), { recursive: true });
    writeFileSync(join(ws, 'artifacts', 'part.step'), 'rev1\n');
    const taskWs = taskWorkspacePath(dataDir, goal, 't_rev2');
    await sh(`git worktree add -q -b task/t_rev2 "${taskWs}" ${goal.branch}`, repo);
    writeFileSync(join(taskWs, 'params.txt'), 'rev2\n');
    writeFileSync(join(taskWs, 'shared.txt'), 'task side\n');
    await sh('git add -A && git commit -qm "feat: part rev2"', taskWs);
    mkdirSync(join(taskWs, 'artifacts'), { recursive: true });
    writeFileSync(join(taskWs, 'artifacts', 'part.step'), 'rev2\n');
    writeFileSync(join(taskWs, 'artifacts', 'drawing.pdf'), 'new\n');
    writeFileSync(join(ws, 'shared.txt'), 'goal side\n');
    await sh('git commit -qam "feat: another task"', ws);
    const tip = await sh('git rev-parse HEAD', ws);
    const check = (name: string, cmd: string): Check => ({ id: newId(IdPrefix.check), goalId: goal.id, taskId: null, name, tier: 'must', spec: { type: 'command', cmd, timeoutMs: 60_000, expectExitCode: 0 } });
    if (!opts.noChecks) for (const ch of [check('export matches its source', 'cmp -s artifacts/part.step params.txt'), ...(extraCheck ? [check('extra', extraCheck)] : [])]) engine.store.append({ type: 'check.created', goalId: goal.id, payload: { check: ch } });
    const now = new Date().toISOString();
    const task = { id: 't_rev2', goalId: goal.id, title: 'part rev2', spec: 'remake the part', kind: 'feature', scope: null, scenario: 'cad', area: null, tdd: 'inherit', dependsOn: [], relevantFiles: [], parallelizable: true, retryBudget: 3, origin: 'brief', milestone: null, milestoneVisits: 0, checkpointOf: null, difficulty: 'standard', state: 'merging', branch: null, worktreePath: null, baseRef: null, commitRef: null, commitMessage: null, hint: null, extraAttempts: 0, delegatedGoalId: null, summary: null, createdAt: now, updatedAt: now } as Task;
    engine.store.append({ type: 'task.created', goalId: goal.id, payload: { task } });
    engine.store.append({ type: 'task.workspace_assigned', goalId: goal.id, payload: { taskId: task.id, branch: 'task/t_rev2', worktreePath: taskWs } });
    const squash = () => git(['merge', '--squash', '--no-commit', 'task/t_rev2'], ws);
    expect((await squash()).code).not.toBe(0);
    await opts.beforeResolve?.({ goal, ws });
    const ok = await resolveConflicts(engine, getGoal(engine.store.db, goal.id)!, getTask(engine.store.db, task.id)!, ['shared.txt'], { ref: 'task/t_rev2', label: 'task/t_rev2', intent: 'remake the part' }, { cwd: ws, redo: async () => void (await squash()), commitMessage: 'feat: part rev2' }).catch((err: Error) => err);
    return { engine, ws, ok, tip, goalId: goal.id, backup: overlayBackupPath(dataDir, goal, task.id) };
  };

  test("its merge attempt is checked with the task's exports laid over the goal's, which a merge that lands keeps", async () => {
    const { engine, ws, ok, backup } = await integrationWindow();
    // without them, revision 2's source against revision 1's export read as a regression of the merge
    expect(ok).toBe(true);
    expect(await sh('cat params.txt', ws)).toBe('rev2');
    expect(readFileSync(join(ws, 'artifacts', 'part.step'), 'utf8')).toBe('rev2\n');
    expect(readFileSync(join(ws, 'artifacts', 'drawing.pdf'), 'utf8')).toBe('new\n');
    expect(existsSync(backup)).toBe(false);
    await engine.stop();
  }, 60_000);

  test('with no must checks to read them, nothing is laid over', async () => {
    const { engine, ws, ok, backup } = await integrationWindow(undefined, { noChecks: true });
    expect(ok).toBe(true);
    // the landing brings revision 2 afterwards; the merge attempt itself copied and saved nothing
    expect(readFileSync(join(ws, 'artifacts', 'part.step'), 'utf8')).toBe('rev1\n');
    expect(existsSync(join(ws, 'artifacts', 'drawing.pdf'))).toBe(false);
    expect(existsSync(backup)).toBe(false);
    await engine.stop();
  }, 60_000);

  test("a merge that does not land takes the task's exports back off the goal's", async () => {
    // a real regression: the merged shared.txt breaks a check the goal passed
    const { engine, ws, ok, tip, backup } = await integrationWindow('grep -q "goal side" shared.txt');
    expect(ok).toBe(false);
    expect(readFileSync(join(ws, 'artifacts', 'part.step'), 'utf8')).toBe('rev1\n');
    expect(existsSync(join(ws, 'artifacts', 'drawing.pdf'))).toBe(false);
    expect(existsSync(backup)).toBe(false);
    // the attempts committed their resolutions before their checks regressed: those commits are taken back too
    expect(await sh('git rev-parse HEAD', ws)).toBe(tip);
    expect(await sh('cat params.txt', ws)).toBe('rev1');
    await engine.stop();
  }, 60_000);

  test('a regressed attempt takes its commit back before the next one, which meets the conflict on the goal branch as it was', async () => {
    const heads: string[] = [];
    const { engine, ok, tip } = await integrationWindow('grep -q "goal side" shared.txt', { onMerge: async (cwd) => void heads.push(await sh('git rev-parse HEAD', cwd)) });
    expect(ok).toBe(false);
    expect(heads).toEqual([tip, tip]);
    await engine.stop();
  }, 60_000);

  test('a commit that cannot be taken back stops the attempts and the escalation says the goal branch still holds it', async () => {
    // the regressed check leaves a lock in the goal worktree's git folder (as a git client holding it would): the reset fails
    const { engine, ws, ok, goalId } = await integrationWindow('case "$PWD" in */baseline*) exit 0;; esac; touch "$(git rev-parse --git-dir)/index.lock"; exit 1');
    try {
      expect(ok).toBe(false);
      const esc = listEscalations(engine.store.db, { goalId, openOnly: true }).find((e) => (e.payload as { kind?: string }).kind === 'merge');
      expect(esc?.message).toContain('could not be taken back');
      expect(esc?.message).toContain('1 merge attempt could not resolve it');
      expect(esc?.message).toContain(`\`${getGoal(engine.store.db, goalId)!.branch}\` still holds`);
      // the answer takes it back: a reset by hand could drop what the person committed on top since
      expect(esc?.message).toContain('your answer takes it back');
      expect(esc?.message).not.toContain('before answering');
      expect(engine.store.listByGoal(goalId, 5000).filter((e) => e.type === 'attempt.concluded')).toHaveLength(1);
      // nothing more lands on the unverified commit until the person has dealt with it
      expect(getGoal(engine.store.db, goalId)!.state).toBe('blocked');
    } finally {
      rmSync(join(await sh('git rev-parse --absolute-git-dir', ws), 'index.lock'), { force: true });
    }
    await engine.stop();
  }, 60_000);

  /** a merge attempt whose commit git would not take back (a lock in the goal worktree's git folder), and that lock */
  const stuckWindow = async () => {
    const w = await integrationWindow('case "$PWD" in */baseline*) exit 0;; esac; touch "$(git rev-parse --git-dir)/index.lock"; exit 1');
    expect(w.ok).toBe(false);
    const esc = listEscalations(w.engine.store.db, { goalId: w.goalId, openOnly: true }).find((e) => (e.payload as { kind?: string }).kind === 'merge')!;
    const stuck = await sh('git rev-parse HEAD', w.ws);
    expect(stuck).not.toBe(w.tip);
    return { ...w, esc, stuck, lock: join(await sh('git rev-parse --absolute-git-dir', w.ws), 'index.lock') };
  };

  test('a commit git would not take back is taken back when the person answers, once git lets go', async () => {
    const { engine, ws, tip, esc, lock, goalId } = await stuckWindow();
    rmSync(lock, { force: true });
    await engine.answerEscalation(esc.id, { action: 'retry_with_hint', hint: 'again' });
    expect(await sh('git rev-parse HEAD', ws)).toBe(tip);
    expect(await sh('cat params.txt', ws)).toBe('rev1');
    const notes = engine.store.listByGoal(goalId, 5000).filter((e) => e.type === 'engine.note').map((e) => (e.payload as { message: string }).message);
    expect(notes.some((m) => m.startsWith('took back the unverified resolution'))).toBe(true);
    await engine.stop();
  }, 60_000);

  test('a goal workspace moved off its branch does not settle the commit the branch still holds', async () => {
    const { engine, ws, tip, esc, lock, goalId } = await stuckWindow();
    rmSync(lock, { force: true });
    await sh(`git checkout -q --detach ${tip}`, ws);
    await expect(engine.answerEscalation(esc.id, { action: 'skip_task' })).rejects.toThrow('still ends at the unverified resolution');
    await sh(`git checkout -q ${getGoal(engine.store.db, goalId)!.branch}`, ws);
    await engine.answerEscalation(esc.id, { action: 'skip_task' });
    expect(await sh('git rev-parse HEAD', ws)).toBe(tip);
    await engine.stop();
  }, 60_000);

  test('a goal workspace detached at the commit git would not take back does not settle the branch that holds it', async () => {
    const { engine, ws, tip, esc, stuck, lock, goalId } = await stuckWindow();
    rmSync(lock, { force: true });
    const branch = getGoal(engine.store.db, goalId)!.branch;
    await sh(`git checkout -q --detach ${stuck}`, ws);
    await expect(engine.answerEscalation(esc.id, { action: 'skip_task' })).rejects.toThrow('still ends at the unverified resolution');
    expect(await sh(`git rev-parse refs/heads/${branch}`, ws)).toBe(stuck);
    await sh(`git checkout -q ${branch}`, ws);
    await engine.answerEscalation(esc.id, { action: 'skip_task' });
    expect(await sh(`git rev-parse refs/heads/${branch}`, ws)).toBe(tip);
    await engine.stop();
  }, 60_000);

  test('a stop while a regressed attempt takes its commit back leaves the attempt to the next start, which takes the commit back', async () => {
    const takeBackModule = await import('./take-back.ts');
    // the engine stops while the take-back runs: nothing after it happens
    const spy = spyOn(takeBackModule, 'takeBack').mockImplementation(async () => {
      throw new Error('the engine stopped');
    });
    let w: Awaited<ReturnType<typeof integrationWindow>>;
    try {
      w = await integrationWindow('grep -q "goal side" shared.txt');
    } finally {
      spy.mockRestore();
    }
    expect(w.ok).toBeInstanceOf(Error);
    expect(await sh('git rev-parse HEAD', w.ws)).not.toBe(w.tip);
    await w.engine.stop();
    const next = new Engine(cfg(), new FakeRunner(() => {}));
    next.beginUpdateDrain();
    await next.start();
    expect(await sh('git rev-parse HEAD', w.ws)).toBe(w.tip);
    await next.stop();
  }, 60_000);

  test('a stop after git refused the take-back, before the escalation was raised, leaves the attempt to the next start, which names the commit', async () => {
    const escalationModule = await import('./escalation.ts');
    // the engine stops just as the escalation would be raised
    const spy = spyOn(escalationModule, 'raiseEscalation').mockImplementation(() => {
      throw new Error('the engine stopped');
    });
    let w: Awaited<ReturnType<typeof integrationWindow>>;
    try {
      w = await integrationWindow('case "$PWD" in */baseline*) exit 0;; esac; touch "$(git rev-parse --git-dir)/index.lock"; exit 1');
    } finally {
      spy.mockRestore();
    }
    const lock = join(await sh('git rev-parse --absolute-git-dir', w.ws), 'index.lock');
    try {
      expect(w.ok).toBeInstanceOf(Error);
      await w.engine.stop();
      const next = new Engine(cfg(), new FakeRunner(() => {}));
      next.beginUpdateDrain();
      await next.start();
      const esc = listEscalations(next.store.db, { goalId: w.goalId, openOnly: true }).find((e) => (e.payload as { stuck?: unknown }).stuck);
      expect((esc?.payload as { stuck?: { ref: string } } | undefined)?.stuck?.ref).toBe(await sh('git rev-parse HEAD', w.ws));
      await next.stop();
    } finally {
      rmSync(lock, { force: true });
    }
  }, 60_000);

  test('a second answer while the first one is still being applied is refused', async () => {
    const { engine, esc, lock, goalId } = await stuckWindow();
    // the first answer waits for the goal workspace, which another task's merge holds
    let release: (() => void) | null = null;
    const held = engine.withGoalWsLock(goalId, () => new Promise<void>((r) => (release = r)));
    await waitFor(() => release !== null);
    rmSync(lock, { force: true });
    const first = engine.answerEscalation(esc.id, { action: 'skip_task' });
    await Bun.sleep(100);
    await expect(engine.answerEscalation(esc.id, { action: 'retry_with_hint', hint: 'again' })).rejects.toThrow('being answered already');
    release!();
    await held;
    await first;
    expect(getTask(engine.store.db, 't_rev2')!.state).toBe('skipped');
    await engine.stop();
  }, 60_000);

  test('an answer whose commit is gone already does not wait for another merge holding the goal workspace', async () => {
    const { engine, ws, tip, esc, lock, goalId } = await stuckWindow();
    rmSync(lock, { force: true });
    await sh(`git reset -q --keep ${tip}`, ws);
    let release: (() => void) | null = null;
    const held = engine.withGoalWsLock(goalId, () => new Promise<void>((r) => (release = r)));
    await waitFor(() => release !== null);
    const answered = engine.answerEscalation(esc.id, { action: 'skip_task' });
    expect(await Promise.race([answered.then(() => 'answered'), Bun.sleep(3_000).then(() => 'waiting')])).toBe('answered');
    release!();
    await held;
    await answered;
    await engine.stop();
  }, 60_000);

  test('a goal aborted while git refused to take the commit back gets it taken back when restarted, or the restart says what is left', async () => {
    const { engine, ws, tip, esc, stuck, lock, goalId } = await stuckWindow();
    await engine.answerEscalation(esc.id, { action: 'abort_goal' });
    expect(getGoal(engine.store.db, goalId)!.state).toBe('failed');
    try {
      await expect(engine.restartGoal(goalId)).rejects.toThrow('still refuses');
      expect(await sh('git rev-parse HEAD', ws)).toBe(stuck);
    } finally {
      rmSync(lock, { force: true });
    }
    await engine.restartGoal(goalId);
    expect(await sh('git rev-parse HEAD', ws)).toBe(tip);
    await engine.stop();
  }, 60_000);

  test('an answer while git still refuses is refused, saying what is left to do, and the escalation stays open', async () => {
    const { engine, ws, esc, stuck, lock, goalId } = await stuckWindow();
    try {
      await expect(engine.answerEscalation(esc.id, { action: 'skip_task' })).rejects.toThrow('still refuses');
      expect(await sh('git rev-parse HEAD', ws)).toBe(stuck);
      expect(listEscalations(engine.store.db, { goalId, openOnly: true }).map((e) => e.id)).toContain(esc.id);
    } finally {
      rmSync(lock, { force: true });
    }
    // once it lets go, skipping the task leaves the goal branch without that commit
    await engine.answerEscalation(esc.id, { action: 'skip_task' });
    expect(await sh('git rev-parse HEAD^{tree}', ws)).toBe(await sh(`git rev-parse ${stuck}^^{tree}`, ws));
    await engine.stop();
  }, 60_000);

  test('a commit with others landed on top waits for its revert before the person can answer', async () => {
    const { engine, ws, esc, stuck, lock } = await stuckWindow();
    rmSync(lock, { force: true });
    await sh('git commit -q --allow-empty -m "feat: another task"', ws);
    await expect(engine.answerEscalation(esc.id, { action: 'retry_with_hint', hint: 'again' })).rejects.toThrow('revert');
    await sh(`git revert --no-edit ${stuck}`, ws);
    await engine.answerEscalation(esc.id, { action: 'retry_with_hint', hint: 'again' });
    expect(await sh('cat params.txt', ws)).toBe('rev1');
    await engine.stop();
  }, 60_000);

  test('a resolution by hand after a refused take-back starts from the goal branch as it was', async () => {
    const { startResolution, abortResolution } = await import('./merge-resolve.ts');
    const { engine, ws, tip, lock, goalId } = await stuckWindow();
    try {
      await expect(startResolution(engine, goalId, 't_rev2')).rejects.toThrow('still refuses');
    } finally {
      rmSync(lock, { force: true });
    }
    await startResolution(engine, goalId, 't_rev2');
    const started = engine.store.listByGoalOfTypes(goalId, ['merge.manual_started']).at(-1)!.payload as { base: string };
    expect(started.base).toBe(tip);
    expect(await sh('git rev-parse HEAD', ws)).toBe(tip);
    await abortResolution(engine, goalId, 't_rev2');
    await engine.stop();
  }, 60_000);

  test('a commit that only says it reverts the stuck one, or a revert undone again, is no revert of it', async () => {
    const { engine, ws, esc, stuck, lock } = await stuckWindow();
    rmSync(lock, { force: true });
    await sh(`git commit -q --allow-empty -m "Revert it" -m "This reverts commit ${stuck}."`, ws);
    await expect(engine.answerEscalation(esc.id, { action: 'retry_with_hint', hint: 'again' })).rejects.toThrow('revert');
    await sh(`git revert --no-edit ${stuck}`, ws);
    await sh('git revert --no-edit HEAD', ws);
    await expect(engine.answerEscalation(esc.id, { action: 'retry_with_hint', hint: 'again' })).rejects.toThrow('revert');
    await sh('git revert --no-edit HEAD', ws);
    await engine.answerEscalation(esc.id, { action: 'retry_with_hint', hint: 'again' });
    expect(await sh('cat params.txt', ws)).toBe('rev1');
    await engine.stop();
  }, 60_000);

  /** another task of the goal whose checks passed in its own worktree, started from `base` */
  const otherTask = async (engine: Engine, goalId: string, base: string) => {
    const goal = getGoal(engine.store.db, goalId)!;
    const otherWs = taskWorkspacePath(dataDir, goal, 't_other');
    await sh(`git worktree add -q -b task/t_other "${otherWs}" ${base}`, repo);
    writeFileSync(join(otherWs, 'other.txt'), 'other\n');
    await sh('git add -A && git commit -qm "feat: other"', otherWs);
    const now = new Date().toISOString();
    const task = { id: 't_other', goalId, title: 'other', spec: 's', kind: 'feature', scope: null, scenario: 'general', area: null, tdd: 'inherit', dependsOn: [], relevantFiles: [], parallelizable: true, retryBudget: 3, origin: 'brief', milestone: null, milestoneVisits: 0, checkpointOf: null, difficulty: 'standard', state: 'merging', branch: null, worktreePath: null, baseRef: null, commitRef: null, commitMessage: null, hint: null, extraAttempts: 0, delegatedGoalId: null, summary: null, createdAt: now, updatedAt: now } as Task;
    engine.store.append({ type: 'task.created', goalId, payload: { task } });
    engine.store.append({ type: 'task.workspace_assigned', goalId, payload: { taskId: 't_other', branch: 'task/t_other', worktreePath: otherWs } });
  };

  test('another task does not land on a commit git would not take back, nor on one others landed on top of without its revert', async () => {
    const { engine, ws, tip, stuck, lock, goalId } = await stuckWindow();
    await otherTask(engine, goalId, tip);
    const integrate = () => integrateTask(engine, getGoal(engine.store.db, goalId)!, getTask(engine.store.db, 't_other')!);
    try {
      const r = await integrate();
      expect(r.merged).toBe(false);
      expect((r as { held?: string }).held).toContain('still refuses');
      expect(await sh('git rev-parse HEAD', ws)).toBe(stuck);
    } finally {
      rmSync(lock, { force: true });
    }
    // git lets go, but a commit landed on top of it and nothing undid it
    await sh('git commit -q --allow-empty -m "feat: another task"', ws);
    const top = await sh('git rev-parse HEAD', ws);
    expect((await integrate()).merged).toBe(false);
    expect(await sh('git rev-parse HEAD', ws)).toBe(top);
    // reverted: the task lands, and nothing of the unverified resolution with it
    await sh(`git revert --no-edit ${stuck}`, ws);
    expect((await integrate()).merged).toBe(true);
    expect(await sh('cat other.txt', ws)).toBe('other');
    expect(await sh('cat params.txt', ws)).toBe('rev1');
    await engine.stop();
  }, 60_000);

  test('a task whose checks passed while the goal branch ends at an unverified commit waits, and lands once the person has dealt with it', async () => {
    const { catchUpAndLand } = (await import('./catchup.ts')) as unknown as { catchUpAndLand: (engine: Engine, goalId: string, taskId: string, lost: () => boolean, pollMs?: number) => Promise<{ merged: boolean } | null> };
    const { engine, ws, tip, esc, lock, goalId } = await stuckWindow();
    await otherTask(engine, goalId, tip);
    let landed: { merged: boolean } | null | 'waiting' = 'waiting';
    const landing = catchUpAndLand(engine, goalId, 't_other', () => false, 20).then((r) => (landed = r));
    await Bun.sleep(1_500);
    expect(landed).toBe('waiting');
    const notes = engine.store.listByGoal(goalId, 5000).filter((e) => e.type === 'engine.note').map((e) => (e.payload as { message: string }).message);
    expect(notes.some((m) => m.includes('"other" passed its checks and waits to land'))).toBe(true);
    rmSync(lock, { force: true });
    await engine.answerEscalation(esc.id, { action: 'skip_task' });
    await landing;
    expect(landed).toMatchObject({ merged: true });
    expect(await sh('cat other.txt', ws)).toBe('other');
    expect(await sh('cat params.txt', ws)).toBe('rev1');
    await engine.stop();
  }, 60_000);

  test('the goal stays blocked while another commit git would not take back is still open', async () => {
    const { engine, ws, tip, esc, lock, goalId } = await stuckWindow();
    rmSync(lock, { force: true });
    await otherTask(engine, goalId, tip);
    stuckEscalation(engine, goalId, 't_other', { cwd: ws, base: tip, ref: tip });
    await engine.answerEscalation(esc.id, { action: 'skip_task' });
    expect(getGoal(engine.store.db, goalId)!.state).toBe('blocked');
    await engine.stop();
  }, 60_000);

  test('a restart does not close the escalation of a commit git still refuses to take back; once git lets go, the restart takes it back', async () => {
    const { engine, ws, tip, esc, stuck, lock, goalId } = await stuckWindow();
    try {
      await expect(engine.restartGoal(goalId, { fromTaskId: 't_rev2' })).rejects.toThrow('still refuses');
      expect(listEscalations(engine.store.db, { goalId, openOnly: true }).map((e) => e.id)).toContain(esc.id);
      expect(await sh('git rev-parse HEAD', ws)).toBe(stuck);
    } finally {
      rmSync(lock, { force: true });
    }
    await engine.restartGoal(goalId, { fromTaskId: 't_rev2' });
    expect(await sh('git rev-parse HEAD', ws)).toBe(tip);
    await engine.stop();
  }, 60_000);

  test('a must check that cannot run proves nothing: the attempt does not land, and its commit and the exports laid over are taken back', async () => {
    // the checks' output folder is a file: every check run throws before it can say how it went
    const { engine, ws, ok, tip, backup, goalId } = await integrationWindow(undefined, { beforeResolve: () => writeFileSync(join(dataDir, 'check-output'), 'in the way') });
    expect(ok).toBe(false);
    // a second paid session cannot make checks run that cannot: no further attempt
    expect(engine.store.listByGoal(goalId, 5000).filter((e) => e.type === 'attempt.concluded')).toHaveLength(1);
    expect(await sh('git rev-parse HEAD', ws)).toBe(tip);
    expect(readFileSync(join(ws, 'artifacts', 'part.step'), 'utf8')).toBe('rev1\n');
    expect(existsSync(join(ws, 'artifacts', 'drawing.pdf'))).toBe(false);
    expect(existsSync(backup)).toBe(false);
    await engine.stop();
  }, 60_000);

  test("a merge attempt does not measure its baseline over exports another merge left laid over: it fails and says why", async () => {
    const { contentHash } = await import('./workspace.ts');
    const { engine, ok, goalId } = await integrationWindow(undefined, {
      // another task's overlay whose undo cannot finish: the goal's saved copy of part.step is gone
      beforeResolve: async ({ goal, ws }) => {
        const backup = overlayBackupPath(dataDir, goal, 't_other');
        mkdirSync(backup, { recursive: true });
        writeFileSync(join(backup, 'list'), `${JSON.stringify({ f: 'part.step', saved: true, hash: await contentHash(join(ws, 'artifacts', 'part.step')) })}\n`);
      },
    });
    expect(ok).toBe(false);
    const reasons = engine.store.listByGoal(goalId, 5000).filter((e) => e.type === 'attempt.concluded').map((e) => (e.payload as { reason: string }).reason);
    expect(reasons.some((r) => r.includes('could not all be put back'))).toBe(true);
    await engine.stop();
  }, 60_000);
});

describe('a merge attempt the engine stopped during', () => {
  /** a merge attempt that committed its resolution, then the engine stopped while its checks ran; `recorded`: it recorded the commit (attempts from before that was recorded did not) */
  const cutShort = async (opts: { recorded?: boolean } = {}) => {
    const engine = new Engine(cfg(), new FakeRunner(() => {}));
    engine.beginUpdateDrain();
    const draft = await engine.createGoal({ prompt: 'a part', repoPath: repo });
    const goal = getGoal(engine.store.db, draft.id)!;
    const ws = await ensureGoalWorkspace(dataDir, goal);
    writeFileSync(join(ws, 'kept.txt'), 'goal side\n');
    await sh('git add -A && git commit -qm "feat: the goal side"', ws);
    const tip = await sh('git rev-parse HEAD', ws);
    const now = new Date().toISOString();
    const task = { id: 't_cut', goalId: goal.id, title: 'cut', spec: 's', kind: 'feature', scope: null, scenario: 'general', area: null, tdd: 'inherit', dependsOn: [], relevantFiles: [], parallelizable: true, retryBudget: 3, origin: 'brief', milestone: null, milestoneVisits: 0, checkpointOf: null, difficulty: 'standard', state: 'merging', branch: 'task/t_cut', worktreePath: null, baseRef: null, commitRef: null, commitMessage: null, hint: null, extraAttempts: 0, delegatedGoalId: null, summary: null, createdAt: now, updatedAt: now } as Task;
    engine.store.append({ type: 'task.created', goalId: goal.id, payload: { task } });
    const attemptId = newId(IdPrefix.attempt);
    engine.store.append({ type: 'attempt.started', goalId: goal.id, payload: { attempt: { id: attemptId, goalId: goal.id, taskId: 't_cut', index: 1, kind: 'merge', sessionId: null, model: null, state: 'running', costUsd: 0, numTurns: 0, resultSubtype: null, baseRef: tip, endRef: null, pid: null, cwd: ws, transcriptPath: null, startedAt: now, endedAt: null, skillsUsed: [], continuations: 0, sessions: [] } } });
    writeFileSync(join(ws, 'resolved.txt'), 'by the merger\n');
    await sh('git add -A && git commit -qm "feat: cut" -m "Resolved by merge attempt 1"', ws);
    if (opts.recorded !== false) engine.store.append({ type: 'attempt.committed', goalId: goal.id, payload: { attemptId, ref: await sh('git rev-parse HEAD', ws) } });
    // a file of a task working in the goal workspace, not part of that commit
    writeFileSync(join(ws, 'kept.txt'), 'being edited\n');
    await engine.stop();
    return { goal, ws, tip, resolved: await sh('git rev-parse HEAD', ws) };
  };

  test('a commit git would not take back at the next start is named on an escalation that blocks the goal until it is dealt with', async () => {
    const { goal, ws, tip, resolved } = await cutShort();
    const lock = join(await sh('git rev-parse --absolute-git-dir', ws), 'index.lock');
    writeFileSync(lock, '');
    const next = new Engine(cfg(), new FakeRunner(() => {}));
    next.beginUpdateDrain();
    let id = '';
    try {
      await next.start();
      const esc = listEscalations(next.store.db, { goalId: goal.id, openOnly: true }).find((e) => (e.payload as { stuck?: unknown }).stuck);
      expect(esc?.taskId).toBe('t_cut');
      expect((esc!.payload as { stuck: unknown }).stuck).toEqual({ cwd: ws, base: tip, ref: resolved, branch: goal.branch });
      expect(getGoal(next.store.db, goal.id)!.state).toBe('blocked');
      expect(getTask(next.store.db, 't_cut')!.state).toBe('blocked');
      expect(await sh('git rev-parse HEAD', ws)).toBe(resolved);
      id = esc!.id;
    } finally {
      rmSync(lock, { force: true });
    }
    await next.answerEscalation(id, { action: 'skip_task' });
    expect(await sh('git rev-parse HEAD', ws)).toBe(tip);
    expect(readFileSync(join(ws, 'kept.txt'), 'utf8')).toBe('being edited\n');
    await next.stop();
  }, 60_000);

  test("only the stopped attempt's own commit is taken back: a later verified commit on the same base, in the same words, stays", async () => {
    const engine = new Engine(cfg(), new FakeRunner(() => {}));
    engine.beginUpdateDrain();
    const draft = await engine.createGoal({ prompt: 'a part', repoPath: repo });
    const goal = getGoal(engine.store.db, draft.id)!;
    const ws = await ensureGoalWorkspace(dataDir, goal);
    const tip = await sh('git rev-parse HEAD', ws);
    const now = new Date().toISOString();
    const task = { id: 't_cut', goalId: goal.id, title: 'cut', spec: 's', kind: 'feature', scope: null, scenario: 'general', area: null, tdd: 'inherit', dependsOn: [], relevantFiles: [], parallelizable: true, retryBudget: 3, origin: 'brief', milestone: null, milestoneVisits: 0, checkpointOf: null, difficulty: 'standard', state: 'merging', branch: 'task/t_cut', worktreePath: null, baseRef: null, commitRef: null, commitMessage: null, hint: null, extraAttempts: 0, delegatedGoalId: null, summary: null, createdAt: now, updatedAt: now } as Task;
    engine.store.append({ type: 'task.created', goalId: goal.id, payload: { task } });
    const attemptId = newId(IdPrefix.attempt);
    // an attempt left running (it threw before it could conclude) had committed a resolution, since taken back
    engine.store.append({ type: 'attempt.started', goalId: goal.id, payload: { attempt: { id: attemptId, goalId: goal.id, taskId: 't_cut', index: 1, kind: 'merge', sessionId: null, model: null, state: 'running', costUsd: 0, numTurns: 0, resultSubtype: null, baseRef: tip, endRef: null, pid: null, cwd: ws, transcriptPath: null, startedAt: now, endedAt: null, skillsUsed: [], continuations: 0, sessions: [] } } });
    writeFileSync(join(ws, 'first.txt'), 'first\n');
    await sh('git add -A && git commit -qm "feat: cut" -m "Resolved by merge attempt 1"', ws);
    engine.store.append({ type: 'attempt.committed', goalId: goal.id, payload: { attemptId, ref: await sh('git rev-parse HEAD', ws) } });
    await sh(`git reset -q --hard ${tip}`, ws);
    // a later merge of the task, verified, landed on the same base
    writeFileSync(join(ws, 'second.txt'), 'second\n');
    await sh('git add -A && git commit -qm "feat: cut" -m "Resolved by merge attempt 1"', ws);
    const verified = await sh('git rev-parse HEAD', ws);
    await engine.stop();
    const next = new Engine(cfg(), new FakeRunner(() => {}));
    next.beginUpdateDrain();
    await next.start();
    expect(await sh('git rev-parse HEAD', ws)).toBe(verified);
    await next.stop();
  }, 60_000);

  test("a commit made on top of the stopped attempt's commit while the engine was down leaves that commit named on an escalation", async () => {
    const { goal, ws, tip, resolved } = await cutShort();
    await sh('git commit -q --allow-empty -m "wip: by hand"', ws);
    const next = new Engine(cfg(), new FakeRunner(() => {}));
    next.beginUpdateDrain();
    await next.start();
    const esc = listEscalations(next.store.db, { goalId: goal.id, openOnly: true }).find((e) => (e.payload as { stuck?: unknown }).stuck);
    expect((esc?.payload as { stuck?: unknown } | undefined)?.stuck).toMatchObject({ base: tip, ref: resolved });
    expect(esc!.message).toContain('revert');
    expect(await sh('git rev-parse HEAD^', ws)).toBe(resolved);
    await next.stop();
  }, 60_000);

  test('an attempt from before commits were recorded has its resolution on top of where it started taken back', async () => {
    const { ws, tip } = await cutShort({ recorded: false });
    const next = new Engine(cfg(), new FakeRunner(() => {}));
    next.beginUpdateDrain();
    await next.start();
    expect(await sh('git rev-parse HEAD', ws)).toBe(tip);
    await next.stop();
  }, 60_000);

  test('a task that was waiting to land when the engine stopped runs again at the next start, its attempt given back', async () => {
    const engine = new Engine(cfg(), new FakeRunner(() => {}));
    engine.beginUpdateDrain();
    const draft = await engine.createGoal({ prompt: 'a part', repoPath: repo });
    await ensureGoalWorkspace(dataDir, getGoal(engine.store.db, draft.id)!);
    const now = new Date().toISOString();
    const task = { id: 't_wait', goalId: draft.id, title: 'wait', spec: 's', kind: 'feature', scope: null, scenario: 'general', area: null, tdd: 'inherit', dependsOn: [], relevantFiles: [], parallelizable: true, retryBudget: 3, origin: 'brief', milestone: null, milestoneVisits: 0, checkpointOf: null, difficulty: 'standard', state: 'merging', branch: null, worktreePath: null, baseRef: null, commitRef: null, commitMessage: null, hint: null, extraAttempts: 0, delegatedGoalId: null, summary: null, createdAt: now, updatedAt: now } as Task;
    engine.store.append({ type: 'task.created', goalId: draft.id, payload: { task } });
    await engine.stop();
    const next = new Engine(cfg(), new FakeRunner(() => {}));
    next.beginUpdateDrain();
    await next.start();
    expect(getTask(next.store.db, 't_wait')).toMatchObject({ state: 'ready', extraAttempts: 1 });
    await next.stop();
  }, 60_000);

  test("a task whose merge attempt the engine stopped during gets that attempt back: its work had passed", async () => {
    const engine = new Engine(cfg(), new FakeRunner(() => {}));
    engine.beginUpdateDrain();
    const draft = await engine.createGoal({ prompt: 'a part', repoPath: repo });
    const ws = await ensureGoalWorkspace(dataDir, getGoal(engine.store.db, draft.id)!);
    const now = new Date().toISOString();
    const task = { id: 't_land', goalId: draft.id, title: 'land', spec: 's', kind: 'feature', scope: null, scenario: 'general', area: null, tdd: 'inherit', dependsOn: [], relevantFiles: [], parallelizable: true, retryBudget: 3, origin: 'brief', milestone: null, milestoneVisits: 0, checkpointOf: null, difficulty: 'standard', state: 'merging', branch: null, worktreePath: null, baseRef: null, commitRef: null, commitMessage: null, hint: null, extraAttempts: 0, delegatedGoalId: null, summary: null, createdAt: now, updatedAt: now } as Task;
    engine.store.append({ type: 'task.created', goalId: draft.id, payload: { task } });
    // its merge attempt was still resolving the conflict: nothing committed yet
    engine.store.append({ type: 'attempt.started', goalId: draft.id, payload: { attempt: { id: newId(IdPrefix.attempt), goalId: draft.id, taskId: 't_land', index: 1, kind: 'merge', sessionId: null, model: null, state: 'running', costUsd: 0, numTurns: 0, resultSubtype: null, baseRef: await sh('git rev-parse HEAD', ws), endRef: null, pid: null, cwd: ws, transcriptPath: null, startedAt: now, endedAt: null, skillsUsed: [], continuations: 0, sessions: [] } } });
    await engine.stop();
    const next = new Engine(cfg(), new FakeRunner(() => {}));
    next.beginUpdateDrain();
    await next.start();
    expect(getTask(next.store.db, 't_land')).toMatchObject({ state: 'ready', extraAttempts: 1 });
    await next.stop();
  }, 60_000);

  test("its commit is taken back at the next start: the merge did not land, so the branch is as it was", async () => {
    const { ws, tip } = await cutShort();
    const next = new Engine(cfg(), new FakeRunner(() => {}));
    next.beginUpdateDrain();
    await next.start();
    expect(await sh('git rev-parse HEAD', ws)).toBe(tip);
    expect(existsSync(join(ws, 'resolved.txt'))).toBe(false);
    expect(readFileSync(join(ws, 'kept.txt'), 'utf8')).toBe('being edited\n');
    await next.stop();
  }, 60_000);
});

describe('a revert of a commit git would not take back', () => {
  test('is told by its exact changes: one that differs only in whitespace is no revert, the exact inverse is', async () => {
    const { takeBackStuck } = await import('./take-back.ts');
    const engine = new Engine(cfg(), new FakeRunner(() => {}));
    engine.beginUpdateDrain();
    const draft = await engine.createGoal({ prompt: 'p', repoPath: repo });
    const goal = getGoal(engine.store.db, draft.id)!;
    const ws = await ensureGoalWorkspace(dataDir, goal);
    writeFileSync(join(ws, 'token.txt'), 'token = "AB"\n');
    await sh('git add -A && git commit -qm "feat: token"', ws);
    const base = await sh('git rev-parse HEAD', ws);
    writeFileSync(join(ws, 'token.txt'), 'token = "A B"\n');
    await sh('git commit -qam "feat: token" -m "Resolved by merge attempt 1"', ws);
    const ref = await sh('git rev-parse HEAD', ws);
    const stuck = { cwd: ws, base, ref, branch: goal.branch };
    // ignoring whitespace, this change reads as the inverse of the one above
    writeFileSync(join(ws, 'token.txt'), 'token = "A  B"\n');
    await sh('git commit -qam "fix: token"', ws);
    expect(await takeBackStuck(engine, goal, stuck)).toContain('revert');
    // a revert under another commit on top of it
    await sh(`git reset -q --hard ${ref}`, ws);
    writeFileSync(join(ws, 'other.txt'), 'other\n');
    await sh('git add -A && git commit -qm "feat: other"', ws);
    await sh(`git revert --no-edit ${ref}`, ws);
    expect(await takeBackStuck(engine, goal, stuck)).toBeNull();
    await engine.stop();
  }, 60_000);

  test("a change that differs from the inverse only in a line's trailing whitespace is no revert", async () => {
    const { takeBackStuck } = await import('./take-back.ts');
    const engine = new Engine(cfg(), new FakeRunner(() => {}));
    engine.beginUpdateDrain();
    const draft = await engine.createGoal({ prompt: 'p', repoPath: repo });
    const goal = getGoal(engine.store.db, draft.id)!;
    const ws = await ensureGoalWorkspace(dataDir, goal);
    // in Markdown, two trailing spaces are a line break
    writeFileSync(join(ws, 'notes.md'), 'go  \n');
    await sh('git add -A && git commit -qm "docs: notes"', ws);
    const base = await sh('git rev-parse HEAD', ws);
    writeFileSync(join(ws, 'notes.md'), 'go\n');
    await sh('git commit -qam "docs: notes" -m "Resolved by merge attempt 1"', ws);
    const ref = await sh('git rev-parse HEAD', ws);
    writeFileSync(join(ws, 'notes.md'), 'go\t\n');
    await sh('git commit -qam "docs: notes again"', ws);
    expect(await takeBackStuck(engine, goal, { cwd: ws, base, ref, branch: goal.branch })).toContain('revert');
    await engine.stop();
  }, 60_000);
});

describe('a catch-up meets only verified commits on the goal branch', () => {
  /** a goal whose task t_late, in its own worktree, made a commit; nothing runs on its own */
  const lateTask = async () => {
    const engine = new Engine(cfg(), new FakeRunner(() => {}));
    engine.beginUpdateDrain();
    const draft = await engine.createGoal({ prompt: 'p', repoPath: repo });
    const goal = getGoal(engine.store.db, draft.id)!;
    const ws = await ensureGoalWorkspace(dataDir, goal);
    const tip = await sh('git rev-parse HEAD', ws);
    const taskWs = taskWorkspacePath(dataDir, goal, 't_late');
    await sh(`git worktree add -q -b task/t_late "${taskWs}" ${tip}`, repo);
    writeFileSync(join(taskWs, 'late.txt'), 'late\n');
    await sh('git add -A && git commit -qm "feat: late"', taskWs);
    const now = new Date().toISOString();
    const task = { id: 't_late', goalId: goal.id, title: 'late', spec: 's', kind: 'feature', scope: null, scenario: 'general', area: null, tdd: 'inherit', dependsOn: [], relevantFiles: [], parallelizable: true, retryBudget: 3, origin: 'brief', milestone: null, milestoneVisits: 0, checkpointOf: null, difficulty: 'standard', state: 'merging', branch: null, worktreePath: null, baseRef: null, commitRef: null, commitMessage: null, hint: null, extraAttempts: 0, delegatedGoalId: null, summary: null, createdAt: now, updatedAt: now } as Task;
    engine.store.append({ type: 'task.created', goalId: goal.id, payload: { task } });
    engine.store.append({ type: 'task.workspace_assigned', goalId: goal.id, payload: { taskId: 't_late', branch: 'task/t_late', worktreePath: taskWs } });
    return { engine, goal, ws, tip, taskWs, task: () => getTask(engine.store.db, 't_late')! };
  };
  /** another task's merge attempt in the goal workspace: its resolution committed, its checks running until `release`, then taken back */
  const attemptRunning = async (engine: Engine, goal: Goal, ws: string, tip: string) => {
    let release: (() => void) | null = null;
    const held = engine.withGoalWsLock(goal.id, async () => {
      writeFileSync(join(ws, 'unverified.txt'), 'x\n');
      await sh('git add -A && git commit -qm "feat: other" -m "Resolved by merge attempt 1"', ws);
      await new Promise<void>((r) => (release = r));
      await sh(`git reset -q --hard ${tip}`, ws);
    });
    await waitFor(() => release !== null);
    return { release: () => release!(), held };
  };

  test("the catch-up before a landing waits for another merge attempt's checks, so it never merges a commit taken back after them", async () => {
    const { catchUp } = await import('./catchup.ts');
    const { engine, goal, ws, tip, taskWs, task } = await lateTask();
    const attempt = await attemptRunning(engine, goal, ws, tip);
    const catching = catchUp(engine, goal, task(), { escalate: true });
    await Bun.sleep(300);
    attempt.release();
    await attempt.held;
    await catching;
    expect(existsSync(join(taskWs, 'unverified.txt'))).toBe(false);
    await engine.stop();
  }, 60_000);

  test("the catch-up before a task starts does not wait for another task's merge: it is left to the one before the landing", async () => {
    const { catchUp } = await import('./catchup.ts');
    const { engine, goal, ws, tip, taskWs, task } = await lateTask();
    const attempt = await attemptRunning(engine, goal, ws, tip);
    const r = await catchUp(engine, goal, task(), { escalate: false, ifIdle: true } as { escalate: boolean });
    expect(r.moved).toBe(false);
    expect(existsSync(join(taskWs, 'unverified.txt'))).toBe(false);
    attempt.release();
    await attempt.held;
    await engine.stop();
  }, 60_000);

  test('a catch-up does not merge a commit git would not take back', async () => {
    const { catchUp } = await import('./catchup.ts');
    const { engine, goal, ws, tip, taskWs, task } = await lateTask();
    writeFileSync(join(ws, 'unverified.txt'), 'x\n');
    await sh('git add -A && git commit -qm "feat: other" -m "Resolved by merge attempt 1"', ws);
    stuckEscalation(engine, goal.id, null, { cwd: ws, base: tip, ref: await sh('git rev-parse HEAD', ws) });
    const lock = join(await sh('git rev-parse --absolute-git-dir', ws), 'index.lock');
    writeFileSync(lock, '');
    try {
      const r = await catchUp(engine, goal, task(), { escalate: true });
      expect((r as { held?: string }).held).toContain('still refuses');
      expect(existsSync(join(taskWs, 'unverified.txt'))).toBe(false);
    } finally {
      rmSync(lock, { force: true });
    }
    await engine.stop();
  }, 60_000);
});

describe('integration and landing in one step', () => {
  test("nothing else on the goal workspace runs between a task's commit and the landing of its exports", async () => {
    const engine = new Engine(cfg(), new FakeRunner(() => {}));
    engine.beginUpdateDrain();
    const draft = await engine.createGoal({ prompt: 'a part', repoPath: repo });
    engine.store.append({ type: 'goal.nature_set', goalId: draft.id, payload: { nature: 'cad', reason: 'a model' } });
    const goal = getGoal(engine.store.db, draft.id)!;
    const ws = await ensureGoalWorkspace(dataDir, goal);
    await sh('echo /artifacts/ >> .git/info/exclude', repo);
    const taskWs = taskWorkspacePath(dataDir, goal, 't_part');
    await sh(`git worktree add -q -b task/t_part "${taskWs}" ${goal.branch}`, repo);
    writeFileSync(join(taskWs, 'part.txt'), 'part\n');
    mkdirSync(join(taskWs, 'artifacts'), { recursive: true });
    writeFileSync(join(taskWs, 'artifacts', 'part.step'), 'step\n');
    const now = new Date().toISOString();
    const task = { id: 't_part', goalId: goal.id, title: 'part', spec: 'model the part', kind: 'feature', scope: null, scenario: 'cad', area: null, tdd: 'inherit', dependsOn: [], relevantFiles: [], parallelizable: true, retryBudget: 3, origin: 'brief', milestone: null, milestoneVisits: 0, checkpointOf: null, difficulty: 'standard', state: 'merging', branch: null, worktreePath: null, baseRef: null, commitRef: null, commitMessage: null, hint: null, extraAttempts: 0, delegatedGoalId: null, summary: null, createdAt: now, updatedAt: now } as Task;
    engine.store.append({ type: 'task.created', goalId: goal.id, payload: { task } });
    engine.store.append({ type: 'task.workspace_assigned', goalId: goal.id, payload: { taskId: task.id, branch: 'task/t_part', worktreePath: taskWs } });
    const integrating = integrateTask(engine, getGoal(engine.store.db, goal.id)!, getTask(engine.store.db, task.id)!);
    const seen = engine.withGoalWsLock(goal.id, async () => existsSync(join(ws, 'artifacts', 'part.step')));
    expect((await integrating).merged).toBe(true);
    expect(await seen).toBe(true);
    await engine.stop();
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
        questions: [], styleOptions: [],
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
    const ws = goalWorkspacePath(dataDir, goal);
    expect(await sh('cat shared.txt', ws)).toBe('merged by the fake merger');
    const notes = engine.store.listByGoal(goal.id, 5000).filter((e) => e.type === 'engine.note').map((e) => (e.payload as { message: string }).message);
    expect(notes.some((m) => m.includes('already failing on the goal branch'))).toBe(true);
    expect(existsSync(baselineWorkspacePath(dataDir, goal))).toBe(false);
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
      brief: { title: 'feat: two', understanding: 'u', areas: [], assumptions: [], questions: [], styleOptions: [], costEstimateUsd: 0, timeEstimateMin: 0, tasks: [t('T1', 'add alpha', [], true), t('T2', 'add beta', [], true)], checks: [c('C1', 'T1', 'test -f "add alpha.txt"'), c('C2', 'T2', 'test -f "add beta.txt"'), c('G', null, 'test -f "add alpha.txt" && test -f "add beta.txt"')] },
    });
    goalId = goal.id;
    await waitFor(() => terminal(getGoal(engine.store.db, goal.id)!.state), 40_000);
    expect(getGoal(engine.store.db, goal.id)!.state).toBe('done');
    const beta = listTasks(engine.store.db, goal.id).find((x) => x.title === 'add beta')!;
    const ev = engine.store.listByGoal(goal.id, 5000);
    // the catch-up merged the goal branch into beta's task branch before landing (task.branch itself is cleared at done)
    expect(ev.some((e) => e.type === 'merge.started' && (e.payload as any).taskId === beta.id && (e.payload as any).into === `task/${beta.id}`)).toBe(true);
    expect(ev.some((e) => e.type === 'engine.note' && String((e.payload as any).message).startsWith('catch-up: merged 1 goal-branch commit'))).toBe(true);
    expect(ev.filter((e) => e.type === 'merge.conflict')).toHaveLength(0);
    const ws = goalWorkspacePath(dataDir, goal);
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
      brief: { title: 'feat: overlap', understanding: 'u', areas: [], assumptions: [], questions: [], styleOptions: [], costEstimateUsd: 0, timeEstimateMin: 0, tasks: [overlapping('T1', 'add one'), overlapping('T2', 'add two')], checks: [c('C1', 'T1', 'test -f "add one.txt"'), c('C2', 'T2', 'test -f "add two.txt"'), c('G', null, 'test -f "add one.txt" && test -f "add two.txt"')] },
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
      brief: { title: 'feat: two', understanding: 'u', areas: [], assumptions: [], questions: [], styleOptions: [], costEstimateUsd: 0, timeEstimateMin: 0, tasks: [t('T1', 'add alpha', [], true), t('T2', 'add beta', [], true)], checks: [c('C1', 'T1', 'test -f "add alpha.txt"'), c('C2', 'T2', 'test -f "add beta.txt"'), c('G', null, 'test -f "add alpha.txt"')] },
    });
    await waitFor(() => terminal(getGoal(engine.store.db, goal.id)!.state), 40_000);
    expect(getGoal(engine.store.db, goal.id)!.state).toBe('done');
    const alpha = listTasks(engine.store.db, goal.id).find((x) => x.title === 'add alpha')!;
    expect(alpha.worktreePath).toBeNull(); // the pointer is cleared when the worktree is dropped at done
    expect(existsSync(taskWorkspacePath(dataDir, goal, alpha.id))).toBe(false); // dropped when it finished
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
