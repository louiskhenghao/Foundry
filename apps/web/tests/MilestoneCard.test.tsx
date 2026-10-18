import { expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ArtifactsStrip, evidenceShows, stripShown } from '../src/pages/goal/MilestoneCard.tsx';

const files = ['front.png', 'frame.step', 'logo.svg', 'voice.mp3'];
const strip = (shown: Set<string> | null) => renderToStaticMarkup(<ArtifactsStrip goalId="g" files={files} shown={shown} />);

test("a milestone of files lists only the goal's artifacts its evidence does not already show", () => {
  const html = strip(new Set(['front.png', 'frame.step']));
  expect(html).toContain('Other artifacts (2)');
  expect(html).toContain('/api/goals/g/artifacts/logo.svg');
  expect(html).toContain('/api/goals/g/artifacts/voice.mp3');
  expect(html).not.toContain('/api/goals/g/artifacts/frame.step');
  // everything shown above: nothing to list
  expect(strip(new Set(files))).toBe('');
  // a walkthrough milestone, the final walkthrough, or evidence on its way: the whole strip
  expect(strip(null)).toContain('Artifacts (4)');
});

test("the evidence's pictures, clips and named files are what it shows; on its way or failed it shows nothing yet", () => {
  const evidence = (status: 'pass' | 'fail') => ({ type: 'milestone.evidence', ts: '2026-10-01T00:00:02Z', payload: { taskId: 't1', video: null, shots: [{ file: 's.png', caption: 'front.png' }], clips: [{ file: 'c.mp4', caption: 'turn.mp4' }], files: ['frame.step'], summary: '', error: null, status, kind: 'files' } });
  const d = (events: unknown[], runs: string[] = []) => ({ milestoneEvents: events, milestoneRuns: runs }) as never;
  expect([...evidenceShows(d([evidence('pass')]), 't1', '2026-10-01T00:00:01Z')!].sort()).toEqual(['frame.step', 'front.png', 'turn.mp4']);
  expect(evidenceShows(d([evidence('fail')]), 't1', '2026-10-01T00:00:01Z')).toBeNull();
  expect(evidenceShows(d([]), 't1', '2026-10-01T00:00:01Z')).toBeNull();
  // an older recording while a new one is being collected
  expect(evidenceShows(d([evidence('pass')], ['t1']), 't1', '2026-10-01T00:00:03Z')).toBeNull();
});

test('only a milestone of files leaves its evidence out of the strip: a walkthrough, a scripted milestone or no task leave out nothing', () => {
  const d = { milestoneEvents: [{ type: 'milestone.evidence', ts: '2026-10-01T00:00:02Z', payload: { taskId: 't1', video: null, shots: [{ file: 's.png', caption: 'front.png' }], summary: '', error: null, status: 'pass', kind: 'files' } }], milestoneRuns: [] } as never;
  const since = '2026-10-01T00:00:01Z';
  expect(stripShown(d, { id: 't1', scenario: 'cad' }, since)).toEqual(new Set(['front.png']));
  expect(stripShown(d, { id: 't1', scenario: 'general' }, since)).toBeNull();
  expect(stripShown(d, { id: 't1', scenario: 'cad', milestoneScript: 'walk.ts' }, since)).toBeNull();
  expect(stripShown(d, undefined, since)).toBeNull();
});
