import { describe, expect, test } from 'bun:test';
import type { GoalRow } from '../src/api.ts';
import { countMarks, stageMarks, taskMark } from '../src/components/progress.tsx';
import { boardOf, needOf } from '../src/pages/goal-boards.ts';
import { waited } from '../src/ui.tsx';
import { listEntries } from '../src/pages/goal-chains.ts';

const goal = (patch: Partial<GoalRow> & { id: string }) =>
  ({ title: `goal ${patch.id}`, state: 'running', openEscalations: 0, interview: null, follows: null, createdAt: '2026-10-20T10:00:00Z', updatedAt: '2026-10-20T10:00:00Z', taskCounts: {}, delivery: { status: 'idle', policy: { mode: 'pr' } }, ...patch }) as unknown as GoalRow;

describe('what waits for you hangs as a sign', () => {
  test('each kind of wait names its action and where it is done', () => {
    expect(needOf(goal({ id: 'a', state: 'awaiting_brief_approval' }))).toMatchObject({ action: 'Review brief', href: '/goals/a/brief' });
    expect(needOf(goal({ id: 'b', state: 'clarifying', interview: { status: 'awaiting_answers' } as GoalRow['interview'] }))).toMatchObject({ action: 'Answer questions', href: '/goals/b' });
    expect(needOf(goal({ id: 'c', state: 'awaiting_feedback' }))).toMatchObject({ action: 'Have a look', href: '/goals/c' });
    expect(needOf(goal({ id: 'd', openEscalations: 2 }))).toMatchObject({ action: 'Open Inbox', href: '/inbox', say: expect.stringContaining('2 things') });
    expect(needOf(goal({ id: 'e', state: 'blocked' }))).toMatchObject({ action: 'See why' });
  });
  test('a goal at work, or one clarifying on its own, needs nothing', () => {
    expect(needOf(goal({ id: 'a' }))).toBeNull();
    expect(needOf(goal({ id: 'b', state: 'clarifying', interview: { status: 'thinking' } as GoalRow['interview'] }))).toBeNull();
    expect(needOf(goal({ id: 'c', state: 'done' }))).toBeNull();
  });
  test('a single goal that waits is a sign, not a row; a chain stays on the board of its newest goal', () => {
    const [waiting, working, finished] = listEntries([goal({ id: 'w', state: 'awaiting_feedback' }), goal({ id: 'r' }), goal({ id: 'f', state: 'failed' })]);
    expect([boardOf(waiting!), boardOf(working!), boardOf(finished!)]).toEqual(['sign', 'working', 'finished']);
    const chain = listEntries([goal({ id: 'B', state: 'awaiting_brief_approval', follows: { goalId: 'A' } as GoalRow['follows'], createdAt: '2026-10-21T10:00:00Z' }), goal({ id: 'A', state: 'done' })]);
    expect(chain).toHaveLength(1);
    expect(boardOf(chain[0]!)).toBe('working');
  });
  test('how long it has waited, in the fewest words', () => {
    const now = Date.parse('2026-10-20T12:00:00Z');
    expect(waited('2026-10-20T11:59:20Z', now)).toBe('40 s');
    expect(waited('2026-10-20T11:53:00Z', now)).toBe('7 min');
    expect(waited('2026-10-20T09:00:00Z', now)).toBe('3 h');
    expect(waited('2026-10-18T09:00:00Z', now)).toBe('2 d');
  });
});

describe('the five stages and the task squares', () => {
  const at = (state: GoalRow['state'], patch: Partial<GoalRow> = {}, hasTasks = true) => stageMarks(goal({ id: 'g', state, ...patch }), hasTasks);
  test('each state stands on its stage: under way hatched, waiting on you yellow', () => {
    expect(at('clarifying')).toEqual(['run', 'next', 'next', 'next', 'next']);
    expect(at('awaiting_brief_approval')).toEqual(['done', 'you', 'next', 'next', 'next']);
    expect(at('running')).toEqual(['done', 'done', 'run', 'next', 'next']);
    expect(at('awaiting_feedback')).toEqual(['done', 'done', 'you', 'next', 'next']);
    expect(at('goal_review')).toEqual(['done', 'done', 'done', 'run', 'next']);
  });
  test('a finished goal is delivered, being delivered, or kept on its branch when it delivers locally', () => {
    expect(at('done', { delivery: { status: 'running', policy: { mode: 'pr' } } as GoalRow['delivery'] })).toEqual(['done', 'done', 'done', 'done', 'run']);
    expect(at('done', { delivery: { status: 'failed', policy: { mode: 'pr' } } as GoalRow['delivery'] })).toEqual(['done', 'done', 'done', 'done', 'bad']);
    expect(at('over_delivered', { delivery: { status: 'idle', policy: { mode: 'local' } } as GoalRow['delivery'] })).toEqual(['done', 'done', 'done', 'done', 'done']);
  });
  test('a failed goal is red where it stopped, the stages after it faint', () => {
    expect(at('failed')).toEqual(['done', 'done', 'bad', 'off', 'off']);
    expect(at('failed', {}, false)).toEqual(['bad', 'off', 'off', 'off', 'off']);
  });
  test('task squares: finished first, then under way, waiting, failed and not started', () => {
    expect(countMarks({ pending: 1, done: 2, running: 1, blocked: 1, failed: 1 })).toEqual(['done', 'done', 'run', 'you', 'bad', 'next']);
    expect(['merging', 'observing', 'ready', 'skipped'].map((s) => taskMark(s as never))).toEqual(['run', 'run', 'next', 'off']);
  });
});
