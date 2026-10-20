import { afterEach, beforeEach, expect, test } from 'bun:test';
import { Goal, listGoals, upsertGoal } from '@foundry/core';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { defaultConfig } from './config.ts';
import { Engine } from './engine.ts';
import { FakeRunner } from './test-helpers.ts';

let home: string;
let engine: Engine;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'foundry-last-workflow-'));
  engine = new Engine(defaultConfig(resolve(import.meta.dir, '../../..'), {
    dataDir: home, claudeHome: join(home, 'claude'), codexHome: join(home, 'codex'), log: () => {},
  }), new FakeRunner(() => {}));
  engine.beginUpdateDrain();
});
afterEach(async () => {
  await engine.stop();
  rmSync(home, { recursive: true, force: true });
});

function seed(id: string, createdAt: string, extra: Partial<Goal> = {}) {
  const goal = Goal.parse({
    id, title: id, prompt: 'p', repoPath: '/repo', baseBranch: 'main', branch: `goal/${id}`,
    budgets: {}, models: { strong: 'opus', cheap: 'haiku', worker: 'opus' }, state: 'cancelled',
    stateBeforeBlock: null, costUsd: 0, fixCycles: 0, runningSince: null,
    createdAt, updatedAt: createdAt, workflow: { profile: 'plain', tdd: 'off', ponytail: 'off' }, ...extra,
  });
  upsertGoal(engine.store.db, goal);
  return goal;
}

test('newest created goal wins regardless of insertion or update time; ties keep list ordering', () => {
  seed('newest', '2026-03-03T00:00:00Z');
  seed('older', '2026-01-01T00:00:00Z', { updatedAt: '2026-05-01T00:00:00Z' });
  expect(engine.lastWorkflowIn('/repo')).toEqual({ goalId: 'newest', title: 'newest', createdAt: '2026-03-03T00:00:00Z', workflow: { profile: 'plain', tdd: 'off', ponytail: 'off' } });
  seed('tie', '2026-03-03T00:00:00Z');
  expect(engine.lastWorkflowIn('/repo')?.goalId).toBe(listGoals(engine.store.db)[0]!.id);
});

test('no goals or a different exact folder string returns null', () => {
  expect(engine.lastWorkflowIn('/repo')).toBeNull();
  seed('other', '2026-01-01T00:00:00Z', { repoPath: '/repo/' });
  expect(engine.lastWorkflowIn('/repo')).toBeNull();
  expect(engine.lastWorkflowIn('/repo/child')).toBeNull();
  expect(engine.lastWorkflowIn('/repo/')?.goalId).toBe('other');
});

test('imported history is ignored until reattached', () => {
  const previous = seed('previous', '2026-01-01T00:00:00Z');
  const imported = seed('imported', '2026-03-01T00:00:00Z', { transfer: {
    transferId: 'transfer-fixture', from: { release: '2.2.0', hostname: 'fixture', exportedAt: '2026-04-01T00:00:00Z' },
    unfinished: false, bundle: null, importedAt: '2026-04-01T00:00:00Z', reattachedAt: null,
    original: { repoPath: '/repo', workspaceDir: null, outputDir: null },
    repoMapped: null, branchRestored: null, artifacts: null, transcripts: false,
  } });
  expect(engine.lastWorkflowIn('/repo')?.goalId).toBe(previous.id);
  seed('history-only', '2026-03-01T00:00:00Z', { repoPath: '/history-only', transfer: imported.transfer });
  expect(engine.lastWorkflowIn('/history-only')).toBeNull();
  upsertGoal(engine.store.db, { ...imported, transfer: { ...imported.transfer!, reattachedAt: '2026-05-01T00:00:00Z' } });
  expect(engine.lastWorkflowIn('/repo')?.goalId).toBe(imported.id);
});

test('reads current saved Ponytail, and normalizes legacy Ponytail and profile using Settings', async () => {
  seed('saved', '2026-01-01T00:00:00Z');
  engine.store.append({ type: 'goal.ponytail_set', goalId: 'saved', payload: { on: true } });
  expect(engine.lastWorkflowIn('/repo')?.workflow.ponytail).toBe('on');
  expect((await engine.followUpDraft('saved')).prefill.ponytail).toBe('on');
  const legacy = seed('legacy', '2026-02-01T00:00:00Z');
  const { profile: _profile, ponytail: _ponytail, ...workflow } = legacy.workflow;
  engine.store.db.run('UPDATE goals SET data = ? WHERE id = ?', [JSON.stringify({ ...legacy, workflow }), legacy.id]);
  engine.config.workflowProfile = 'pstack';
  expect(engine.lastWorkflowIn('/repo')?.workflow).toEqual({ profile: 'pstack', tdd: 'off', ponytail: 'on' });
  expect((await engine.followUpDraft(legacy.id)).prefill).toMatchObject({ profile: 'pstack', tdd: 'off', ponytail: 'on' });
});
