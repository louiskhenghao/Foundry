import { describe, expect, test } from 'bun:test';
import type { Task } from '@foundry/core';
import { downstreamUnstarted, revisionChanges } from './replan.ts';

const task = (id: string, over: Partial<Task> = {}): Task => ({
  id, goalId: 'g', title: id, spec: `spec of ${id}`, kind: 'feature', scope: null, scenario: 'general', area: null, tdd: 'inherit', dependsOn: [], relevantFiles: [], parallelizable: true, retryBudget: 3, origin: 'brief',
  milestone: null, milestoneVisits: 0, checkpointOf: null, difficulty: 'standard', state: 'pending', branch: null, worktreePath: null, baseRef: null, commitRef: null, commitMessage: null, hint: null, extraAttempts: 0, delegatedGoalId: null, summary: null, createdAt: 't', updatedAt: 't', ...over,
});

describe('Replan', () => {
  test('only the tasks after the landed one that have not started are touched: transitively, pending or ready, no session on them', () => {
    const tasks = [task('landed', { state: 'merging' }), task('a', { dependsOn: ['landed'] }), task('b', { dependsOn: ['a'], state: 'ready' }), task('c', { dependsOn: ['landed'], state: 'running' }), task('d', { dependsOn: ['c'] }), task('other')];
    const picked = downstreamUnstarted(tasks, { id: 'landed' }, (id) => id === 'b');
    expect(picked.map((t) => t.id)).toEqual(['a', 'd']);
  });

  test('a revision records what differs from the task as it is, and nothing when the planner returned it unchanged', () => {
    const t = task('a', { relevantFiles: ['src/a.ts'], delivers: ['docs/a.md'] });
    expect(revisionChanges(t, { taskId: 'a', spec: 'spec of a', relevantFiles: ['src/a.ts'], delivers: ['docs/a.md'], why: '' })).toBeNull();
    expect(revisionChanges(t, { taskId: 'a', spec: ' spec of a ', relevantFiles: null, delivers: null, why: '' })).toBeNull();
    expect(revisionChanges(t, { taskId: 'a', spec: '', relevantFiles: ['x'], delivers: null, why: '' })).toBeNull();
    expect(revisionChanges(t, { taskId: 'a', spec: 'read docs/b.md instead', relevantFiles: null, delivers: null, why: '' })).toEqual({ spec: 'read docs/b.md instead', relevantFiles: null, delivers: null });
    // the lists come whole: a changed one is recorded, an equal one is kept as null, a bad Deliverable is dropped
    expect(revisionChanges(t, { taskId: 'a', spec: 'spec of a', relevantFiles: ['src/a.ts', 'docs/b.md'], delivers: ['docs/a.md', '../nope'], why: '' })).toEqual({ spec: 'spec of a', relevantFiles: ['src/a.ts', 'docs/b.md'], delivers: null });
  });
});
