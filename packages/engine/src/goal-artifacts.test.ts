import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { IDLE_DELIVERY, getGoal, getTask, type Goal, type Task } from '@foundry/core';
import { deliverArtifacts } from './completion.ts';
import { defaultConfig } from './config.ts';
import { Engine } from './engine.ts';
import { landTaskArtifacts, landedArtifacts, unlandedFiles } from './goal-artifacts.ts';
import { FakeRunner, makeRepo, sh } from './test-helpers.ts';

const ROOT = resolve(import.meta.dir, '../../..');
let dataDir: string;
let ws: string;
let engine: Engine;
beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'foundry-goal-artifacts-'));
  ws = mkdtempSync(join(tmpdir(), 'foundry-goal-artifacts-ws-'));
  engine = new Engine(defaultConfig(ROOT, { dataDir, claudeHome: join(dataDir, 'claude-home'), log: () => {} }), new FakeRunner(() => {}));
});
afterEach(async () => {
  await engine.stop();
  for (const d of [dataDir, ws]) rmSync(d, { recursive: true, force: true });
});

const seed = (workspaceDir = ws, extra: Partial<Goal> = {}): Goal => {
  const now = new Date().toISOString();
  const g = {
    id: 'g_land01', title: 'parts', prompt: 'p', workspaceDir, checkpoint: null, selfCheck: false, previewRef: null, previewPlace: 'auto', milestonePause: true, clarifyStage: null, references: [], investigation: null, interview: null, effort: null, modelPreset: null, modelSubstitutions: {}, repoPath: '/nowhere', baseBranch: 'main', branch: 'goal/g_land01',
    budgets: { maxCostUsd: 5, maxDurationMin: 120, maxConcurrent: 3, attemptsPerTask: 3 }, budgetPreset: 'custom', mode: 'expert', workflow: { tdd: 'off', pace: 'thorough', ponytail: 'on' },
    models: { strong: 'opus', cheap: 'haiku', worker: 'opus' }, state: 'running', stateBeforeBlock: null, costUsd: 0, fixCycles: 0, delivery: IDLE_DELIVERY, attachments: [], baseSync: null, autoskills: null, follows: null,
    completion: { graphRefresh: false, docs: [], audit: false, auditRun: null, docsRun: null, graphRun: null, artifactsRun: null }, nature: 'cad', outputDir: null, runningSince: null, createdAt: now, updatedAt: now,
    ...extra,
  } as Goal;
  engine.store.append({ type: 'goal.created', goalId: g.id, payload: { goal: g } });
  return getGoal(engine.store.db, g.id)!;
};
/** a done cad task of the goal whose worktree is `worktreePath` */
const created = (goal: Goal, id: string, worktreePath: string): Task => {
  const now = new Date().toISOString();
  const t = { id, goalId: goal.id, title: id, spec: 's', kind: 'feature', scope: null, scenario: 'cad', area: null, tdd: 'inherit', dependsOn: [], relevantFiles: [], parallelizable: false, retryBudget: 3, origin: 'brief', milestone: null, milestoneVisits: 0, checkpointOf: null, difficulty: 'standard', state: 'done', branch: null, worktreePath: null, baseRef: null, commitRef: null, commitMessage: null, hint: null, extraAttempts: 0, createdAt: now, updatedAt: now } as Task;
  engine.store.append({ type: 'task.created', goalId: goal.id, payload: { task: t } });
  engine.store.append({ type: 'task.workspace_assigned', goalId: goal.id, payload: { taskId: id, branch: null, worktreePath } });
  return getTask(engine.store.db, id)!;
};
const art = (f: string, s: number) => {
  const p = join(ws, 'artifacts', f);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, 'x');
  const t = new Date(Date.UTC(2026, 0, 1) + s * 1000);
  utimesSync(p, t, t);
};

test('a task that worked in the goal workspace records the files it changed there, not the ones another task landed meanwhile', async () => {
  const goal = seed();
  engine.store.append({
    type: 'attempt.started',
    goalId: goal.id,
    payload: { attempt: { id: 'a_serial1', goalId: goal.id, taskId: 't_serial', index: 1, kind: 'work', sessionId: null, model: null, state: 'running', costUsd: 0, numTurns: 0, resultSubtype: null, baseRef: null, endRef: null, pid: null, cwd: null, transcriptPath: null, startedAt: new Date(Date.UTC(2026, 0, 1) + 100_000).toISOString(), endedAt: null, skillsUsed: [], continuations: 0, sessions: [] } },
  });
  art('earlier.step', 10);
  art('bracket.step', 200);
  art('bracket_iso.png', 200);
  art('hinge.step', 300);
  art('samples/style-1.png', 300);
  // a parallel task landed its hinge while this one ran
  engine.store.append({ type: 'task.artifacts_landed', goalId: goal.id, payload: { taskId: 't_hinge', files: ['hinge.step'] } });
  const task = { id: 't_serial', title: 'model the bracket', scenario: 'cad', worktreePath: null } as Task;
  expect(await landTaskArtifacts(engine, goal, task)).toEqual({ files: ['bracket.step', 'bracket_iso.png'], failed: [] });
  expect(landedArtifacts(engine, goal.id, 't_serial')).toEqual({ files: new Set(['bracket.step', 'bracket_iso.png']), failed: [] });
  // a code task in the goal workspace records nothing
  expect(await landTaskArtifacts(engine, goal, { id: 't_code', title: 'wire it', scenario: 'backend', worktreePath: null } as Task)).toEqual({ files: [], failed: [] });
  expect(landedArtifacts(engine, goal.id, 't_code')).toBeNull();
});

test("a landing leaves alone what git tracks: a merged version of a tracked file is not replaced by the task's", async () => {
  const repo = await makeRepo();
  mkdirSync(join(repo, 'artifacts'), { recursive: true });
  writeFileSync(join(repo, 'artifacts', 'parts.md'), 'v1');
  await sh('git add artifacts/parts.md && git commit -qm parts', repo);
  const taskWs = join(mkdtempSync(join(tmpdir(), 'foundry-land-task-')), 'wt');
  await sh(`git worktree add -q --detach "${taskWs}" HEAD`, repo);
  writeFileSync(join(taskWs, 'artifacts', 'parts.md'), 'the task side');
  writeFileSync(join(taskWs, 'artifacts', 'part.step'), 'step');
  // the goal workspace holds the version a resolution settled on
  writeFileSync(join(repo, 'artifacts', 'parts.md'), 'resolved by hand');
  const landing = await landTaskArtifacts(engine, seed(repo), { id: 't_part', title: 'part', scenario: 'cad', worktreePath: taskWs } as Task);
  expect(landing).toEqual({ files: ['part.step'], failed: [] });
  expect(readFileSync(join(repo, 'artifacts', 'parts.md'), 'utf8')).toBe('resolved by hand');
});

test('a file that cannot be copied is reported, and the others still land', async () => {
  const goal = seed();
  const taskWs = mkdtempSync(join(tmpdir(), 'foundry-land-task-'));
  mkdirSync(join(taskWs, 'artifacts'), { recursive: true });
  writeFileSync(join(taskWs, 'artifacts', 'a.step'), 'a');
  writeFileSync(join(taskWs, 'artifacts', 'b.step'), 'b');
  // a folder where b.step would go: that copy fails
  mkdirSync(join(ws, 'artifacts', 'b.step'), { recursive: true });
  const landing = await landTaskArtifacts(engine, goal, { id: 't_ab', title: 'ab', scenario: 'cad', worktreePath: taskWs } as Task);
  expect(landing).toEqual({ files: ['a.step'], failed: ['b.step'] });
  // the landing records what it could not copy, so the milestone can say so
  expect(landedArtifacts(engine, goal.id, 't_ab')).toEqual({ files: new Set(['a.step']), failed: ['b.step'] });
});

test('what a landing could not copy goes again before the delivery, and the landing that brings it clears the failure', async () => {
  const out = mkdtempSync(join(tmpdir(), 'foundry-land-out-'));
  const goal = seed(ws, { outputDir: out });
  const taskWs = mkdtempSync(join(tmpdir(), 'foundry-land-task-'));
  mkdirSync(join(taskWs, 'artifacts'), { recursive: true });
  writeFileSync(join(taskWs, 'artifacts', 'a.step'), 'a');
  writeFileSync(join(taskWs, 'artifacts', 'b.step'), 'b');
  mkdirSync(join(ws, 'artifacts', 'b.step'), { recursive: true });
  const task = created(goal, 't_ab', taskWs);
  expect(await landTaskArtifacts(engine, goal, task)).toEqual({ files: ['a.step'], failed: ['b.step'] });
  expect(unlandedFiles(engine, goal, task)).toEqual(['b.step']);
  // a failure whose file the worktree no longer holds keeps nothing there
  engine.store.append({ type: 'task.artifacts_landed', goalId: goal.id, payload: { taskId: 't_ab', files: [], failed: ['gone.step'] } });
  expect(unlandedFiles(engine, goal, task)).toEqual(['b.step']);
  // what stood in the way is gone when the goal finishes: the delivery copies b.step again first, and delivers it
  rmSync(join(ws, 'artifacts', 'b.step'), { recursive: true });
  await deliverArtifacts(engine, getGoal(engine.store.db, goal.id)!);
  expect(readFileSync(join(out, 'b.step'), 'utf8')).toBe('b');
  expect(landedArtifacts(engine, goal.id, 't_ab')).toEqual({ files: new Set(['a.step', 'b.step']), failed: ['gone.step'] });
  expect(unlandedFiles(engine, goal, task)).toEqual([]);
  for (const d of [out, taskWs]) rmSync(d, { recursive: true, force: true });
});

test("a cad goal's delivery records the model the CAD Viewer opens, chosen by the exports' own times", async () => {
  const out = mkdtempSync(join(tmpdir(), 'foundry-land-out-'));
  const goal = seed(ws, { outputDir: out });
  art('parts/hinge.step', 300);
  art('frame_assembly.step', 100);
  art('samples/reference.step', 400);
  await deliverArtifacts(engine, goal);
  expect(getGoal(engine.store.db, goal.id)!.completion.artifactsRun).toMatchObject({ status: 'ok', model: 'frame_assembly.step' });
  rmSync(out, { recursive: true, force: true });
});
