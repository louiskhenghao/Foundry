import { describe, expect, test } from 'bun:test';
import { depths, topoSort } from './dag.ts';

describe('dag', () => {
  test('topological order respects dependencies', () => {
    const order = topoSort([
      { id: 'T4', dependsOn: ['T2', 'T3'] },
      { id: 'T2', dependsOn: ['T1'] },
      { id: 'T3', dependsOn: ['T1'] },
      { id: 'T1', dependsOn: [] },
      { id: 'T5', dependsOn: ['T4'] },
    ]);
    expect(order.indexOf('T1')).toBeLessThan(order.indexOf('T2'));
    expect(order.indexOf('T3')).toBeLessThan(order.indexOf('T4'));
    expect(order.at(-1)).toBe('T5');
  });
  test('detects cycles and unknown deps', () => {
    expect(() => topoSort([{ id: 'a', dependsOn: ['b'] }, { id: 'b', dependsOn: ['a'] }])).toThrow(/cycle/);
    expect(() => topoSort([{ id: 'a', dependsOn: ['zzz'] }])).toThrow(/unknown/);
  });
  test('depths', () => {
    const d = depths([
      { id: 'T1', dependsOn: [] },
      { id: 'T2', dependsOn: ['T1'] },
      { id: 'T3', dependsOn: ['T1'] },
      { id: 'T4', dependsOn: ['T2', 'T3'] },
    ]);
    expect(d.get('T1')).toBe(0);
    expect(d.get('T4')).toBe(2);
  });
});
