import { describe, expect, test } from 'bun:test';
import { FINAL_WALK, type Goal, type Task } from '@foundry/core';
import { dueCheckpoint, finalLookDue, hintOnly, repairTitle, scriptedMilestones } from './checkpoint.ts';

const task = (id: string, over: Partial<Task> = {}): Task => ({
  id, goalId: 'g', title: id, spec: 's', kind: 'feature', scope: null, scenario: 'general', area: null, tdd: 'inherit', dependsOn: [], relevantFiles: [], parallelizable: true, retryBudget: 3, origin: 'brief',
  milestone: null, milestoneVisits: 0, checkpointOf: null, difficulty: 'standard' as const, state: 'done', branch: null, worktreePath: null, baseRef: null, commitRef: null, commitMessage: null, hint: null, extraAttempts: 0, createdAt: '2026-01-01', updatedAt: '2026-01-01', ...over,
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

describe('the final walkthrough', () => {
  const goal = (finalWalk: Goal['finalWalk'], milestonePause = true) => ({ milestonePause, finalWalk }) as Goal;
  test('runs the scripts of the feature milestones that landed', () => {
    const tasks = [task('t1', { milestone: 'look', milestoneScript: 'e2e/milestones/a.spec.ts' }), task('t2', { milestone: 'look' }), task('t3', { milestone: 'look', milestoneScript: 'e2e/milestones/c.spec.ts', state: 'running' })];
    expect(scriptedMilestones(tasks).map((t) => t.id)).toEqual(['t1']);
  });
  test('pauses for a first look, and once more only after fixes from that look landed', () => {
    expect(finalLookDue(goal({ ranAt: 'x', passed: true, looks: 0 }), [])).toEqual({ recheck: false });
    expect(finalLookDue(goal({ ranAt: null, passed: null, looks: 0 }), [])).toBeNull();
    expect(finalLookDue(goal({ ranAt: 'x', passed: true, looks: 0 }, false), [])).toBeNull();
    expect(finalLookDue(goal({ ranAt: 'x', passed: true, looks: 1 }), [])).toBeNull();
    expect(finalLookDue(goal({ ranAt: 'x', passed: true, looks: 1 }), [task('f1', { checkpointOf: FINAL_WALK })])).toEqual({ recheck: true });
    expect(finalLookDue(goal({ ranAt: 'x', passed: true, looks: 2 }), [task('f1', { checkpointOf: FINAL_WALK })])).toBeNull();
  });
  test("a repair task is named after the feature's script", () => {
    expect(repairTitle(task('t1', { milestoneScript: 'e2e/milestones/user-list.spec.ts' }))).toBe('fix the user-list milestone script');
  });
});
