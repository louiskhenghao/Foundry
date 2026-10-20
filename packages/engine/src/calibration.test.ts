import { beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Brief, Goal } from '@foundry/core';
import { Goal as GoalSchema, upsertBrief, upsertGoal } from '@foundry/core';
import { calibrationFor, estimateSamples } from './calibration.ts';
import { defaultConfig } from './config.ts';
import { Engine } from './engine.ts';
import { FakeRunner } from './test-helpers.ts';

const ROOT = resolve(import.meta.dir, '../../..');
let dataDir: string;
let engine: Engine;
beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'foundry-calibration-'));
  engine = new Engine(defaultConfig(ROOT, { dataDir, claudeHome: join(dataDir, 'claude-home'), log: () => {} }), new FakeRunner(() => {}));
});

let n = 0;
/** a finished goal with an approved Brief that estimated `estUsd` / `estMin`, which came to `costUsd` and `activeMin` */
function finished(over: Partial<Goal> & { estUsd?: number; estMin?: number; activeMin?: number; approved?: boolean; skeleton?: boolean } = {}): Goal {
  const { estUsd = 10, estMin = 60, activeMin = 90, approved = true, skeleton = false, ...rest } = over;
  n++;
  const goal = GoalSchema.parse({
    id: `g_${n}`, title: `goal ${n}`, prompt: 'p', repoPath: '/repo', baseBranch: 'main', branch: `goal/g_${n}`, budgets: {}, models: { strong: 'opus', cheap: 'haiku', worker: 'opus' },
    state: 'done', stateBeforeBlock: null, costUsd: 15, fixCycles: 0, runningSince: null, activeMs: activeMin * 60_000, activeSince: null, nature: 'code',
    createdAt: `2026-10-${String(n).padStart(2, '0')}T00:00:00Z`, updatedAt: `2026-10-${String(n).padStart(2, '0')}T01:00:00Z`, ...rest,
  });
  upsertGoal(engine.store.db, goal);
  const brief = { goalId: goal.id, title: 't', understanding: 'u', areas: [], assumptions: [], questions: [], styleOptions: [], tasks: [], checks: [], costEstimateUsd: estUsd, timeEstimateMin: estMin } as unknown as Brief;
  upsertBrief(engine.store.db, brief, approved, skeleton);
  return goal;
}

describe('estimate calibration (ADR-0056)', () => {
  test('only finished goals with an approved, estimated Brief are samples; a Codex goal has a time but no cost', () => {
    finished();
    finished({ state: 'failed' });
    finished({ state: 'cancelled' });
    finished({ state: 'running' });
    finished({ approved: false });
    finished({ skeleton: true });
    finished({ estMin: 0 });
    finished({ provider: 'codex' });
    finished({ costUsd: 0 });
    const samples = estimateSamples(engine);
    expect(samples.map((s) => [s.goalId, s.actualUsd, Math.round(s.actualMin!)])).toEqual([
      ['g_9', null, 90],
      ['g_8', null, 90],
      ['g_1', 15, 90],
    ]);
  });

  test('the folder calibrates its own goals once it has three; else the nature, across folders; else nothing; the goal itself is left out', () => {
    const first = finished({ estUsd: 10, estMin: 60, costUsd: 15, activeMin: 90 });
    for (let i = 0; i < 2; i++) finished({ estUsd: 10, estMin: 60, costUsd: 15, activeMin: 90 });
    const here = calibrationFor(engine, { id: 'g_new', repoPath: '/repo', nature: 'code' });
    expect(here.scope).toBe('folder');
    expect(here.cost).toEqual({ factor: 1.5, samples: 3, spread: 'tight' });
    expect(here.time).toEqual({ factor: 1.5, samples: 3, spread: 'tight' });
    expect(here.samples.length).toBe(3);
    // the goal being estimated is not its own sample: without it the folder (and the nature) have two, too few
    const self = calibrationFor(engine, { id: first.id, repoPath: '/repo', nature: 'code' });
    expect(self).toEqual({ scope: 'none', nature: null, cost: null, time: null, samples: [] });
    // another folder of the same nature falls back to every code goal on this computer
    const elsewhere = calibrationFor(engine, { id: 'g_x', repoPath: '/other', nature: 'code' });
    expect(elsewhere).toMatchObject({ scope: 'nature', nature: 'code', cost: { factor: 1.5, samples: 3 } });
    // a docs goal has nothing to learn from code goals
    expect(calibrationFor(engine, { id: 'g_y', repoPath: '/other', nature: 'docs' })).toEqual({ scope: 'none', nature: null, cost: null, time: null, samples: [] });
  });
});
