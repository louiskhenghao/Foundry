import { expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ArtifactsStrip } from '../src/pages/goal/MilestoneCard.tsx';

const strip = (task: { scenario: string; milestoneScript?: string | null } | null) => renderToStaticMarkup(<ArtifactsStrip goalId="g" files={['front.png', 'frame.step']} task={task} />);

test("a milestone of files leaves out the goal's artifacts, which its evidence already shows", () => {
  expect(strip({ scenario: 'cad', milestoneScript: null })).toBe('');
  // a walkthrough milestone, a scripted one of a cad task, and the final walkthrough still list them
  expect(strip({ scenario: 'general', milestoneScript: null })).toContain('Artifacts (2)');
  expect(strip({ scenario: 'cad', milestoneScript: 'walk.ts' })).toContain('Artifacts (2)');
  expect(strip(null)).toContain('href="/api/goals/g/artifacts/frame.step"');
});
