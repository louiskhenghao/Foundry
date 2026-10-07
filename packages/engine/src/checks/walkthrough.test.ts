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
import { captureMilestone, type MilestoneEvidence, type WalkPlan } from './walkthrough.ts';

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
    id: 'g_walk01', title: 'walk', prompt: 'p', workspaceDir: ws, checkpoint: null, selfCheck: false, previewRef: null, previewPlace: 'auto', milestonePause: true, interview: null, effort: null, modelPreset: null, modelSubstitutions: {}, repoPath: '/nowhere', baseBranch: 'main', branch: 'goal/g_walk01',
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
});
