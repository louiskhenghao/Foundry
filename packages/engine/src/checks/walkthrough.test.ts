import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { IDLE_DELIVERY, getGoal, type Goal, type Task } from '@foundry/core';
import type { ClaudeRunner, RunResult } from '@foundry/runner';
import { defaultConfig } from '../config.ts';
import { Engine } from '../engine.ts';
import { screenshotsDir } from '../workspace.ts';
import { playwrightStatus } from './selfcheck.ts';
import { captureMilestone, pageProblem, pickApp, type MilestoneEvidence, type WalkPlan } from './walkthrough.ts';
import type { PreviewAppStatus } from '../preview/manager.ts';

const ROOT = resolve(import.meta.dir, '../../../..');
const browser = (await playwrightStatus()).browser;

/** a session that answers every run with a walkthrough plan (or fails) */
const planner = (plan: WalkPlan | null | undefined): ClaudeRunner =>
  ({
    active: () => 0,
    run: async () => {
      if (plan === undefined) throw new Error('no model today');
      const result = { sessionId: 's', subtype: 'success', isError: false, costUsd: 0.01, numTurns: 1, durationMs: 1, usage: null, modelUsage: null, permissionDenials: [], finalText: '', structuredOutput: plan, exitCode: 0, pid: null, rateLimit: null, errorMessage: null, skillsUsed: [], toolsUsed: {} } as RunResult;
      return { pid: null, events: (async function* () {})(), kill() {}, result: Promise.resolve(result) };
    },
  }) as unknown as ClaudeRunner;

let dataDir: string;
let ws: string;
const engines: Engine[] = [];
beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'foundry-walk-data-'));
  ws = mkdtempSync(join(tmpdir(), 'foundry-walk-ws-'));
  mkdirSync(join(ws, 'node_modules'));
  const page = `<h1>Demo</h1><button onclick="document.body.insertAdjacentHTML('beforeend','<p>clicked</p>')">Show</button>`;
  writeFileSync(join(ws, 'server.js'), `Bun.serve({ port: Number(process.env.PORT), fetch: () => new Response(${JSON.stringify(page)}, { headers: { 'content-type': 'text/html' } }) });`);
  writeFileSync(join(ws, 'package.json'), JSON.stringify({ scripts: { start: 'bun server.js' } }));
});
afterEach(async () => {
  for (const e of engines.splice(0)) await e.stop();
  for (const d of [dataDir, ws]) rmSync(d, { recursive: true, force: true });
});

const setup = (runner: ClaudeRunner) => {
  const engine = new Engine(defaultConfig(ROOT, { dataDir, claudeHome: join(dataDir, 'claude-home'), log: () => {} }), runner);
  engines.push(engine);
  engine.config.preview = { portFrom: 47140, portTo: 47149, idleMinutes: 60 };
  const now = new Date().toISOString();
  const g = {
    id: 'g_walk01', title: 'walk', prompt: 'p', workspaceDir: ws, checkpoint: null, selfCheck: false, previewRef: null, previewPlace: 'auto', milestonePause: true, clarifyStage: null, interview: null, effort: null, modelPreset: null, modelSubstitutions: {}, repoPath: '/nowhere', baseBranch: 'main', branch: 'goal/g_walk01',
    budgets: { maxCostUsd: 5, maxDurationMin: 120, maxConcurrent: 3, attemptsPerTask: 3 }, budgetPreset: 'custom', mode: 'expert', workflow: { tdd: 'off', pace: 'thorough' },
    models: { strong: 'opus', cheap: 'haiku', worker: 'opus' }, state: 'running', stateBeforeBlock: null, costUsd: 0, fixCycles: 0, delivery: IDLE_DELIVERY, attachments: [], baseSync: null, autoskills: null, follows: null,
    completion: { graphRefresh: false, docs: [], docsRun: null, graphRun: null, artifactsRun: null }, nature: 'auto', outputDir: null, runningSince: null, createdAt: now, updatedAt: now,
  } as Goal;
  engine.store.append({ type: 'goal.created', goalId: g.id, payload: { goal: g } });
  const task = { id: 't_walk', title: 'the Show button', milestone: 'press Show and see the text appear', spec: 's' } as Task;
  return { engine, goal: getGoal(engine.store.db, g.id)!, task };
};

describe('milestone walkthrough', () => {
  test.skipIf(!browser)('follows the planned steps in the preview, recording a video and a screenshot where asked', async () => {
    const { engine, goal, task } = setup(planner({ steps: [{ action: 'click', target: 'Show', role: 'button', value: '', caption: '' }, { action: 'click', target: 'Missing', role: null, value: '', caption: '' }, { action: 'shot', target: '', role: null, value: '', caption: 'the text after Show' }], summary: 'presses Show' }));
    const ev = (await captureMilestone(engine, goal, task))!;
    expect(ev).toMatchObject({ taskId: 't_walk', summary: 'presses Show', error: null, shots: [{ caption: 'the text after Show' }] });
    const dir = screenshotsDir(dataDir, goal);
    expect(existsSync(join(dir, ev.shots[0]!.file))).toBe(true);
    expect(ev.video && existsSync(join(dir, ev.video))).toBe(true);
    expect(engine.store.listByGoal(goal.id).filter((e) => e.type === 'milestone.evidence').map((e) => e.payload as MilestoneEvidence)).toEqual([ev]);
  }, 60_000);

  test.skipIf(!browser)('without a plan, one screenshot of the page is kept and the reason is recorded in words', async () => {
    let { engine, goal, task } = setup(planner(undefined));
    let ev = (await captureMilestone(engine, goal, task))!;
    expect(ev.shots).toHaveLength(1);
    expect(ev.video).toBeNull();
    expect(ev.error).toContain('no model today');
    await engine.stop();
    ({ engine, goal, task } = setup(planner(null)));
    ev = (await captureMilestone(engine, goal, task))!;
    expect(ev.error).toBe('no walkthrough planned: the session returned no plan');
  }, 60_000);

  test.skipIf(!browser)('a real app that shows only error pages is walked again against its mock script, and the error pages are left out', async () => {
    // the real app answers every page with a 404; its dev:mock script serves the page the milestone is about
    writeFileSync(join(ws, 'server.js'), `Bun.serve({ port: Number(process.env.PORT), fetch: () => new Response('<h1>404</h1><p>This page could not be found.</p>', { status: 404, headers: { 'content-type': 'text/html' } }) });`);
    const page = `<h1>Demo</h1><button>Show</button><p>${'a real page with enough words on it to read like one. '.repeat(4)}</p>`;
    writeFileSync(join(ws, 'mock.js'), `Bun.serve({ port: Number(process.env.PORT), fetch: () => new Response(${JSON.stringify(page)}, { headers: { 'content-type': 'text/html' } }) });`);
    writeFileSync(join(ws, 'package.json'), JSON.stringify({ scripts: { start: 'bun server.js', 'dev:mock': 'bun mock.js' } }));
    const { engine, goal, task } = setup(planner({ steps: [{ action: 'shot', target: '', role: null, value: '', caption: 'the page' }], summary: 'shows the page' }));
    const ev = (await captureMilestone(engine, goal, task))!;
    expect(ev.mock).toBe(true);
    expect(ev.summary).toStartWith('With mock data');
    expect(ev.shots).toHaveLength(1);
    expect(ev.error).toBeNull();
    // the mock lasted the walkthrough only
    expect(engine.preview.status(goal.id).apps.every((a) => !a.mock && !a.running)).toBe(true);
  }, 90_000);
});

describe('which app and which pages', () => {
  const app = (key: string, dir: string): PreviewAppStatus => ({ key, name: key, dir, ready: true, url: `http://localhost/${key}` }) as PreviewAppStatus;
  test('the app whose folder holds the task\'s files, else the first', () => {
    const apps = [app('admin', 'apps/admin'), app('miniapp', 'apps/miniapp')];
    expect(pickApp({ relevantFiles: ['apps/miniapp/src/a.tsx', 'apps/miniapp/e2e/b.ts', 'e2e/web/c.ts'] }, apps)!.key).toBe('miniapp');
    expect(pickApp({ relevantFiles: ['README.md'] }, apps)!.key).toBe('admin');
    expect(pickApp({ relevantFiles: [] }, [])).toBeNull();
  });
  test('an HTTP error, a "could not be found" page and a blank page show nothing of the milestone', () => {
    expect(pageProblem(404, 'whatever')).toBe('HTTP 404');
    expect(pageProblem(200, '404 | This page could not be found.')).toContain('an error page');
    expect(pageProblem(200, '  ')).toBe('a blank page');
    expect(pageProblem(200, 'Sign in Email Password Continue')).toBeNull();
    expect(pageProblem(200, `Store ${'pack '.repeat(200)} not found anywhere`)).toBeNull();
  });
});
