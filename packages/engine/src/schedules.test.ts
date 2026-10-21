import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { BriefOutput } from '@foundry/core';
import { getBrief, getGoal, getSchedule, listSchedules } from '@foundry/core';
import type { ClaudeRunner, RunHandle, RunResult, RunSpec, RunnerEvent } from '@foundry/runner';
import { defaultConfig } from './config.ts';
import { Engine } from './engine.ts';
import { ScheduleError, checkSchedules, fireSchedule } from './schedules.ts';
import { FakeRunner, makeRepo, sh, waitFor } from './test-helpers.ts';

const ROOT = resolve(import.meta.dir, '../../..');
let dataDir: string;
let repo: string;
const engines: Engine[] = [];
beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'foundry-schedules-'));
  repo = await makeRepo();
});
afterEach(async () => {
  for (const e of engines.splice(0)) await e.stop().catch(() => {});
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(repo, { recursive: true, force: true });
  rmSync(`${repo}-foundry`, { recursive: true, force: true });
});
const cfg = () => defaultConfig(ROOT, { dataDir, claudeHome: join(dataDir, 'claude-home'), alwaysReviewTasks: false, log: () => {} });
const track = (e: Engine) => {
  engines.push(e);
  return e;
};

/** a runner that answers the Clarifier with a one-task Brief and every attempt by writing the file it names */
class BriefRunner implements ClaudeRunner {
  calls: RunSpec[] = [];
  constructor(private brief: BriefOutput) {}
  active() {
    return 0;
  }
  async run(spec: RunSpec): Promise<RunHandle> {
    this.calls.push(spec);
    const structured = spec.label?.startsWith('classify nature') ? { nature: 'code' } : spec.label?.startsWith('clarify') ? this.brief : spec.label?.startsWith('plan') ? this.brief : null;
    if (spec.label?.startsWith('attempt')) writeFileSync(join(spec.cwd, 'done.txt'), 'ok');
    const result: RunResult = { sessionId: `s${this.calls.length}`, subtype: 'success', isError: false, costUsd: 0.2, numTurns: 2, durationMs: 1, usage: null, modelUsage: null, permissionDenials: [], finalText: structured ? JSON.stringify(structured) : 'done', structuredOutput: structured, exitCode: 0, pid: null, rateLimit: null, errorMessage: null, failureClass: null, skillsUsed: [], toolsUsed: {} };
    const events: RunnerEvent[] = [{ kind: 'init', sessionId: result.sessionId!, model: 'fake', tools: [], raw: {} }, { kind: 'result', result }];
    return { pid: null, events: (async function* () { for (const e of events) yield e; })(), kill() {}, result: Promise.resolve(result) };
  }
}
const oneTaskBrief = (questions: BriefOutput['openQuestions'] = []): BriefOutput => ({
  title: 'chore(deps): upgrade dependencies',
  understanding: 'Upgrade the dependencies.',
  nature: 'code',
  areas: [{ key: 'A1', name: 'Repository', slug: 'repository', description: 'the whole repository' }],
  assumptions: ['nothing breaks'],
  tasks: [{ key: 'T1', title: 'upgrade', spec: 'upgrade them', kind: 'chore', scope: null, scenario: 'general', difficulty: 'standard', areaKey: 'A1', dependsOnKeys: [], parallelizable: false, relevantFiles: [], milestone: null }],
  checks: [{ key: 'C1', name: 'done', tier: 'must', taskKey: 'T1', areaKey: null, type: 'command', cmd: 'test -f done.txt', rubric: null }],
  costEstimateUsd: 1.5,
  timeEstimateMin: 12,
  openQuestions: questions,
  styleOptions: [],
  run: null,
  apps: null,
});

const recipe = (over: Record<string, unknown> = {}) => ({ prompt: 'Upgrade the dependencies and run the tests.', repoPath: repo, budgetPreset: 'quick' as const, links: [], ...over });
const local = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min, 0, 0);

describe('schedules (ADR-0054)', () => {
  test('saved whole, listed with its next run, edited in place, turned off and on, deleted', async () => {
    const engine = track(new Engine(cfg(), new FakeRunner(() => {})));
    const s = engine.saveSchedule({ name: 'Weekly upgrade', cadence: { kind: 'weekly', weekday: 1, at: '03:00' }, recipe: recipe() });
    expect(s).toMatchObject({ name: 'Weekly upgrade', enabled: true, autoApprove: true, runs: 0, lastRun: null });
    expect(getSchedule(engine.store.db, s.id)).toEqual(s);
    const listed = engine.listSchedules();
    expect(listed.length).toBe(1);
    expect(listed[0]!.nextRunAt).toBeTruthy();
    expect(listed[0]!.lastGoal).toBeNull();
    const edited = engine.saveSchedule({ id: s.id, name: 'Monday upgrade', cadence: { kind: 'daily', at: '04:00' }, recipe: recipe({ prompt: 'Upgrade them.' }), autoApprove: false });
    expect(edited).toMatchObject({ id: s.id, name: 'Monday upgrade', autoApprove: false, createdAt: s.createdAt });
    expect(edited.recipe.prompt).toBe('Upgrade them.');
    expect(engine.setScheduleEnabled(s.id, false).enabled).toBe(false);
    expect(engine.listSchedules()[0]!.nextRunAt).toBeNull();
    expect(engine.setScheduleEnabled(s.id, true).enabled).toBe(true);
    expect(() => engine.saveSchedule({ id: 'sch_missing', name: 'x', cadence: { kind: 'daily', at: '03:00' }, recipe: recipe() })).toThrow(ScheduleError);
    expect(() => engine.saveSchedule({ name: 'x', cadence: { kind: 'daily', at: '03:00' }, recipe: recipe({ repoPath: 'relative/path' }) })).toThrow(/absolute/);
    engine.deleteSchedule(s.id);
    expect(listSchedules(engine.store.db)).toEqual([]);
    expect(() => engine.deleteSchedule(s.id)).toThrow(ScheduleError);
  }, 60_000);

  test('a due schedule fires one goal from its recipe: titled after it, links attached, the interview skipped, the schedule on the goal', async () => {
    const engine = track(new Engine(cfg(), new BriefRunner(oneTaskBrief())));
    const s = engine.saveSchedule({ name: 'Nightly upgrade', cadence: { kind: 'daily', at: '03:00' }, recipe: recipe({ interviewDepth: 4, milestonePause: true, links: [{ url: 'http://127.0.0.1:9/upgrade-notes', note: 'the notes' }] }) });
    // not due yet: nothing fires
    await checkSchedules(engine, new Date(Date.parse(s.updatedAt) + 60_000));
    expect(getSchedule(engine.store.db, s.id)!.runs).toBe(0);
    // two days on: due (one missed run) → one goal, late
    const now = new Date(Date.parse(s.updatedAt) + 2 * 86_400_000);
    await checkSchedules(engine, now);
    const after = getSchedule(engine.store.db, s.id)!;
    expect(after.runs).toBe(1);
    expect(after.lastRun?.goalId).toBeTruthy();
    expect(after.lastRun?.skipped).toBeNull();
    const goal = getGoal(engine.store.db, after.lastRun!.goalId!)!;
    expect(goal.title).toMatch(/^Nightly upgrade · \d{4}-\d{2}-\d{2}$/);
    expect(goal.schedule).toMatchObject({ id: s.id, name: 'Nightly upgrade', autoApprove: true });
    expect(goal.interview).toBeNull();
    expect(goal.milestonePause).toBe(false);
    expect(goal.budgetPreset).toBe('quick');
    expect(goal.attachments.map((a) => [a.kind, a.url, a.note])).toEqual([['link', 'http://127.0.0.1:9/upgrade-notes', 'the notes']]);
    const fired = engine.store.listByGoal(goal.id, 100).find((e) => e.type === 'schedule.fired')!;
    expect(fired.payload).toMatchObject({ scheduleId: s.id, name: 'Nightly upgrade', skipped: null, late: true, manual: false });
    // the same pass again: not due any more (the late run counted)
    await checkSchedules(engine, new Date(now.getTime() + 60_000));
    expect(getSchedule(engine.store.db, s.id)!.runs).toBe(1);
    // the run: its Brief is approved by the engine with the budget the Brief proposes when the preset is Auto
    await waitFor(() => ['done', 'over_delivered', 'failed'].includes(getGoal(engine.store.db, goal.id)!.state), 30_000);
    expect(getGoal(engine.store.db, goal.id)!.state).toBe('done');
    expect(getBrief(engine.store.db, goal.id)?.approved).toBe(true);
    expect(engine.store.listByGoal(goal.id, 500).some((e) => e.type === 'engine.note' && String((e.payload as { message: string }).message).includes('approved by the engine: the schedule'))).toBe(true);
    expect(engine.listSchedules()[0]!.lastGoal).toMatchObject({ id: goal.id, state: 'done' });
    // the link's snapshot settles before the data folder goes
    await waitFor(() => getGoal(engine.store.db, goal.id)!.attachments[0]!.markdown?.status !== 'pending', 20_000);
  }, 60_000);

  test('an Auto budget takes the Brief’s proposal; a blocking question leaves the Brief for the person', async () => {
    const engine = track(new Engine(cfg(), new BriefRunner(oneTaskBrief())));
    const s = engine.saveSchedule({ name: 'Budget from the estimate', cadence: { kind: 'daily', at: '03:00' }, recipe: recipe({ budgetPreset: 'auto', budgets: undefined }) });
    const { goalId } = await fireSchedule(engine, s, { manual: true });
    await waitFor(() => ['done', 'over_delivered', 'failed'].includes(getGoal(engine.store.db, goalId!)!.state), 30_000);
    expect(getGoal(engine.store.db, goalId!)!.budgets).toMatchObject({ maxCostUsd: 3, maxDurationMin: 30 });

    const asks = track(new Engine(cfg(), new BriefRunner(oneTaskBrief([{ text: 'Which registry?', options: ['npm', 'jsr'], blocking: true }]))));
    const s2 = asks.saveSchedule({ name: 'Asks', cadence: { kind: 'daily', at: '03:00' }, recipe: recipe() });
    const r2 = await fireSchedule(asks, s2, { manual: true });
    await waitFor(() => getGoal(asks.store.db, r2.goalId!)!.state === 'awaiting_brief_approval', 20_000);
    await new Promise((r) => setTimeout(r, 300));
    expect(getGoal(asks.store.db, r2.goalId!)!.state).toBe('awaiting_brief_approval');
    expect(getBrief(asks.store.db, r2.goalId!)?.approved).toBeFalsy();
  }, 60_000);

  test('while the previous run is still going the firing is skipped and said so; Run now refuses; a folder gone is a skipped run too', async () => {
    const engine = track(new Engine(cfg(), new FakeRunner(() => {})));
    const s = engine.saveSchedule({ name: 'Busy', cadence: { kind: 'daily', at: '03:00' }, recipe: recipe({ autoBrief: { mustChecks: ['sleep 30'] } }), autoApprove: false });
    const first = await fireSchedule(engine, s, { manual: true });
    expect(first.goalId).toBeTruthy();
    const again = await fireSchedule(engine, getSchedule(engine.store.db, s.id)!, { now: new Date() });
    expect(again.goalId).toBeNull();
    expect(again.skipped).toMatch(/the previous run is still going/);
    expect(getSchedule(engine.store.db, s.id)!.runs).toBe(2);
    await expect(engine.runSchedule(s.id)).rejects.toThrow(/previous run is still going/);
    await engine.cancelGoal(first.goalId!);
    await waitFor(() => getGoal(engine.store.db, first.goalId!)!.state === 'cancelled', 20_000);
    const gone = engine.saveSchedule({ name: 'Gone', cadence: { kind: 'daily', at: '03:00' }, recipe: recipe({ repoPath: join(dataDir, 'missing') }) });
    const r = await fireSchedule(engine, gone, { manual: true });
    expect(r.goalId).toBeNull();
    expect(r.skipped).toMatch(/no goal could be made/);
  }, 60_000);

  test('a run the person approves: the interview and the Brief wait like any goal’s', async () => {
    const engine = track(new Engine(cfg(), new BriefRunner(oneTaskBrief())));
    const s = engine.saveSchedule({ name: 'Ask me', cadence: { kind: 'daily', at: '03:00' }, recipe: recipe({ interviewDepth: 0 }), autoApprove: false });
    const { goalId } = await fireSchedule(engine, s, { manual: true });
    await waitFor(() => getGoal(engine.store.db, goalId!)!.state === 'awaiting_brief_approval', 20_000);
    await new Promise((r) => setTimeout(r, 300));
    expect(getGoal(engine.store.db, goalId!)!.state).toBe('awaiting_brief_approval');
    expect(getGoal(engine.store.db, goalId!)!.schedule?.autoApprove).toBe(false);
    expect(await sh('git branch --list', repo)).toContain('main');
  }, 60_000);
});
