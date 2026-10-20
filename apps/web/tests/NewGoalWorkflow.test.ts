import { expect, test } from 'bun:test';
import { initialWorkflow, updateWorkflow } from '../src/pages/new-goal-workflow.ts';
import type { LastGoalWorkflow } from '../src/api.ts';

const lastGoal: LastGoalWorkflow = { goalId: 'g1', title: '<b>Previous goal</b>', createdAt: '2026-01-01', workflow: { profile: 'pstack', tdd: 'off', ponytail: 'off' } };

test('ready repository prefills untouched fields without protecting automatic choices', () => {
  const changed = new Set<string>(['tdd']);
  let state = updateWorkflow(initialWorkflow(), { type: 'edit', field: 'tdd', value: { tdd: 'preferred' } }, changed);
  state = updateWorkflow(state, { type: 'pending', request: 1 }, changed);
  state = updateWorkflow(state, { type: 'validated', request: 1, ok: true, lastGoal }, changed);
  expect(state.values).toEqual({ profile: 'pstack', tdd: 'preferred', ponytail: 'off' });
  expect(state.inherited).toEqual(['profile', 'ponytail']);
  expect(state.lastGoal?.title).toBe('<b>Previous goal</b>');
  expect([...changed]).toEqual(['tdd']);
});

const defaults = { profile: 'plain', tdd: 'preferred', ponytail: 'on' } satisfies LastGoalWorkflow['workflow'];
const untouched = new Set<string>();
function inherited() {
  let state = updateWorkflow(initialWorkflow(), { type: 'settings', values: defaults }, untouched);
  state = updateWorkflow(state, { type: 'pending', request: 1 }, untouched);
  return updateWorkflow(state, { type: 'validated', request: 1, ok: true, lastGoal }, untouched);
}

test('manual edits remove source provenance one field at a time, even when selecting the inherited value', () => {
  let state = inherited();
  const changed = new Set<string>(['profile']);
  state = updateWorkflow(state, { type: 'edit', field: 'profile', value: { profile: 'pstack' } }, changed);
  expect(state.inherited).toEqual(['tdd', 'ponytail']);
  changed.add('tdd');
  state = updateWorkflow(state, { type: 'edit', field: 'tdd', value: { tdd: 'required' } }, changed);
  expect(state.inherited).toEqual(['ponytail']);
  changed.add('ponytail');
  state = updateWorkflow(state, { type: 'edit', field: 'ponytail', value: { ponytail: 'on' } }, changed);
  expect(state.inherited).toEqual([]);
});

test('pending, invalid, failed and empty-folder validation use the latest Settings fallback and protect human choices', () => {
  let state = inherited();
  const changed = new Set<string>(['tdd']);
  state = updateWorkflow(state, { type: 'edit', field: 'tdd', value: { tdd: 'required' } }, changed);
  state = updateWorkflow(state, { type: 'pending', request: 2 }, changed);
  expect(state.values).toEqual({ ...defaults, tdd: 'required' });
  expect(state.lastGoal).toBeNull();
  expect(state.inherited).toEqual([]);
  state = updateWorkflow(state, { type: 'validated', request: 2, ok: false, lastGoal }, changed);
  expect(state.values).toEqual({ ...defaults, tdd: 'required' });
  state = updateWorkflow(state, { type: 'pending', request: 3 }, changed);
  state = updateWorkflow(state, { type: 'validated', request: 3, ok: false, lastGoal: null }, changed);
  expect(state.lastGoal).toBeNull();
  state = updateWorkflow(state, { type: 'settings', values: { ...defaults, profile: 'mattpocock' } }, changed);
  state = updateWorkflow(state, { type: 'pending', request: 4 }, changed);
  state = updateWorkflow(state, { type: 'validated', request: 4, ok: true, lastGoal: null }, changed);
  expect(state.values).toEqual({ profile: 'mattpocock', tdd: 'required', ponytail: 'on' });
});

test('late Settings refresh only fallback values while repository and manual choices win', () => {
  let state = inherited();
  const changed = new Set<string>(['ponytail']);
  state = updateWorkflow(state, { type: 'edit', field: 'ponytail', value: { ponytail: 'on' } }, changed);
  state = updateWorkflow(state, { type: 'settings', values: defaults }, changed);
  expect(state.values).toEqual({ ...lastGoal.workflow, ponytail: 'on' });
  expect(state.defaults).toEqual(defaults);
  state = updateWorkflow(state, { type: 'pending', request: 2 }, changed);
  expect(state.values).toEqual(defaults);
});

test('revalidation refreshes the same folder and obsolete responses cannot replace it', () => {
  let state = inherited();
  state = updateWorkflow(state, { type: 'pending', request: 2 }, untouched);
  state = updateWorkflow(state, { type: 'pending', request: 3 }, untouched);
  const newer = { ...lastGoal, title: 'Newer goal', workflow: defaults };
  state = updateWorkflow(state, { type: 'validated', request: 3, ok: true, lastGoal: newer }, untouched);
  const winner = state;
  state = updateWorkflow(state, { type: 'validated', request: 2, ok: true, lastGoal }, untouched);
  expect(state).toBe(winner);
  expect(state.values).toEqual(defaults);
  expect(state.lastGoal?.title).toBe('Newer goal');
});

test('Follow-up wins over folder inheritance and Settings, without adding human edits', () => {
  let state = inherited();
  state = updateWorkflow(state, { type: 'follow-up', values: defaults }, untouched);
  state = updateWorkflow(state, { type: 'settings', values: lastGoal.workflow }, untouched);
  state = updateWorkflow(state, { type: 'pending', request: 2 }, untouched);
  state = updateWorkflow(state, { type: 'validated', request: 2, ok: true, lastGoal }, untouched);
  expect(state.values).toEqual(defaults);
  expect(state.inherited).toEqual([]);
  expect(state.lastGoal).toBeNull();
  expect(untouched.size).toBe(0);
});

test('manual changes after a Follow-up survive delayed Settings and folder revalidation', () => {
  const changed = new Set<string>();
  let state = updateWorkflow(inherited(), { type: 'follow-up', values: defaults }, changed);
  changed.add('profile');
  state = updateWorkflow(state, { type: 'edit', field: 'profile', value: { profile: 'mattpocock' } }, changed);
  changed.add('tdd');
  state = updateWorkflow(state, { type: 'edit', field: 'tdd', value: { tdd: 'required' } }, changed);
  changed.add('ponytail');
  state = updateWorkflow(state, { type: 'edit', field: 'ponytail', value: { ponytail: 'off' } }, changed);
  state = updateWorkflow(state, { type: 'settings', values: defaults }, changed);
  state = updateWorkflow(state, { type: 'pending', request: 2 }, changed);
  state = updateWorkflow(state, { type: 'validated', request: 2, ok: true, lastGoal }, changed);
  expect(state.values).toEqual({ profile: 'mattpocock', tdd: 'required', ponytail: 'off' });
  expect(state.inherited).toEqual([]);
  expect(state.lastGoal).toBeNull();
});

test('a delayed Follow-up preserves edited TDD and Ponytail while keeping Follow-up profile precedence', () => {
  const changed = new Set<string>(['profile', 'tdd', 'ponytail']);
  let state = updateWorkflow(initialWorkflow(), { type: 'edit', field: 'profile', value: { profile: 'plain' } }, changed);
  state = updateWorkflow(state, { type: 'edit', field: 'tdd', value: { tdd: 'preferred' } }, changed);
  state = updateWorkflow(state, { type: 'edit', field: 'ponytail', value: { ponytail: 'on' } }, changed);
  state = updateWorkflow(state, { type: 'follow-up', values: lastGoal.workflow }, changed);
  expect(state.values).toEqual({ profile: 'pstack', tdd: 'preferred', ponytail: 'on' });
  expect(state.inherited).toEqual([]);
  expect(state.lastGoal).toBeNull();
  state = updateWorkflow(state, { type: 'settings', values: defaults }, changed);
  state = updateWorkflow(state, { type: 'pending', request: 1 }, changed);
  state = updateWorkflow(state, { type: 'validated', request: 1, ok: true, lastGoal }, changed);
  expect(state.values).toEqual({ profile: 'pstack', tdd: 'preferred', ponytail: 'on' });
});
