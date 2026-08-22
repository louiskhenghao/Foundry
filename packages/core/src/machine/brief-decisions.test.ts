import { describe, expect, test } from 'bun:test';
import type { Brief } from '../schema/brief.ts';
import { decisionsOf, diffBrief, diffIsEmpty, markDecisionsApplied, pendingDecisions, renderDecisions } from './brief-decisions.ts';

const task = (key: string, spec = 's', deps: string[] = []) => ({ key, title: key, spec, kind: 'feature' as const, scope: null, scenario: 'general' as const, areaKey: null, tdd: 'inherit' as const, dependsOnKeys: deps, parallelizable: true, relevantFiles: [] });
const check = (key: string, taskKey: string | null, cmd = 'true') => ({ key, name: key, tier: 'must' as const, taskKey, areaKey: null, spec: { type: 'command' as const, cmd, timeoutMs: 1, expectExitCode: 0 } });
const brief = (over: Partial<Omit<Brief, 'goalId'>> = {}): Omit<Brief, 'goalId'> => ({ title: 't', understanding: 'u', areas: [], assumptions: [], checks: [], tasks: [], costEstimateUsd: 1, timeEstimateMin: 1, questions: [], ...over });

describe('decisions', () => {
  const b = brief({
    questions: [
      { id: 'q1', text: 'Which DB?', answer: 'sqlite', blocking: true, areaKey: null, applied: false },
      { id: 'q2', text: 'unanswered', answer: '  ', blocking: false, areaKey: null, applied: false },
    ],
    assumptions: [
      { id: 'a1', text: 'teachers too', accepted: false, applied: false },
      { id: 'a2', text: 'kept', accepted: true, applied: false },
    ],
  });
  test('decisionsOf / pending / render / markApplied', () => {
    expect(decisionsOf(b).map((d) => [d.kind, d.id])).toEqual([
      ['answer', 'q1'],
      ['rejected-assumption', 'a1'],
    ]);
    expect(pendingDecisions(b)).toHaveLength(2);
    const text = renderDecisions(b);
    expect(text).toContain('# Decisions from the human');
    expect(text).toContain('Q: Which DB?\n  A: sqlite');
    expect(text).toContain('Rejected assumption (do NOT proceed on it): teachers too');
    expect(renderDecisions(brief())).toBe('');
    const applied = markDecisionsApplied(b);
    expect(pendingDecisions(applied)).toHaveLength(0);
    expect(applied.questions[1]!.applied).toBe(false);
    expect(applied.assumptions[1]!.applied).toBe(false);
  });
});

describe('diffBrief', () => {
  test('keys are the contract: changed / added / removed, plus understanding and new assumptions', () => {
    const cur = brief({ tasks: [task('T1'), task('T2', 'old'), task('T3')], checks: [check('C1', 'T1'), check('C2', 'T3')], assumptions: [{ id: 'a1', text: 'x', accepted: true, applied: false }] });
    const rev = brief({ understanding: 'u2', tasks: [task('T1'), task('T2', 'new', ['T1']), task('T4')], checks: [check('C1', 'T1', 'bun test'), check('C3', 'T4')], assumptions: [{ id: 'zz', text: 'x', accepted: true, applied: false }, { id: 'zy', text: 'y', accepted: true, applied: false }] });
    const d = diffBrief(cur, rev);
    expect(d.tasks.added.map((t) => t.key)).toEqual(['T4']);
    expect(d.tasks.removed.map((t) => t.key)).toEqual(['T3']);
    expect(d.tasks.changed.map((c) => [c.key, c.fields.map((f) => f.field)])).toEqual([['T2', ['spec', 'dependsOnKeys']]]);
    expect(d.checks.changed[0]!.fields[0]).toMatchObject({ field: 'spec' });
    expect(d.checks.removed.map((c) => c.key)).toEqual(['C2']);
    expect(d.checks.added.map((c) => c.key)).toEqual(['C3']);
    expect(d.understanding).toEqual({ before: 'u', after: 'u2' });
    expect(d.newAssumptions).toEqual(['y']);
    expect(diffIsEmpty(d)).toBe(false);
    expect(diffIsEmpty(diffBrief(cur, cur))).toBe(true);
  });
});
