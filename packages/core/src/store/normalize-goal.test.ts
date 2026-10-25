import { describe, expect, test } from 'bun:test';
import { openDatabase } from './db.ts';
import { getGoal, upsertGoal } from './projections.ts';
import { IDLE_DELIVERY, type Goal } from '../schema/index.ts';

/** a goal row as a Foundry before ADR-0077 wrote it: no video engine, no session cap of its own */
function oldRow(id: string): Goal {
  const now = new Date().toISOString();
  const g = {
    id, title: 't', prompt: 'p', workspaceDir: null, checkpoint: null, selfCheck: false, previewRef: null, previewPlace: 'auto', milestonePause: true, clarifyStage: null, references: [], investigation: null,
    revise: null, interview: null, effort: null, modelPreset: null, modelSubstitutions: {}, repoPath: '/tmp/x', baseBranch: 'main', branch: `goal/${id}`,
    budgets: { maxCostUsd: 5, maxDurationMin: 120, maxConcurrent: 3, attemptsPerTask: 3 },
    budgetPreset: 'custom', mode: 'expert', workflow: { tdd: 'required', pace: 'thorough', ponytail: 'on' }, models: { strong: 'opus', cheap: 'haiku', worker: 'opus' },
    state: 'draft', stateBeforeBlock: null, costUsd: 0, fixCycles: 0, delivery: IDLE_DELIVERY, attachments: [], baseSync: null, autoskills: null, follows: null,
    delegation: { allow: false, autoApprove: false }, delegatedFrom: null, completion: { graphRefresh: false, docs: [], audit: false, auditRun: null, qa: false, qaRun: null, docsRun: null, graphRun: null, artifactsRun: null },
    nature: 'video', outputDir: null, runningSince: null, createdAt: now, updatedAt: now,
  };
  return g as unknown as Goal;
}

describe('a goal row from before the video engine and the session cap (ADR-0077)', () => {
  test('reads back with the defaults: the Settings pack, the Settings timeout', () => {
    const db = openDatabase(':memory:');
    upsertGoal(db, oldRow('g_old'));
    const g = getGoal(db, 'g_old')!;
    expect(g.videoPack).toBeNull();
    expect(g.budgets.attemptTimeoutMin).toBeNull();
  });
  test('keeps what a newer row says', () => {
    const db = openDatabase(':memory:');
    upsertGoal(db, { ...oldRow('g_new'), videoPack: 'hyperframes', budgets: { maxCostUsd: 5, maxDurationMin: 120, maxConcurrent: 3, attemptsPerTask: 3, attemptTimeoutMin: 60 } });
    const g = getGoal(db, 'g_new')!;
    expect(g.videoPack).toBe('hyperframes');
    expect(g.budgets.attemptTimeoutMin).toBe(60);
  });
});
