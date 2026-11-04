import { describe, expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import type { EditorView, GoalDetail } from '../src/api.ts';
import { AdjustCard } from '../src/pages/goal/AdjustCard.tsx';
import { RerenderCard } from '../src/pages/goal/RerenderCard.tsx';

const at = '2026-11-03T10:00:00.000Z';
const project = { dir: 'video/reel', name: 'reel', version: '0.9.8', pinned: true, key: 'editor:video/reel' };
const detail = (editor: EditorView | undefined, adjust?: GoalDetail['adjust']): GoalDetail =>
  ({ goal: { id: 'g1', state: 'done', provider: 'claude', budgets: { maxCostUsd: 20, maxDurationMin: null, attemptsPerTask: 3, maxConcurrent: 1 } }, budget: { remainingUsd: 12.5, costUsd: 7.5, conversationUsd: 0, maxCostUsd: 20, elapsedMin: 10, maxDurationMin: null, exceeded: null }, editor, adjust }) as unknown as GoalDetail;
const render = (el: React.ReactElement) => renderToStaticMarkup(<MemoryRouter>{el}</MemoryRouter>);

describe('RerenderCard (ADR-0086)', () => {
  test('hidden while the beta is off or the goal has no HyperFrames project', () => {
    expect(render(<RerenderCard d={detail(undefined)} />)).toBe('');
    expect(render(<RerenderCard d={detail({ enabled: false, projects: [], films: [], rerender: null })} />)).toBe('');
    expect(render(<RerenderCard d={detail({ enabled: true, projects: [], films: [{ slug: 'launch', title: 'Launch', duration: 15, fps: 60, formats: ['16x9'], url: '/api/goals/g1/film/launch' }], rerender: null })} />)).toBe('');
  });
  test('on a finished HyperFrames goal: the button, the edit it would make, the last result and the edits so far', () => {
    const history = [{ id: 'adj_1', n: 1, text: 'Edits in the editor, rendered again', mode: 'rerender' as const, taskId: null, attachmentIds: [], at, by: 'ann', files: ['video/reel/final.mp4'] }];
    const html = render(<RerenderCard d={detail({ enabled: true, projects: [project], films: [], rerender: { can: true, reason: null, running: false, next: 2, last: { n: 1, at, files: ['video/reel/final.mp4'], commit: 'abcdef0123', errors: [] }, history } })} />);
    expect(html).toContain('Re-render');
    expect(html).toContain('Beta');
    expect(html).toContain('(edit 2)');
    expect(html).toContain('>Re-render</button>');
    expect(html).toContain('committed abcdef0');
    expect(html).toContain('/api/goals/g1/artifacts/video/reel/final.mp4');
    expect(html).toContain('Before it:');
    expect(html).toContain('/api/goals/g1/artifacts/.history/1/video/reel/final.mp4');
    expect(html).toContain('ann');
  });
  test('refused or running: the reason, the button held', () => {
    const refused = render(<RerenderCard d={detail({ enabled: true, projects: [project], films: [], rerender: { can: false, reason: 'the goal is still at work', running: false, next: 1, last: null, history: [] } })} />);
    expect(refused).toContain('Not now: the goal is still at work');
    expect(refused).toContain('disabled');
    const running = render(<RerenderCard d={detail({ enabled: true, projects: [project], films: [], rerender: { can: false, reason: 'its films are being rendered now', running: true, next: 1, last: { n: 1, at, files: [], commit: null, errors: [{ dir: 'video/reel', error: 'boom' }] }, history: [] } })} />);
    expect(running).toContain('Rendering…');
    expect(running).not.toContain('boom');
  });
  test('the Adjust card lists the Adjustments without the edits, which the Re-render card has', () => {
    const history = [
      { id: 'adj_1', n: 1, text: 'make the lid red', mode: 'resume' as const, taskId: 't1', attachmentIds: [], at, by: null, files: [] },
      { id: 'adj_2', n: 2, text: 'Edits in the editor, rendered again', mode: 'rerender' as const, taskId: null, attachmentIds: [], at, by: null, files: [] },
    ];
    const html = render(<AdjustCard d={detail(undefined, { enabled: true, can: true, reason: null, mode: 'task', next: 3, history })} />);
    expect(html).toContain('make the lid red');
    expect(html).not.toContain('rendered again');
    expect(html).toContain('(adjustment 3)');
  });
});
