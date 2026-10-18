import { afterEach, beforeEach, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, truncateSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { IDLE_DELIVERY, getGoal, type Goal, type Task } from '@foundry/core';
import { defaultConfig } from '../config.ts';
import { Engine } from '../engine.ts';
import { FakeRunner } from '../test-helpers.ts';
import { screenshotsDir } from '../workspace.ts';
import { captureMilestone, imageSubject } from './walkthrough.ts';

const ROOT = resolve(import.meta.dir, '../../../..');
let dataDir: string;
let ws: string;
let engine: Engine;
beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'foundry-milestone-files-'));
  ws = mkdtempSync(join(tmpdir(), 'foundry-milestone-ws-'));
  engine = new Engine(defaultConfig(ROOT, { dataDir, claudeHome: join(dataDir, 'claude-home'), log: () => {} }), new FakeRunner(() => {}));
});
afterEach(async () => {
  await engine.stop();
  for (const d of [dataDir, ws]) rmSync(d, { recursive: true, force: true });
});

/** a goal seeded as events, so nothing runs it behind the test's back */
const seed = (id: string): Goal => {
  const now = new Date().toISOString();
  const g = {
    id, title: 'parts', prompt: 'p', workspaceDir: ws, checkpoint: null, selfCheck: false, previewRef: null, previewPlace: 'auto', milestonePause: true, clarifyStage: null, references: [], investigation: null, interview: null, effort: null, modelPreset: null, modelSubstitutions: {}, repoPath: '/nowhere', baseBranch: 'main', branch: `goal/${id}`,
    budgets: { maxCostUsd: 5, maxDurationMin: 120, maxConcurrent: 3, attemptsPerTask: 3 }, budgetPreset: 'custom', mode: 'expert', workflow: { tdd: 'off', pace: 'thorough', ponytail: 'on' },
    models: { strong: 'opus', cheap: 'haiku', worker: 'opus' }, state: 'running', stateBeforeBlock: null, costUsd: 0, fixCycles: 0, delivery: IDLE_DELIVERY, attachments: [], baseSync: null, autoskills: null, follows: null, delegation: { allow: false, autoApprove: false }, delegatedFrom: null,
    completion: { graphRefresh: false, docs: [], audit: false, auditRun: null, docsRun: null, graphRun: null, artifactsRun: null }, nature: 'cad', outputDir: null, runningSince: null, createdAt: now, updatedAt: now,
  } as Goal;
  engine.store.append({ type: 'goal.created', goalId: g.id, payload: { goal: g } });
  return getGoal(engine.store.db, g.id)!;
};
const task = (id: string, milestone: string, extra: Partial<Task> = {}) => ({ id, title: id, milestone, spec: 's', scenario: 'cad', relevantFiles: [], milestoneScript: null, ...extra }) as Task;
const land = (goal: Goal, taskId: string, files: string[]) => engine.store.append({ type: 'task.artifacts_landed', goalId: goal.id, payload: { taskId, files } });
/** a file under artifacts/, with a modification time of `s` seconds after an origin, so newest-first orders are fixed */
const art = (f: string, s = 0, body = 'x') => {
  const p = join(ws, 'artifacts', f);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, body);
  const t = new Date(Date.UTC(2026, 0, 1) + s * 1000);
  utimesSync(p, t, t);
  return p;
};

test("a cad task's milestone shows the snapshots and names the exports its landing recorded, not the goal's other files", async () => {
  const goal = seed('g_files01');
  const bracket = task('t_bracket', 'look at the bracket');
  art('bracket_iso.png', 1, 'iso');
  art('bracket_front.png', 2, 'front');
  for (const f of ['bracket.step', 'bracket.stl', 'bracket_drawing.pdf']) art(f, 2);
  // another task's files, newer, and the Brief's style samples
  art('hinge_iso.png', 9);
  art('hinge.step', 9);
  art('samples/style-1.png', 9);
  land(goal, 't_bracket', ['bracket_iso.png', 'bracket_front.png', 'bracket.step', 'bracket.stl', 'bracket_drawing.pdf']);
  land(goal, 't_hinge', ['hinge_iso.png', 'hinge.step']);
  const ev = (await captureMilestone(engine, goal, bracket))!;
  expect(ev).toMatchObject({ kind: 'files', status: 'pass', error: null, files: ['bracket.step', 'bracket.stl', 'bracket_drawing.pdf'] });
  expect(ev.shots.map((s) => s.caption)).toEqual(['bracket_front.png', 'bracket_iso.png']);
  expect(ev.summary).toBe('');
  // the copies sit in the screenshots folder, where the card and the notification channels read them
  expect(ev.shots.map((s) => readFileSync(join(screenshotsDir(dataDir, goal), s.file), 'utf8'))).toEqual(['front', 'iso']);
  // a task whose landing brought nothing says so, instead of showing the goal's other files
  const empty = (await captureMilestone(engine, goal, task('t_nothing', 'look at the clip')))!;
  land(goal, 't_nothing', []);
  const after = (await captureMilestone(engine, goal, task('t_nothing', 'look at the clip')))!;
  expect(empty.status).toBe('pass'); // no landing recorded yet: the goal from before landings were recorded, no attempt to date it
  expect(after).toMatchObject({ status: 'fail', error: 'the task left no snapshots or exports under artifacts/: there is nothing to look at', shots: [] });
});

test('two files never share a copy, whatever their names, and a rerun over unchanged files copies nothing again', async () => {
  const goal = seed('g_files02');
  const files = { '支架.png': 'bracket', '底座.png': 'base', 'a/b.png': 'a slash b', 'a_b.png': 'a underscore b' };
  for (const [f, body] of Object.entries(files)) art(f, 1, body);
  land(goal, 't_names', Object.keys(files));
  const ev = (await captureMilestone(engine, goal, task('t_names', 'look')))!;
  const dir = screenshotsDir(dataDir, goal);
  expect(new Set(ev.shots.map((s) => s.file)).size).toBe(4);
  for (const s of ev.shots) expect(readFileSync(join(dir, s.file), 'utf8')).toBe(files[s.caption as keyof typeof files]);
  const before = readdirSync(dir).sort();
  const again = (await captureMilestone(engine, goal, task('t_names', 'look')))!;
  expect(again.shots.map((s) => s.file).sort()).toEqual(ev.shots.map((s) => s.file).sort());
  expect(readdirSync(dir).sort()).toEqual(before);
  // a file that changed gets a copy of its own
  art('支架.png', 5, 'bracket v2');
  const changed = (await captureMilestone(engine, goal, task('t_names', 'look')))!;
  expect(readFileSync(join(dir, changed.shots.find((s) => s.caption === '支架.png')!.file), 'utf8')).toBe('bracket v2');
});

test("after the goal folder is gone, the delivered copies of the task's own files show", async () => {
  const goal = seed('g_files03');
  const out = mkdtempSync(join(tmpdir(), 'foundry-milestone-out-'));
  writeFileSync(join(out, 'bracket_iso.png'), 'x');
  writeFileSync(join(out, 'hinge_iso.png'), 'x');
  land(goal, 't_bracket', ['bracket_iso.png']);
  engine.store.append({ type: 'goal.artifacts_delivered', goalId: goal.id, payload: { status: 'ok', files: ['bracket_iso.png', 'hinge_iso.png', 'gone.png'], dest: out, detail: '2 artifact(s) copied' } });
  const ev = (await captureMilestone(engine, getGoal(engine.store.db, goal.id)!, task('t_bracket', 'look at the bracket')))!;
  expect(ev).toMatchObject({ status: 'pass', shots: [{ caption: 'bracket_iso.png' }] });
  rmSync(out, { recursive: true, force: true });
});

test("a goal from before landings were recorded: the files changed since the task's first attempt stand in, and none changed reads as nothing to look at", async () => {
  const goal = seed('g_files04');
  const started = new Date(Date.UTC(2026, 0, 1) + 100_000);
  engine.store.append({
    type: 'attempt.started',
    goalId: goal.id,
    payload: { attempt: { id: 'a_old1', goalId: goal.id, taskId: 't_old', index: 1, kind: 'work', sessionId: null, model: null, state: 'running', costUsd: 0, numTurns: 0, resultSubtype: null, baseRef: null, endRef: null, pid: null, cwd: null, transcriptPath: null, startedAt: started.toISOString(), endedAt: null, skillsUsed: [], continuations: 0, sessions: [] } },
  });
  art('earlier_iso.png', 10);
  expect(await captureMilestone(engine, goal, task('t_old', 'look'))).toMatchObject({ status: 'fail', shots: [] });
  art('part_iso.png', 200);
  expect((await captureMilestone(engine, goal, task('t_old', 'look')))!.shots.map((s) => s.caption)).toEqual(['part_iso.png']);
});

test('the images the milestone and the manifest name come first; a name inside a longer one, or a bare view in a generic folder, does not count', async () => {
  const goal = seed('g_files05');
  mkdirSync(join(ws, 'docs', 'artifacts'), { recursive: true });
  writeFileSync(join(ws, 'docs', 'artifacts', 't_frame.md'), '| `artifacts/snapshots/sub_frame.png` | the sub-frame from the side |');
  const frame = task('t_frame', 'open artifacts/snapshots/frame_assembly.png: the whole frame, base to top', { relevantFiles: ['docs/artifacts/t_frame.md'] });
  const shots = {
    'snapshots/frame_assembly.png': 1, // named by the milestone: first
    'snapshots/frame_assembly/front.png': 1, // its part, by the folder
    'snapshots/frame_iso.png': 2, // "frame" stands alone in the milestone
    'snapshots/sub_frame.png': 3, // named by the manifest
    'snapshots/assembly.png': 4, // "assembly" only inside frame_assembly
    'snapshots/iso.png': 4, // a view in a folder that says nothing
  };
  for (const [f, s] of Object.entries(shots)) art(f, s);
  land(goal, 't_frame', Object.keys(shots));
  const ev = (await captureMilestone(engine, goal, frame))!;
  expect(ev.shots.map((s) => s.caption)).toEqual(['snapshots/frame_assembly.png', 'snapshots/frame_iso.png', 'snapshots/frame_assembly/front.png', 'snapshots/sub_frame.png', 'snapshots/assembly.png', 'snapshots/iso.png']);
});

test('a video task shows its clips, the one its milestone names first, and names a clip too large to copy instead', async () => {
  const goal = seed('g_files06');
  const video = task('t_teaser', 'watch artifacts/teaser.mp4 from start to end', { scenario: 'video' });
  expect(await captureMilestone(engine, goal, video)).toMatchObject({ status: 'fail', error: 'the task left no images or video under artifacts/' });
  art('teaser.mp4', 1);
  art('cut_b.mp4', 5);
  art('poster.jpg', 1);
  truncateSync(art('master.mov', 1), 201 * 1024 * 1024);
  land(goal, 't_teaser', ['teaser.mp4', 'cut_b.mp4', 'poster.jpg', 'master.mov']);
  const ev = (await captureMilestone(engine, goal, video))!;
  expect(ev.clips!.map((c) => c.caption)).toEqual(['teaser.mp4', 'cut_b.mp4']);
  expect(ev.shots.map((s) => s.caption)).toEqual(['poster.jpg']);
  expect(ev.files).toEqual(['master.mov']);
  expect(ev.summary).toBe('1 file(s) too large to copy, listed with the files.');
  expect(existsSync(join(screenshotsDir(dataDir, goal), ev.clips![0]!.file))).toBe(true);
  expect(readdirSync(screenshotsDir(dataDir, goal)).some((f) => f.endsWith('.mov'))).toBe(false);
});

test('a drawing task that left only its PDF reaches its milestone: the drawing is named, with nothing to preview', async () => {
  const goal = seed('g_files07');
  art('bracket_drawing.pdf', 1);
  land(goal, 't_drawing', ['bracket_drawing.pdf']);
  const ev = (await captureMilestone(engine, goal, task('t_drawing', 'read the bracket drawing')))!;
  expect(ev).toMatchObject({ status: 'pass', error: null, shots: [], files: ['bracket_drawing.pdf'] });
  expect(ev.summary).toBe('Nothing to preview.');
});

test('an image is named by its file or its folder without the view, and by nothing when neither says', () => {
  expect(imageSubject('snapshots/frame_assembly.png')).toBe('frame_assembly');
  expect(imageSubject('snapshots/frame_assembly_front.png')).toBe('frame_assembly');
  expect(imageSubject('snapshots/frame_assembly/iso.png')).toBe('frame_assembly');
  expect(imageSubject('snapshots/frame_assembly/base_closeup.png')).toBe('frame_assembly');
  expect(imageSubject('snapshots/upper_section/section_yz.png')).toBe('upper_section');
  expect(imageSubject('snapshots/iso.png')).toBe('');
  expect(imageSubject('front.png')).toBe('');
  expect(imageSubject('_front.png')).toBe('');
});

test('a copy cut short is made again, an image too large to copy is linked instead, and links past twelve are counted', async () => {
  const goal = seed('g_files08');
  art('part_iso.png', 1, 'the whole render');
  truncateSync(art('poster_8k.png', 1), 26 * 1024 * 1024);
  const named = Array.from({ length: 13 }, (_, i) => `part_${String(i).padStart(2, '0')}.step`);
  for (const f of named) art(f, 1);
  land(goal, 't_part', ['part_iso.png', 'poster_8k.png', ...named]);
  const look = task('t_part', 'look at the part');
  const ev = (await captureMilestone(engine, goal, look))!;
  expect(ev.shots.map((s) => s.caption)).toEqual(['part_iso.png']);
  // the deliverables first, then the render too large to copy (past the twelve shown)
  expect(ev.files![0]).toBe('part_00.step');
  expect(ev.files).toHaveLength(12);
  expect(ev.summary).toBe('1 file(s) too large to copy, listed with the files. 2 more file(s) not listed.');
  // a restart cut the copy short: the next look makes it again instead of serving the half
  const copy = join(screenshotsDir(dataDir, goal), ev.shots[0]!.file);
  writeFileSync(copy, 'the whole');
  await captureMilestone(engine, goal, look);
  expect(readFileSync(copy, 'utf8')).toBe('the whole render');
});

test('a task whose landing brought nothing new shows the files its milestone names, saying so', async () => {
  const goal = seed('g_files09');
  art('bracket_iso.png', 1);
  art('hinge_iso.png', 1);
  land(goal, 't_fix', []);
  const ev = (await captureMilestone(engine, goal, task('t_fix', 'open artifacts/bracket_iso.png again')))!;
  expect(ev).toMatchObject({ status: 'pass', shots: [{ caption: 'bracket_iso.png' }] });
  expect(ev.summary).toBe('The task changed none of its files: these are the ones its milestone names.');
});

test('a task whose landing could not copy some files says so, instead of showing older files the milestone names', async () => {
  const goal = seed('g_files10');
  art('bracket_iso.png', 1);
  engine.store.append({ type: 'task.artifacts_landed', goalId: goal.id, payload: { taskId: 't_full', files: [], failed: ['bracket_iso.png'] } });
  const ev = (await captureMilestone(engine, goal, task('t_full', 'open artifacts/bracket_iso.png')))!;
  expect(ev).toMatchObject({ status: 'fail', shots: [], error: "the task's files could not be landed in the goal workspace (bracket_iso.png)" });
});
