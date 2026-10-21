import { beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { getGoal, type DeliveryPr } from '@foundry/core';
import { defaultConfig } from '../config.ts';
import { Engine } from '../engine.ts';
import { FakeRunner, makeRepoWithRemote, sh, waitFor } from '../test-helpers.ts';
import { revertWorkspacePath } from '../workspace.ts';
import { FakeGh } from './gh.fake.ts';
import { mergesOf, revertInfo } from './revert.ts';

const ROOT = resolve(import.meta.dir, '../../../..');
let dataDir: string;
let repo: string;
let bare: string;
beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'foundry-revert-data-'));
  ({ repo, bare } = await makeRepoWithRemote());
});

const cfg = () => defaultConfig(ROOT, { dataDir, claudeHome: join(dataDir, 'claude-home'), alwaysReviewTasks: false, log: () => {}, delivery: { pollMs: 10, noChecksGraceMs: 30, checksTimeoutMs: 3000, automergeWaitMs: 200, updateLocalBase: true, prWatchMs: 60_000 } });
const worker = () => new FakeRunner((spec) => writeFileSync(join(spec.cwd, 'done.txt'), 'ok'));
const delivery = (engine: Engine, goalId: string) => getGoal(engine.store.db, goalId)!.delivery;
const reverts = (engine: Engine, goalId: string) => delivery(engine, goalId).reverts;
const types = (engine: Engine, goalId: string) => engine.store.listByGoal(goalId, 5000).map((e) => e.type as string);
const branches = async (cwd: string) => (await sh("git branch --format='%(refname:short)'", cwd)).split('\n');

/** a goal delivered and merged through the fake GitHub: its work is on the bare remote's main, and on the local main */
async function mergedGoal(engine: Engine) {
  const goal = await engine.createGoal({ prompt: 'ship it', repoPath: repo, autoBrief: { mustChecks: ['test -f done.txt'] }, delivery: { mode: 'pr-automerge' } });
  await waitFor(() => ['delivered', 'failed'].includes(delivery(engine, goal.id).status), 20_000);
  expect(delivery(engine, goal.id).outcome).toBe('merged');
  await waitFor(() => delivery(engine, goal.id).cleanup != null);
  expect(await sh('git show main:done.txt', bare)).toBe('ok');
  return goal;
}

describe('revert (ADR-0059)', () => {
  test('a merged goal is undone by a revert pull request: a branch from the online base with one revert commit per merge, every command audited; merged on GitHub later, it is noticed, the remote branch tidied and the local base brought up', async () => {
    const gh = new FakeGh(bare);
    gh.mergeStyle = 'squash';
    const engine = new Engine(cfg(), worker(), gh);
    const goal = await mergedGoal(engine);
    const before = delivery(engine, goal.id);
    expect(mergesOf(getGoal(engine.store.db, goal.id)!)).toEqual([{ prNumber: 1, ref: before.mergedRef!, title: expect.any(String) }]);
    expect(engine.revertInfo(goal.id)).toMatchObject({ ok: true, why: null, base: 'main', remote: 'origin', method: 'squash', running: false, open: null });

    engine.revert(goal.id, { reason: 'the export breaks on Mondays' });
    expect(() => engine.revert(goal.id)).toThrow('a revert of this goal is running');
    await waitFor(() => reverts(engine, goal.id)[0]?.status !== 'running', 20_000);
    const r = reverts(engine, goal.id)[0]!;
    expect(r).toMatchObject({ status: 'open', reason: 'the export breaks on Mondays', merge: false, branch: `${goal.branch}-revert`, pr: { number: 2 }, mergedRef: null, finishedAt: null });
    expect(r.reverts).toEqual([{ prNumber: 1, ref: before.mergedRef!, title: expect.any(String) }]);
    expect(r.commits).toHaveLength(1);
    expect(r.detail).toContain('pull request #2 opened');
    // the branch is on the remote, starts from main and takes the file away, with a message that says why
    expect(await branches(bare)).toContain(r.branch!);
    expect(await sh(`git merge-base --is-ancestor main ${r.branch} && echo yes`, bare)).toBe('yes');
    expect(await sh(`git ls-tree --name-only ${r.branch} -- done.txt`, bare)).toBe('');
    expect(await sh(`git log -1 --format=%s ${r.branch}`, bare)).toStartWith('Revert "');
    expect(await sh(`git log -1 --format=%b ${r.branch}`, bare)).toContain(`This reverts commit ${before.mergedRef}, the merge of pull request #1`);
    expect(await sh(`git log -1 --format=%b ${r.branch}`, bare)).toContain('Reason: the export breaks on Mondays');
    // the pull request targets the base; its description names the merge and the reason
    expect(gh.prs.get(2)).toMatchObject({ head: r.branch, base: 'main', state: 'OPEN' });
    const body = readFileSync(join(dataDir, 'delivery', goal.id, `revert-${r.id}.md`), 'utf8');
    expect(body).toContain('**Reason:** the export breaks on Mondays');
    expect(body).toContain(`#1`);
    expect(body).toContain('## Merge Danger');
    // every command is in the delivery's audit, under the revert step
    const cmds = engine.store.listByGoal(goal.id, 5000).filter((e) => e.type === 'delivery.command' && (e.payload as { step: string }).step === 'revert').map((e) => (e.payload as { command: string }).command);
    expect(cmds.some((c) => c.startsWith('git revert --no-commit'))).toBe(true);
    expect(cmds.some((c) => c.startsWith(`git push -u origin refs/heads/${r.branch}`))).toBe(true);
    expect(cmds.some((c) => c.startsWith('gh pr create'))).toBe(true);
    expect(cmds.some((c) => c.includes('--force'))).toBe(false);
    // the worktree and the local branch are gone; the goal is untouched
    expect(existsSync(revertWorkspacePath(dataDir, getGoal(engine.store.db, goal.id)!))).toBe(false);
    expect(await branches(repo)).not.toContain(r.branch!);
    expect(getGoal(engine.store.db, goal.id)!.state).toBe('done');
    expect(delivery(engine, goal.id)).toMatchObject({ status: 'delivered', outcome: 'merged' });
    // no second revert while this one waits
    expect(engine.revertInfo(goal.id)).toMatchObject({ ok: false, why: 'revert pull request #2 is open', open: { id: r.id } });
    expect(() => engine.revert(goal.id)).toThrow('revert pull request #2 is open');

    // someone merges it on GitHub: the next look records it, the remote branch goes, the local main follows
    await gh.mergeOnGitHub(2);
    await engine.refreshDelivery(goal.id);
    const merged = reverts(engine, goal.id)[0]!;
    expect(merged.status).toBe('merged');
    expect(merged.mergedRef).toBe(await sh('git rev-parse main', bare));
    expect(merged.finishedAt).toBeTruthy();
    expect(merged.detail).toContain(`origin/${r.branch} deleted`);
    expect(merged.detail).toContain('your local main: fast-forwarded main by 1 commit');
    expect(await sh('git ls-tree --name-only main -- done.txt', bare)).toBe('');
    expect(await sh('git rev-parse main', repo)).toBe(await sh('git rev-parse main', bare));
    expect(await branches(bare)).not.toContain(r.branch!);
    expect(types(engine, goal.id)).toContain('delivery.revert_merged');
    // the delivery itself was not finished again
    expect(types(engine, goal.id).filter((t) => t === 'delivery.completed')).toHaveLength(1);
    expect(engine.revertInfo(goal.id)).toMatchObject({ ok: false, why: expect.stringContaining('the goal was reverted by pull request #2') });
    await engine.stop();
  }, 60_000);

  test('a conflict with what main got since fails with the files and opens nothing; Merge it right away merges the revert with the policy method and brings the local base up', async () => {
    const gh = new FakeGh(bare);
    const engine = new Engine(cfg(), worker(), gh);
    const goal = await mergedGoal(engine);
    // someone changed the goal's file on main after the merge: the revert cannot apply
    const other = mkdtempSync(join(tmpdir(), 'foundry-other-'));
    await sh(`git clone -q ${bare} . && printf 'changed later\\n' > done.txt && git -c user.name=o -c user.email=o@o commit -qam later && git push -q origin main`, other);
    engine.revert(goal.id, { reason: 'wrong', merge: true });
    await waitFor(() => reverts(engine, goal.id)[0]?.status !== 'running', 20_000);
    const failed = reverts(engine, goal.id)[0]!;
    expect(failed.status).toBe('failed');
    expect(failed.detail).toContain('conflicts with what main got since, in done.txt');
    expect(failed.pr).toBeNull();
    expect(failed.finishedAt).toBeTruthy();
    expect(gh.prs.size).toBe(1);
    expect(await branches(bare)).not.toContain(`${goal.branch}-revert`);
    expect(existsSync(revertWorkspacePath(dataDir, getGoal(engine.store.db, goal.id)!))).toBe(false);
    // a failed revert may be tried again
    expect(engine.revertInfo(goal.id).ok).toBe(true);

    // the later change is undone by hand: the revert applies now, and is merged at once as asked
    await sh('git revert --no-edit HEAD && git push -q origin main', other);
    engine.revert(goal.id, { reason: 'still wrong', merge: true });
    await waitFor(() => reverts(engine, goal.id)[1]?.status !== 'running', 20_000);
    const m = reverts(engine, goal.id)[1]!;
    expect(m).toMatchObject({ status: 'merged', merge: true, branch: `${goal.branch}-revert-2`, pr: { number: 2 } });
    expect(m.detail).toContain('pull request #2 merged with squash');
    expect(m.detail).toContain('your local main: fast-forwarded main');
    expect(m.mergedRef).toBe(await sh('git rev-parse main', bare));
    expect(gh.calls.some((c) => c[0] === 'prMerge' && c[1] === '2' && c[2] === 'squash' && c[3] === 'now')).toBe(true);
    expect(await sh('git ls-tree --name-only main -- done.txt', bare)).toBe('');
    expect(await sh('git rev-parse main', repo)).toBe(await sh('git rev-parse main', bare));
    expect(await branches(bare)).not.toContain(m.branch!);
    expect(types(engine, goal.id).filter((t) => t === 'delivery.revert_finished')).toHaveLength(2);
    expect(getGoal(engine.store.db, goal.id)!.state).toBe('done');
    await engine.stop();
  }, 60_000);

  test('branch protection leaves the merge to GitHub: the revert is armed and watched until it merges', async () => {
    const gh = new FakeGh(bare);
    const engine = new Engine(cfg(), worker(), gh);
    const goal = await mergedGoal(engine);
    gh.mergeBehavior = 'protected';
    engine.revert(goal.id, { merge: true });
    await waitFor(() => reverts(engine, goal.id)[0]?.status !== 'running', 20_000);
    const armed = reverts(engine, goal.id)[0]!;
    expect(armed).toMatchObject({ status: 'armed', pr: { number: 2 }, reason: '' });
    expect(armed.detail).toContain('auto-merge armed on pull request #2');
    expect(gh.calls.some((c) => c[0] === 'prMerge' && c[1] === '2' && c[3] === 'auto')).toBe(true);
    expect(engine.revertInfo(goal.id)).toMatchObject({ ok: false, why: 'revert pull request #2 is waiting for GitHub to merge it' });
    // closed without merging on GitHub: recorded, nothing changes, and a revert may be tried again
    gh.prs.get(2)!.state = 'CLOSED';
    await engine.refreshDelivery(goal.id);
    expect(reverts(engine, goal.id)[0]).toMatchObject({ status: 'closed' });
    expect(types(engine, goal.id)).toContain('delivery.revert_closed');
    expect(await sh('git show main:done.txt', bare)).toBe('ok');
    expect(engine.revertInfo(goal.id).ok).toBe(true);
    await engine.stop();
  }, 60_000);

  test('what cannot be reverted says why: a delivery that did not merge, one finished by hand, a Local only goal, an unknown merge commit, a running delivery', async () => {
    const gh = new FakeGh(bare);
    const engine = new Engine(cfg(), worker(), gh);
    const goal = await engine.createGoal({ prompt: 'push only', repoPath: repo, autoBrief: { mustChecks: ['test -f done.txt'] }, delivery: { mode: 'push' } });
    await waitFor(() => ['delivered', 'failed'].includes(delivery(engine, goal.id).status), 20_000);
    expect(engine.revertInfo(goal.id)).toMatchObject({ ok: false, why: 'the delivery has not merged', reverts: [] });
    expect(() => engine.revert(goal.id)).toThrow('the delivery has not merged');
    const g = getGoal(engine.store.db, goal.id)!;
    const d = g.delivery;
    const pr = (over: Partial<DeliveryPr>): DeliveryPr => ({ taskId: null, index: 1, branch: g.branch, base: 'main', title: 'feat: x', number: 7, url: 'u', state: 'merged', checks: null, mergedRef: 'abc', failing: [], activity: null, ciSkipped: false, branchDeleted: false, sync: null, ...over });
    const why = (patch: Partial<typeof d>) => revertInfo(engine, { ...g, delivery: { ...d, ...patch } }).why;
    expect(why({ status: 'delivered', outcome: 'by_you' })).toContain('finished by you');
    expect(why({ status: 'idle', outcome: null, policy: { ...d.policy, mode: 'local' } })).toContain('Local only');
    expect(why({ status: 'delivered', outcome: 'merged', prs: [pr({ mergedRef: null })] })).toBe('the merge commit of pull request #7 is not known');
    expect(why({ status: 'delivered', outcome: 'merged', prs: [] })).toBe('no merged pull request is recorded on the delivery');
    expect(why({ status: 'running' })).toBe('the delivery is running');
    // a stack is undone top-down
    expect(revertInfo(engine, { ...g, delivery: { ...d, status: 'delivered', outcome: 'merged', prs: [pr({ index: 1, number: 7, mergedRef: 'a1' }), pr({ index: 2, number: 8, mergedRef: 'b2', title: 'feat: y' })] } })).toMatchObject({ ok: true, reverts: [{ prNumber: 8, ref: 'b2', title: 'feat: y' }, { prNumber: 7, ref: 'a1', title: 'feat: x' }] });
    await engine.stop();
  }, 30_000);
});
