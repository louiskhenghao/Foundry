import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { IDLE_DELIVERY, getGoal, type Goal } from '@foundry/core';
import type { ClaudeRunner } from '@foundry/runner';
import { artifactsDue } from './completion.ts';
import { defaultConfig } from './config.ts';
import { EditorError, HYPERFRAMES_PIN, editorView, hyperframesProjects, motionFilms, rerenderOutputs } from './editor.ts';
import { Engine } from './engine.ts';
import { makeRepo, sh, waitFor } from './test-helpers.ts';

const ROOT = resolve(import.meta.dir, '../../..');
const noRunner = { active: () => 0, run: async () => { throw new Error('no sessions in this test'); } } as unknown as ClaudeRunner;

let dataDir: string;
let engine: Engine;
beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'foundry-editor-data-'));
  engine = new Engine(defaultConfig(ROOT, { dataDir, claudeHome: join(dataDir, 'claude-home'), betaEditor: true, log: () => {} }), noRunner);
  engine.config.preview = { portFrom: 47120, portTo: 47130, idleMinutes: 60 };
});
afterEach(async () => {
  await engine.stop();
  rmSync(dataDir, { recursive: true, force: true });
});

/** a goal whose workspace is `ws` (a repository of its own in these tests), appended as created */
const goal = (ws: string, over: Partial<Goal> = {}): Goal => {
  const now = new Date().toISOString();
  const g: Goal = {
    id: 'g_editor01', title: 'reel', prompt: 'p', workspaceDir: ws, checkpoint: null, selfCheck: false, previewRef: null, previewPlace: 'auto', milestonePause: true, clarifyStage: null, references: [], investigation: null, revise: null, interview: null, effort: null, videoPack: 'hyperframes', modelPreset: null, modelSubstitutions: {}, repoPath: ws, baseBranch: 'main', branch: 'goal/g_editor01',
    budgets: { maxCostUsd: 5, maxDurationMin: 120, maxConcurrent: 3, attemptsPerTask: 3, attemptTimeoutMin: null }, budgetPreset: 'custom', mode: 'expert', workflow: { tdd: 'off', pace: 'thorough', ponytail: 'on' },
    models: { strong: 'opus', cheap: 'haiku', worker: 'opus' }, state: 'done', stateBeforeBlock: null, costUsd: 0, fixCycles: 0, delivery: IDLE_DELIVERY, attachments: [], baseSync: null, autoskills: null, follows: null, delegation: { allow: false, autoApprove: false }, delegatedFrom: null,
    completion: { graphRefresh: false, docs: [], audit: false, auditRun: null, qa: false, qaRun: null, docsRun: null, graphRun: null, artifactsRun: null }, nature: 'video', outputDir: null, runningSince: null, createdAt: now, updatedAt: now, ...over,
  };
  engine.store.append({ type: 'goal.created', goalId: g.id, payload: { goal: g } });
  return getGoal(engine.store.db, g.id)!;
};

/** a HyperFrames project as `hyperframes init` leaves it: hyperframes.json, meta.json, a package.json whose scripts pin the CLI */
const project = (root: string, dir: string, name: string, version: string | null) => {
  mkdirSync(join(root, dir), { recursive: true });
  writeFileSync(join(root, dir, 'hyperframes.json'), JSON.stringify({ paths: { assets: 'assets' } }));
  writeFileSync(join(root, dir, 'meta.json'), JSON.stringify({ id: name, name }));
  writeFileSync(join(root, dir, 'index.html'), '<div class="clip" data-start="0" data-duration="3"></div>');
  if (version) writeFileSync(join(root, dir, 'package.json'), JSON.stringify({ name, private: true, scripts: { dev: `npx --yes hyperframes@${version} preview`, render: `npx --yes hyperframes@${version} render` } }));
};

describe('the Editor (ADR-0086)', () => {
  test('HyperFrames projects are the folders with a hyperframes.json, four levels down at most, node_modules and the engine folders left out; each with its own CLI pin', () => {
    const ws = mkdtempSync(join(tmpdir(), 'foundry-editor-ws-'));
    project(ws, 'video/reel', 'Launch reel', '0.9.5');
    project(ws, 'video/teaser', 'teaser', null);
    project(ws, 'node_modules/hyperframes/template', 'nope', '0.1.0');
    project(ws, 'a/b/c/d/e/deep', 'deep', '0.1.0');
    expect(hyperframesProjects(ws)).toEqual([
      { dir: 'video/reel', name: 'Launch reel', version: '0.9.5', pinned: true },
      { dir: 'video/teaser', name: 'teaser', version: HYPERFRAMES_PIN, pinned: false },
    ]);
    // the root itself can be the project
    const root = mkdtempSync(join(tmpdir(), 'foundry-editor-root-'));
    project(root, '', 'whole', '0.9.8');
    expect(hyperframesProjects(root)).toEqual([{ dir: '', name: 'whole', version: '0.9.8', pinned: true }]);
    expect(hyperframesProjects(join(root, 'missing'))).toEqual([]);
    rmSync(ws, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  });

  test('motion-studio films are motion/<slug>/ with a film.json and an index.html; lib and half-made folders are not films', () => {
    const ws = mkdtempSync(join(tmpdir(), 'foundry-editor-films-'));
    mkdirSync(join(ws, 'motion', 'lib'), { recursive: true });
    mkdirSync(join(ws, 'motion', 'launch'), { recursive: true });
    writeFileSync(join(ws, 'motion', 'launch', 'film.json'), JSON.stringify({ title: 'Launch', duration: 15, fps: 60, formats: ['16x9', '9x16'] }));
    writeFileSync(join(ws, 'motion', 'launch', 'index.html'), '<canvas>');
    mkdirSync(join(ws, 'motion', 'no-page'), { recursive: true });
    writeFileSync(join(ws, 'motion', 'no-page', 'film.json'), '{}');
    expect(motionFilms(ws)).toEqual([{ slug: 'launch', title: 'Launch', duration: 15, fps: 60, formats: ['16x9', '9x16'] }]);
    rmSync(ws, { recursive: true, force: true });
  });

  test('a video goal with the beta on lists an Editor app per project — the pinned CLI on a preview port, never opening a browser; nothing on other goals or with the beta off', async () => {
    const ws = await makeRepo();
    project(ws, 'video/reel', 'Launch reel', '0.9.5');
    const g = goal(ws);
    expect(engine.editorApps(g).map((a) => [a.key, a.name, a.dir, a.command, a.url])).toEqual([['editor:video/reel', 'Editor · Launch reel', 'video/reel', 'npx --yes hyperframes@0.9.5 preview --port {port} --no-open --foreground', 'http://localhost:{port}/']]);
    const view = editorView(engine, g);
    expect(view.enabled).toBe(true);
    expect(view.projects.map((p) => p.key)).toEqual(['editor:video/reel']);
    expect(view.rerender).toMatchObject({ can: true, reason: null, running: false, next: 1, last: null, history: [] });
    // the preview card lists it; a milestone, self-check or integration start has nothing to run
    expect(engine.preview.status(g.id).apps.map((a) => [a.key, a.running])).toEqual([['editor:video/reel', false]]);
    await expect(engine.preview.start(g, 'milestone')).rejects.toThrow(/nothing to run/);
    // a code goal with a project folder has no Editor
    expect(engine.editorApps(goal(ws, { id: 'g_editor02', nature: 'code', branch: 'goal/g_editor02' }))).toEqual([]);
    engine.config.betaEditor = false;
    expect(engine.editorApps(g)).toEqual([]);
    expect(editorView(engine, g)).toEqual({ enabled: false, projects: [], films: [], rerender: null });
    rmSync(ws, { recursive: true, force: true });
  });

  test('Re-render: the result kept aside, every project rendered to artifacts/video/<project>/final.mp4, the edits committed as edit n, the goal told, the delivery due again', async () => {
    const ws = await makeRepo();
    project(ws, 'video/reel', 'reel', '0.9.5');
    mkdirSync(join(ws, 'artifacts', 'video', 'reel'), { recursive: true });
    writeFileSync(join(ws, 'artifacts', 'video', 'reel', 'final.mp4'), 'old');
    await sh('git add -A && git commit -qm "feat: the reel"', ws);
    // delivered once already to its output folder: nothing due until something changes. The goal finished the way a
    // real one does, through its states: the delivery trigger reads those
    const out = mkdtempSync(join(tmpdir(), 'foundry-editor-out-'));
    const g = goal(ws, { outputDir: out });
    engine.store.append({ type: 'goal.state_changed', goalId: g.id, payload: { from: 'running', to: 'done', reason: 'test' } });
    engine.store.append({ type: 'goal.artifacts_delivered', goalId: g.id, payload: { status: 'ok', files: ['video/reel/final.mp4'], dest: out, detail: '1 artifact(s) copied' } });
    expect(artifactsDue(engine, getGoal(engine.store.db, g.id)!)).toBe(false);
    // the person edited in the Editor: the project's page changed on disk, uncommitted
    writeFileSync(join(ws, 'video', 'reel', 'index.html'), '<div class="clip" data-start="0" data-duration="4"></div>');
    const renders: string[] = [];
    engine.editorDeps = {
      render: async ({ dir, composition, out: file, version, log }) => {
        renders.push(`${dir}@${version}:${composition}`);
        log('rendering…');
        writeFileSync(file, 'new mp4 bytes');
      },
      // no harness in this repository: the render is the film
      loudness: async () => false,
      probe: async () => 4,
    };
    expect(engine.rerender(g.id, { by: 'ann' })).toEqual({ n: 1 });
    expect(engine.rerendering.has(g.id)).toBe(true);
    await expect(() => engine.rerender(g.id)).toThrow(/being rendered now/);
    await waitFor(() => engine.store.listByGoalOfTypes(g.id, ['goal.rerendered']).length === 1, 15_000);
    expect(renders).toEqual([`${join(ws, 'video/reel')}@0.9.5:index.html`]);
    expect(readFileSync(join(ws, 'artifacts', 'video', 'reel', 'final.mp4'), 'utf8')).toBe('new mp4 bytes');
    // the earlier result, kept before the edit
    expect(readFileSync(join(ws, 'artifacts', '.history', '1', 'video', 'reel', 'final.mp4'), 'utf8')).toBe('old');
    const rerendered = engine.store.listByGoalOfTypes(g.id, ['goal.rerendered'])[0]!.payload as { n: number; files: string[]; commit: string | null; errors: unknown[] };
    expect(rerendered).toMatchObject({ n: 1, files: ['video/reel/final.mp4'], errors: [] });
    expect(rerendered.commit).toBeTruthy();
    expect(await sh('git log -1 --format=%s', ws)).toBe('chore(video): edits in the editor (edit 1)');
    expect(await sh('git status --porcelain', ws)).toBe('');
    const after = getGoal(engine.store.db, g.id)!;
    expect(after.adjustments?.map((a) => [a.n, a.mode, a.by])).toEqual([[1, 'rerender', 'ann']]);
    // the goal's tick delivered the new file to the output folder on its own (artifactsDue): the delivery after the Re-render is the second one
    await waitFor(() => engine.store.listByGoalOfTypes(g.id, ['goal.artifacts_delivered']).length === 2, 15_000);
    expect(readFileSync(join(out, 'video', 'reel', 'final.mp4'), 'utf8')).toBe('new mp4 bytes');
    // and once only: the Re-render is covered by the delivery that followed it, whatever state change that delivery
    // names as its start (live, a goal that went through its states delivered again on every tick)
    expect(artifactsDue(engine, getGoal(engine.store.db, g.id)!)).toBe(false);
    await engine.tick(g.id);
    await new Promise((r) => setTimeout(r, 300));
    expect(engine.store.listByGoalOfTypes(g.id, ['goal.artifacts_delivered']).length).toBe(2);
    const view = editorView(engine, after);
    expect(view.rerender).toMatchObject({ can: true, running: false, next: 2 });
    expect(view.rerender!.last).toMatchObject({ n: 1, files: ['video/reel/final.mp4'] });
    expect(view.rerender!.history.map((h) => [h.n, h.files])).toEqual([[1, ['video/reel/final.mp4']]]);
    // the editor's scratch folders are kept out of git
    expect(readFileSync(join(ws, '.git', 'info', 'exclude'), 'utf8')).toContain('.hyperframes/');
    expect(readFileSync(join(ws, '.git', 'info', 'exclude'), 'utf8')).toContain('.thumbnails/');
    rmSync(out, { recursive: true, force: true });
    rmSync(ws, { recursive: true, force: true });
  }, 30_000);

  test('every film the goal delivered is made again from its own composition and replaced in place, through the loudness pass when the repository carries the harness', async () => {
    const ws = await makeRepo();
    project(ws, 'video/reel', 'reel', '0.9.8');
    writeFileSync(join(ws, 'video', 'reel', 'index-9x16.html'), '<div class="clip"></div>');
    mkdirSync(join(ws, 'video', 'lib'), { recursive: true });
    writeFileSync(join(ws, 'video', 'lib', 'loudness.mjs'), '// the harness');
    mkdirSync(join(ws, 'artifacts', 'video', 'reel'), { recursive: true });
    writeFileSync(join(ws, 'artifacts', 'video', 'reel', 'final-16x9.mp4'), 'old wide');
    writeFileSync(join(ws, 'artifacts', 'video', 'reel', 'final-9x16.mp4'), 'old tall');
    await sh('git add -A && git commit -qm "feat: the reel in two formats"', ws);
    const g = goal(ws, { id: 'g_editor05', branch: 'goal/g_editor05' });
    expect(rerenderOutputs(ws, { dir: 'video/reel', name: 'reel', version: '0.9.8', pinned: true })).toEqual([
      { format: '16x9', composition: 'index.html', rel: 'video/reel/final-16x9.mp4' },
      { format: '9x16', composition: 'index-9x16.html', rel: 'video/reel/final-9x16.mp4' },
    ]);
    const calls: string[] = [];
    engine.editorDeps = {
      render: async ({ composition, out }) => {
        calls.push(`render ${composition} → ${basename(out)}`);
        writeFileSync(out, `raw ${composition}`);
      },
      loudness: async ({ input, out }) => {
        calls.push(`loudness ${basename(input)} → ${basename(out)}`);
        writeFileSync(out, `loud ${readFileSync(input, 'utf8')}`);
        return true;
      },
      probe: async () => 15,
    };
    engine.rerender(g.id);
    await waitFor(() => engine.store.listByGoalOfTypes(g.id, ['goal.rerendered']).length === 1, 15_000);
    expect(calls).toEqual(['render index.html → render-16x9.mp4', 'loudness render-16x9.mp4 → final-16x9.mp4', 'render index-9x16.html → render-9x16.mp4', 'loudness render-9x16.mp4 → final-9x16.mp4']);
    expect(readFileSync(join(ws, 'artifacts', 'video', 'reel', 'final-16x9.mp4'), 'utf8')).toBe('loud raw index.html');
    expect(readFileSync(join(ws, 'artifacts', 'video', 'reel', 'final-9x16.mp4'), 'utf8')).toBe('loud raw index-9x16.html');
    expect(readFileSync(join(ws, 'artifacts', '.history', '1', 'video', 'reel', 'final-9x16.mp4'), 'utf8')).toBe('old tall');
    const p = engine.store.listByGoalOfTypes(g.id, ['goal.rerendered'])[0]!.payload as { files: string[]; errors: unknown[] };
    expect(p.files).toEqual(['video/reel/final-16x9.mp4', 'video/reel/final-9x16.mp4']);
    expect(p.errors).toEqual([]);
    expect(readFileSync(join(ws, '.git', 'info', 'exclude'), 'utf8')).toContain('.waveform-cache/');
    rmSync(ws, { recursive: true, force: true });
  }, 30_000);

  test('a render that fails is recorded on the goal, the others still land; refused with the beta off, on a goal at work, and without a project', async () => {
    const ws = await makeRepo();
    project(ws, 'a', 'a', null);
    project(ws, 'b', 'b', null);
    await sh('git add -A && git commit -qm "feat: two"', ws);
    const g = goal(ws);
    engine.editorDeps = {
      render: async ({ dir, out }) => {
        if (dir.endsWith('/a')) throw new Error('boom');
        writeFileSync(out, 'ok');
      },
      loudness: async () => false,
      probe: async () => 2,
    };
    engine.rerender(g.id);
    await waitFor(() => engine.store.listByGoalOfTypes(g.id, ['goal.rerendered']).length === 1, 15_000);
    const p = engine.store.listByGoalOfTypes(g.id, ['goal.rerendered'])[0]!.payload as { files: string[]; errors: { dir: string; error: string }[] };
    expect(p.files).toEqual(['video/b/final.mp4']);
    expect(p.errors).toEqual([{ dir: 'a', error: 'index.html: boom' }]);
    expect(engine.store.listByGoalOfTypes(g.id, ['engine.note']).at(-1)!.payload).toMatchObject({ level: 'warn' });
    expect(existsSync(join(ws, 'artifacts', 'video', 'a', 'final.mp4'))).toBe(false);

    const busy = goal(ws, { id: 'g_editor03', state: 'running', branch: 'goal/g_editor03' });
    expect(() => engine.rerender(busy.id)).toThrow(EditorError);
    expect(() => engine.rerender(busy.id)).toThrow(/still at work/);
    const bare = await makeRepo();
    const empty = goal(bare, { id: 'g_editor04', branch: 'goal/g_editor04' });
    expect(() => engine.rerender(empty.id)).toThrow(/no HyperFrames project/);
    expect(editorView(engine, empty).rerender).toBeNull();
    engine.config.betaEditor = false;
    expect(() => engine.rerender(g.id)).toThrow(/Settings → Beta/);
    rmSync(ws, { recursive: true, force: true });
    rmSync(bare, { recursive: true, force: true });
  }, 30_000);
});
