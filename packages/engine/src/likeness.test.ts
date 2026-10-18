import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { IDLE_DELIVERY, getGoal, listTasks, type Brief, type BriefSubject, type Goal, type LikenessVerdict, type Task } from '@foundry/core';
import type { ClaudeRunner, RunHandle, RunResult, RunSpec, RunnerEvent } from '@foundry/runner';
import { defaultConfig } from './config.ts';
import { Engine } from './engine.ts';
import { latestLikeness } from './likeness.ts';
import { likenessLines, subjectsDir } from './subjects.ts';
import { waitFor } from './test-helpers.ts';
import { screenshotsDir } from './workspace.ts';

const ROOT = resolve(import.meta.dir, '../../..');
let dataDir: string;
let engine: Engine;
let runner: VerdictRunner;

/** answers a Likeness review with the next scripted verdict */
class VerdictRunner implements ClaudeRunner {
  calls: RunSpec[] = [];
  verdicts: LikenessVerdict[] = [];
  active() {
    return 0;
  }
  async run(spec: RunSpec): Promise<RunHandle> {
    this.calls.push(spec);
    const structuredOutput = this.verdicts.shift() ?? null;
    const result: RunResult = { sessionId: `s${this.calls.length}`, subtype: 'success', isError: false, costUsd: 0.3, numTurns: 4, durationMs: 1, usage: null, modelUsage: null, permissionDenials: [], finalText: JSON.stringify(structuredOutput), structuredOutput, exitCode: 0, pid: null, rateLimit: null, errorMessage: null, failureClass: null, skillsUsed: [], toolsUsed: {} };
    const events: RunnerEvent[] = [{ kind: 'init', sessionId: result.sessionId!, model: 'fake', tools: [], raw: {} }, { kind: 'result', result }];
    return { pid: null, events: (async function* () { for (const e of events) yield e; })(), kill() {}, result: Promise.resolve(result) };
  }
}

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'foundry-likeness-'));
  runner = new VerdictRunner();
  engine = new Engine(defaultConfig(ROOT, { dataDir, claudeHome: join(dataDir, 'claude-home'), log: () => {} }), runner);
  // the fixtures drive the milestones by hand: no tick may run the goal in the background
  engine.beginUpdateDrain();
});
afterEach(async () => {
  await engine.stop();
  rmSync(dataDir, { recursive: true, force: true });
});

const subject: BriefSubject = { key: 'P1', name: 'Porsche 911 GT3 (992)', lookFor: 'the nose and the rear wing', pictures: [{ file: 'P1-1.jpg', source: 'web', url: 'https://example.com/a', caption: 'front three-quarter' }], search: { status: 'ok', detail: '', at: 'x' } };

/** a running goal whose Brief has `subjects`, with one landed milestone task */
function seed(subjects: BriefSubject[] = [subject], state: Goal['state'] = 'running'): { goal: Goal; task: Task } {
  const now = new Date().toISOString();
  const goal = {
    id: 'g_like01', title: 'showcase', prompt: 'a showcase of one car', workspaceDir: null, checkpoint: null, selfCheck: false, previewRef: null, previewPlace: 'auto', milestonePause: false, clarifyStage: null, references: [], investigation: null, interview: null, effort: null, modelPreset: null, modelSubstitutions: {}, repoPath: '/nowhere', baseBranch: 'main', branch: 'goal/g_like01',
    budgets: { maxCostUsd: 5, maxDurationMin: 120, maxConcurrent: 3, attemptsPerTask: 3 }, budgetPreset: 'custom', mode: 'expert', workflow: { tdd: 'off', pace: 'thorough', ponytail: 'on' },
    models: { strong: 'opus', cheap: 'haiku', worker: 'opus' }, state, stateBeforeBlock: null, costUsd: 0, fixCycles: 0, delivery: IDLE_DELIVERY, attachments: [], baseSync: null, autoskills: null, follows: null, delegation: { allow: false, autoApprove: false }, delegatedFrom: null,
    completion: { graphRefresh: false, docs: [], audit: false, auditRun: null, docsRun: null, graphRun: null, artifactsRun: null }, nature: 'code', outputDir: null, runningSince: null, createdAt: now, updatedAt: now,
  } as unknown as Goal;
  engine.store.append({ type: 'goal.created', goalId: goal.id, payload: { goal } });
  const brief = { goalId: goal.id, title: '', understanding: 'u', areas: [], assumptions: [], checks: [], tasks: [], costEstimateUsd: 0, timeEstimateMin: 0, questions: [], styleOptions: [], subjects } as Brief;
  engine.store.append({ type: 'brief.approved', goalId: goal.id, payload: { brief } });
  const task = { id: 't_hero', goalId: goal.id, title: 'add hero with the car', spec: 's', kind: 'feature', scope: null, scenario: 'frontend', area: null, tdd: 'inherit', dependsOn: [], relevantFiles: ['src/hero.ts'], parallelizable: false, retryBudget: 3, origin: 'brief', milestone: 'the car in the hero', milestoneVisits: 1, checkpointOf: null, difficulty: 'standard', state: 'done', branch: null, worktreePath: null, baseRef: null, commitRef: null, commitMessage: null, hint: null, extraAttempts: 0, delegatedGoalId: null, summary: null, createdAt: now, updatedAt: now } as Task;
  engine.store.append({ type: 'task.created', goalId: goal.id, payload: { task } });
  mkdirSync(subjectsDir(dataDir, goal.id), { recursive: true });
  writeFileSync(join(subjectsDir(dataDir, goal.id), 'P1-1.jpg'), 'jpeg');
  const shots = screenshotsDir(dataDir, goal);
  mkdirSync(shots, { recursive: true });
  for (const f of ['hero-01.png', 'hero-02.png']) writeFileSync(join(shots, f), 'png');
  return { goal: getGoal(engine.store.db, goal.id)!, task };
}

const record = (taskId: string, extra: Record<string, unknown> = {}) =>
  engine.store.append({ type: 'milestone.evidence', goalId: 'g_like01', payload: { taskId, video: null, shots: [{ file: 'hero-01.png', caption: 'front three-quarter' }, { file: 'hero-02.png', caption: 'side' }], summary: 'the hero', error: null, status: 'pass', ...extra } });
const looks = () => engine.store.listByGoalOfTypes('g_like01', ['milestone.likeness']).map((e) => e.payload as { taskId: string; status: string; verdict: LikenessVerdict | null; fixTaskId: string | null; evidenceAt: string });
const verdict = (major: boolean, score = 4): LikenessVerdict => ({ subjects: [{ key: 'P1', shown: true, score, matches: ['the colour'], differences: [{ what: 'the nose is tall and rounded; in the pictures it is a low flat wedge', major }, { what: 'the wheels are too small', major: false }], shots: ['hero-01.png'] }], summary: 'recognisably a sports car, not this one' });

describe('the Likeness review', () => {
  test('compares a recording with the pictures; major differences make one fix task that re-opens the milestone; the next recording is only reported', async () => {
    const { goal, task } = seed();
    runner.verdicts.push(verdict(true), verdict(true, 6));
    record(task.id);
    await waitFor(() => looks().length === 1);
    const [first] = looks();
    expect(first).toMatchObject({ taskId: task.id, status: 'ok', verdict: verdict(true) });
    const call = runner.calls[0]!;
    expect(call.label).toBe('likeness add hero with the car');
    expect(call.prompt).toContain(`\`${join(subjectsDir(dataDir, goal.id), 'P1-1.jpg')}\` — front three-quarter`);
    expect(call.prompt).toContain(`\`${join(screenshotsDir(dataDir, goal), 'hero-01.png')}\` — front three-quarter`);
    expect(call.addDirs).toEqual([screenshotsDir(dataDir, goal), subjectsDir(dataDir, goal.id)]);
    expect(call.disallowedTools).toContain('Write');
    const fix = listTasks(engine.store.db, goal.id).find((t) => t.origin === 'likeness-fix')!;
    expect(first!.fixTaskId).toBe(fix.id);
    expect(fix).toMatchObject({ title: 'match Porsche 911 GT3 (992) to its pictures', checkpointOf: task.id, relevantFiles: ['src/hero.ts'], state: 'pending' });
    expect(fix.spec).toContain('## Porsche 911 GT3 (992): 4/10');
    expect(fix.spec).toContain('- (major) the nose is tall and rounded; in the pictures it is a low flat wedge');
    expect(fix.spec).toContain(join(screenshotsDir(dataDir, goal), 'hero-01.png'));
    expect(fix.spec).toContain('Already right, keep it: the colour');
    // the recording after the fix landed: reviewed again, reported, no second fix
    record(task.id);
    await waitFor(() => looks().length === 2);
    expect(looks()[1]).toMatchObject({ status: 'ok', fixTaskId: null });
    expect(listTasks(engine.store.db, goal.id).filter((t) => t.origin === 'likeness-fix')).toHaveLength(1);
    // the goal reviewer reads the latest review of each milestone
    expect(latestLikeness(engine, goal.id)).toEqual([{ title: 'add hero with the car', verdict: verdict(true, 6) }]);
    expect(likenessLines(latestLikeness(engine, goal.id), [subject])).toContain('- "add hero with the car": Porsche 911 GT3 (992) 6/10 — (major) the nose is tall');
  });

  test('the final walkthrough, a failed recording and a goal without pictures are not reviewed; minor differences make no fix', async () => {
    const { goal, task } = seed();
    record(task.id, { final: true });
    record(task.id, { status: 'fail' });
    await Bun.sleep(100);
    expect(runner.calls).toHaveLength(0);
    runner.verdicts.push(verdict(false, 8));
    record(task.id);
    await waitFor(() => looks().length === 1);
    expect(looks()[0]!.fixTaskId).toBeNull();
    expect(listTasks(engine.store.db, goal.id).some((t) => t.origin === 'likeness-fix')).toBe(false);
  });

  test('a Brief whose Subjects have no pictures has nothing to compare with', async () => {
    const { task } = seed([{ ...subject, pictures: [] }]);
    record(task.id);
    await Bun.sleep(100);
    expect(runner.calls).toHaveLength(0);
    expect(looks()).toHaveLength(0);
  });

  test('no verdict is recorded as a failed review, and a finished goal gets no fix', async () => {
    const { goal, task } = seed([subject], 'done');
    record(task.id);
    await waitFor(() => looks().length === 1);
    expect(looks()[0]).toMatchObject({ status: 'failed', verdict: null });
    runner.verdicts.push(verdict(true));
    record(task.id);
    await waitFor(() => looks().length === 2);
    expect(looks()[1]).toMatchObject({ status: 'ok', fixTaskId: null });
    expect(listTasks(engine.store.db, goal.id).some((t) => t.origin === 'likeness-fix')).toBe(false);
  });
});
