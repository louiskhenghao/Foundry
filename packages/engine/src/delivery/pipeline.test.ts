import { beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { getGoal, listTasks } from '@ai-engine/core';
import { defaultConfig } from '../config.ts';
import { Engine } from '../engine.ts';
import { FakeRunner, makeRepoWithRemote, sh, terminal, waitFor } from '../test-helpers.ts';
import { FakeGh } from './gh.fake.ts';

const ROOT = resolve(import.meta.dir, '../../../..');
let dataDir: string;
let repo: string;
let bare: string;
beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'ai-engine-deliv-data-'));
  ({ repo, bare } = await makeRepoWithRemote());
});
// temp dirs are intentionally not removed: background ticks may still be writing when a test ends

const cfg = () => defaultConfig(ROOT, { dataDir, claudeHome: join(dataDir, 'claude-home'), alwaysReviewTasks: false, log: () => {}, delivery: { pollMs: 10, noChecksGraceMs: 30, checksTimeoutMs: 3000, automergeWaitMs: 200 } });
const worker = () => new FakeRunner((spec) => writeFileSync(join(spec.cwd, 'done.txt'), 'ok'));
const eventsOf = (engine: Engine, goalId: string): string[] => engine.store.listByGoal(goalId, 5000).map((e) => e.type as string);
const deliveredStatus = (engine: Engine, goalId: string) => getGoal(engine.store.db, goalId)!.delivery;

describe('delivery pipeline', () => {
  test('push mode: branch lands on the bare remote, every remote action is audited', async () => {
    const engine = new Engine(cfg(), worker(), new FakeGh(bare));
    const goal = await engine.createGoal({ prompt: 'push me', repoPath: repo, autoBrief: { mustChecks: ['test -f done.txt'] }, delivery: { mode: 'push' } });
    await waitFor(() => ['delivered', 'failed'].includes(deliveredStatus(engine, goal.id).status), 20_000);
    const d = deliveredStatus(engine, goal.id);
    expect(d).toMatchObject({ status: 'delivered', outcome: 'pushed' });
    const remoteBranches = await sh("git branch --format='%(refname:short)'", bare);
    expect(remoteBranches.split('\n')).toContain(goal.branch);
    const ev = eventsOf(engine, goal.id);
    expect(ev).toContain('delivery.started');
    expect(ev).toContain('delivery.pushed');
    expect(ev.filter((t) => t === 'delivery.command').length).toBeGreaterThan(0);
    const cmds = engine.store.listByGoal(goal.id, 5000).filter((e) => e.type === 'delivery.command').map((e) => (e.payload as any).command as string);
    expect(cmds.some((c) => c.includes('--force') || c.includes(' +refs'))).toBe(false);
  });

  test('pr-automerge happy path: PR opened, checks pass, merged, remote branch deleted; base == goal head', async () => {
    const gh = new FakeGh(bare);
    const engine = new Engine(cfg(), worker(), gh);
    const goal = await engine.createGoal({ prompt: 'merge me', repoPath: repo, autoBrief: { mustChecks: ['test -f done.txt'] }, delivery: { mode: 'pr-automerge' } });
    await waitFor(() => ['delivered', 'failed'].includes(deliveredStatus(engine, goal.id).status), 20_000);
    const d = deliveredStatus(engine, goal.id);
    expect(d.error).toBeNull();
    expect(d).toMatchObject({ status: 'delivered', outcome: 'merged', checks: 'passing' });
    expect(d.pr?.number).toBe(1);
    const ev = eventsOf(engine, goal.id);
    for (const t of ['delivery.started', 'delivery.pushed', 'delivery.pr_opened', 'delivery.checks', 'delivery.merged', 'delivery.completed']) expect(ev).toContain(t);
    expect(ev.indexOf('delivery.pr_opened')).toBeLessThan(ev.indexOf('delivery.merged'));
    const goalHead = await sh('git rev-parse HEAD', join(dataDir, 'worktrees', goal.id, '_goal'));
    expect(await sh('git rev-parse main', bare)).toBe(goalHead);
    expect((await sh("git branch --format='%(refname:short)'", bare)).split('\n')).not.toContain(goal.branch);
    expect(gh.calls.some((c) => c[0] === 'prMerge' && c[3] === 'now')).toBe(true);
  });

  test('base moved with a conflict: sync task resolves via Merge Attempt, then merges', async () => {
    const gh = new FakeGh(bare);
    // worker: attempts edit README (conflicting with what main will get); merge attempts resolve the conflict
    const runner = new FakeRunner(async (spec) => {
      if (spec.label?.startsWith('merge')) {
        writeFileSync(join(spec.cwd, 'README.md'), 'resolved by merger\n');
        await sh('git add README.md', spec.cwd);
        return;
      }
      writeFileSync(join(spec.cwd, 'README.md'), 'goal version\n');
      writeFileSync(join(spec.cwd, 'done.txt'), 'ok');
    });
    const engine = new Engine(cfg(), runner, gh);
    const goal = await engine.createGoal({ prompt: 'conflict me', repoPath: repo, autoBrief: { mustChecks: ['test -f done.txt'] }, delivery: { mode: 'pr-automerge' } });
    // someone else pushes a conflicting change to origin/main while the goal runs
    const other = mkdtempSync(join(tmpdir(), 'ai-engine-other-'));
    await sh(`git clone -q ${bare} . && printf 'upstream version\\n' > README.md && git -c user.name=o -c user.email=o@o commit -qam upstream && git push -q origin main`, other);
    await waitFor(() => ['delivered', 'failed'].includes(deliveredStatus(engine, goal.id).status), 30_000);
    const d = deliveredStatus(engine, goal.id);
    expect(d.error).toBeNull();
    expect(d.outcome).toBe('merged');
    const sync = listTasks(engine.store.db, goal.id).find((t) => t.origin === 'merge');
    expect(sync?.state).toBe('done');
    expect(eventsOf(engine, goal.id)).toContain('merge.conflict');
    expect(await sh('git show main:README.md', bare)).toBe('resolved by merger');
    rmSync(other, { recursive: true, force: true });
  });

  test('failing checks → one fix-CI task → green → merged; fixCiCycles 0 fails instead', async () => {
    const gh = new FakeGh(bare);
    gh.checksSequence = ['failing', 'passing'];
    gh.failedLogText = 'Error: lint failed on src/x.ts';
    const runner = new FakeRunner((spec) => {
      writeFileSync(join(spec.cwd, 'done.txt'), 'ok');
      if (spec.label?.includes('CI pass')) writeFileSync(join(spec.cwd, 'ci-fix.txt'), 'fixed');
    });
    const engine = new Engine(cfg(), runner, gh);
    const goal = await engine.createGoal({ prompt: 'fix ci', repoPath: repo, autoBrief: { mustChecks: ['test -f done.txt'] }, delivery: { mode: 'pr-automerge' } });
    await waitFor(() => ['delivered', 'failed'].includes(deliveredStatus(engine, goal.id).status), 30_000);
    const d = deliveredStatus(engine, goal.id);
    expect(d.error).toBeNull();
    expect(d.outcome).toBe('merged');
    expect(d.fixCycles).toBe(1);
    const fix = listTasks(engine.store.db, goal.id).find((t) => t.origin === 'delivery-fix');
    expect(fix?.state).toBe('done');
    expect(fix?.spec).toContain('lint failed');
    expect(eventsOf(engine, goal.id).filter((t) => t === 'delivery.pushed').length).toBe(2);
    expect(await sh('git cat-file -e main:ci-fix.txt && echo yes', bare)).toBe('yes');

    const gh2 = new FakeGh(bare);
    gh2.checksSequence = ['failing'];
    const engine2 = new Engine(cfg(), worker(), gh2);
    const goal2 = await engine2.createGoal({ prompt: 'no fix budget', repoPath: repo, autoBrief: { mustChecks: ['test -f done.txt'] }, delivery: { mode: 'pr-automerge', fixCiCycles: 0 } });
    await waitFor(() => ['delivered', 'failed'].includes(deliveredStatus(engine2, goal2.id).status), 30_000);
    expect(deliveredStatus(engine2, goal2.id)).toMatchObject({ status: 'failed', step: 'wait-checks' });
    expect(listTasks(engine2.store.db, goal2.id).some((t) => t.origin === 'delivery-fix')).toBe(false);
  });

  test('gh absent: push still works, pr fails at preflight with install hint; branch protection → auto-merge armed', async () => {
    const noGh = new FakeGh(bare);
    noGh.installed = false;
    const engine = new Engine(cfg(), worker(), noGh);
    const g1 = await engine.createGoal({ prompt: 'push ok', repoPath: repo, autoBrief: { mustChecks: ['test -f done.txt'] }, delivery: { mode: 'push' } });
    await waitFor(() => ['delivered', 'failed'].includes(deliveredStatus(engine, g1.id).status), 20_000);
    expect(deliveredStatus(engine, g1.id).outcome).toBe('pushed');
    const g2 = await engine.createGoal({ prompt: 'pr fails', repoPath: repo, autoBrief: { mustChecks: ['test -f done.txt'] }, delivery: { mode: 'pr' } });
    await waitFor(() => ['delivered', 'failed'].includes(deliveredStatus(engine, g2.id).status), 20_000);
    expect(deliveredStatus(engine, g2.id)).toMatchObject({ status: 'failed', step: 'preflight' });
    expect(deliveredStatus(engine, g2.id).error).toContain('brew install gh');

    const prot = new FakeGh(bare);
    prot.mergeBehavior = 'protected';
    const engine3 = new Engine(cfg(), worker(), prot);
    const g3 = await engine3.createGoal({ prompt: 'protected', repoPath: repo, autoBrief: { mustChecks: ['test -f done.txt'] }, delivery: { mode: 'pr-automerge' } });
    await waitFor(() => ['delivered', 'failed'].includes(deliveredStatus(engine3, g3.id).status), 20_000);
    expect(deliveredStatus(engine3, g3.id)).toMatchObject({ status: 'delivered', outcome: 'automerge_armed' });
    expect(prot.calls.some((c) => c[0] === 'prMerge' && c[3] === 'auto')).toBe(true);
  });

  // ---- stacked, one PR per task
  const t = (key: string, title: string, deps: string[], kind: 'feature' | 'bug' = 'feature') => ({ key, title, spec: `write ${title}.txt`, kind, scope: null, scenario: 'general' as const, areaKey: null, dependsOnKeys: deps, parallelizable: false, relevantFiles: [] });
  const c = (key: string, taskKey: string | null, cmd: string) => ({ key, name: key, tier: 'must' as const, taskKey, areaKey: null, spec: { type: 'command' as const, cmd, timeoutMs: 60_000, expectExitCode: 0 } });
  const twoTasks = () => ({
    title: 'feat(demo): add two files',
    understanding: 'u',
    areas: [],
    assumptions: [],
    questions: [],
    costEstimateUsd: 0,
    timeEstimateMin: 0,
    tasks: [t('T1', 'add first', []), t('T2', 'fix second', ['T1'], 'bug')],
    checks: [c('C1', 'T1', 'test -f "add first.txt"'), c('C2', 'T2', 'test -f "fix second.txt"'), c('G', null, 'test -f "fix second.txt"')],
  });
  const titleWorker = () =>
    new FakeRunner((spec) => {
      if (!spec.label?.startsWith('attempt')) return;
      const title = spec.label.replace(/^attempt /, '').replace(/ #\d+$/, '');
      writeFileSync(join(spec.cwd, `${title}.txt`), 'ok');
    });

  test('unit=task, mode=pr: one stacked branch + PR per task commit, titles are the commit headers', async () => {
    const gh = new FakeGh(bare);
    const engine = new Engine(cfg(), titleWorker(), gh);
    const goal = await engine.createGoal({ prompt: 'stack me', repoPath: repo, brief: twoTasks(), delivery: { mode: 'pr', unit: 'task' } });
    await waitFor(() => ['delivered', 'failed'].includes(deliveredStatus(engine, goal.id).status), 30_000);
    const d = deliveredStatus(engine, goal.id);
    expect(d.error).toBeNull();
    expect(d.outcome).toBe('pr_open');
    const b1 = `${goal.branch}-1-add-first`;
    const b2 = `${goal.branch}-2-fix-second`;
    expect(gh.calls.filter((x) => x[0] === 'prCreate').map((x) => [x[2], x[3]])).toEqual([
      [b1, 'main'],
      [b2, b1],
    ]);
    expect([...gh.prs.values()].map((p) => p.number)).toEqual([1, 2]);
    expect(d.prs.map((p) => ({ index: p.index, branch: p.branch, base: p.base, title: p.title, number: p.number, state: p.state }))).toEqual([
      { index: 1, branch: b1, base: 'main', title: 'feat: add first', number: 1, state: 'open' },
      { index: 2, branch: b2, base: b1, title: 'fix: fix second', number: 2, state: 'open' },
    ]);
    expect(d.pr?.number).toBe(1);
    const remoteBranches = (await sh("git branch --format='%(refname:short)'", bare)).split('\n');
    expect(remoteBranches).toContain(b1);
    expect(remoteBranches).toContain(b2);
    expect(remoteBranches).not.toContain(goal.branch);
    expect((await sh(`git log --format=%s main..${b2}`, bare)).split('\n')).toEqual(['fix: fix second', 'feat: add first']);
    expect(await sh(`git log --format=%s main..${b1}`, bare)).toBe('feat: add first');
    const ev = eventsOf(engine, goal.id);
    expect(ev).toContain('delivery.stack_built');
    expect(ev.filter((x) => x === 'delivery.pushed').length).toBe(2);
    const plan = await engine.deliveryPlan(goal.id, { mode: 'pr', unit: 'task' });
    expect(plan.steps.map((s) => s.step)).toEqual(['preflight', 'ensure-remote', 'build-stack', 'push', 'open-pr']);
    const before = engine.store.snapshotReadModels();
    engine.store.replay();
    expect(engine.store.snapshotReadModels()).toEqual(before);
  }, 40_000);

  test('unit=task, mode=pr-automerge: PRs merge bottom-up, each retargeted and updated, remote branches deleted', async () => {
    const gh = new FakeGh(bare);
    const engine = new Engine(cfg(), titleWorker(), gh);
    const goal = await engine.createGoal({ prompt: 'stack and merge', repoPath: repo, brief: twoTasks(), delivery: { mode: 'pr-automerge', unit: 'task' } });
    await waitFor(() => ['delivered', 'failed'].includes(deliveredStatus(engine, goal.id).status), 40_000);
    const d = deliveredStatus(engine, goal.id);
    expect(d.error).toBeNull();
    expect(d.outcome).toBe('merged');
    expect(d.prs.map((p) => p.state)).toEqual(['merged', 'merged']);
    const order = gh.calls.filter((x) => x[0] === 'prMerge' || x[0] === 'prEdit').map((x) => x.slice(0, 3).join(' '));
    expect(order).toEqual(['prEdit 1 main', 'prMerge 1 squash', 'prEdit 2 main', 'prEdit 2 main', 'prMerge 2 squash']); // every PR is retargeted before its merge; #2 also right after #1 merged, before #1's branch is deleted
    expect(await sh('git cat-file -e main:"add first.txt" && git cat-file -e main:"fix second.txt" && echo yes', bare)).toBe('yes');
    const remoteBranches = (await sh("git branch --format='%(refname:short)'", bare)).split('\n');
    expect(remoteBranches.some((b) => b.startsWith(goal.branch))).toBe(false);
    // the scratch worktree is gone, the local stack branches stay until the goal is deleted
    expect(existsSync(join(dataDir, 'worktrees', goal.id, '_delivery'))).toBe(false);
    expect((await sh("git branch --format='%(refname:short)'", repo)).split('\n')).toContain(`${goal.branch}-2-fix-second`);
    await engine.deleteGoal(goal.id, { deleteBranch: true });
    expect((await sh("git branch --format='%(refname:short)'", repo)).split('\n').some((b) => b.startsWith(goal.branch))).toBe(false);
  }, 50_000);

  test('unit=task, pr-automerge: a PR GitHub closed when its base branch vanished is reopened and retargeted; the next PR is retargeted before the merged branch is deleted', async () => {
    const gh = new FakeGh(bare);
    gh.closeDependentsOnMerge = true;
    const engine = new Engine(cfg(), titleWorker(), gh);
    const goal = await engine.createGoal({ prompt: 'closed dependents', repoPath: repo, brief: twoTasks(), delivery: { mode: 'pr-automerge', unit: 'task' } });
    await waitFor(() => ['delivered', 'failed'].includes(deliveredStatus(engine, goal.id).status), 40_000);
    const d = deliveredStatus(engine, goal.id);
    expect(d.error).toBeNull();
    expect(d.outcome).toBe('merged');
    expect(d.prs.map((p) => p.state)).toEqual(['merged', 'merged']);
    const calls = gh.calls.filter((x) => ['prMerge', 'prEdit', 'prReopen'].includes(x[0]!)).map((x) => x.slice(0, 3).join(' '));
    // merge #1 → (fake closes #2) → retarget attempt fails → reopen → retarget → merge #2
    expect(calls).toEqual(['prEdit 1 main', 'prMerge 1 squash', 'prEdit 2 main', 'prReopen 2', 'prEdit 2 main', 'prEdit 2 main', 'prMerge 2 squash']);
    const notes = engine.store.listByGoal(goal.id, 5000).filter((e) => e.type === 'delivery.note').map((e) => (e.payload as any).message as string);
    expect(notes.some((n) => n.includes('reopened PR #2'))).toBe(true);
    // the retarget of #2 happened inside the cleanup step of #1, i.e. before `git push --delete` of branch 1
    const cmds = engine.store.listByGoal(goal.id, 5000).filter((e) => e.type === 'delivery.command').map((e) => (e.payload as any).command as string);
    expect(cmds.findIndex((c) => c.startsWith('gh pr edit 2'))).toBeLessThan(cmds.findIndex((c) => c.includes('--delete refs/heads/') && c.includes('-1-add-first')));
  }, 50_000);

  test('unit=task: a failed run resumes — merged tasks are skipped, branch names keep their positions, open PRs are reused', async () => {
    const gh = new FakeGh(bare);
    const engine = new Engine(cfg(), titleWorker(), gh);
    const goal = await engine.createGoal({ prompt: 'resume me', repoPath: repo, brief: twoTasks(), delivery: { mode: 'pr', unit: 'task' } });
    await waitFor(() => ['delivered', 'failed'].includes(deliveredStatus(engine, goal.id).status), 30_000);
    expect(deliveredStatus(engine, goal.id).outcome).toBe('pr_open');
    // pretend PR #1 was merged by hand (fake fast-forwards main to branch 1) and GitHub closed #2
    await gh.prMerge('', { repo: [...gh.prs.values()][0]!.repo, number: 1, method: 'squash', auto: false });
    gh.prs.get(2)!.state = 'CLOSED';
    engine.store.append({ type: 'delivery.merged', goalId: goal.id, payload: { prNumber: 1, method: 'squash', ref: null, taskId: listTasks(engine.store.db, goal.id).find((t) => t.title === 'add first')!.id } });
    await engine.deliver(goal.id, { mode: 'pr-automerge', unit: 'task' });
    await waitFor(() => deliveredStatus(engine, goal.id).outcome === 'merged', 40_000);
    const d = deliveredStatus(engine, goal.id);
    expect(d.error).toBeNull();
    // only task 2 was delivered this time, on its original branch (-2-…), through the reopened PR #2
    expect(d.prs.map((p) => [p.index, p.number, p.state])).toEqual([[2, 2, 'merged']]);
    expect(gh.calls.filter((x) => x[0] === 'prCreate').length).toBe(2);
    expect(gh.calls.some((x) => x[0] === 'prReopen' && x[1] === '2')).toBe(true);
    expect(await sh('git cat-file -e main:"fix second.txt" && echo yes', bare)).toBe('yes');
  }, 60_000);

  test('unit=task falls back to one PR when a task commit cannot be re-applied on the moved base', async () => {
    const gh = new FakeGh(bare);
    // workers edit README (conflicts with upstream); merge attempts resolve only in the goal workspace, never in _delivery
    const runner = new FakeRunner(async (spec) => {
      if (spec.label?.startsWith('merge')) {
        if (spec.cwd.endsWith('_delivery')) return;
        writeFileSync(join(spec.cwd, 'README.md'), 'resolved by merger\n');
        await sh('git add README.md', spec.cwd);
        return;
      }
      const title = spec.label!.replace(/^attempt /, '').replace(/ #\d+$/, '');
      writeFileSync(join(spec.cwd, 'README.md'), `${title}\n`);
      writeFileSync(join(spec.cwd, `${title}.txt`), 'ok');
    });
    const engine = new Engine(cfg(), runner, gh);
    const goal = await engine.createGoal({ prompt: 'fallback', repoPath: repo, brief: twoTasks(), delivery: { mode: 'pr', unit: 'task' } });
    const other = mkdtempSync(join(tmpdir(), 'ai-engine-other-'));
    await sh(`git clone -q ${bare} . && printf 'upstream version\\n' > README.md && git -c user.name=o -c user.email=o@o commit -qam upstream && git push -q origin main`, other);
    await waitFor(() => ['delivered', 'failed'].includes(deliveredStatus(engine, goal.id).status), 40_000);
    const d = deliveredStatus(engine, goal.id);
    expect(d.error).toBeNull();
    expect(d.outcome).toBe('pr_open');
    expect(gh.calls.filter((x) => x[0] === 'prCreate').map((x) => x[2])).toEqual([goal.branch]);
    expect(d.prs.length).toBe(1);
    expect(d.prs[0]!.title).toBe('feat(demo): add two files');
    const notes = engine.store.listByGoal(goal.id, 5000).filter((e) => e.type === 'delivery.note').map((e) => (e.payload as any).message as string);
    expect(notes.some((n) => n.includes('one PR instead'))).toBe(true);
    expect((await sh("git branch --format='%(refname:short)'", repo)).split('\n').some((b) => b.startsWith(`${goal.branch}-`))).toBe(false);
    rmSync(other, { recursive: true, force: true });
  }, 50_000);

  test('unit=task with a single task commit delivers one PR titled after the Brief', async () => {
    const gh = new FakeGh(bare);
    const engine = new Engine(cfg(), worker(), gh);
    const goal = await engine.createGoal({ prompt: 'single', repoPath: repo, autoBrief: { mustChecks: ['test -f done.txt'] }, delivery: { mode: 'pr', unit: 'task' } });
    await waitFor(() => ['delivered', 'failed'].includes(deliveredStatus(engine, goal.id).status), 20_000);
    const d = deliveredStatus(engine, goal.id);
    expect(d.outcome).toBe('pr_open');
    expect(eventsOf(engine, goal.id)).not.toContain('delivery.stack_built');
    expect(gh.calls.filter((x) => x[0] === 'prCreate').map((x) => x[2])).toEqual([goal.branch]);
    expect(d.prs[0]!.title).toBe('feat: single');
  });

  test('deliver() later on a local goal, plan preview, and restart reconciliation', async () => {
    const gh = new FakeGh(bare);
    const engine = new Engine(cfg(), worker(), gh);
    const goal = await engine.createGoal({ prompt: 'later', repoPath: repo, autoBrief: { mustChecks: ['test -f done.txt'] } });
    await waitFor(() => terminal(getGoal(engine.store.db, goal.id)!.state));
    expect(deliveredStatus(engine, goal.id).status).toBe('idle');
    const plan = await engine.deliveryPlan(goal.id, { mode: 'pr' });
    expect(plan.steps.map((s) => s.step)).toEqual(['preflight', 'ensure-remote', 'sync-base', 'push', 'open-pr']);
    expect(plan.steps.find((s) => s.step === 'push')!.command).toContain(`refs/heads/${goal.branch}:refs/heads/${goal.branch}`);
    await engine.deliver(goal.id, { mode: 'pr' });
    await waitFor(() => ['delivered', 'failed'].includes(deliveredStatus(engine, goal.id).status), 20_000);
    expect(deliveredStatus(engine, goal.id)).toMatchObject({ outcome: 'pr_open' });
    // second deliver with automerge reuses the open PR
    await engine.deliver(goal.id, { mode: 'pr-automerge' });
    await waitFor(() => deliveredStatus(engine, goal.id).outcome === 'merged', 20_000);
    expect(gh.calls.filter((c) => c[0] === 'prCreate').length).toBe(1);
    // restart while "running": reconcile marks failed with a clear reason
    engine.store.append({ type: 'delivery.started', goalId: goal.id, payload: { policy: deliveredStatus(engine, goal.id).policy, plan: [] } });
    const engine2 = new Engine(cfg(), worker(), gh);
    await engine2.start();
    expect(deliveredStatus(engine2, goal.id)).toMatchObject({ status: 'failed' });
    expect(deliveredStatus(engine2, goal.id).error).toContain('restarted');
    const before = engine2.store.snapshotReadModels();
    engine2.store.replay();
    expect(engine2.store.snapshotReadModels()).toEqual(before);
  });
});
