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
    workspaceDir: null,
    checkpoint: null,
    selfCheck: false, previewRef: null, previewPlace: 'auto', milestonePause: true, clarifyStage: null,
    interview: null,
    effort: null, modelPreset: null, modelSubstitutions: {},
    repoPath: '/tmp/x',
    baseBranch: 'main',
    branch: `goal/${id}`,
    budgets: { maxCostUsd: 5, maxDurationMin: 120, maxConcurrent: 3, attemptsPerTask: 3 },
    budgetPreset: 'custom', mode: 'expert', workflow: { tdd: 'required', pace: 'thorough' },
    models: { strong: 'opus', cheap: 'haiku', worker: 'opus' },
    state: 'draft',
    stateBeforeBlock: null,
    costUsd: 0,
    fixCycles: 0,
    delivery: IDLE_DELIVERY,
    attachments: [],
    baseSync: null,
    autoskills: null, follows: null,
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
    milestone: null,
    milestoneVisits: 0,
    checkpointOf: null, difficulty: 'standard' as const,
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

  test("the Clarify step is kept while a session runs and cleared when a new one begins or the Brief is out", () => {
    const store = new EventStore(openDatabase(':memory:'));
    const g = { ...goal('g_2'), interview: { mode: 'auto' as const, depth: 5, status: 'awaiting_answers' as const, sessionId: 's', rounds: [{ round: 1, questions: [], answers: null, askedAt: '2026-01-01', answeredAt: null, finish: false }] } };
    store.append({ type: 'goal.created', goalId: g.id, payload: { goal: g } });
    store.append({ type: 'clarify.stage', goalId: g.id, payload: { stage: 'planning' } });
    expect(getGoal(store.db, g.id)?.clarifyStage?.stage).toBe('planning');
    store.append({ type: 'interview.round_answered', goalId: g.id, payload: { round: 1, answers: {}, finish: false } });
    expect(getGoal(store.db, g.id)?.clarifyStage).toBeNull();
    store.append({ type: 'clarify.stage', goalId: g.id, payload: { stage: 'clarifying' } });
    store.append({ type: 'goal.reclarified', goalId: g.id, payload: { reason: 'test', decisions: '', workspaceRebuilt: false } });
    expect(getGoal(store.db, g.id)?.clarifyStage).toBeNull();
    // a fresh Clarify keeps how deep the goal asked to be interviewed
    expect(getGoal(store.db, g.id)?.interview).toMatchObject({ depth: 5, rounds: [], sessionId: null });
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

describe('listByGoalOfTypes', () => {
  test('finds a goal\'s events of the given types however many came after them', () => {
    const store = new EventStore(openDatabase(':memory:'));
    const g = goal('g_types');
    store.append({ type: 'goal.created', goalId: g.id, payload: { goal: g } });
    store.append({ type: 'task.created', goalId: g.id, payload: { task: task('t_1', g.id) } });
    store.append({ type: 'goal.milestone_passed', goalId: g.id, payload: { taskId: 't_1', lookFor: 'the page' } });
    for (let i = 0; i < 400; i++) store.append({ type: 'clarify.stage', goalId: g.id, payload: { stage: 'planning' } });
    expect(store.listByGoal(g.id, 300).some((e) => e.type === 'goal.milestone_passed')).toBe(false);
    expect(store.listByGoalOfTypes(g.id, ['goal.milestone_passed', 'goal.checkpoint_opened']).map((e) => e.type)).toEqual(['goal.milestone_passed']);
    expect(store.listByGoalOfTypes('g_other', ['goal.milestone_passed'])).toEqual([]);
    expect(store.listByGoalOfTypes(g.id, [])).toEqual([]);
  });
});
