import { expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import { EvidenceView, MilestonesCard, type Evidence } from '../src/pages/goal/MilestoneEvidence.tsx';

const files: Evidence = { taskId: 't1', video: null, shots: [{ file: 's.png', caption: 'snapshots/frame_assembly/front.png' }], summary: '3 of 9 images shown, the ones the milestone names first.', error: null, status: 'pass', kind: 'files', files: ['frame_assembly.step', 'drawings/frame.pdf'] };
const walk: Evidence = { taskId: 't1', video: null, shots: [{ file: 's.png', caption: 'the hero' }], summary: 'opens the site', error: null, status: 'pass' };
const view = (e: Evidence) => renderToStaticMarkup(<EvidenceView goalId="g" evidence={e} taskId="t1" />);

test('a milestone of files shows what the task produced whole, with its models and drawings as links', () => {
  const html = view(files);
  expect(html).toContain('What the task produced · 3 of 9 images shown');
  expect(html).not.toContain('What Foundry saw');
  expect(html).toContain('object-contain');
  expect(html).not.toContain('object-top');
  expect(html).toContain('href="/api/goals/g/artifacts/frame_assembly.step"');
  expect(html).toContain('href="/api/goals/g/artifacts/drawings/frame.pdf"');
  // the caption keeps the folder and the view
  expect(html).toContain('>frame_assembly/front.png<');
});

test('a walkthrough still reads as what Foundry saw, its page screenshots cropped from the top', () => {
  const html = view(walk);
  expect(html).toContain('What Foundry saw: opens the site');
  expect(html).toContain('object-cover object-top');
});

test('a milestone of files being collected again says so, not that it is recording', () => {
  const d = {
    goal: { id: 'g', checkpoint: null },
    tasks: [{ id: 't1', title: 'model the frame', scenario: 'cad', milestone: 'the whole frame', milestoneScript: null, state: 'done' }],
    escalations: [],
    milestoneRuns: ['t1'],
    milestoneEvents: [{ type: 'milestone.evidence', ts: '2026-10-01T00:00:01Z', payload: files }],
  } as never;
  const html = renderToStaticMarkup(
    <StaticRouter location="/">
      <MilestonesCard d={d} />
    </StaticRouter>,
  );
  expect(html).toContain('collecting…');
  expect(html).not.toContain('recording…');
  expect(html).toContain('milestones of files collect their files again');
});
