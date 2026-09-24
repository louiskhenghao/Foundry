import { describe, expect, test } from 'bun:test';
import { modelFor, metaFor, resolveModel, workerModelFor } from './roles.ts';

const goal = { models: { strong: 'claude-fable-5-1', worker: 'opus', cheap: 'haiku' } };
const cfg = {
  modelRoles: { clarifier: null, planner: 'worker', merger: 'claude-sonnet-5', taskReviewer: null, documenter: null, feedback: null },
  difficultyRoute: { routine: 'cheap', normal: 'worker', hard: 'strong' },
  escalateLastAttempt: true,
};

describe('model roles', () => {
  test('empty = the default tier; a tier name follows the goal; a model id is pinned (no tier, so fallbacks never rewrite a tier)', () => {
    expect(modelFor(cfg, goal, 'clarifier')).toEqual({ model: 'claude-fable-5-1', tier: 'strong' });
    expect(modelFor(cfg, goal, 'taskReviewer')).toEqual({ model: 'haiku', tier: 'cheap' });
    expect(modelFor(cfg, goal, 'planner')).toEqual({ model: 'opus', tier: 'worker' });
    expect(modelFor(cfg, goal, 'merger')).toEqual({ model: 'claude-sonnet-5', tier: null });
    expect(metaFor('g1', { tier: null })).toEqual({ goalId: 'g1' });
    expect(resolveModel(goal, '  ', 'worker')).toEqual({ model: 'opus', tier: 'worker' });
  });
});

describe('worker routing', () => {
  const task = (difficulty: 'routine' | 'normal' | 'hard', retryBudget = 3) => ({ difficulty, retryBudget });
  test('difficulty picks the route', () => {
    expect(workerModelFor(cfg, goal, task('routine'), 1)).toMatchObject({ model: 'haiku', escalated: null });
    expect(workerModelFor(cfg, goal, task('normal'), 1)).toMatchObject({ model: 'opus', escalated: null });
    expect(workerModelFor(cfg, goal, task('hard'), 1)).toMatchObject({ model: 'claude-fable-5-1', escalated: null });
  });
  test('the last attempt of a budget ≥ 2 and human retries run on strong; a budget of 1 never escalates; already-strong stays', () => {
    expect(workerModelFor(cfg, goal, task('normal', 3), 2)).toMatchObject({ model: 'opus', escalated: null });
    expect(workerModelFor(cfg, goal, task('normal', 3), 3)).toMatchObject({ model: 'claude-fable-5-1', tier: 'strong', escalated: 'last-attempt' });
    expect(workerModelFor(cfg, goal, task('normal', 3), 4)).toMatchObject({ model: 'claude-fable-5-1', escalated: 'human-retry' });
    expect(workerModelFor(cfg, goal, task('normal', 1), 1)).toMatchObject({ model: 'opus', escalated: null });
    expect(workerModelFor(cfg, goal, task('normal', 1), 2)).toMatchObject({ model: 'claude-fable-5-1', escalated: 'human-retry' });
    expect(workerModelFor(cfg, goal, task('hard', 3), 3)).toMatchObject({ model: 'claude-fable-5-1', escalated: null });
    expect(workerModelFor({ ...cfg, escalateLastAttempt: false }, goal, task('normal', 3), 3)).toMatchObject({ model: 'opus', escalated: null });
  });
});
