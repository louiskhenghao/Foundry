import { beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { getGoal, listEscalations, listTasks } from '@foundry/core';
import { defaultConfig } from '../config.ts';
import { Engine } from '../engine.ts';
import { FakeRunner, makeRepoWithRemote, sh, waitFor } from '../test-helpers.ts';
import { FakeGh } from './gh.fake.ts';
import { checkGoalPrs } from './pr-watch.ts';
import { REPLY_MARK } from './reviews.ts';

const ROOT = resolve(import.meta.dir, '../../../..');
let dataDir: string;
let repo: string;
let bare: string;
beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'foundry-review-fix-'));
  ({ repo, bare } = await makeRepoWithRemote());
});

const cfg = () => defaultConfig(ROOT, { dataDir, claudeHome: join(dataDir, 'claude-home'), alwaysReviewTasks: false, log: () => {}, delivery: { pollMs: 10, noChecksGraceMs: 30, checksTimeoutMs: 3000, automergeWaitMs: 200, updateLocalBase: true, prWatchMs: 60_000 } });
/** the worker writes the goal's file; the review-fix task, when it runs, writes what the comment asked for */
const worker = (onReview: ((cwd: string) => void) | null = (cwd) => writeFileSync(join(cwd, 'renamed.txt'), 'parseRef')) =>
  new FakeRunner((spec) => {
    if (spec.label?.includes('review comments')) onReview?.(spec.cwd);
    else writeFileSync(join(spec.cwd, 'done.txt'), 'ok');
  });
const delivery = (engine: Engine, goalId: string) => getGoal(engine.store.db, goalId)!.delivery;
const settled = (engine: Engine, goalId: string) => ['delivered', 'failed'].includes(delivery(engine, goalId).status);
const events = (engine: Engine, goalId: string) => engine.store.listByGoal(goalId, 5000).map((e) => e.type as string);
const notes = (engine: Engine, goalId: string) => engine.store.listByGoal(goalId, 5000).filter((e) => e.type === 'delivery.note').map((e) => (e.payload as { message: string }).message);

/** a goal delivered as one open PR, with review comments then left on it */
async function openPr(engine: Engine, gh: FakeGh, policy: Record<string, unknown> = {}) {
  const goal = await engine.createGoal({ prompt: 'csv export', repoPath: repo, autoBrief: { mustChecks: ['test -f done.txt'] }, delivery: { mode: 'pr', ...policy } });
  await waitFor(() => settled(engine, goal.id), 20_000);
  expect(delivery(engine, goal.id)).toMatchObject({ status: 'delivered', outcome: 'pr_open' });
  expect(gh.prs.get(1)).toBeTruthy();
  return goal;
}

describe('review comments on a pull request (ADR-0053)', () => {
  test('a look at the open PR finds the comments, a run of the delivery addresses them on the branch, pushes, and replies under each', async () => {
    const gh = new FakeGh(bare);
    const engine = new Engine(cfg(), worker(), gh);
    const goal = await openPr(engine, gh);
    gh.addReviewComment(1, { body: 'rename this to parseRef', path: 'src/x.ts', line: 4 });
    gh.addReviewComment(1, { body: 'and here', author: 'sam' });
    gh.addReview(1, { state: 'APPROVED', body: 'otherwise fine' });

    await checkGoalPrs(engine, goal.id);
    const round = delivery(engine, goal.id).reviews[0]!;
    expect(round).toMatchObject({ prNumber: 1, status: 'pending', requested: false });
    expect(round.comments.map((c) => c.body)).toEqual(['rename this to parseRef', 'and here']);
    expect(events(engine, goal.id).filter((t) => t === 'delivery.review_received').length).toBe(1);
    // the run the engine started: the fix task on the branch, one more push, the replies, the PR still open for the person
    await waitFor(() => delivery(engine, goal.id).reviews[0]!.status === 'addressed', 30_000);
    await waitFor(() => settled(engine, goal.id), 20_000);
    const d = delivery(engine, goal.id);
    expect(d).toMatchObject({ status: 'delivered', outcome: 'pr_open', reviewCycles: 1 });
    expect(d.reviews[0]).toMatchObject({ status: 'addressed', replied: 2, requested: false });
    expect(d.reviews[0]!.commit).toBeTruthy();
    const fix = listTasks(engine.store.db, goal.id).find((t) => t.origin === 'review-fix')!;
    expect(fix.state).toBe('done');
    expect(fix.spec).toContain('rename this to parseRef');
    expect(fix.relevantFiles).toEqual(['src/x.ts']);
    expect(await sh(`git cat-file -e ${goal.branch}:renamed.txt && echo yes`, bare)).toBe('yes');
    // the first delivery's push, the resumed run's push of the branch as it was, and the push of the fix
    expect(events(engine, goal.id).filter((t) => t === 'delivery.pushed').length).toBe(3);
    expect(gh.replies.map((r) => r.commentId)).toEqual(round.comments.map((c) => c.id));
    expect(gh.replies[0]!.body).toMatch(/^Addressed in `[0-9a-f]{7}` \(chore\(review\): address review comments on PR #1\)\. Changed: `renamed\.txt`\./);
    expect(gh.replies[0]!.body.endsWith(REPLY_MARK)).toBe(true);
    const steps = engine.store.listByGoal(goal.id, 5000).filter((e) => e.type === 'delivery.step').map((e) => e.payload as { step: string; status: string });
    expect(steps.some((s) => s.step === 'fix-review' && s.status === 'ok')).toBe(true);
    expect(listEscalations(engine.store.db, { goalId: goal.id, openOnly: true })).toEqual([]);

    // the next look: Foundry's own replies are not comments, nothing new
    await checkGoalPrs(engine, goal.id);
    expect(delivery(engine, goal.id).reviews.length).toBe(1);
    expect(delivery(engine, goal.id).status).toBe('delivered');
  });

  test('beyond the policy budget a round waits for the person; Fix review comments addresses it; a request for changes counts too', async () => {
    const gh = new FakeGh(bare);
    const engine = new Engine(cfg(), worker(), gh);
    const goal = await openPr(engine, gh, { fixReviewCycles: 0 });
    gh.addReview(1, { state: 'CHANGES_REQUESTED', body: 'Please rename the parser.' });
    await checkGoalPrs(engine, goal.id);
    const d = delivery(engine, goal.id);
    expect(d.status).toBe('delivered');
    expect(d.reviews[0]).toMatchObject({ status: 'pending', requested: false });
    expect(d.reviews[0]!.comments[0]).toMatchObject({ kind: 'review', body: 'Please rename the parser.' });
    // no run was started: the policy was set once, at creation, inside goal.created
    expect(events(engine, goal.id).filter((t) => t === 'delivery.policy_set' || t === 'delivery.started').length).toBe(1);
    expect(notes(engine, goal.id).some((m) => m.includes('wait for you') && m.includes('allows 0'))).toBe(true);
    const received = engine.store.listByGoal(goal.id, 5000).find((e) => e.type === 'delivery.review_received')!.payload as { action: string };
    expect(received.action).toBe('waiting');

    await engine.requestReviewFix(goal.id, 1);
    await waitFor(() => delivery(engine, goal.id).reviews[0]!.status === 'addressed', 30_000);
    await waitFor(() => settled(engine, goal.id), 20_000);
    expect(delivery(engine, goal.id)).toMatchObject({ status: 'delivered', outcome: 'pr_open', reviewCycles: 1 });
    expect(delivery(engine, goal.id).reviews[0]).toMatchObject({ requested: true, status: 'addressed', replied: 1 });
    // a review that requested changes is answered in the conversation, quoting it
    expect(gh.comments.length).toBe(1);
    expect(gh.comments[0]!.body).toStartWith('> Please rename the parser.\n\nAddressed in');
    await expect(engine.requestReviewFix(goal.id, 1)).rejects.toThrow(/no review comments are waiting/);
  });

  test('a fix task that finds nothing to change replies so and pushes nothing; bots and empty comments are ignored', async () => {
    const gh = new FakeGh(bare);
    const engine = new Engine(cfg(), worker(null), gh);
    const goal = await openPr(engine, gh);
    gh.addReviewComment(1, { body: 'is this needed?' });
    gh.addReviewComment(1, { body: 'deploy preview ready', author: 'vercel[bot]', bot: true });
    await checkGoalPrs(engine, goal.id);
    await waitFor(() => delivery(engine, goal.id).reviews[0]?.status === 'nochange', 30_000);
    await waitFor(() => settled(engine, goal.id), 20_000);
    const d = delivery(engine, goal.id);
    expect(d.reviews[0]!.comments.length).toBe(1);
    expect(d.reviews[0]).toMatchObject({ status: 'nochange', commit: null, replied: 1 });
    // the resumed run pushed the branch as it was; nothing was pushed for the round itself
    expect(events(engine, goal.id).filter((t) => t === 'delivery.pushed').length).toBe(2);
    expect(await sh('git rev-parse ' + goal.branch, bare)).toBe(await sh('git rev-parse ' + goal.branch, repo));
    expect(gh.replies[0]!.body).toStartWith('Looked at this and left the code as it is');
  });

  test('a fix the task cannot make stops the delivery with one Inbox item; Resume gives a fresh budget', async () => {
    const gh = new FakeGh(bare);
    // the review fix breaks the goal's must check: every attempt fails
    const engine = new Engine(cfg(), worker((cwd) => writeFileSync(join(cwd, 'done.txt'), '')), gh);
    const goal = await engine.createGoal({ prompt: 'csv export', repoPath: repo, autoBrief: { mustChecks: ['test -s done.txt'] }, delivery: { mode: 'pr' }, budgets: { attemptsPerTask: 1 } });
    await waitFor(() => settled(engine, goal.id), 20_000);
    gh.addReviewComment(1, { body: 'empty the file' });
    await checkGoalPrs(engine, goal.id);
    await waitFor(() => delivery(engine, goal.id).status === 'failed', 30_000);
    const d = delivery(engine, goal.id);
    expect(d.step).toBe('fix-review');
    expect(d.error).toContain('could not address the 1 review comment(s) on PR #1');
    expect(d.reviews[0]).toMatchObject({ status: 'failed', replied: 0 });
    expect(gh.replies).toEqual([]);
    const inbox = listEscalations(engine.store.db, { goalId: goal.id, openOnly: true });
    expect(inbox.length).toBe(1);
    expect(inbox[0]!.trigger).toBe('delivery_failed');
    expect(inbox[0]!.message).toContain('fix-review');
    // Resume: the round stays failed (not addressed again), the PR is reused, the delivery is open again
    await engine.resumeDelivery(goal.id);
    await waitFor(() => settled(engine, goal.id), 20_000);
    expect(delivery(engine, goal.id)).toMatchObject({ status: 'delivered', outcome: 'pr_open', reviewCycles: 0 });
    expect(delivery(engine, goal.id).reviews.length).toBe(1);
  });

  test('with auto-merge armed under branch protection, a round is addressed and the merge is asked for again', async () => {
    const gh = new FakeGh(bare);
    gh.mergeBehavior = 'protected';
    const engine = new Engine(cfg(), worker(), gh);
    const goal = await engine.createGoal({ prompt: 'csv export', repoPath: repo, autoBrief: { mustChecks: ['test -f done.txt'] }, delivery: { mode: 'pr-automerge' } });
    await waitFor(() => settled(engine, goal.id), 20_000);
    expect(delivery(engine, goal.id)).toMatchObject({ status: 'delivered', outcome: 'automerge_armed' });
    gh.addReviewComment(1, { body: 'rename this' });
    await checkGoalPrs(engine, goal.id);
    await waitFor(() => delivery(engine, goal.id).reviews[0]?.status === 'addressed', 30_000);
    await waitFor(() => settled(engine, goal.id), 20_000);
    expect(delivery(engine, goal.id)).toMatchObject({ status: 'delivered', outcome: 'automerge_armed', reviewCycles: 1 });
    expect(await sh(`git cat-file -e ${goal.branch}:renamed.txt && echo yes`, bare)).toBe('yes');
    expect(gh.calls.filter((c) => c[0] === 'prMerge').length).toBeGreaterThanOrEqual(3);
  });

  test('one PR per task: the fix lands on the reviewed PR’s own branch, the other branch is untouched', async () => {
    const gh = new FakeGh(bare);
    const t = (key: string, title: string, deps: string[]) => ({ key, title, spec: `write ${title}.txt`, kind: 'feature' as const, scope: null, scenario: 'general' as const, areaKey: null, tdd: 'inherit' as const, dependsOnKeys: deps, parallelizable: false, relevantFiles: [] });
    const c = (key: string, taskKey: string, cmd: string) => ({ key, name: key, tier: 'must' as const, taskKey, areaKey: null, spec: { type: 'command' as const, cmd, timeoutMs: 60_000, expectExitCode: 0 } });
    const brief = { title: 'feat(demo): add two files', understanding: 'u', areas: [], assumptions: [], questions: [], styleOptions: [], costEstimateUsd: 0, timeEstimateMin: 0, tasks: [t('T1', 'first', []), t('T2', 'second', ['T1'])], checks: [c('C1', 'T1', 'test -f first.txt'), c('C2', 'T2', 'test -f second.txt')] };
    const runner = new FakeRunner((spec) => {
      if (spec.label?.includes('review comments')) writeFileSync(join(spec.cwd, 'renamed.txt'), 'x');
      else if (spec.label?.startsWith('attempt')) writeFileSync(join(spec.cwd, `${spec.label.replace(/^attempt /, '').replace(/ #\d+$/, '')}.txt`), 'ok');
    });
    const engine = new Engine(cfg(), runner, gh);
    const goal = await engine.createGoal({ prompt: 'stack', repoPath: repo, brief, delivery: { mode: 'pr', unit: 'task' } });
    await waitFor(() => settled(engine, goal.id), 40_000);
    const d0 = delivery(engine, goal.id);
    expect(d0.prs.map((p) => [p.number, p.state])).toEqual([
      [1, 'open'],
      [2, 'open'],
    ]);
    gh.addReviewComment(1, { body: 'rename this' });
    await checkGoalPrs(engine, goal.id);
    await waitFor(() => delivery(engine, goal.id).reviews[0]?.status === 'addressed', 40_000);
    await waitFor(() => settled(engine, goal.id), 40_000);
    const d = delivery(engine, goal.id);
    expect(d).toMatchObject({ status: 'delivered', outcome: 'pr_open', reviewCycles: 1 });
    const [b1, b2] = d.prs.map((p) => p.branch);
    expect(await sh(`git cat-file -e ${b1}:renamed.txt && echo yes`, bare)).toBe('yes');
    expect(await sh(`git cat-file -e ${b2}:renamed.txt 2>/dev/null && echo yes || echo no`, bare)).toBe('no');
    expect(gh.replies.length).toBe(1);
  });
});
