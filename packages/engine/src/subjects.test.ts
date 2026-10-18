import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { BriefOutput, BriefSubject, Goal } from '@foundry/core';
import { getBrief, getGoal, listTasks } from '@foundry/core';
import type { ClaudeRunner, RunHandle, RunResult, RunSpec, RunnerEvent } from '@foundry/runner';
import { defaultConfig } from './config.ts';
import { Engine } from './engine.ts';
import { SubjectError, addSubject, addSubjectPicture, imageType, inheritSubjects, removeSubjectPicture, renderSubjects, startSubjectSearch, subjectsDir, subjectsFromClarifier } from './subjects.ts';
import { makeRepo, waitFor } from './test-helpers.ts';

const ROOT = resolve(import.meta.dir, '../../..');
let dataDir: string;
let repo: string;
beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'foundry-subjects-'));
  repo = await makeRepo();
});
const engines: Engine[] = [];
const track = <T extends Engine>(e: T): T => (engines.push(e), e);
afterEach(async () => {
  for (const e of engines.splice(0)) await e.stop().catch(() => {});
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(repo, { recursive: true, force: true });
  rmSync(`${repo}-foundry`, { recursive: true, force: true });
});

/** bytes that start like a JPEG and are large enough to be a picture */
const jpeg = (fill = 1) => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(8 * 1024).fill(fill)]);
const png = () => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(8 * 1024).fill(2)]);

/** answers each session by its label: the Clarifier with `brief`, a picture search by downloading what `search` says */
class Runner implements ClaudeRunner {
  calls: RunSpec[] = [];
  /** a search waits on this before it answers (to see the Brief wait for it) */
  gate: Promise<void> = Promise.resolve();
  constructor(
    private brief: () => BriefOutput,
    private search: (folder: string) => unknown = (folder) => {
      writeFileSync(join(folder, '1.jpg'), jpeg());
      writeFileSync(join(folder, '2.png'), '<html>403 Forbidden</html>');
      return { pictures: [{ file: '1.jpg', url: 'https://example.com/press/front', caption: 'front three-quarter' }, { file: '2.png', url: 'https://example.com/side', caption: 'side' }], note: 'two found' };
    },
  ) {}
  active() {
    return 0;
  }
  async run(spec: RunSpec): Promise<RunHandle> {
    this.calls.push(spec);
    let structuredOutput: unknown = null;
    if (spec.label?.startsWith('classify nature')) structuredOutput = { nature: 'code' };
    else if (spec.label?.startsWith('subject pictures')) {
      await this.gate;
      structuredOutput = this.search(spec.addDirs![0]!);
    } else structuredOutput = this.brief();
    const result: RunResult = { sessionId: `s${this.calls.length}`, subtype: 'success', isError: false, costUsd: 0.4, numTurns: 3, durationMs: 1, usage: null, modelUsage: null, permissionDenials: [], finalText: JSON.stringify(structuredOutput), structuredOutput, exitCode: 0, pid: null, rateLimit: null, errorMessage: null, failureClass: null, skillsUsed: [], toolsUsed: {} };
    const events: RunnerEvent[] = [{ kind: 'init', sessionId: result.sessionId!, model: 'fake', tools: [], raw: {} }, { kind: 'result', result }];
    return { pid: null, events: (async function* () { for (const e of events) yield e; })(), kill() {}, result: Promise.resolve(result) };
  }
}

const area = { key: 'A1', name: 'Site', slug: 'site', description: 'the site' };
const briefOut = (subjects: BriefOutput['subjects'] = [{ key: 'P1', name: 'Porsche 911 GT3 (992)', lookFor: 'the low nose and the fixed rear wing', pictures: [] }]): BriefOutput => ({
  title: 'feat(site): add the showcase',
  understanding: 'A showcase of one car.',
  nature: 'code',
  areas: [area],
  assumptions: [],
  tasks: [
    { key: 'T1', title: 'build the car model', spec: 'make the car', kind: 'feature', scope: null, scenario: 'general', difficulty: 'standard', areaKey: 'A1', dependsOnKeys: [], parallelizable: false, relevantFiles: [], milestone: null },
    { key: 'T2', title: 'add the specs api', spec: 'serve the specs', kind: 'feature', scope: null, scenario: 'backend', difficulty: 'standard', areaKey: 'A1', dependsOnKeys: [], parallelizable: false, relevantFiles: [], milestone: null },
  ],
  checks: [{ key: 'C1', name: 'ok', tier: 'must', taskKey: 'T1', areaKey: null, type: 'command', cmd: 'true', rubric: null }],
  costEstimateUsd: 2,
  timeEstimateMin: 20,
  openQuestions: [],
  styleOptions: [],
  run: null,
  apps: null,
  subjects,
});
const cfg = () => defaultConfig(ROOT, { dataDir, claudeHome: join(dataDir, 'claude-home'), alwaysReviewTasks: false, log: () => {} });
const subjectsOf = (engine: Engine, goalId: string): BriefSubject[] => getBrief(engine.store.db, goalId)?.brief.subjects ?? [];

describe('Subjects on the Brief', () => {
  test('the Clarifier names a Subject; Foundry searches its pictures once, keeps only real pictures, and approval waits for them', async () => {
    const runner = new Runner(() => briefOut());
    let release!: () => void;
    runner.gate = new Promise((r) => (release = r));
    const engine = track(new Engine(cfg(), runner));
    const goal = await engine.createGoal({ prompt: 'a showcase site for one sports car', repoPath: repo });
    await waitFor(() => getGoal(engine.store.db, goal.id)!.state === 'awaiting_brief_approval');
    // the Clarifier was asked for Subjects
    expect(runner.calls.find((c) => c.label?.startsWith('clarify'))!.prompt).toContain('# Subjects: real things the result must look like');
    await waitFor(() => runner.calls.some((c) => c.label?.startsWith('subject pictures')));
    const search = runner.calls.find((c) => c.label?.startsWith('subject pictures'))!;
    expect(search.prompt).toContain('Subject: Porsche 911 GT3 (992)');
    expect(search.prompt).toContain(search.addDirs![0]!);
    // the Brief waits for the pictures
    await expect(engine.approveBrief(goal.id)).rejects.toThrow(/being found now/);
    release();
    await waitFor(() => subjectsOf(engine, goal.id)[0]?.search !== null);
    const [s] = subjectsOf(engine, goal.id);
    expect(s!.pictures).toEqual([{ file: 'P1-1.jpg', source: 'web', url: 'https://example.com/press/front', caption: 'front three-quarter' }]);
    expect(s!.search).toMatchObject({ status: 'ok' });
    expect(s!.search!.detail).toContain('2.png: not a picture');
    expect(existsSync(join(subjectsDir(dataDir, goal.id), 'P1-1.jpg'))).toBe(true);
    // the download folder is gone, and the search is not run again by itself
    expect(existsSync(join(subjectsDir(dataDir, goal.id), '.incoming', 'P1'))).toBe(false);
    engine.tick(goal.id);
    await Bun.sleep(100);
    expect(runner.calls.filter((c) => c.label?.startsWith('subject pictures'))).toHaveLength(1);
    // a page's stale copy of the Brief never drops them
    engine.editBrief(goal.id, { ...getBrief(engine.store.db, goal.id)!.brief, subjects: [] });
    expect(subjectsOf(engine, goal.id)[0]!.pictures).toHaveLength(1);
    await engine.approveBrief(goal.id, { ...getBrief(engine.store.db, goal.id)!.brief, subjects: [] });
    expect(getBrief(engine.store.db, goal.id)!.approved).toBe(true);
    expect(subjectsOf(engine, goal.id)[0]!.pictures).toHaveLength(1);
    engine.cancelGoal(goal.id);
  }, 20_000);

  test("the person's Subjects and pictures: added, refused when not a picture, removed; a failed search is not repeated by itself", async () => {
    const runner = new Runner(() => briefOut([]), () => {
      throw new Error('no network');
    });
    const engine = track(new Engine(cfg(), runner));
    const goal = await engine.createGoal({ prompt: 'a showcase site', repoPath: repo });
    await waitFor(() => getGoal(engine.store.db, goal.id)!.state === 'awaiting_brief_approval');
    expect(subjectsOf(engine, goal.id)).toEqual([]);
    const s = addSubject(engine, goal.id, { name: 'Sydney Opera House', lookFor: 'the shells', search: false });
    expect(s).toMatchObject({ key: 'P1', name: 'Sydney Opera House', pictures: [], search: null });
    const pic = addSubjectPicture(engine, goal.id, 'P1', png(), 'from the harbour');
    expect(pic).toEqual({ file: 'P1-1.png', source: 'person', url: null, caption: 'from the harbour' });
    expect(() => addSubjectPicture(engine, goal.id, 'P1', new TextEncoder().encode('<svg/>'))).toThrow(SubjectError);
    expect(() => addSubjectPicture(engine, goal.id, 'P9', png())).toThrow(/no Subject P9/);
    removeSubjectPicture(engine, goal.id, 'P1', 'P1-1.png');
    expect(subjectsOf(engine, goal.id)[0]!.pictures).toEqual([]);
    // a search that fails is recorded, and Foundry does not try again by itself
    startSubjectSearch(engine, goal.id, 'P1');
    await waitFor(() => subjectsOf(engine, goal.id)[0]!.search !== null);
    expect(subjectsOf(engine, goal.id)[0]!.search).toMatchObject({ status: 'failed', detail: 'no network' });
    engine.tick(goal.id);
    await Bun.sleep(100);
    expect(runner.calls.filter((c) => c.label?.startsWith('subject pictures'))).toHaveLength(1);
    engine.cancelGoal(goal.id);
    expect(() => addSubject(engine, goal.id, { name: 'Big Ben' })).toThrow(/Subjects change while the Brief awaits approval/);
  }, 20_000);

  test('a Delegated goal starts with the main goal\'s Subjects and copies of their pictures, and searches nothing again', async () => {
    // the main goal names nothing; its child's Clarifier names the main goal's Subject again, and one more
    let child = false;
    const runner = new Runner(() => (child ? briefOut([{ key: 'P1', name: 'porsche 911 GT3 (992)', lookFor: 'x', pictures: [] }, { key: 'P2', name: 'Nürburgring Nordschleife', lookFor: 'the track', pictures: [] }]) : briefOut([])));
    const engine = track(new Engine(cfg(), runner));
    const main = await engine.createGoal({ prompt: 'a showcase site for one sports car', repoPath: repo });
    await waitFor(() => getGoal(engine.store.db, main.id)!.state === 'awaiting_brief_approval');
    const kept: BriefSubject = { key: 'P1', name: 'Porsche 911 GT3 (992)', lookFor: 'the nose', pictures: [{ file: 'P1-1.jpg', source: 'web', url: 'https://example.com/a', caption: 'front' }], search: { status: 'ok', detail: '', at: 'x' } };
    mkdirSync(subjectsDir(dataDir, main.id), { recursive: true });
    writeFileSync(join(subjectsDir(dataDir, main.id), 'P1-1.jpg'), jpeg());
    child = true;
    const goal = await engine.createGoal({ prompt: 'the car model', repoPath: repo, delegatedFrom: { goalId: main.id, taskId: 't_x', title: 'the showcase', style: null, subjects: [kept] } });
    inheritSubjects(dataDir, main.id, goal.id, [kept]);
    await waitFor(() => getGoal(engine.store.db, goal.id)!.state === 'awaiting_brief_approval');
    expect(runner.calls.filter((c) => c.label?.startsWith('clarify')).at(-1)!.prompt).toContain('These Subjects are settled already, with their pictures (from the main goal): "Porsche 911 GT3 (992)"');
    expect(subjectsOf(engine, goal.id).map((s) => [s.key, s.name])).toEqual([['P1', 'Porsche 911 GT3 (992)'], ['P2', 'Nürburgring Nordschleife']]);
    expect(readFileSync(join(subjectsDir(dataDir, goal.id), 'P1-1.jpg'))).toEqual(Buffer.from(jpeg()));
    // only the new Subject is searched; the inherited one keeps its picture
    await waitFor(() => subjectsOf(engine, goal.id)[1]!.search !== null);
    expect(runner.calls.filter((c) => c.label?.startsWith('subject pictures')).map((c) => c.label)).toEqual(['subject pictures Nürburgring Nordschleife']);
    expect(subjectsOf(engine, goal.id).map((s) => s.pictures.map((p) => p.file))).toEqual([['P1-1.jpg'], ['P2-1.jpg']]);
    engine.cancelGoal(goal.id);
    engine.cancelGoal(main.id);
  }, 20_000);
});

describe('pictures and what sessions are told', () => {
  test('a picture is told by its first bytes', () => {
    expect(imageType(jpeg())).toBe('jpg');
    expect(imageType(png())).toBe('png');
    expect(imageType(new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 '))).toBe('webp');
    expect(imageType(new TextEncoder().encode('GIF89a......'))).toBe('gif');
    expect(imageType(new TextEncoder().encode('<!doctype html>'))).toBeNull();
  });

  test("the Clarifier's attached images become the person's pictures; an image the goal lacks is left out", () => {
    const att = join(dataDir, 'attachments', 'g1', 'att1');
    mkdirSync(att, { recursive: true });
    writeFileSync(join(att, 'car.jpg'), jpeg());
    const goal = { id: 'g1', attachments: [{ id: 'att1', kind: 'file', name: 'car.jpg', mime: 'image/jpeg', size: 10, path: 'attachments/g1/att1/car.jpg', url: null, note: 'my photo of it', addedAt: 'x', markdown: null }] } as unknown as Goal;
    const engine = { config: { dataDir, log: () => {} } } as unknown as Engine;
    const [s] = subjectsFromClarifier(engine, goal, [{ key: 'P1', name: 'Car', lookFor: 'nose', pictures: ['car.jpg', 'missing.jpg'] }]);
    expect(s!.pictures).toEqual([{ file: 'P1-1.jpg', source: 'person', url: null, caption: 'my photo of it' }]);
  });

  test('workers and reviewers on work with a look get the pictures by path; backend work and a Brief without Subjects get nothing', () => {
    const brief = { subjects: [{ key: 'P1', name: 'Porsche 911 GT3 (992)', lookFor: 'the nose', pictures: [{ file: 'P1-1.jpg', source: 'web', url: 'https://www.example.com/a', caption: 'front' }], search: null }] } as never;
    const worker = renderSubjects('/data', 'g1', brief, 'worker', 'general');
    expect(worker).toContain('# Subjects: what the result must look like (pictures approved by the human)');
    expect(worker).toContain('`/data/subjects/g1/P1-1.jpg` — front (example.com)');
    expect(worker).toContain('never copy, trace or embed them');
    expect(worker).toContain('`artifacts/renders/`');
    expect(renderSubjects('/data', 'g1', brief, 'worker', 'cad')).toContain('Your snapshots show the model');
    expect(renderSubjects('/data', 'g1', brief, 'task-reviewer', 'frontend')).toContain('is a BLOCKER');
    expect(renderSubjects('/data', 'g1', brief, 'worker', 'backend')).toBe('');
    expect(renderSubjects('/data', 'g1', { subjects: [] } as never, 'worker', 'general')).toBe('');
    expect(renderSubjects('/data', 'g1', brief, 'goal-reviewer', 'backend', 'Likeness reviews…')).toContain('Likeness reviews…');
  });
});

test('approval materialises tasks, and only a task with a look is told about the Subjects', async () => {
  const runner = new Runner(() => briefOut());
  const engine = track(new Engine(cfg(), runner));
  const goal = await engine.createGoal({ prompt: 'a showcase site for one sports car', repoPath: repo });
  await waitFor(() => getGoal(engine.store.db, goal.id)!.state === 'awaiting_brief_approval');
  await waitFor(() => subjectsOf(engine, goal.id)[0]?.search !== null);
  await engine.approveBrief(goal.id);
  await waitFor(() => runner.calls.filter((c) => c.label?.startsWith('attempt')).length >= 2, 15_000);
  const attempts = runner.calls.filter((c) => c.label?.startsWith('attempt'));
  const model = attempts.find((c) => c.label!.includes('build the car model'))!;
  const api = attempts.find((c) => c.label!.includes('add the specs api'))!;
  expect(model.prompt).toContain(`\`${join(subjectsDir(dataDir, goal.id), 'P1-1.jpg')}\``);
  expect(model.addDirs).toContain(subjectsDir(dataDir, goal.id));
  expect(api.prompt).not.toContain('# Subjects');
  expect(api.addDirs ?? []).not.toContain(subjectsDir(dataDir, goal.id));
  expect(listTasks(engine.store.db, goal.id)).toHaveLength(2);
  engine.cancelGoal(goal.id);
}, 30_000);
