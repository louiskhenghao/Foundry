import { expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { GoalTimeline } from '@foundry/core/browser';
import { TimelineView, axisMarks, axisScale, axisSegments, fmtDur } from '../src/pages/goal/TimelineTab.tsx';

const at = (min: number) => new Date(Date.UTC(2026, 9, 18, 10, 0, 0) + min * 60_000).toISOString();
const t: GoalTimeline = {
  goalId: 'g1',
  start: at(0),
  end: at(100),
  live: false,
  rows: [
    { id: 'goal:g1', label: 'Showcase site', level: 0, kind: 'goal', goalId: 'g1', taskId: null, spans: [{ kind: 'clarify', label: 'Clarify', start: at(0), end: at(10) }, { kind: 'waiting', label: 'The Brief waits for you', start: at(10), end: at(20) }, { kind: 'run', label: 'Running', start: at(20), end: at(100) }] },
    { id: 'task:t1', label: 'research the subject', level: 1, kind: 'task', goalId: 'g1', taskId: 't1', spans: [{ kind: 'run', label: 'Delegated goal: research the subject', start: at(20), end: at(60) }] },
    { id: 'goal:g2', label: 'Delegated goal: research the subject', level: 1, kind: 'delegated', goalId: 'g2', taskId: null, spans: [] },
    { id: 'task:t2', label: 'build the model', level: 1, kind: 'task', goalId: 'g1', taskId: 't2', spans: [{ kind: 'work', label: 'Attempt 1', start: at(60), end: at(85), costUsd: 1.25 }] },
  ],
  totals: { wall: 100 * 60_000, waiting: 10 * 60_000, clarify: 6 * 60_000, work: 25 * 60_000, review: 0, merge: 0, delivery: 0, other: 0 },
  longest: [{ row: 'research the subject', span: { kind: 'run', label: 'Delegated goal: research the subject', start: at(20), end: at(60) }, ms: 40 * 60_000 }, { row: 'build the model', span: { kind: 'work', label: 'Attempt 1', start: at(60), end: at(85) }, ms: 25 * 60_000 }],
};

test('durations and the axis read the way a person says them', () => {
  expect([fmtDur(40_000), fmtDur(12 * 60_000), fmtDur(65 * 60_000)]).toEqual(['40s', '12m', '1h 05m']);
  expect(axisMarks(100 * 60_000)).toEqual([0, 15, 30, 45, 60, 75, 90]);
  expect(axisMarks(5 * 60_000)).toEqual([0, 1, 2, 3, 4, 5]);
});

test('where the time went, the longest steps, and every step on one axis', () => {
  const html = renderToStaticMarkup(<TimelineView t={t} />);
  expect(html).toContain('1h 40m from start to the end');
  expect(html).toContain('10m waiting for you');
  expect(html).toContain('Work <span class="tabular-nums text-zinc-400">25m</span>');
  expect(html).not.toContain('Reviews <span');
  // the Delegated goal names its own row: said once
  expect(html).toContain('title="Delegated goal: research the subject · research the subject">Delegated goal: research the subject</span>');
  expect(html).toContain('Attempt 1<span class="text-zinc-500"> · build the model</span>');
  // the attempt starts at 60% of the axis and lasts a quarter of it, with its cost in the tooltip
  expect(html).toContain('left:60%;width:25%');
  expect(html).toContain('title="Attempt 1 · 25m · $1.25"');
  expect(html).toContain('>↳ Delegated goal: research the subject<');
});

test('a stretch in which nothing ran folds into a short gap; the steps around it keep their scale', () => {
  // work for an hour, then nothing but the goal running for 5 hours, then an hour's work again
  const quiet: GoalTimeline = {
    ...t,
    end: at(420),
    rows: [
      { ...t.rows[0]!, spans: [{ kind: 'run', label: 'Running', start: at(0), end: at(420) }] },
      { ...t.rows[3]!, spans: [{ kind: 'work', label: 'Attempt 1', start: at(0), end: at(60) }, { kind: 'work', label: 'Attempt 2', start: at(360), end: at(420) }] },
    ],
  };
  const segs = axisSegments(quiet);
  expect(segs.map((s) => [(s.start - Date.parse(at(0))) / 60_000, (s.end - Date.parse(at(0))) / 60_000, s.folded])).toEqual([[0, 60, false], [60, 360, true], [360, 420, false]]);
  const x = axisScale(segs);
  // 120 minutes drawn to scale, the fold as wide as 6 of them: the second hour's work starts just past the middle
  expect(x(Date.parse(at(60)))).toBeCloseTo((60 / 126) * 100, 6);
  expect(x(Date.parse(at(360)))).toBeCloseTo((66 / 126) * 100, 6);
  expect(x(Date.parse(at(420)))).toBeCloseTo(100, 6);
  const html = renderToStaticMarkup(<TimelineView t={quiet} />);
  expect(html).toContain('⋯ 5h 00m');
  expect(html).toContain('nothing ran (folded)');
  // a timeline with no quiet stretch is all to scale
  expect(axisSegments(t).every((s) => !s.folded)).toBe(true);
});

test('the chart zooms, and every bar and row name is a button that opens what it was', () => {
  const html = renderToStaticMarkup(<TimelineView t={t} />);
  expect(html).toContain('aria-label="zoom in"');
  expect(html).toContain('>fit<');
  expect(html).toMatch(/<button type="button" class="absolute rounded-sm[^"]*" style="left:60%;width:25%"/);
  expect(html).toContain('title="build the model">build the model</button>');
});
