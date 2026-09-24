import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { IDLE_DELIVERY, getGoal, type Goal } from '@foundry/core';
import type { ClaudeRunner } from '@foundry/runner';
import { ensureSelfCheck, runSelfCheck } from '../checks/selfcheck.ts';
import { defaultConfig } from '../config.ts';
import { Engine } from '../engine.ts';

const ROOT = resolve(import.meta.dir, '../../../..');
const noRunner = { active: () => 0, run: async () => { throw new Error('no sessions in this test'); } } as unknown as ClaudeRunner;

let dataDir: string;
let ws: string;
let engine: Engine;
beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'foundry-preview-data-'));
  ws = mkdtempSync(join(tmpdir(), 'foundry-preview-ws-'));
  engine = new Engine(defaultConfig(ROOT, { dataDir, claudeHome: join(dataDir, 'claude-home'), log: () => {} }), noRunner);
  engine.config.preview = { portFrom: 47100, portTo: 47110, idleMinutes: 60 };
});
afterEach(async () => {
  await engine.stop();
  for (const d of [dataDir, ws]) rmSync(d, { recursive: true, force: true });
});

const goal = (over: Partial<Goal> = {}): Goal => {
  const now = new Date().toISOString();
  const g: Goal = {
    id: 'g_preview01', title: 'preview', prompt: 'p', workspaceDir: ws, checkpoint: null, selfCheck: false, interview: null, effort: null, modelPreset: null, modelSubstitutions: {}, repoPath: '/nowhere', baseBranch: 'main', branch: 'goal/g_preview01',
    budgets: { maxCostUsd: 5, maxDurationMin: 120, maxConcurrent: 3, attemptsPerTask: 3 }, budgetPreset: 'custom', mode: 'expert', workflow: { tdd: 'off', pace: 'thorough' },
    models: { strong: 'opus', cheap: 'haiku', worker: 'opus' }, state: 'running', stateBeforeBlock: null, costUsd: 0, fixCycles: 0, delivery: IDLE_DELIVERY, attachments: [], baseSync: null, autoskills: null,
    completion: { graphRefresh: false, docs: [], docsRun: null, graphRun: null, artifactsRun: null }, nature: 'auto', outputDir: null, runningSince: null, createdAt: now, updatedAt: now, ...over,
  };
  engine.store.append({ type: 'goal.created', goalId: g.id, payload: { goal: g } });
  return getGoal(engine.store.db, g.id)!;
};

describe('PreviewManager', () => {
  test('starts the detected dev script on a free port from the range, answers, and stops', async () => {
    writeFileSync(join(ws, 'package.json'), JSON.stringify({ scripts: { start: `bun -e "Bun.serve({ port: Number(process.env.PORT), fetch: () => new Response('hi from preview') })"` } }));
    const g = goal();
    expect(engine.preview.status(g.id)).toMatchObject({ running: false, run: { command: 'npm run start', platform: 'web' }, source: 'detected' });
    const st = await engine.preview.start(g, 'human');
    expect(st.running).toBe(true);
    expect(st.ready).toBe(true);
    expect(st.port).toBeGreaterThanOrEqual(47100);
    expect(await fetch(st.url!).then((r) => r.text())).toBe('hi from preview');
    expect(engine.store.listByGoal(g.id).some((e) => e.type === 'preview.started')).toBe(true);
    // starting again is a no-op that keeps the same process
    expect((await engine.preview.start(g, 'human')).port).toBe(st.port);
    await engine.preview.stop(g.id, 'test');
    expect(engine.preview.status(g.id).running).toBe(false);
    expect(engine.store.listByGoal(g.id).some((e) => e.type === 'preview.stopped')).toBe(true);
  }, 30_000);

  test('nothing to run: start refuses with a reason, and the self-check records an error instead of throwing', async () => {
    const g = goal({ selfCheck: true });
    await expect(engine.preview.start(g, 'human')).rejects.toThrow(/nothing to run/);
    const check = ensureSelfCheck(engine, g)!;
    expect(check.spec.type).toBe('selfcheck');
    expect(check.tier).toBe('must');
    expect(ensureSelfCheck(engine, g)!.id).toBe(check.id); // idempotent
    const r = await runSelfCheck(engine, g, { taskId: 't_x' });
    expect(r?.status).toBe('error');
    expect(r?.summary).toContain('nothing to run');
    expect(engine.store.listByGoal(g.id).some((e) => e.type === 'selfcheck.finished')).toBe(true);
  });
});
