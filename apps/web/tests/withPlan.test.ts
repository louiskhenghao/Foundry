import { expect, test } from 'bun:test';
import type { Brief } from '@foundry/core/browser';
import { withPlan } from '../src/pages/brief/shared.ts';

const check = (key: string, taskKey: string | null) => ({ key, name: key, tier: 'must', taskKey, areaKey: null, spec: { type: 'command', cmd: 'true', timeoutMs: 1000, expectExitCode: 0 } }) as Brief['checks'][number];
const question = (id: string, text: string, answer: string | null) => ({ id, text, answer, blocking: false, areaKey: null, options: [], kind: 'text', applied: false }) as Brief['questions'][number];

test('the plan fills the edited skeleton: tasks, task checks, estimate and new questions come in; the edits stay', () => {
  const local = { understanding: 'edited meanwhile', tasks: [], checks: [check('G1', null)], costEstimateUsd: 0, timeEstimateMin: 0, questions: [question('q1', 'Which database?', 'Postgres')] } as unknown as Brief;
  const planned = { understanding: 'as the Clarifier wrote it', tasks: [{ key: 'T1' }], checks: [check('G1', null), check('C1', 'T1')], costEstimateUsd: 4, timeEstimateMin: 30, questions: [question('q1', 'Which database?', null), question('q2', 'Area "Admin" has no tasks yet.', null)] } as unknown as Brief;
  const merged = withPlan(local, planned);
  expect(merged.understanding).toBe('edited meanwhile');
  expect(merged.tasks).toEqual([{ key: 'T1' }] as never);
  expect(merged.checks.map((c) => [c.key, c.taskKey])).toEqual([['G1', null], ['C1', 'T1']]);
  expect(merged.costEstimateUsd).toBe(4);
  expect(merged.timeEstimateMin).toBe(30);
  // the answer typed on the page stays; the question the plan added is appended
  expect(merged.questions.map((q) => [q.id, q.answer])).toEqual([['q1', 'Postgres'], ['q2', null]]);
});
