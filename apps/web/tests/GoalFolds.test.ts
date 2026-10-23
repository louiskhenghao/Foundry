import { describe, expect, test } from 'bun:test';
import type { GoalRow } from '../src/api.ts';
import { foldable, listEntries } from '../src/pages/goal-chains.ts';

const goal = (id: string, day: number, follows: string | null = null) =>
  ({ id, title: `goal ${id}`, createdAt: `2026-10-${String(day).padStart(2, '0')}T10:00:00Z`, follows: follows ? { goalId: follows, title: `goal ${follows}` } : null, delegatedFrom: null }) as unknown as GoalRow;

describe('the Goals list folds', () => {
  test('expand all and collapse all reach every fold: the chains of follow-ups and the Delegated goals', () => {
    const entries = listEntries([goal('C', 8, 'B'), goal('B', 5, 'A'), goal('A', 2), goal('M', 1)]);
    const children = new Map<string, GoalRow[]>([['M', [goal('D', 3)]]]);
    expect(foldable(entries, children)).toEqual({ chains: ['A'], parents: ['M'] });
  });
});
