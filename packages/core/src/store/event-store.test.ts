import { describe, expect, test } from 'bun:test';
import { openDatabase } from './db.ts';
import { EventStore } from './event-store.ts';
import { getGoal, getTask, listTasks } from './projections.ts';
import { IDLE_DELIVERY, type Goal, type Task } from '../schema/index.ts';

function goal(id: string): Goal {
  const now = new Date().toISOString();
  return {
    id,
    title: 't',
    prompt: 'p',
    repoPath: '/tmp/x',
    baseBranch: 'main',
    branch: `goal/${id}`,
    budgets: { maxCostUsd: 5, maxDurationMin: 120, maxConcurrent: 3, attemptsPerTask: 3 },
    budgetPreset: 'custom', mode: 'expert', workflow: { tdd: 'required' },
    models: { strong: 'opus', cheap: 'haiku', worker: 'opus' },
    state: 'draft',
    stateBeforeBlock: null,
    costUsd: 0,
    fixCycles: 0,
    delivery: IDLE_DELIVERY,
    attachments: [],
    baseSync: null,
    autoskills: null,
    completion: { graphRefresh: false, docs: [], docsRun: null, graphRun: null, artifactsRun: null },
    nature: 'auto',
    outputDir: null,
    runningSince: null,
    createdAt: now,
    updatedAt: now,
  };
}
function task(id: string, goalId: string): Task {
  const now = new Date().toISOString();
  return {
    id,
    goalId,
    kind: 'feature',
    scope: null,
    scenario: 'general',
    area: null, tdd: 'inherit',
    baseRef: null,
    commitRef: null,
    commitMessage: null,
    title: 'task',
    spec: 'do it',
    dependsOn: [],
    relevantFiles: [],
    parallelizable: true,
    retryBudget: 3,
    origin: 'brief',
    state: 'pending',
    branch: null,
    worktreePath: null,
    hint: null,
    extraAttempts: 0,
    createdAt: now,
    updatedAt: now,
  };
}

describe('EventStore', () => {
  test('append projects and replay reproduces identical read models', () => {
    const store = new EventStore(openDatabase(':memory:'));
    const g = goal('g_1');
    store.append({ type: 'goal.created', goalId: g.id, payload: { goal: g } });
    store.append({ type: 'goal.state_changed', goalId: g.id, payload: { from: 'draft', to: 'clarifying', reason: 'test' } });
    store.append({ type: 'task.created', goalId: g.id, payload: { task: task('t_1', g.id) } });
    store.append({ type: 'task.state_changed', goalId: g.id, payload: { taskId: 't_1', from: 'pending', to: 'ready', reason: 'deps done' } });
    store.append({ type: 'goal.cost_added', goalId: g.id, payload: { costUsd: 0.25, source: 'test' } });

    expect(getGoal(store.db, g.id)?.state).toBe('clarifying');
    expect(getGoal(store.db, g.id)?.costUsd).toBe(0.25);
    expect(getTask(store.db, 't_1')?.state).toBe('ready');
    expect(listTasks(store.db, g.id)).toHaveLength(1);

    const before = store.snapshotReadModels();
    const n = store.replay();
    expect(n).toBe(5);
    expect(store.snapshotReadModels()).toEqual(before);
  });

  test('rejects invalid payloads', () => {
    const store = new EventStore(openDatabase(':memory:'));
    // @ts-expect-error invalid state
    expect(() => store.append({ type: 'goal.state_changed', goalId: 'g', payload: { from: 'draft', to: 'nope', reason: '' } })).toThrow();
  });

  test('notifies listeners after commit', () => {
    const store = new EventStore(openDatabase(':memory:'));
    const seen: string[] = [];
    store.subscribe((e) => seen.push(e.type));
    store.append({ type: 'engine.note', goalId: null, payload: { level: 'info', message: 'hi' } });
    expect(seen).toEqual(['engine.note']);
  });
});
