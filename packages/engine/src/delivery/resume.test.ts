import { beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { getGoal, listTasks } from '@foundry/core';
import { defaultConfig } from '../config.ts';
import { Engine } from '../engine.ts';
import { FakeRunner, makeRepoWithRemote, sh, waitFor } from '../test-helpers.ts';
import { goalWorkspacePath } from '../workspace.ts';
import { FakeGh } from './gh.fake.ts';

const ROOT = resolve(import.meta.dir, '../../../..');
let dataDir: string;
let repo: string;
let bare: string;
beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'foundry-resume-data-'));
  ({ repo, bare } = await makeRepoWithRemote());
});

const cfg = (delivery: Partial<{ pollMs: number; checksTimeoutMs: number }> = {}) =>
  defaultConfig(ROOT, { dataDir, claudeHome: join(dataDir, 'claude-home'), alwaysReviewTasks: false, log: () => {}, delivery: { pollMs: 10, noChecksGraceMs: 30, checksTimeoutMs: 3000, automergeWaitMs: 200, updateLocalBase: true, prWatchMs: 60_000, ...delivery } });
const delivery = (engine: Engine, goalId: string) => getGoal(engine.store.db, goalId)!.delivery;
const settled = (engine: Engine, goalId: string) => ['delivered', 'failed'].includes(delivery(engine, goalId).status);
const payloads = <T>(engine: Engine, goalId: string, type: string) => engine.store.listByGoal(goalId, 5000).filter((e) => e.type === type).map((e) => e.payload as T);
const commands = (engine: Engine, goalId: string) => payloads<{ command: string }>(engine, goalId, 'delivery.command').map((p) => p.command);
const remoteBranches = async () => (await sh("git branch --format='%(refname:short)'", bare)).split('\n');

const t = (key: string, title: string, deps: string[]) => ({ key, title, spec: `write ${title}.txt`, kind: 'feature' as const, scope: null, scenario: 'general' as const, areaKey: null, tdd: 'inherit' as const, dependsOnKeys: deps, parallelizable: false, relevantFiles: [] });
const c = (key: string, taskKey: string, cmd: string) => ({ key, name: key, tier: 'must' as const, taskKey, areaKey: null, spec: { type: 'command' as const, cmd, timeoutMs: 60_000, expectExitCode: 0 } });
const twoTasks = () => ({
  title: 'feat(demo): add two files',
  understanding: 'u',
  areas: [],
  assumptions: [],
  questions: [],
  styleOptions: [],
  costEstimateUsd: 0,
  timeEstimateMin: 0,
  tasks: [t('T1', 'add first', []), t('T2', 'add second', ['T1'])],
  checks: [c('C1', 'T1', 'test -f "add first.txt"'), c('C2', 'T2', 'test -f "add second.txt"')],
});
const titleWorker = () =>
  new FakeRunner((spec) => {
    if (!spec.label?.startsWith('attempt')) return;
    writeFileSync(join(spec.cwd, `${spec.label.replace(/^attempt /, '').replace(/ #\d+$/, '')}.txt`), 'ok');
  });

describe('a delivery resumes instead of starting again (ADR-0023)', () => {
  test('after a squash merge the next branch is replayed onto the base and pushed with a lease: no merge, no model', async () => {
    const gh = new FakeGh(bare);
    gh.mergeStyle = 'squash';
    const engine = new Engine(cfg(), titleWorker(), gh);
    const goal = await engine.createGoal({ prompt: 'squash stack', repoPath: repo, brief: twoTasks(), delivery: { mode: 'pr-automerge', unit: 'task' } });
    await waitFor(() => settled(engine, goal.id) && delivery(engine, goal.id).cleanup != null, 40_000);
    const d = delivery(engine, goal.id);
    expect(d.error).toBeNull();
    expect(d.prs.map((p) => [p.number, p.state, p.sync, p.branchDeleted])).toEqual([
      [1, 'merged', 'current', true],
      [2, 'merged', 'rebased', true],
    ]);
    // the replay needed neither a merge commit nor a Merge Attempt
    expect(listTasks(engine.store.db, goal.id).some((x) => x.scope === 'sync')).toBe(false);
    expect(payloads(engine, goal.id, 'merge.conflict')).toEqual([]);
    expect(commands(engine, goal.id).some((x) => x.includes('--force-with-lease=refs/heads/') && x.includes('-2-add-second'))).toBe(true);
    expect(await sh('git cat-file -e main:"add first.txt" && git cat-file -e main:"add second.txt" && echo yes', bare)).toBe('yes');
    // two squash commits on main, one per PR
    expect((await sh('git log -2 --format=%s main', bare)).split('\n').map((x) => x.replace(/-\d-.*/, ''))).toEqual([`squash ${d.prs[1]!.branch}`.replace(/-\d-.*/, ''), `squash ${d.prs[0]!.branch}`.replace(/-\d-.*/, '')]);
    // the local base holds the last merged PR, so the after-merge steps call it up to date
    expect(payloads<{ upToDate: boolean }>(engine, goal.id, 'delivery.local_synced').at(-1)?.upToDate).toBe(true);
    const before = engine.store.snapshotReadModels();
    engine.store.replay();
    expect(engine.store.snapshotReadModels()).toEqual(before);
    await engine.stop();
  }, 60_000);

  test('a fix-CI commit goes onto its PR branch; the stack is not rebuilt and no PR is closed', async () => {
    const gh = new FakeGh(bare);
    gh.mergeStyle = 'squash';
    gh.checksSequence = ['failing', 'passing'];
    gh.failedLogText = 'Error: lint failed';
    const engine = new Engine(cfg(), titleWorker(), gh);
    const goal = await engine.createGoal({ prompt: 'fix on branch', repoPath: repo, brief: twoTasks(), delivery: { mode: 'pr-automerge', unit: 'task' } });
    await waitFor(() => settled(engine, goal.id), 50_000);
    const d = delivery(engine, goal.id);
    expect(d.error).toBeNull();
    expect(d.outcome).toBe('merged');
    expect(d.fixCycles).toBe(1);
    expect(gh.calls.filter((x) => x[0] === 'prCreate').length).toBe(2);
    expect(gh.calls.some((x) => x[0] === 'prClose')).toBe(false);
    expect(payloads(engine, goal.id, 'delivery.stack_built').length).toBe(1);
    // the fix travelled with PR #1 and reached main; it never became a stack entry of its own
    expect(await sh('git cat-file -e "main:make CI pass on PR #1.txt" && echo yes', bare)).toBe('yes');
    expect(d.prs.length).toBe(2);
    await engine.stop();
  }, 60_000);

  test('Save mid-run: turning "Wait for CI checks" off lets a PR stuck on pending checks merge, marked as CI skipped', async () => {
    const gh = new FakeGh(bare);
    gh.checksSequence = ['pending'];
    const engine = new Engine(cfg({ checksTimeoutMs: 60_000 }), titleWorker(), gh);
    const goal = await engine.createGoal({ prompt: 'skip ci', repoPath: repo, brief: { ...twoTasks(), tasks: [t('T1', 'add first', [])], checks: [c('C1', 'T1', 'test -f "add first.txt"')] }, delivery: { mode: 'pr-automerge' } });
    await waitFor(() => delivery(engine, goal.id).step === 'wait-checks' && delivery(engine, goal.id).status === 'running', 30_000);
    // structure is locked while the run goes; the switches are not
    expect(() => engine.saveDeliveryPolicy(goal.id, { mergeMethod: 'merge' })).toThrow(/Start over/);
    engine.saveDeliveryPolicy(goal.id, { requireChecks: false });
    await waitFor(() => settled(engine, goal.id), 20_000);
    const d = delivery(engine, goal.id);
    expect(d.outcome).toBe('merged');
    expect(d.prs[0]).toMatchObject({ state: 'merged', ciSkipped: true });
    expect(d.policy.requireChecks).toBe(false);
    await engine.stop();
  }, 60_000);

  test('Resume keeps the open PRs and adds the docs commit as the last PR; Start over closes them and begins again', async () => {
    const gh = new FakeGh(bare);
    gh.mergeStyle = 'squash';
    const engine = new Engine(cfg(), titleWorker(), gh);
    const goal = await engine.createGoal({ prompt: 'resume docs', repoPath: repo, brief: twoTasks(), delivery: { mode: 'pr', unit: 'task' } });
    await waitFor(() => settled(engine, goal.id), 40_000);
    expect(delivery(engine, goal.id).outcome).toBe('pr_open');

    // the docs commit written when the goal finished (an older goal recorded it only in the detail text)
    const ws = goalWorkspacePath(dataDir, getGoal(engine.store.db, goal.id)!);
    mkdirSync(join(ws, 'docs'), { recursive: true });
    writeFileSync(join(ws, 'docs', 'demo.md'), '# demo\n');
    await sh('git add docs/demo.md && git -c user.name=t -c user.email=t@t commit -qm "docs: demo"', ws);
    const ref = await sh('git rev-parse --short HEAD', ws);
    engine.store.append({ type: 'goal.docs_generated', goalId: goal.id, payload: { status: 'ok', types: [], files: ['docs/demo.md'], costUsd: 0, detail: `committed ${ref} (1 file(s))` } });

    // opening PRs → opening and merging them keeps the PRs; changing the unit does not
    expect(() => engine.saveDeliveryPolicy(goal.id, { unit: 'goal' })).toThrow(/Start over/);
    engine.saveDeliveryPolicy(goal.id, { mode: 'pr-automerge' });
    expect(delivery(engine, goal.id).status).toBe('delivered'); // Save only saves
    await engine.resumeDelivery(goal.id);
    await waitFor(() => settled(engine, goal.id) && delivery(engine, goal.id).outcome === 'merged', 50_000);
    const d = delivery(engine, goal.id);
    expect(d.error).toBeNull();
    expect(d.prs.map((p) => [p.index, p.number, p.state, p.title])).toEqual([
      [1, 1, 'merged', 'feat: add first'],
      [2, 2, 'merged', 'feat: add second'],
      [3, 3, 'merged', `docs: ${goal.title}`],
    ]);
    expect(gh.calls.some((x) => x[0] === 'prClose')).toBe(false);
    expect(await sh('git cat-file -e main:docs/demo.md && echo yes', bare)).toBe('yes');
    await engine.stop();
  }, 90_000);

  test('Start over closes the open PRs, deletes the stacked branches and delivers with the new settings', async () => {
    const gh = new FakeGh(bare);
    const engine = new Engine(cfg(), titleWorker(), gh);
    const goal = await engine.createGoal({ prompt: 'start over', repoPath: repo, brief: twoTasks(), delivery: { mode: 'pr', unit: 'task' } });
    await waitFor(() => settled(engine, goal.id), 40_000);
    const g = getGoal(engine.store.db, goal.id)!;
    expect((await remoteBranches()).filter((b) => b.startsWith(`${g.branch}-`)).length).toBe(2);
    await engine.startOverDelivery(goal.id, { unit: 'goal' });
    await waitFor(() => settled(engine, goal.id), 40_000);
    const d = delivery(engine, goal.id);
    expect(d.error).toBeNull();
    expect(gh.calls.filter((x) => x[0] === 'prClose').map((x) => x[1])).toEqual(['1', '2']);
    expect([...gh.prs.values()].map((p) => [p.number, p.state])).toEqual([
      [1, 'CLOSED'],
      [2, 'CLOSED'],
      [3, 'OPEN'],
    ]);
    expect(d.prs.map((p) => [p.number, p.branch])).toEqual([[3, g.branch]]);
    expect((await remoteBranches()).some((b) => b.startsWith(`${g.branch}-`))).toBe(false);
    await engine.stop();
  }, 60_000);

  test('someone pushed to a stacked branch: the lease refuses the replay, their commit is kept and the base merged in', async () => {
    const gh = new FakeGh(bare);
    gh.mergeStyle = 'squash';
    const merge = gh.prMerge.bind(gh);
    let pushedBySomeone = false;
    gh.prMerge = async (cwd, i) => {
      const r = await merge(cwd, i);
      const second = [...gh.prs.values()].find((p) => p.head.endsWith('-2-add-second'));
      if (i.number === 1 && second && !pushedBySomeone) {
        pushedBySomeone = true;
        const other = mkdtempSync(join(tmpdir(), 'foundry-other-'));
        await sh(`git clone -q "${bare}" . && git checkout -q "${second.head}" && echo theirs > theirs.txt && git add theirs.txt && git -c user.name=o -c user.email=o@o commit -qm "chore: theirs" && git push -q origin HEAD`, other);
      }
      return r;
    };
    const engine = new Engine(cfg(), titleWorker(), gh);
    const goal = await engine.createGoal({ prompt: 'lease', repoPath: repo, brief: twoTasks(), delivery: { mode: 'pr-automerge', unit: 'task' } });
    await waitFor(() => settled(engine, goal.id), 50_000);
    const d = delivery(engine, goal.id);
    expect(d.error).toBeNull();
    expect(d.outcome).toBe('merged');
    expect(pushedBySomeone).toBe(true);
    expect(payloads<{ message: string }>(engine, goal.id, 'delivery.note').some((n) => n.message.includes('someone pushed to'))).toBe(true);
    expect(d.prs[1]?.sync).toBe('merged');
    expect(await sh('git cat-file -e main:theirs.txt && git cat-file -e main:"add second.txt" && echo yes', bare)).toBe('yes');
    await engine.stop();
  }, 60_000);
});
