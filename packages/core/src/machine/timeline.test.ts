import { describe, expect, test } from 'bun:test';
import type { EngineEvent } from '../events.ts';
import { buildTimeline, type TimelineInput } from './timeline.ts';

/** minutes after 10:00 as a timestamp */
const at = (min: number) => new Date(Date.UTC(2026, 9, 18, 10, 0, 0) + min * 60_000).toISOString();
let n = 0;
const ev = (goalId: string, min: number, type: string, payload: object) => ({ id: `e${++n}`, ts: at(min), goalId, type, payload }) as EngineEvent;
const state = (goalId: string, min: number, from: string, to: string, reason = '') => ev(goalId, min, 'goal.state_changed', { from, to, reason });
const usage = (goalId: string, min: number, kind: string, minutes: number, costUsd = 0.5) => ev(goalId, min, 'session.usage', { sessionId: null, kind, model: null, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreateTokens: 0, costUsd, durationMs: minutes * 60_000, subtype: 'success', rateLimit: null, skillsUsed: [] });
const attempt = (goalId: string, min: number, id: string, taskId: string, index = 1) => ev(goalId, min, 'attempt.started', { attempt: { id, goalId, taskId, index, kind: 'work', sessionId: null, state: 'running', startedAt: at(min), endedAt: null } });
const session = (goalId: string, attemptId: string, role: 'worker' | 'reviewer' | 'merger', from: number, to: number, costUsd = 1) => ev(goalId, to, 'attempt.session_finished', { attemptId, session: { role, segment: 0, sessionId: null, model: 'opus', costUsd, numTurns: 9, durationMs: (to - from) * 60_000, subtype: 'success', startedAt: at(from), endedAt: at(to) } });

/** a goal: interview, Brief, two tasks (the second done by a Delegated goal), review, delivery */
const main: TimelineInput = {
  goal: { id: 'g1', title: 'Showcase site', createdAt: at(0), state: 'done' },
  tasks: [{ id: 't1', title: 'scaffold the site', delegatedGoalId: null }, { id: 't2', title: 'research the subject', delegatedGoalId: 'g2' }],
  events: [
    state('g1', 0, 'draft', 'clarifying'),
    ev('g1', 2, 'interview.round_asked', { round: 1, sessionId: null, questions: [] }),
    ev('g1', 12, 'interview.round_answered', { round: 1, answers: {}, finish: false }),
    usage('g1', 16, 'clarify', 4, 2),
    state('g1', 16, 'clarifying', 'awaiting_brief_approval', 'brief proposed'),
    state('g1', 20, 'awaiting_brief_approval', 'running', 'brief approved'),
    attempt('g1', 21, 'a1', 't1'),
    session('g1', 'a1', 'worker', 21, 31),
    session('g1', 'a1', 'reviewer', 31, 33, 0.2),
    ev('g1', 33, 'attempt.concluded', { attemptId: 'a1', state: 'passed', reason: '' }),
    ev('g1', 33, 'merge.started', { taskId: 't1', into: 'goal' }),
    ev('g1', 34, 'merge.completed', { taskId: 't1', ref: 'abc' }),
    ev('g1', 34, 'task.delegated', { taskId: 't2', goalId: 'g2', title: 'research the subject' }),
    state('g1', 40, 'running', 'blocked', 'the delegated goal "research the subject" waits for you to approve its Brief'),
    state('g1', 45, 'blocked', 'running', 'the delegated goal goes on'),
    ev('g1', 74, 'task.state_changed', { taskId: 't2', from: 'running', to: 'done', reason: 'landed' }),
    state('g1', 75, 'running', 'goal_review'),
    usage('g1', 85, 'review-goal', 10, 1.5),
    usage('g1', 86, 'distill', 1, 0.01),
    ev('g1', 86, 'delivery.started', { policy: {}, plan: [] }),
    ev('g1', 90, 'delivery.completed', { outcome: {} }),
    state('g1', 90, 'goal_review', 'done'),
  ],
};
const child: TimelineInput = {
  goal: { id: 'g2', title: 'research the subject', createdAt: at(34), state: 'done' },
  tasks: [{ id: 't3', title: 'write the report', delegatedGoalId: null }],
  events: [
    state('g2', 34, 'draft', 'clarifying'),
    usage('g2', 39, 'clarify', 5),
    state('g2', 39, 'clarifying', 'awaiting_brief_approval'),
    state('g2', 45, 'awaiting_brief_approval', 'running'),
    attempt('g2', 45, 'a3', 't3'),
    session('g2', 'a3', 'worker', 45, 70),
    ev('g2', 70, 'attempt.concluded', { attemptId: 'a3', state: 'passed', reason: '' }),
    state('g2', 72, 'running', 'done'),
  ],
};

describe('a goal timeline', () => {
  const t = buildTimeline(main, [child], at(200));

  test('rows: the goal, its sessions, each task, and a Delegated goal right under the task it does', () => {
    expect(t.rows.map((r) => [r.level, r.kind, r.label])).toEqual([
      [0, 'goal', 'Showcase site'],
      [1, 'sessions', 'Clarify, reviews and other sessions'],
      [1, 'task', 'scaffold the site'],
      [1, 'task', 'research the subject'],
      [1, 'delegated', 'Delegated goal: research the subject'],
      [2, 'sessions', 'Clarify, reviews and other sessions'],
      [2, 'task', 'write the report'],
    ]);
    expect([t.start, t.end, t.live]).toEqual([at(0), at(90), false]);
  });

  test("the goal's phases, with the interview's open round cut out of Clarify as a wait, and the delivery", () => {
    expect(t.rows[0]!.spans.map((s) => [s.kind, s.label, s.start, s.end])).toEqual([
      ['clarify', 'Clarify', at(0), at(2)],
      ['waiting', 'Interview round 1 waits for you', at(2), at(12)],
      ['clarify', 'Clarify', at(12), at(16)],
      ['waiting', 'The Brief waits for you', at(16), at(20)],
      ['run', 'Running', at(20), at(40)],
      ['waiting', 'Blocked: the delegated goal "research the subject" waits for you to approve its Brief', at(40), at(45)],
      ['run', 'Running', at(45), at(75)],
      ['review', 'Goal review', at(75), at(90)],
      ['delivery', 'Delivery', at(86), at(90)],
    ]);
  });

  test("Foundry's own sessions, without the tasks' and the tiny ones; a task's attempt, its review and its landing", () => {
    expect(t.rows[1]!.spans.map((s) => [s.kind, s.label, s.start, s.end])).toEqual([
      ['clarify', 'Clarify', at(12), at(16)],
      ['review', 'Goal review', at(75), at(85)],
    ]);
    expect(t.rows[2]!.spans.map((s) => [s.kind, s.label, s.start, s.end])).toEqual([
      ['work', 'Attempt 1', at(21), at(31)],
      ['review', 'Review of attempt 1', at(31), at(33)],
      ['merge', 'Landing', at(33), at(34)],
    ]);
    // the delegated task's bar is its goal's whole run, and its row knows that goal
    expect(t.rows[3]!.spans).toEqual([{ kind: 'run', label: 'Delegated goal: research the subject', start: at(34), end: at(74) }]);
    expect(t.rows[3]!.delegatedGoalId).toBe('g2');
    expect(t.rows[2]!.delegatedGoalId).toBeUndefined();
  });

  test('where the time went, waits counted once, and the longest steps', () => {
    expect(t.totals).toEqual({
      wall: 90 * 60_000,
      // the interview (10m), the Brief (4m), the main goal blocked (40–45) and the Delegated goal's Brief (39–45), overlapping
      waiting: (10 + 4 + 6) * 60_000,
      clarify: (4 + 5) * 60_000,
      work: (10 + 25) * 60_000,
      review: (2 + 10) * 60_000,
      merge: 1 * 60_000,
      delivery: 4 * 60_000,
      other: 0,
    });
    expect(t.longest.slice(0, 3).map((l) => [l.row, l.span.label, l.ms / 60_000])).toEqual([
      ['research the subject', 'Delegated goal: research the subject', 40],
      ['write the report', 'Attempt 1', 25],
      ['Showcase site', 'Goal review', 15],
    ]);
  });

  test('a delivery after the goal is done is on its row, and the timeline ends with it; one still going ends now', () => {
    const delivered: TimelineInput = { ...main, events: [...main.events.filter((e) => !e.type.startsWith('delivery.')), ev('g1', 91, 'delivery.started', { policy: {}, plan: [] }), ev('g1', 99, 'delivery.completed', { outcome: {} })] };
    const d = buildTimeline(delivered, [child], at(200));
    expect([d.end, d.live, d.totals.wall, d.totals.delivery]).toEqual([at(99), false, 99 * 60_000, 8 * 60_000]);
    expect(d.rows[0]!.spans.at(-1)).toEqual({ kind: 'delivery', label: 'Delivery', start: at(91), end: at(99) });
    const going = buildTimeline({ ...delivered, events: delivered.events.filter((e) => e.type !== 'delivery.completed') }, [child], at(95));
    expect([going.end, going.live]).toEqual([at(95), true]);
    expect(going.rows[0]!.spans.at(-1)).toEqual({ kind: 'delivery', label: 'Delivery', start: at(91), end: at(95), open: true });
  });

  test('a goal still working ends now: its open attempt and its phase run to now', () => {
    const working: TimelineInput = { ...main, goal: { ...main.goal, state: 'running' }, events: main.events.filter((e) => e.ts <= at(21)) };
    const w = buildTimeline(working, [], at(30));
    expect([w.end, w.live]).toEqual([at(30), true]);
    expect(w.rows[0]!.spans.at(-1)).toEqual({ kind: 'run', label: 'Running', start: at(20), end: at(30), open: true });
    expect(w.rows.find((r) => r.taskId === 't1')!.spans).toEqual([{ kind: 'work', label: 'Attempt 1', start: at(21), end: at(30), open: true }]);
  });
});
