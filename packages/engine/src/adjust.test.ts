import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { getGoal, getTask, listAttempts, listEscalations, listTasks } from '@foundry/core';
import { AdjustError, adjustedSinceDelivery, versionFiles } from './adjust.ts';
import { linkAttachment, stageFile } from './attachments.ts';
import { defaultConfig } from './config.ts';
import { Engine } from './engine.ts';
import { FakeRunner, makeRepo, sh, terminal, waitFor } from './test-helpers.ts';
import { goalWorkspacePath, listArtifacts } from './workspace.ts';

/**
 * Adjust the result (ADR-0078): a finished goal takes the person's words on its result and carries them out itself —
 * the finished task's session resumed, a task appended, or the failed tasks run again — keeping the earlier result.
 */
const ROOT = resolve(import.meta.dir, '../../..');
let dataDir: string;
let repo: string;
const engines: Engine[] = [];
beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'foundry-adjust-'));
  repo = await makeRepo();
});
afterEach(async () => {
  for (const e of engines.splice(0)) await e.stop();
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(repo, { recursive: true, force: true });
});
const track = (e: Engine) => (engines.push(e), e);
const cfg = (extra: Partial<ReturnType<typeof defaultConfig>> = {}) => defaultConfig(ROOT, { dataDir, claudeHome: join(dataDir, 'claude-home'), alwaysReviewTasks: false, betaAdjust: true, log: () => {}, ...extra });
const t = (key: string, title: string, deps: string[], scenario: 'general' | 'image' = 'general') => ({ key, title, spec: `write ${title}.txt`, kind: 'feature' as const, scope: null, scenario, areaKey: null, tdd: 'inherit' as const, dependsOnKeys: deps, parallelizable: false, relevantFiles: [] });
const c = (key: string, taskKey: string | null, cmd: string) => ({ key, name: key, tier: 'must' as const, taskKey, areaKey: null, spec: { type: 'command' as const, cmd, timeoutMs: 60_000, expectExitCode: 0 } });
const brief = (tasks: ReturnType<typeof t>[], checks: ReturnType<typeof c>[]) => ({ title: '', understanding: 'u', areas: [], assumptions: [], questions: [], styleOptions: [], costEstimateUsd: 0, timeEstimateMin: 0, tasks, checks });
const attempts = (runner: FakeRunner) => runner.calls.filter((x) => x.label?.startsWith('attempt'));

describe('Adjust the result', () => {
  test('a goal of one task: its session resumes with the words and the files, lands a commit of its own, and the earlier result is kept', async () => {
    const runner = new FakeRunner((spec) => {
      mkdirSync(join(spec.cwd, 'artifacts'), { recursive: true });
      writeFileSync(join(spec.cwd, 'hello.txt'), spec.resumeSessionId ? 'adjusted' : 'ok');
      writeFileSync(join(spec.cwd, 'artifacts', 'out.txt'), spec.resumeSessionId ? 'v2' : 'v1');
    });
    const engine = track(new Engine(cfg(), runner));
    const goal = await engine.createGoal({ prompt: 'one step', repoPath: repo, brief: brief([t('T1', 'hello', [], 'image')], [c('C1', 'T1', 'test -f hello.txt')]) });
    await waitFor(() => terminal(getGoal(engine.store.db, goal.id)!.state), 20_000);
    expect(getGoal(engine.store.db, goal.id)!.state).toBe('done');
    const ws = goalWorkspacePath(dataDir, goal);
    const task = listTasks(engine.store.db, goal.id)[0]!;
    const first = listAttempts(engine.store.db, task.id).filter((a) => a.kind === 'work').at(-1)!;
    expect(first.state).toBe('passed');
    const headBefore = await sh('git rev-parse HEAD', ws);
    const view0 = engine.adjustView(getGoal(engine.store.db, goal.id)!);
    expect(view0).toMatchObject({ enabled: true, can: true, mode: 'resume', next: 1, history: [] });

    const link = engine.stage(linkAttachment('https://example.com/red'), { convert: false });
    const file = engine.stage(stageFile(dataDir, { name: 'lid.png', mime: 'image/png', bytes: new Uint8Array([1, 2, 3]) }), { convert: false });
    const adj = await engine.adjust(goal.id, 'make it say adjusted', { attachments: [link, file], by: 'ann' });
    expect(adj).toMatchObject({ n: 1, mode: 'resume', taskId: task.id, by: 'ann' });
    expect(adj.attachmentIds).toHaveLength(2);
    // recorded on the goal and on the task; the task back in line; its squash target moved to the branch as it stands
    const g1 = getGoal(engine.store.db, goal.id)!;
    expect(g1.state).toBe('running');
    expect(g1.adjustments!.map((a) => a.id)).toEqual([adj.id]);
    expect(g1.attachments.filter((a) => a.adjustId === adj.id).map((a) => a.name).sort()).toEqual(['example.com/red', 'lid.png']);
    expect(getTask(engine.store.db, task.id)!.adjustment?.id).toBe(adj.id);
    expect(getTask(engine.store.db, task.id)!.baseRef).toBe(headBefore);
    // the result as it was is kept, out of the artifacts' way
    expect(readFileSync(join(ws, 'artifacts', '.history', '1', 'out.txt'), 'utf8')).toBe('v1');
    expect(listArtifacts(ws)).toEqual(['out.txt']);
    expect(versionFiles(ws, 1)).toEqual(['out.txt']);

    await waitFor(() => terminal(getGoal(engine.store.db, goal.id)!.state), 30_000);
    expect(getGoal(engine.store.db, goal.id)!.state).toBe('done');
    const calls = attempts(runner);
    expect(calls).toHaveLength(2);
    expect(calls[1]!.resumeSessionId).toBe(first.sessionId!);
    expect(calls[1]!.prompt).toContain('asks for an adjustment (adjustment 1)');
    expect(calls[1]!.prompt).toContain('make it say adjusted');
    expect(calls[1]!.prompt).toContain('lid.png');
    expect(calls[1]!.prompt).toContain('https://example.com/red');
    expect(readFileSync(join(ws, 'hello.txt'), 'utf8')).toBe('adjusted');
    expect(readFileSync(join(ws, 'artifacts', 'out.txt'), 'utf8')).toBe('v2');
    // one attempt, continued; the adjustment a commit of its own on top of the task's, named after it
    expect(listAttempts(engine.store.db, task.id).filter((a) => a.kind === 'work')).toHaveLength(1);
    expect((await sh(`git log --format=%s main..${goal.branch}`, ws)).split('\n')).toEqual(['feat: hello (adjustment 1)', 'feat: hello']);
    expect(getTask(engine.store.db, task.id)!.adjustment).toBeNull();
    const view = engine.adjustView(getGoal(engine.store.db, goal.id)!);
    expect(view).toMatchObject({ can: true, mode: 'resume', next: 2 });
    expect(view.history[0]!.files).toEqual(['out.txt']);
    const before = engine.store.snapshotReadModels();
    engine.store.replay();
    expect(engine.store.snapshotReadModels()).toEqual(before);
  }, 60_000);

  test('a goal of several tasks: a task is appended after the finished ones, with the goal\'s must commands, a fresh session told the words', async () => {
    const runner = new FakeRunner((spec) => {
      const title = spec.label?.replace(/^attempt /, '').replace(/ #\d+$/, '') ?? 'x';
      writeFileSync(join(spec.cwd, title.startsWith('Adjustment') ? 'bigger.txt' : `${title}.txt`), 'ok');
    });
    const engine = track(new Engine(cfg(), runner));
    const goal = await engine.createGoal({ prompt: 'two steps', repoPath: repo, brief: brief([t('T1', 'first', []), t('T2', 'second', ['T1'])], [c('C1', 'T1', 'test -f first.txt'), c('C2', 'T2', 'test -f second.txt'), c('G', null, 'test -f first.txt && test -f second.txt')]) });
    await waitFor(() => terminal(getGoal(engine.store.db, goal.id)!.state), 20_000);
    expect(getGoal(engine.store.db, goal.id)!.state).toBe('done');
    expect(engine.adjustView(getGoal(engine.store.db, goal.id)!)).toMatchObject({ can: true, mode: 'task' });
    const adj = await engine.adjust(goal.id, 'make it bigger\nmuch bigger');
    expect(adj.mode).toBe('task');
    const tasks = listTasks(engine.store.db, goal.id);
    const added = tasks.find((x) => x.origin === 'adjustment')!;
    expect(added.title).toBe('Adjustment 1: make it bigger');
    expect(added.spec).toContain('much bigger');
    expect(added.dependsOn.sort()).toEqual(tasks.filter((x) => x.origin === 'brief').map((x) => x.id).sort());
    expect(adj.taskId).toBe(added.id);
    // the goal's must command, as a fix task gets it
    const { listChecks } = await import('@foundry/core');
    expect(listChecks(engine.store.db, goal.id).filter((x) => x.taskId === added.id).map((x) => x.name)).toEqual(['G']);
    await waitFor(() => terminal(getGoal(engine.store.db, goal.id)!.state), 30_000);
    expect(getGoal(engine.store.db, goal.id)!.state).toBe('done');
    const fresh = attempts(runner).at(-1)!;
    expect(fresh.resumeSessionId).toBeUndefined();
    expect(fresh.prompt).toContain('# Your task (Adjustment 1: make it bigger)');
    expect(fresh.prompt).toContain('asks for an adjustment (adjustment 1)');
    expect(getTask(engine.store.db, added.id)!.state).toBe('done');
    expect((await sh(`git log --format=%s main..${goal.branch}`, goalWorkspacePath(dataDir, goal))).split('\n')[0]).toContain('Adjustment 1');
  }, 60_000);

  test('a failed goal: its failed tasks run again, each fresh attempt given the words; the record is cleared when the task lands', async () => {
    let pass = false;
    const runner = new FakeRunner((spec) => {
      if (pass) writeFileSync(join(spec.cwd, 'never.txt'), 'ok');
    });
    const engine = track(new Engine(cfg(), runner));
    const goal = await engine.createGoal({ prompt: 'hard', repoPath: repo, brief: brief([t('T1', 'first', [])], [c('C1', 'T1', 'test -f never.txt')]) });
    await waitFor(() => listEscalations(engine.store.db, { goalId: goal.id, openOnly: true }).length > 0, 20_000);
    await engine.answerEscalation(listEscalations(engine.store.db, { goalId: goal.id, openOnly: true })[0]!.id, { action: 'abort_goal' });
    await waitFor(() => getGoal(engine.store.db, goal.id)!.state === 'failed');
    const task = listTasks(engine.store.db, goal.id)[0]!;
    expect(engine.adjustView(getGoal(engine.store.db, goal.id)!)).toMatchObject({ can: true, mode: 'restart' });
    pass = true;
    const adj = await engine.adjust(goal.id, 'the file is called never.txt, really');
    expect(adj).toMatchObject({ mode: 'restart', taskId: task.id });
    expect(getGoal(engine.store.db, goal.id)!.state).toBe('running');
    await waitFor(() => terminal(getGoal(engine.store.db, goal.id)!.state), 30_000);
    expect(getGoal(engine.store.db, goal.id)!.state).toBe('done');
    const fresh = attempts(runner).at(-1)!;
    expect(fresh.resumeSessionId).toBeUndefined();
    expect(fresh.prompt).toContain('# Adjustment asked by the person (adjustment 1)');
    expect(fresh.prompt).toContain('never.txt, really');
    expect(getTask(engine.store.db, task.id)!.adjustment).toBeNull();
    expect(engine.store.listByGoal(goal.id, 5000).some((e) => e.type === 'task.restarted' && (e.payload as { reason: string }).reason.includes('adjustment 1'))).toBe(true);
  }, 60_000);

  test('refused while the beta is off, while the goal is at work, once its work was merged; a delivery already out carries on after an adjustment', async () => {
    const off = track(new Engine(cfg({ betaAdjust: false }), new FakeRunner(() => {})));
    const g0 = await off.createGoal({ prompt: 'x', repoPath: repo, brief: brief([t('T1', 'first', [])], [c('C1', 'T1', 'true')]) });
    await expect(off.adjust(g0.id, 'words')).rejects.toBeInstanceOf(AdjustError);
    await expect(off.adjust(g0.id, 'words')).rejects.toThrow(/Settings → Beta/);
    expect(off.adjustView(getGoal(off.store.db, g0.id)!)).toMatchObject({ enabled: false, can: false });
    await waitFor(() => terminal(getGoal(off.store.db, g0.id)!.state), 20_000);

    const engine = track(new Engine(cfg(), new FakeRunner(() => {})));
    const goal = await engine.createGoal({ prompt: 'x', repoPath: repo, brief: brief([t('T1', 'first', [])], [c('C1', 'T1', 'true')]) });
    // at work: refused with the reason, nothing recorded
    const early = engine.adjustView(getGoal(engine.store.db, goal.id)!);
    expect(early.can).toBe(false);
    expect(early.reason).toContain('still at work');
    await expect(engine.adjust(goal.id, 'words')).rejects.toThrow(/still at work/);
    await waitFor(() => terminal(getGoal(engine.store.db, goal.id)!.state), 20_000);
    expect(getGoal(engine.store.db, goal.id)!.adjustments).toEqual([]);
    await expect(engine.adjust(goal.id, '   ')).rejects.toThrow(/what should change/);
    // while a delivery runs, nothing is adjusted: the branch it pushes must not move under it
    engine.store.append({ type: 'delivery.policy_set', goalId: goal.id, payload: { policy: getGoal(engine.store.db, goal.id)!.delivery.policy, source: 'deliver' } });
    engine.store.append({ type: 'delivery.started', goalId: goal.id, payload: { policy: getGoal(engine.store.db, goal.id)!.delivery.policy, plan: [] } });
    expect(engine.adjustView(getGoal(engine.store.db, goal.id)!).reason).toContain('delivery is under way');
    await expect(engine.adjust(goal.id, 'words')).rejects.toThrow(/delivery is under way/);
    // a branch pushed: an adjustment after the delivery was set going means it carries on; not before, not once it did again
    engine.store.append({ type: 'delivery.completed', goalId: goal.id, payload: { outcome: 'pushed' } });
    expect(adjustedSinceDelivery(engine, getGoal(engine.store.db, goal.id)!)).toBe(false);
    const adj = await engine.adjust(goal.id, 'again');
    expect(adj.n).toBe(1);
    expect(adjustedSinceDelivery(engine, { ...getGoal(engine.store.db, goal.id)!, delivery: { ...getGoal(engine.store.db, goal.id)!.delivery, status: 'delivered', outcome: 'pushed' } })).toBe(true);
    engine.store.append({ type: 'delivery.policy_set', goalId: goal.id, payload: { policy: getGoal(engine.store.db, goal.id)!.delivery.policy, source: 'resume' } });
    expect(adjustedSinceDelivery(engine, { ...getGoal(engine.store.db, goal.id)!, delivery: { ...getGoal(engine.store.db, goal.id)!.delivery, status: 'delivered', outcome: 'pushed' } })).toBe(false);
    await waitFor(() => terminal(getGoal(engine.store.db, goal.id)!.state), 30_000);
    // merged: refused, a follow-up is the way
    engine.store.append({ type: 'delivery.completed', goalId: goal.id, payload: { outcome: 'merged' } });
    const merged = engine.adjustView(getGoal(engine.store.db, goal.id)!);
    expect(merged.can).toBe(false);
    expect(merged.reason).toContain('merged');
  }, 60_000);
});
