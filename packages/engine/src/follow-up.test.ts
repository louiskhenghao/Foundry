import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Brief, BriefOutput, Goal } from '@foundry/core';
import { getBrief, getGoal, listFollowUps } from '@foundry/core';
import type { ClaudeRunner, RunHandle, RunResult, RunSpec, RunnerEvent } from '@foundry/runner';
import { linkAttachment, stageFile } from './attachments.ts';
import { defaultConfig } from './config.ts';
import { Engine } from './engine.ts';
import { FollowUpError } from './follow-up.ts';
import { makeRepo, sh, terminal, waitFor } from './test-helpers.ts';
import { goalWorkspacePath } from './workspace.ts';

const ROOT = resolve(import.meta.dir, '../../..');
let dataDir: string;
let repo: string;
const extraDirs: string[] = [];
beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'foundry-followup-'));
  repo = await makeRepo();
});
const engines: Engine[] = [];
const track = <T extends Engine>(e: T): T => (engines.push(e), e);
afterEach(async () => {
  for (const e of engines.splice(0)) await e.stop().catch(() => {});
  for (const d of [dataDir, repo, `${repo}-foundry`, ...extraDirs.splice(0)]) rmSync(d, { recursive: true, force: true });
});

const briefOut = (over: Partial<BriefOutput> = {}): BriefOutput => ({
  title: 'feat: follow up',
  understanding: 'Carry on.',
  nature: 'code',
  areas: [{ key: 'A1', name: 'General', slug: 'general', description: '' }],
  assumptions: [],
  tasks: [{ key: 'T1', title: 'carry on', spec: 'carry on', kind: 'feature', scope: null, scenario: 'frontend', difficulty: 'standard', areaKey: 'A1', dependsOnKeys: [], parallelizable: false, relevantFiles: [], milestone: null }],
  checks: [{ key: 'C1', name: 'C1', tier: 'must', taskKey: 'T1', areaKey: null, type: 'command', cmd: 'true', rubric: null }],
  costEstimateUsd: 1,
  timeEstimateMin: 10,
  // a blocking question keeps the follow-up parked at its Brief: the test only looks at Clarify
  questions: [{ text: 'Which colour?', blocking: true, areaKey: null, options: [] }],
  styleOptions: [],
  run: null,
  ...over,
});

/** Workers write `a.txt` (the earlier goal's work); Clarify sessions answer with `clarifyAnswer`. */
class HybridRunner implements ClaudeRunner {
  calls: RunSpec[] = [];
  clarifyAnswer: BriefOutput = briefOut();
  active() {
    return 0;
  }
  async run(spec: RunSpec): Promise<RunHandle> {
    this.calls.push(spec);
    const label = spec.label ?? '';
    let structuredOutput: unknown = null;
    if (label.startsWith('classify nature')) structuredOutput = { nature: 'code' };
    else if (label.startsWith('clarify')) structuredOutput = this.clarifyAnswer;
    else writeFileSync(join(spec.cwd, 'a.txt'), 'from the earlier goal\n');
    const result: RunResult = { sessionId: `s${this.calls.length}`, subtype: 'success', isError: false, costUsd: 0.01, numTurns: 1, durationMs: 1, usage: null, modelUsage: null, permissionDenials: [], finalText: JSON.stringify(structuredOutput ?? 'done'), structuredOutput, exitCode: 0, pid: null, rateLimit: null, errorMessage: null, failureClass: null, skillsUsed: [], toolsUsed: {} };
    const events: RunnerEvent[] = [{ kind: 'hook', name: 'SessionStart:startup', outcome: 'success' }, { kind: 'init', sessionId: result.sessionId!, model: 'fake', tools: [], raw: {} }, { kind: 'result', result }];
    return { pid: null, events: (async function* () { for (const e of events) yield e; })(), kill() {}, result: Promise.resolve(result) };
  }
}

const cfg = () => defaultConfig(ROOT, { dataDir, claudeHome: join(dataDir, 'claude-home'), alwaysReviewTasks: false, log: () => {} });

/** An earlier goal that finished with `a.txt` on its goal branch (not on main). */
async function finishedGoal(engine: Engine, extra: Partial<Parameters<Engine['createGoal']>[0]> = {}): Promise<Goal> {
  const a = await engine.createGoal({ prompt: 'create a.txt for the landing page', repoPath: repo, autoBrief: { mustChecks: ['test -f a.txt'], stretchChecks: ['test -f never.txt'] }, ...extra });
  await waitFor(() => terminal(getGoal(engine.store.db, a.id)!.state));
  expect(getGoal(engine.store.db, a.id)!.state).toBe('done');
  return getGoal(engine.store.db, a.id)!;
}

const clarifyPrompt = (runner: HybridRunner, goalId: string, engine: Engine) => runner.calls.find((c) => c.label === `clarify ${getGoal(engine.store.db, goalId)!.title}`)!.prompt;

describe('follow-up goals', () => {
  test('A not merged: B starts from A\'s goal branch and Clarify gets the "# Previous goal" section', async () => {
    const runner = new HybridRunner();
    const engine = track(new Engine(cfg(), runner));
    const a = await finishedGoal(engine);
    const draft = await engine.followUpDraft(a.id);
    expect(draft.followable).toBe(true);
    expect(draft.start).toMatchObject({ recommended: 'previous', onBase: false, previousBranch: a.branch, baseBranch: 'main' });
    expect(draft.prefill).toMatchObject({ repoPath: repo, nature: a.nature, pace: a.workflow.pace, delivery: a.delivery.policy });

    const b = await engine.createGoal({ prompt: 'now add b.txt', repoPath: repo, follows: { goalId: a.id } });
    expect(b.follows).toMatchObject({ goalId: a.id, title: a.title, via: 'created', startFrom: 'previous', branch: a.branch });
    expect(b.baseBranch).toBe('main'); // B still delivers to the original base
    await waitFor(() => getGoal(engine.store.db, b.id)!.state === 'awaiting_brief_approval');
    const synced = getGoal(engine.store.db, b.id)!;
    expect(synced.baseSync?.startedFrom).toBe('previous');
    expect(existsSync(join(goalWorkspacePath(dataDir, synced), 'a.txt'))).toBe(true); // A's work is in B's checkout

    const prompt = clarifyPrompt(runner, b.id, engine);
    expect(prompt).toContain('# Previous goal');
    expect(prompt).toContain('create a.txt for the landing page'); // A's prompt
    expect(prompt).toContain('[done]'); // task outcomes
    expect(prompt).toContain('## Final goal review');
    expect(prompt).toContain('## Stretch checks it did not meet');
    expect(prompt).toContain('test -f never.txt');
    expect(prompt).toContain(`starts from the previous goal's branch ${a.branch}`);
    expect(listFollowUps(engine.store.db, a.id).map((g) => g.id)).toEqual([b.id]);
    engine.cancelGoal(b.id);
  }, 30_000);

  test('A squash-merged into main: B starts from the base branch', async () => {
    const runner = new HybridRunner();
    const engine = track(new Engine(cfg(), runner));
    const a = await finishedGoal(engine);
    await sh(`git merge -q --squash ${a.branch} && git -c user.name=t -c user.email=t@t commit -q -m "feat: a (#1)"`, repo);
    expect((await engine.followUpDraft(a.id)).start).toMatchObject({ recommended: 'base', onBase: true });
    const b = await engine.createGoal({ prompt: 'now add b.txt', repoPath: repo, follows: { goalId: a.id } });
    expect(b.follows?.startFrom).toBe('base');
    await waitFor(() => getGoal(engine.store.db, b.id)!.state === 'awaiting_brief_approval');
    expect(getGoal(engine.store.db, b.id)!.baseSync?.startedFrom).toBe('local');
    expect(clarifyPrompt(runner, b.id, engine)).toContain('this checkout starts from main');
    engine.cancelGoal(b.id);
  }, 30_000);

  test('only finished goals of the same repository can be followed', async () => {
    const runner = new HybridRunner();
    const engine = track(new Engine(cfg(), runner));
    const parked = await engine.createGoal({ prompt: 'still clarifying', repoPath: repo });
    await waitFor(() => getGoal(engine.store.db, parked.id)!.state === 'awaiting_brief_approval');
    await expect(engine.createGoal({ prompt: 'follow', repoPath: repo, follows: { goalId: parked.id } })).rejects.toThrow(/only a finished goal/);
    expect((await engine.followUpDraft(parked.id)).followable).toBe(false);
    await expect(engine.createGoal({ prompt: 'follow', repoPath: repo, follows: { goalId: 'g_missing' } })).rejects.toThrow(FollowUpError);

    const a = await finishedGoal(engine);
    const other = await makeRepo();
    extraDirs.push(other, `${other}-foundry`);
    await expect(engine.createGoal({ prompt: 'follow', repoPath: other, follows: { goalId: a.id } })).rejects.toThrow(/same repository/);
    engine.cancelGoal(parked.id);
  }, 30_000);

  test('attachments are copied and the snapshot survives deleting A', async () => {
    const runner = new HybridRunner();
    const engine = track(new Engine(cfg(), runner));
    const file = stageFile(dataDir, { name: 'notes.txt', mime: 'text/plain', bytes: new TextEncoder().encode('keep this') });
    const a = await finishedGoal(engine, { attachments: [file, linkAttachment('https://example.com/spec')] });
    const b = await engine.createGoal({ prompt: 'follow', repoPath: repo, follows: { goalId: a.id, startFrom: 'base' } });
    expect(b.attachments.map((x) => x.name)).toEqual(['notes.txt', 'example.com/spec']);
    expect(b.attachments.every((x) => !a.attachments.some((y) => y.id === x.id))).toBe(true); // copies, with their own ids
    const copied = b.attachments.find((x) => x.kind === 'file')!;
    expect(copied.path).toContain(b.id);
    expect(existsSync(join(dataDir, copied.path!))).toBe(true);
    const optOut = await engine.createGoal({ prompt: 'follow without files', repoPath: repo, follows: { goalId: a.id, attachments: false } });
    expect(optOut.attachments).toEqual([]);

    await engine.deleteGoal(a.id, { deleteBranch: true });
    const after = getGoal(engine.store.db, b.id)!;
    expect(after.follows).toMatchObject({ goalId: a.id, title: a.title });
    expect(after.follows!.context).toContain('create a.txt for the landing page');
    expect(existsSync(join(dataDir, copied.path!))).toBe(true); // A's attachments went to the trash, B's copy stays
    await expect(engine.followUpDraft(a.id)).rejects.toThrow(/not found/);
    for (const id of [b.id, optOut.id]) engine.cancelGoal(id);
  }, 30_000);

  test('a kept style direction comes first in B\'s Brief, already picked, with A\'s sample attached', async () => {
    const runner = new HybridRunner();
    const engine = track(new Engine(cfg(), runner));
    const warm = { key: 'S1', name: 'Warm night', palette: ['#2b1d16'], fonts: ['Noto Serif'], keywords: ['lantern'], description: 'Cozy.', samples: ['artifacts/samples/S1-1.png'], chosenSample: 'artifacts/samples/S1-1.png' };
    const brief: Omit<Brief, 'goalId'> = {
      title: 'feat(site): landing page',
      understanding: 'A warm landing page.',
      areas: [],
      assumptions: [],
      checks: [{ key: 'M1', name: 'a exists', tier: 'must', taskKey: 'T1', areaKey: null, spec: { type: 'command', cmd: 'test -f a.txt', timeoutMs: 60_000, expectExitCode: 0 } }],
      tasks: [{ key: 'T1', title: 'build the page', spec: 'write a.txt', kind: 'feature', scope: null, scenario: 'general', areaKey: null, tdd: 'inherit', dependsOnKeys: [], parallelizable: false, relevantFiles: [], milestone: null }],
      costEstimateUsd: 1,
      timeEstimateMin: 10,
      questions: [{ id: 'q1', text: 'Which style?', answer: 'Warm night', blocking: true, areaKey: null, options: ['Warm night'], kind: 'style', applied: true }],
      styleOptions: [warm],
      run: null,
    };
    const a = await engine.createGoal({ prompt: 'warm landing page', repoPath: repo, brief });
    // the sample A's human pinned lives in A's workspace
    const samples = join(goalWorkspacePath(dataDir, a), 'artifacts', 'samples');
    mkdirSync(samples, { recursive: true });
    writeFileSync(join(samples, 'S1-1.png'), 'png-bytes');
    await waitFor(() => terminal(getGoal(engine.store.db, a.id)!.state));

    runner.clarifyAnswer = briefOut({ styleOptions: [{ key: 'S1', name: 'Cool day', palette: ['#ffffff'], fonts: [], keywords: ['airy'], description: 'Light.' }] });
    const b = await engine.createGoal({ prompt: 'add a pricing section', repoPath: repo, follows: { goalId: a.id } });
    expect(b.follows?.style?.name).toBe('Warm night');
    expect(b.attachments.map((x) => x.name)).toEqual(['style-Warm-night.png']);
    await waitFor(() => getGoal(engine.store.db, b.id)!.state === 'awaiting_brief_approval');
    const bb = getBrief(engine.store.db, b.id)!.brief;
    expect(bb.styleOptions.map((s) => [s.key, s.name])).toEqual([['S1-kept', 'Warm night'], ['S1', 'Cool day']]);
    expect(bb.questions.find((q) => q.kind === 'style')).toMatchObject({ answer: 'Warm night', options: ['Warm night', 'Cool day'] });
    expect(clarifyPrompt(runner, b.id, engine)).toContain('## Style direction to keep');

    const plain = await engine.createGoal({ prompt: 'no style this time', repoPath: repo, follows: { goalId: a.id, style: false } });
    expect(plain.follows?.style).toBeNull();
    expect(plain.attachments).toEqual([]);
    for (const id of [b.id, plain.id]) engine.cancelGoal(id);
  }, 30_000);

  test('Mark as follow-up of…: earlier goals of the same repository only, once, never a cycle', async () => {
    const runner = new HybridRunner();
    const engine = track(new Engine(cfg(), runner));
    const x = await finishedGoal(engine);
    await Bun.sleep(5);
    const y = await engine.createGoal({ prompt: 'later goal', repoPath: repo, autoBrief: { mustChecks: ['true'] } });
    await waitFor(() => terminal(getGoal(engine.store.db, y.id)!.state));

    expect(() => engine.markFollowUp(y.id, y.id)).toThrow(/itself/);
    expect(() => engine.markFollowUp(x.id, y.id)).toThrow(/earlier goal/); // Y is newer: X following Y would reverse the chain
    const linked = engine.markFollowUp(y.id, x.id);
    expect(linked.follows).toMatchObject({ goalId: x.id, title: x.title, via: 'linked', startFrom: null, context: '' });
    expect(() => engine.markFollowUp(y.id, x.id)).toThrow(/already follows/);
    expect(listFollowUps(engine.store.db, x.id).map((g) => g.id)).toEqual([y.id]);
    // the link is an event: replay rebuilds it
    engine.store.replay();
    expect(getGoal(engine.store.db, y.id)!.follows?.goalId).toBe(x.id);
  }, 30_000);
});
