import { describe, expect, test } from 'bun:test';
import { Brief } from '../schema/brief.ts';
import { LARGE_BRIEF_TASKS, areaSlug, briefIsLarge, stagesOf, uncoveredAreas } from './brief-coverage.ts';

const task = (key: string, areaKey: string | null, dependsOnKeys: string[] = []) => ({ key, title: key, spec: '', kind: 'feature' as const, scope: null, scenario: 'general' as const, areaKey, tdd: 'inherit' as const, dependsOnKeys, parallelizable: true, relevantFiles: [] });
const area = (key: string, name: string) => ({ key, name, slug: areaSlug(name), description: '' });

describe('brief coverage', () => {
  test('uncoveredAreas lists areas without a task', () => {
    const areas = [area('A1', 'Student portal'), area('A2', 'Teacher portal'), area('A3', 'Shared')];
    expect(uncoveredAreas({ areas, tasks: [task('T1', 'A1'), task('T2', 'A3')] }).map((a) => a.key)).toEqual(['A2']);
    expect(uncoveredAreas({ areas: [], tasks: [task('T1', null)] })).toEqual([]);
  });

  test('stagesOf groups by longest dependency chain, keeping brief order inside a stage', () => {
    const stages = stagesOf([task('T1', 'A1'), task('T2', 'A1', ['T1']), task('T3', 'A2'), task('T4', 'A2', ['T2', 'T3'])]);
    expect(stages.map((s) => s.map((t) => t.key))).toEqual([['T1', 'T3'], ['T2'], ['T4']]);
    expect(() => stagesOf([task('T1', null, ['T2']), task('T2', null, ['T1'])])).toThrow(/cycle/);
  });

  test('briefIsLarge and areaSlug', () => {
    expect(briefIsLarge({ tasks: Array.from({ length: LARGE_BRIEF_TASKS }, (_, i) => task(`T${i}`, null)) })).toBe(false);
    expect(briefIsLarge({ tasks: Array.from({ length: LARGE_BRIEF_TASKS + 1 }, (_, i) => task(`T${i}`, null)) })).toBe(true);
    expect(areaSlug('Student Portal')).toBe('student-portal');
    expect(areaSlug('教师端', 2)).toBe('area-2');
  });

  test('a pre-Area Brief still parses with defaults', () => {
    const old = Brief.parse({
      goalId: 'g',
      understanding: 'u',
      assumptions: [],
      checks: [{ key: 'C1', name: 'tests', tier: 'must', taskKey: null, spec: { type: 'command', cmd: 'bun test' } }],
      tasks: [{ key: 'T1', title: 't', spec: 's' }],
      costEstimateUsd: 1,
      timeEstimateMin: 5,
      questions: [{ id: 'q1', text: '?' }],
    });
    expect(old.areas).toEqual([]);
    expect(old.tasks[0]!.areaKey).toBeNull();
    expect(old.checks[0]!.areaKey).toBeNull();
    expect(old.questions[0]!.areaKey).toBeNull();
  });
});
