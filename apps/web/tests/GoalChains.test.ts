import { describe, expect, test } from 'bun:test';
import type { GoalRow } from '../src/api.ts';
import { listEntries, memberRole, type ListEntry } from '../src/pages/goal-chains.ts';

const goal = (id: string, day: number, follows: string | null = null) =>
  ({ id, title: `goal ${id}`, createdAt: `2026-10-${String(day).padStart(2, '0')}T10:00:00Z`, follows: follows ? { goalId: follows, title: `goal ${follows}`, via: 'created', startFrom: 'base', branch: null, context: '' } : null }) as unknown as GoalRow;
// what the list shows: a single goal by its id, a chain as its members' ids
const shape = (entries: ListEntry[]) => entries.map((e) => (e.kind === 'goal' ? e.goal.id : e.chain.members.map((m) => m.id)));

describe('the Goals list groups follow-ups', () => {
  test('a goal and its follow-ups are one entry, oldest first, placed where its newest goal is', () => {
    // newest first, as the API lists them
    const entries = listEntries([goal('D', 9), goal('C', 8, 'B'), goal('B', 5, 'A'), goal('E', 4), goal('A', 2)]);
    expect(shape(entries)).toEqual(['D', ['A', 'B', 'C'], 'E']);
    const chain = entries[1]!.kind === 'chain' ? entries[1]!.chain : null;
    expect(chain).toMatchObject({ id: 'A', root: { id: 'A' }, latest: { id: 'C' } });
  });

  test('a follow-up whose earlier goal is gone stays on its own, or starts the chain of its follow-ups', () => {
    expect(shape(listEntries([goal('B', 5, 'gone')]))).toEqual(['B']);
    expect(shape(listEntries([goal('C', 8, 'B'), goal('B', 5, 'gone')]))).toEqual([['B', 'C']]);
  });

  test('two follow-ups of one goal both sit in its chain, each after the goal it follows', () => {
    const entries = listEntries([goal('B2', 7, 'A'), goal('C', 6, 'B1'), goal('B1', 4, 'A'), goal('A', 2)]);
    expect(shape(entries)).toEqual([['A', 'B1', 'C', 'B2']]);
    expect(entries[0]!.kind === 'chain' && entries[0]!.chain.latest.id).toBe('B2');
  });

  test('a cycle of follows links never lists a goal twice or loses one', () => {
    const ids = shape(listEntries([goal('B', 5, 'A'), goal('A', 2, 'B'), goal('C', 1)])).flat();
    expect(ids.sort()).toEqual(['A', 'B', 'C']);
  });
});

describe('memberRole: what a step of a chain is to the chain', () => {
  test('the first goal, a follow-up, and one that took over tasks', () => {
    const carrying = (n: number) => ({ ...goal('b', 2, 'a'), follows: { ...goal('b', 2, 'a').follows!, carried: Array.from({ length: n }, (_, i) => `t${i}`) } }) as GoalRow;
    expect(memberRole(goal('a', 1), 0)).toBe('Original');
    expect(memberRole(goal('b', 2, 'a'), 1)).toBe('Follow-up');
    expect(memberRole(carrying(1), 1)).toBe('Carried over 1 task');
    expect(memberRole(carrying(3), 2)).toBe('Carried over 3 tasks');
    // a first goal in this list that follows a deleted one is still where the chain starts
    expect(memberRole(carrying(3), 0)).toBe('Original');
  });
});
