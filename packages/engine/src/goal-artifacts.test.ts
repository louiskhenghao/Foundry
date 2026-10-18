import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { IDLE_DELIVERY, getGoal, getTask, type Goal, type Task } from '@foundry/core';
import { deliverArtifacts } from './completion.ts';
import { defaultConfig } from './config.ts';
import { Engine } from './engine.ts';
import { landTaskArtifacts, landedArtifacts, overlayTaskExports, recoverOverlays, retryUnlanded, unlandedFiles } from './goal-artifacts.ts';
import { contentHash, inheritArtifacts, internalWorkspaceDir, overlayBackupPath } from './workspace.ts';
import { FakeRunner, makeRepo, sh } from './test-helpers.ts';

const ROOT = resolve(import.meta.dir, '../../..');
let dataDir: string;
let ws: string;
let engine: Engine;
beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'foundry-goal-artifacts-'));
  ws = mkdtempSync(join(tmpdir(), 'foundry-goal-artifacts-ws-'));
  engine = new Engine(defaultConfig(ROOT, { dataDir, claudeHome: join(dataDir, 'claude-home'), log: () => {} }), new FakeRunner(() => {}));
  // the fixtures drive landings and deliveries by hand: no tick may finish the goal and deliver it in the background
  engine.beginUpdateDrain();
});
/** task worktrees a test made (worktree()) */
const made: string[] = [];
afterEach(async () => {
  await engine.stop();
  for (const d of [dataDir, ws, internalWorkspaceDir({ id: '', workspaceDir: ws })!, ...made.splice(0)]) rmSync(d, { recursive: true, force: true });
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
  expect(landedArtifacts(engine, goal.id, 't_serial')).toEqual({ files: new Set(['bracket.step', 'bracket_iso.png']), failed: [], newer: new Set() });
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
  expect(landedArtifacts(engine, goal.id, 't_ab')).toEqual({ files: new Set(['a.step']), failed: ['b.step'], newer: new Set() });
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
  expect(landedArtifacts(engine, goal.id, 't_ab')).toEqual({ files: new Set(['a.step', 'b.step']), failed: ['gone.step'], newer: new Set() });
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

const worktree = (files: Record<string, string>) => {
  const wt = mkdtempSync(join(tmpdir(), 'foundry-land-task-'));
  made.push(wt);
  for (const [f, body] of Object.entries(files)) {
    mkdirSync(dirname(join(wt, 'artifacts', f)), { recursive: true });
    writeFileSync(join(wt, 'artifacts', f), body);
  }
  return wt;
};
const landings = () => engine.store.listByGoalOfTypes('g_land01', ['task.artifacts_landed']).length;

test('a failure a later task settled is not copied again: the newer export it landed stays and is delivered', async () => {
  const out = mkdtempSync(join(tmpdir(), 'foundry-land-out-'));
  const goal = seed(ws, { outputDir: out });
  const a = created(goal, 't_a', worktree({ 'b.step': 'rev1 from A' }));
  mkdirSync(join(ws, 'artifacts', 'b.step'), { recursive: true }); // stands in for a full disk at A's landing
  expect((await landTaskArtifacts(engine, goal, a)).failed).toEqual(['b.step']);
  rmSync(join(ws, 'artifacts', 'b.step'), { recursive: true });
  const b = created(goal, 't_b', worktree({ 'b.step': 'rev2 from B' }));
  expect((await landTaskArtifacts(engine, goal, b)).files).toEqual(['b.step']);
  // B's worktree goes after its clean landing, as the scheduler does: its export now exists only in the goal workspace
  engine.store.append({ type: 'task.workspace_assigned', goalId: goal.id, payload: { taskId: 't_b', branch: null, worktreePath: null } });
  expect(unlandedFiles(engine, goal, getTask(engine.store.db, 't_a')!)).toEqual([]);
  await deliverArtifacts(engine, getGoal(engine.store.db, goal.id)!);
  expect(readFileSync(join(ws, 'artifacts', 'b.step'), 'utf8')).toBe('rev2 from B');
  expect(readFileSync(join(out, 'b.step'), 'utf8')).toBe('rev2 from B');
  rmSync(out, { recursive: true, force: true });
});

test('a folder a landing could not read is settled once the retry brings its files, and a failure that stays records nothing new', async () => {
  const goal = seed();
  const wt = worktree({ 'renders/front.png': 'png', 'part.step': 'step' });
  const task = created(goal, 't_dir', wt);
  // what copyArtifactFiles records for a folder it could not read, and for a file in the way
  engine.store.append({ type: 'task.artifacts_landed', goalId: goal.id, payload: { taskId: 't_dir', files: [], failed: ['renders/', 'part.step'] } });
  mkdirSync(join(ws, 'artifacts', 'part.step'), { recursive: true });
  expect(unlandedFiles(engine, goal, task).sort()).toEqual(['part.step', 'renders/']);
  await retryUnlanded(engine, getGoal(engine.store.db, goal.id)!);
  expect(readFileSync(join(ws, 'artifacts', 'renders', 'front.png'), 'utf8')).toBe('png');
  expect(unlandedFiles(engine, goal, task)).toEqual(['part.step']);
  // the file still cannot go: retrying again records no landing (each one would wake the goal and its tick retry again)
  const n = landings();
  await retryUnlanded(engine, getGoal(engine.store.db, goal.id)!);
  expect(landings()).toBe(n);
  rmSync(wt, { recursive: true, force: true });
});

test("an overlay that does not land takes away what it added and puts the goal's copies back, but never over a file written since", async () => {
  const goal = seed();
  art('part.step', 1); // the goal's
  art('stand.step', 1);
  const task = created(goal, 't_ov', worktree({ 'part.step': 'rev2', 'stand.step': 'rev2', 'drawing.pdf': 'new' }));
  const overlay = await overlayTaskExports(engine, goal, task);
  expect(readFileSync(join(ws, 'artifacts', 'part.step'), 'utf8')).toBe('rev2');
  expect(readFileSync(join(ws, 'artifacts', 'drawing.pdf'), 'utf8')).toBe('new');
  // a landing of another task writes stand.step while the merge is checked
  writeFileSync(join(ws, 'artifacts', 'stand.step'), 'from another task');
  await overlay.done(false);
  expect(readFileSync(join(ws, 'artifacts', 'part.step'), 'utf8')).toBe('x');
  expect(existsSync(join(ws, 'artifacts', 'drawing.pdf'))).toBe(false);
  expect(readFileSync(join(ws, 'artifacts', 'stand.step'), 'utf8')).toBe('from another task');
  expect(existsSync(overlayBackupPath(dataDir, goal, 't_ov'))).toBe(false);
});

test('an overlay a run left is put back at the next start, a list that cannot be read keeps its backup, and no undo goes through a link', async () => {
  const goal = seed();
  art('part.step', 1);
  const task = created(goal, 't_cut', worktree({ 'part.step': 'rev2', 'parts/new.step': 'new' }));
  await overlayTaskExports(engine, goal, task); // cut short: done() never runs
  const backup = overlayBackupPath(dataDir, goal, 't_cut');
  if (process.getuid?.() !== 0) {
    chmodSync(join(backup, 'list'), 0o000);
    await recoverOverlays(engine, goal);
    chmodSync(join(backup, 'list'), 0o644);
    expect(existsSync(join(backup, 'list'))).toBe(true);
    expect(readFileSync(join(ws, 'artifacts', 'part.step'), 'utf8')).toBe('rev2');
  }
  // the folder the overlay wrote into became a link meanwhile: its entry is refused and the list kept
  const outside = mkdtempSync(join(tmpdir(), 'foundry-overlay-outside-'));
  writeFileSync(join(outside, 'new.step'), 'new');
  rmSync(join(ws, 'artifacts', 'parts'), { recursive: true });
  symlinkSync(outside, join(ws, 'artifacts', 'parts'));
  await recoverOverlays(engine, goal);
  expect(readFileSync(join(outside, 'new.step'), 'utf8')).toBe('new');
  expect(existsSync(join(backup, 'list'))).toBe(true);
  // once the link is gone the rest is undone
  rmSync(join(ws, 'artifacts', 'parts'));
  await recoverOverlays(engine, goal);
  expect(readFileSync(join(ws, 'artifacts', 'part.step'), 'utf8')).toBe('x');
  expect(existsSync(backup)).toBe(false);
  rmSync(outside, { recursive: true, force: true });
});

test("a folder a landing could not read never puts its older copy back over a file another task landed under it later", async () => {
  const goal = seed();
  created(goal, 't_dir', worktree({ 'renders/front.png': 'A old', 'renders/side.png': 'A side' }));
  engine.store.append({ type: 'task.artifacts_landed', goalId: goal.id, payload: { taskId: 't_dir', files: [], failed: ['renders/'] } });
  // the same with artifacts/ itself unreadable
  created(goal, 't_root', worktree({ 'b.step': 'old', 'c.step': 'c' }));
  engine.store.append({ type: 'task.artifacts_landed', goalId: goal.id, payload: { taskId: 't_root', files: [], failed: ['./'] } });
  await landTaskArtifacts(engine, goal, created(goal, 't_b', worktree({ 'renders/front.png': 'B newer', 'b.step': 'new' })));
  await retryUnlanded(engine, getGoal(engine.store.db, goal.id)!);
  expect(readFileSync(join(ws, 'artifacts', 'renders', 'front.png'), 'utf8')).toBe('B newer');
  expect(readFileSync(join(ws, 'artifacts', 'renders', 'side.png'), 'utf8')).toBe('A side');
  expect(readFileSync(join(ws, 'artifacts', 'b.step'), 'utf8')).toBe('new');
  expect(readFileSync(join(ws, 'artifacts', 'c.step'), 'utf8')).toBe('c');
  expect(unlandedFiles(engine, goal, getTask(engine.store.db, 't_dir')!)).toEqual([]);
  expect(unlandedFiles(engine, goal, getTask(engine.store.db, 't_root')!)).toEqual([]);
});

test('a folder whose retry still fails on a file under it records that file once, and no landing after', async () => {
  const goal = seed();
  const task = created(goal, 't_dir2', worktree({ 'renders/front.png': 'png' }));
  engine.store.append({ type: 'task.artifacts_landed', goalId: goal.id, payload: { taskId: 't_dir2', files: [], failed: ['renders/'] } });
  mkdirSync(join(ws, 'artifacts', 'renders', 'front.png'), { recursive: true });
  await retryUnlanded(engine, getGoal(engine.store.db, goal.id)!);
  expect(unlandedFiles(engine, goal, task)).toEqual(['renders/front.png']);
  const n = landings();
  await retryUnlanded(engine, getGoal(engine.store.db, goal.id)!);
  await retryUnlanded(engine, getGoal(engine.store.db, goal.id)!);
  expect(landings()).toBe(n);
});

test('what a retry finds nothing new in is settled: the files there came from the goal and were left as they were', async () => {
  const goal = seed();
  art('renders/a.png', 1);
  art('b.png', 1);
  const wt = mkdtempSync(join(tmpdir(), 'foundry-land-task-'));
  await inheritArtifacts(ws, wt);
  const task = created(goal, 't_inh', wt);
  engine.store.append({ type: 'task.artifacts_landed', goalId: goal.id, payload: { taskId: 't_inh', files: [], failed: ['renders/', 'b.png'] } });
  expect(unlandedFiles(engine, goal, task).sort()).toEqual(['b.png', 'renders/']);
  await retryUnlanded(engine, getGoal(engine.store.db, goal.id)!);
  expect(unlandedFiles(engine, goal, task)).toEqual([]);
  const n = landings();
  await retryUnlanded(engine, getGoal(engine.store.db, goal.id)!);
  expect(landings()).toBe(n);
  rmSync(wt, { recursive: true, force: true });
});

test("a failure after another task's landing of the same file stays outstanding: only a later landing settles it", async () => {
  const goal = seed();
  await landTaskArtifacts(engine, goal, created(goal, 't_b1', worktree({ 'b.step': 'rev1 from B' })));
  const a = created(goal, 't_a1', worktree({ 'b.step': 'rev2 from A' }));
  rmSync(join(ws, 'artifacts', 'b.step'));
  mkdirSync(join(ws, 'artifacts', 'b.step'), { recursive: true });
  expect((await landTaskArtifacts(engine, goal, a)).failed).toEqual(['b.step']);
  expect(unlandedFiles(engine, goal, getTask(engine.store.db, 't_a1')!)).toEqual(['b.step']);
});

test("an undo that cannot read a file keeps the goal's saved copy for the next try", async () => {
  if (process.getuid?.() === 0) return;
  const goal = seed();
  art('part.step', 1);
  const overlay = await overlayTaskExports(engine, goal, created(goal, 't_ro', worktree({ 'part.step': 'rev2' })));
  chmodSync(join(ws, 'artifacts', 'part.step'), 0o000);
  try {
    await expect(overlay.done(false)).rejects.toThrow('could not put back');
  } finally {
    chmodSync(join(ws, 'artifacts', 'part.step'), 0o644);
  }
  expect(existsSync(join(overlayBackupPath(dataDir, goal, 't_ro'), 'files', 'part.step'))).toBe(true);
  await recoverOverlays(engine, goal);
  expect(readFileSync(join(ws, 'artifacts', 'part.step'), 'utf8')).toBe('x');
  expect(existsSync(overlayBackupPath(dataDir, goal, 't_ro'))).toBe(false);
});

test("a list kept after a partial undo holds only what was not put back, and the task's own landing clears it", async () => {
  const goal = seed();
  art('part.step', 1);
  const outside = mkdtempSync(join(tmpdir(), 'foundry-overlay-outside-'));
  const task = created(goal, 't_part', worktree({ 'part.step': 'rev2', 'parts/new.step': 'new' }));
  const overlay = await overlayTaskExports(engine, goal, task);
  // parts/ became a link: that entry cannot be undone, the rest is
  rmSync(join(ws, 'artifacts', 'parts'), { recursive: true });
  symlinkSync(outside, join(ws, 'artifacts', 'parts'));
  await expect(overlay.done(false)).rejects.toThrow('could not put back');
  expect(readFileSync(join(ws, 'artifacts', 'part.step'), 'utf8')).toBe('x');
  const backup = overlayBackupPath(dataDir, goal, 't_part');
  expect(readFileSync(join(backup, 'list'), 'utf8').trim().split('\n').map((l) => JSON.parse(l).f)).toEqual(['parts/new.step']);
  rmSync(join(ws, 'artifacts', 'parts'));
  // the task lands for real later (a resolution by hand): the very bytes the overlay wrote
  await landTaskArtifacts(engine, goal, task);
  expect(existsSync(backup)).toBe(false);
  // a recovery afterwards never takes the landing back
  await recoverOverlays(engine, goal);
  expect(readFileSync(join(ws, 'artifacts', 'part.step'), 'utf8')).toBe('rev2');
  expect(readFileSync(join(ws, 'artifacts', 'parts', 'new.step'), 'utf8')).toBe('new');
  rmSync(outside, { recursive: true, force: true });
});

test('an overlay list line cut short, or an entry that leaves artifacts/, is skipped and the rest is undone', async () => {
  const goal = seed();
  mkdirSync(join(ws, 'artifacts'), { recursive: true });
  writeFileSync(join(ws, 'artifacts', 'added.step'), 'task');
  const victim = join(dirname(ws), `foundry-victim-${process.pid}.txt`);
  writeFileSync(victim, 'task');
  const backup = overlayBackupPath(dataDir, goal, 't_bad');
  mkdirSync(backup, { recursive: true });
  const hash = await contentHash(victim);
  const lines = [{ f: 'added.step', saved: false, hash }, { f: `../../${basename(victim)}`, saved: false, hash }, { f: victim, saved: false, hash }].map((e) => JSON.stringify(e));
  writeFileSync(join(backup, 'list'), `${lines.join('\n')}\n{"f":"part.st`);
  await recoverOverlays(engine, goal);
  expect(existsSync(join(ws, 'artifacts', 'added.step'))).toBe(false);
  expect(readFileSync(victim, 'utf8')).toBe('task');
  expect(existsSync(backup)).toBe(false);
  rmSync(victim, { force: true });
});

test('an overlay a run left is put back when the engine starts again', async () => {
  const goal = seed();
  art('part.step', 1);
  await overlayTaskExports(engine, goal, created(goal, 't_cut2', worktree({ 'part.step': 'rev2', 'drawing.pdf': 'new' })));
  await engine.stop();
  engine = new Engine(defaultConfig(ROOT, { dataDir, claudeHome: join(dataDir, 'claude-home'), log: () => {} }), new FakeRunner(() => {}));
  engine.beginUpdateDrain();
  await engine.start();
  expect(readFileSync(join(ws, 'artifacts', 'part.step'), 'utf8')).toBe('x');
  expect(existsSync(join(ws, 'artifacts', 'drawing.pdf'))).toBe(false);
  expect(existsSync(overlayBackupPath(dataDir, goal, 't_cut2'))).toBe(false);
});

test('an overlay folder that became a link is never undone through, and no overlay is laid through it', async () => {
  const goal = seed();
  const victim = mkdtempSync(join(tmpdir(), 'foundry-overlay-victim-'));
  for (const d of ['projA', 't_lnk']) {
    mkdirSync(join(victim, d), { recursive: true });
    writeFileSync(join(victim, d, 'keep.txt'), 'keep');
  }
  const root = dirname(overlayBackupPath(dataDir, goal, 'x'));
  mkdirSync(dirname(root), { recursive: true });
  symlinkSync(victim, root);
  await recoverOverlays(engine, goal);
  await expect(overlayTaskExports(engine, goal, created(goal, 't_lnk', worktree({ 'a.step': 'a' })))).rejects.toThrow('symbolic link');
  expect(readFileSync(join(victim, 'projA', 'keep.txt'), 'utf8')).toBe('keep');
  expect(readFileSync(join(victim, 't_lnk', 'keep.txt'), 'utf8')).toBe('keep');
  rmSync(root);
  rmSync(victim, { recursive: true, force: true });
});

test("a subfolder a retry still cannot read keeps the folder's first failure: what another task landed under it stays", async () => {
  if (process.getuid?.() === 0) return;
  const goal = seed();
  const a = created(goal, 't_a', worktree({ 'renders/sub/x.png': 'A old', 'renders/side.png': 'A side' }));
  engine.store.append({ type: 'task.artifacts_landed', goalId: goal.id, payload: { taskId: 't_a', files: [], failed: ['renders/'] } });
  await landTaskArtifacts(engine, goal, created(goal, 't_b', worktree({ 'renders/sub/x.png': 'B newer' })));
  const sub = join(a.worktreePath!, 'artifacts', 'renders', 'sub');
  chmodSync(sub, 0o000);
  try {
    await retryUnlanded(engine, getGoal(engine.store.db, goal.id)!);
  } finally {
    chmodSync(sub, 0o755);
  }
  await retryUnlanded(engine, getGoal(engine.store.db, goal.id)!);
  expect(readFileSync(join(ws, 'artifacts', 'renders', 'sub', 'x.png'), 'utf8')).toBe('B newer');
  expect(readFileSync(join(ws, 'artifacts', 'renders', 'side.png'), 'utf8')).toBe('A side');
});

test("a folder that failed after another task's landing under it still brings the task's later copy", async () => {
  const goal = seed();
  await landTaskArtifacts(engine, goal, created(goal, 't_b', worktree({ 'renders/front.png': 'B older' })));
  created(goal, 't_a', worktree({ 'renders/front.png': 'A later' }));
  engine.store.append({ type: 'task.artifacts_landed', goalId: goal.id, payload: { taskId: 't_a', files: [], failed: ['renders/'] } });
  await retryUnlanded(engine, getGoal(engine.store.db, goal.id)!);
  expect(readFileSync(join(ws, 'artifacts', 'renders', 'front.png'), 'utf8')).toBe('A later');
  expect(unlandedFiles(engine, goal, getTask(engine.store.db, 't_a')!)).toEqual([]);
});

test("one task's retry settling a folder settles no other task's failure on it", async () => {
  if (process.getuid?.() === 0) return;
  const goal = seed();
  art('renders/a.png', 1);
  const wtX = mkdtempSync(join(tmpdir(), 'foundry-land-task-'));
  made.push(wtX);
  await inheritArtifacts(ws, wtX);
  created(goal, 't_x', wtX);
  const y = created(goal, 't_y', worktree({ 'renders/b.png': 'Y' }));
  for (const taskId of ['t_x', 't_y']) engine.store.append({ type: 'task.artifacts_landed', goalId: goal.id, payload: { taskId, files: [], failed: ['renders/'] } });
  const renders = join(y.worktreePath!, 'artifacts', 'renders');
  chmodSync(renders, 0o000);
  try {
    await retryUnlanded(engine, getGoal(engine.store.db, goal.id)!);
    expect(unlandedFiles(engine, goal, getTask(engine.store.db, 't_x')!)).toEqual([]);
    expect(unlandedFiles(engine, goal, getTask(engine.store.db, 't_y')!)).toEqual(['renders/']);
  } finally {
    chmodSync(renders, 0o755);
  }
});

/** an overlay of `task` whose undo could not put `f` back: the goal workspace still holds the task's copy of it */
const stuckOverlay = async (goal: Goal, task: Task, f: string) => {
  const overlay = await overlayTaskExports(engine, goal, task);
  chmodSync(join(ws, 'artifacts', f), 0o000);
  try {
    await expect(overlay.done(false)).rejects.toThrow('could not put back');
  } finally {
    chmodSync(join(ws, 'artifacts', f), 0o644);
  }
};

test("a resolution that kept the goal's side gets back the goal's export an unfinished undo left covered", async () => {
  if (process.getuid?.() === 0) return;
  const goal = seed();
  art('part.step', 1);
  const task = created(goal, 't_keep', worktree({ 'part.step': 'rev2' }));
  await stuckOverlay(goal, task, 'part.step');
  expect(readFileSync(join(ws, 'artifacts', 'part.step'), 'utf8')).toBe('rev2');
  await landTaskArtifacts(engine, goal, task, { keepExisting: true });
  expect(readFileSync(join(ws, 'artifacts', 'part.step'), 'utf8')).toBe('x');
  expect(existsSync(overlayBackupPath(dataDir, goal, 't_keep'))).toBe(false);
});

test("an export an unfinished undo left that the goal lacks is landed and recorded as the task's", async () => {
  if (process.getuid?.() === 0) return;
  const goal = seed();
  mkdirSync(join(ws, 'artifacts'), { recursive: true });
  const task = created(goal, 't_add', worktree({ 'drawing.pdf': 'new' }));
  await stuckOverlay(goal, task, 'drawing.pdf');
  await landTaskArtifacts(engine, goal, task, { keepExisting: true });
  expect(landedArtifacts(engine, goal.id, 't_add')!.files.has('drawing.pdf')).toBe(true);
  expect(readFileSync(join(ws, 'artifacts', 'drawing.pdf'), 'utf8')).toBe('new');
});

test("an export the task lands is never taken back by a list an unfinished undo left for it", async () => {
  if (process.getuid?.() === 0) return;
  const goal = seed();
  art('part.step', 1);
  const task = created(goal, 't_land', worktree({ 'part.step': 'rev2' }));
  await stuckOverlay(goal, task, 'part.step');
  // the undo before the landing cannot put it back either (the goal's saved copy is gone): the landing still writes it
  rmSync(join(overlayBackupPath(dataDir, goal, 't_land'), 'files', 'part.step'));
  await landTaskArtifacts(engine, goal, task);
  await recoverOverlays(engine, goal);
  expect(readFileSync(join(ws, 'artifacts', 'part.step'), 'utf8')).toBe('rev2');
  expect(existsSync(overlayBackupPath(dataDir, goal, 't_land'))).toBe(false);
});

test('an undo that keeps an entry never writes its list through a link planted beside it', async () => {
  const goal = seed();
  art('part.step', 1);
  const task = created(goal, 't_part2', worktree({ 'part.step': 'rev2' }));
  await overlayTaskExports(engine, goal, task); // cut short: done() never runs
  const backup = overlayBackupPath(dataDir, goal, 't_part2');
  rmSync(join(backup, 'files', 'part.step')); // its put-back fails: the entry stays
  const victim = join(mkdtempSync(join(tmpdir(), 'foundry-overlay-victim-')), 'victim.txt');
  made.push(dirname(victim));
  writeFileSync(victim, 'untouched');
  symlinkSync(victim, join(backup, 'list.part'));
  await recoverOverlays(engine, goal);
  expect(readFileSync(victim, 'utf8')).toBe('untouched');
  expect(readFileSync(join(backup, 'list'), 'utf8')).toContain('part.step');
});

test("a task's overlay folder that is a link is refused: nothing behind it is read or undone", async () => {
  const goal = seed();
  art('part.step', 1);
  const victim = mkdtempSync(join(tmpdir(), 'foundry-overlay-victim-'));
  made.push(victim);
  // a list behind the link that names the goal's own export, as the overlay wrote it
  writeFileSync(join(victim, 'list'), `${JSON.stringify({ f: 'part.step', saved: false, hash: await contentHash(join(ws, 'artifacts', 'part.step')) })}\n`);
  const backup = overlayBackupPath(dataDir, goal, 't_lnk2');
  mkdirSync(dirname(backup), { recursive: true });
  symlinkSync(victim, backup);
  await expect(overlayTaskExports(engine, goal, created(goal, 't_lnk2', worktree({ 'part.step': 'rev2' })))).rejects.toThrow('not a folder');
  expect(readFileSync(join(ws, 'artifacts', 'part.step'), 'utf8')).toBe('x');
  expect(existsSync(join(victim, 'list'))).toBe(true);
  rmSync(backup);
});

test('an undo leaves alone a link or a pipe where the overlay wrote', async () => {
  const { lstatSync } = await import('node:fs');
  const { execSync } = await import('node:child_process');
  const goal = seed();
  const outside = mkdtempSync(join(tmpdir(), 'foundry-overlay-outside-'));
  made.push(outside);
  const overlay = await overlayTaskExports(engine, goal, created(goal, 't_kind', worktree({ 'drawing.pdf': 'new', 'pipe.bin': 'p' })));
  writeFileSync(join(outside, 'drawing.pdf'), 'new');
  rmSync(join(ws, 'artifacts', 'drawing.pdf'));
  symlinkSync(join(outside, 'drawing.pdf'), join(ws, 'artifacts', 'drawing.pdf'));
  rmSync(join(ws, 'artifacts', 'pipe.bin'));
  execSync(`mkfifo "${join(ws, 'artifacts', 'pipe.bin')}"`);
  await overlay.done(false);
  expect(lstatSync(join(ws, 'artifacts', 'drawing.pdf')).isSymbolicLink()).toBe(true);
  expect(lstatSync(join(ws, 'artifacts', 'pipe.bin')).isFIFO()).toBe(true);
}, 5_000);

test('a stray file in the folder of overlay backups is no overlay to undo', async () => {
  const goal = seed();
  const root = dirname(overlayBackupPath(dataDir, goal, 'x'));
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, '.DS_Store'), 'finder');
  await recoverOverlays(engine, goal);
  expect(engine.store.listByGoal(goal.id, 5000).filter((e) => e.type === 'engine.note')).toEqual([]);
});

test('a delivery records when its copy began', async () => {
  const out = mkdtempSync(join(tmpdir(), 'foundry-land-out-'));
  made.push(out);
  const goal = seed(ws, { outputDir: out });
  art('part.step', 1);
  const before = Date.now();
  await deliverArtifacts(engine, goal);
  const run = getGoal(engine.store.db, goal.id)!.completion.artifactsRun!;
  expect(run.status).toBe('ok');
  expect(Date.parse(run.startedAt!)).toBeGreaterThanOrEqual(before - 1);
  expect(Date.parse(run.startedAt!)).toBeLessThanOrEqual(Date.parse(run.at));
});

test("a copy of the goal's exports that fails without the lock is made again under it", async () => {
  const { snapshotGoalExports } = await import('./goal-artifacts.ts');
  const workspace = await import('./workspace.ts');
  const goal = seed();
  art('part.step', 1);
  const dest = mkdtempSync(join(tmpdir(), 'foundry-snap-'));
  made.push(dest);
  const copyArtifactFiles = workspace.copyArtifactFiles;
  let calls = 0;
  // a landing renames part.step away just as the copy reads it, the first time
  const spy = spyOn(workspace, 'copyArtifactFiles').mockImplementation(async (from, to, opts) => {
    if (++calls === 1) {
      opts?.onError?.('part.step', new Error('ENOENT'));
      return [];
    }
    return copyArtifactFiles(from, to, opts);
  });
  try {
    await snapshotGoalExports(engine, goal, dest);
  } finally {
    spy.mockRestore();
  }
  expect(calls).toBe(2);
  expect(readFileSync(join(dest, 'artifacts', 'part.step'), 'utf8')).toBe('x');
});

test('a goal that keeps artifacts records its delivery even with nothing to deliver: no tick delivers it again', async () => {
  // a goal of nature auto that keeps artifacts only because of its cad task, which made nothing
  const goal = seed(ws, { nature: 'auto' });
  created(goal, 't_part', worktree({}));
  await deliverArtifacts(engine, getGoal(engine.store.db, goal.id)!);
  expect(getGoal(engine.store.db, goal.id)!.completion.artifactsRun).toMatchObject({ status: 'skipped', files: [] });
});

test('a folder that fails again keeps the landing that first failed it: a file another task landed in between stays', async () => {
  if (process.getuid?.() === 0) return;
  const goal = seed();
  const a = created(goal, 't_a', worktree({ 'renders/front.png': 'A old', 'x.step': 'x' }));
  engine.store.append({ type: 'task.artifacts_landed', goalId: goal.id, payload: { taskId: 't_a', files: [], failed: ['renders/', 'x.step'] } });
  await landTaskArtifacts(engine, goal, created(goal, 't_b', worktree({ 'renders/front.png': 'B newer' })));
  // the retry brings x.step while renders/ still cannot be read: it records the folder's failure again beside that
  const renders = join(a.worktreePath!, 'artifacts', 'renders');
  chmodSync(renders, 0o000);
  try {
    await retryUnlanded(engine, getGoal(engine.store.db, goal.id)!);
  } finally {
    chmodSync(renders, 0o755);
  }
  await retryUnlanded(engine, getGoal(engine.store.db, goal.id)!);
  expect(readFileSync(join(ws, 'artifacts', 'renders', 'front.png'), 'utf8')).toBe('B newer');
  expect(readFileSync(join(ws, 'artifacts', 'x.step'), 'utf8')).toBe('x');
});
