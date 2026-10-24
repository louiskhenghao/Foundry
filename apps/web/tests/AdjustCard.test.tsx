import { describe, expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import type { AdjustView, GoalDetail } from '../src/api.ts';
import { AdjustCard } from '../src/pages/goal/AdjustCard.tsx';

const at = '2026-10-25T10:00:00.000Z';
const detail = (state: string, adjust: AdjustView | undefined, remainingUsd: number | null = 12.5): GoalDetail =>
  ({ goal: { id: 'g1', state, provider: 'claude', budgets: { maxCostUsd: 20, maxDurationMin: null, attemptsPerTask: 3, maxConcurrent: 1 } }, budget: { remainingUsd, costUsd: 7.5, conversationUsd: 0, maxCostUsd: 20, elapsedMin: 10, maxDurationMin: null, exceeded: null }, adjust }) as unknown as GoalDetail;
const render = (d: GoalDetail) =>
  renderToStaticMarkup(
    <MemoryRouter>
      <AdjustCard d={d} />
    </MemoryRouter>,
  );

describe('AdjustCard (ADR-0077)', () => {
  test('hidden while the beta is off, and on a goal still at work with nothing adjusted yet', () => {
    expect(render(detail('done', undefined))).toBe('');
    expect(render(detail('done', { enabled: false, can: false, reason: 'off', mode: null, next: 1, history: [] }))).toBe('');
    expect(render(detail('running', { enabled: true, can: false, reason: 'the goal is still at work', mode: null, next: 1, history: [] }))).toBe('');
  });
  test('on a finished goal: the box, how it would be carried out, and what is left of the budget', () => {
    const html = render(detail('done', { enabled: true, can: true, reason: null, mode: 'resume', next: 1, history: [] }));
    expect(html).toContain('Adjust the result');
    expect(html).toContain('Beta');
    expect(html).toContain('aria-label="What should change"');
    expect(html).toContain('picks up where it left off');
    expect(html).toContain('$12.50');
    expect(html).toContain('aria-label="Attach files"');
    expect(html).toContain('>Adjust</button>');
  });
  test('refused: the reason, with the way to a follow-up when the work was merged', () => {
    const html = render(detail('done', { enabled: true, can: false, reason: 'its work was merged: start a follow-up for the change', mode: null, next: 1, history: [] }));
    expect(html).toContain('Not now: its work was merged');
    expect(html).toContain('/goals/new?follows=g1');
    expect(html).not.toContain('aria-label="What should change"');
  });
  test('the Adjustments made, each with the version kept before it', () => {
    const history = [{ id: 'adj_1', n: 1, text: 'make the lid red\nand shiny', mode: 'resume' as const, taskId: 't1', attachmentIds: ['att_1'], at, by: 'ann', files: ['out.png', 'figures/toaster.html'] }];
    const html = render(detail('done', { enabled: true, can: true, reason: null, mode: 'resume', next: 2, history }));
    expect(html).toContain('make the lid red');
    expect(html).toContain('the finished task carried on');
    expect(html).toContain('ann');
    expect(html).toContain('1 file');
    expect(html).toContain('/api/goals/g1/artifacts/.history/1/out.png');
    expect(html).toContain('/api/goals/g1/artifacts/.history/1/figures/toaster.html');
    expect(html).toContain('(adjustment 2)');
  });
});
