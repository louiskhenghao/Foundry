import { describe, expect, test } from 'bun:test';
import type { Task } from '@foundry/core';
import { dueCheckpoint, hintOnly } from './checkpoint.ts';

const task = (id: string, over: Partial<Task> = {}): Task => ({
  id, goalId: 'g', title: id, spec: 's', kind: 'feature', scope: null, scenario: 'general', area: null, tdd: 'inherit', dependsOn: [], relevantFiles: [], parallelizable: true, retryBudget: 3, origin: 'brief',
  milestone: null, milestoneVisits: 0, checkpointOf: null, state: 'done', branch: null, worktreePath: null, baseRef: null, commitRef: null, commitMessage: null, hint: null, extraAttempts: 0, createdAt: '2026-01-01', updatedAt: '2026-01-01', ...over,
});

describe('dueCheckpoint', () => {
  test('a landed milestone task that was never visited is due; a visited one is not', () => {
    expect(dueCheckpoint([task('t1', { milestone: 'look' }), task('t2', { state: 'pending' })])).toMatchObject({ task: { id: 't1' }, recheck: false });
    expect(dueCheckpoint([task('t1', { milestone: 'look', milestoneVisits: 1 })])).toBeNull();
    expect(dueCheckpoint([task('t1', { milestone: 'look', state: 'running' })])).toBeNull();
    expect(dueCheckpoint([task('t1')])).toBeNull();
  });
  test('a landed feedback fix re-opens its milestone exactly once', () => {
    const m = task('t1', { milestone: 'look', milestoneVisits: 1 });
    const fix = task('f1', { origin: 'feedback-fix', checkpointOf: 't1' });
    expect(dueCheckpoint([m, fix])).toMatchObject({ task: { id: 't1' }, recheck: true });
    expect(dueCheckpoint([{ ...m, milestoneVisits: 2 }, fix])).toBeNull();
    expect(dueCheckpoint([m, { ...fix, state: 'running' }])).toBeNull();
  });
});

describe('hintOnly', () => {
  test('folds fix tasks and decisions into a hint', () => {
    const plan = hintOnly({ kind: 'fix', rationale: 'r', hint: 'keep it', fixTasks: [{ title: 'fix x', spec: 'do x', relevantFiles: [] }], decision: 'no accounts' });
    expect(plan.kind).toBe('hint');
    expect(plan.fixTasks).toEqual([]);
    expect(plan.decision).toBeNull();
    expect(plan.hint).toBe('keep it\nno accounts\nfix x: do x');
  });
});
