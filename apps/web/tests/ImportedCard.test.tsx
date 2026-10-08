import { expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Goal } from '@foundry/core/browser';
import { ImportedCard } from '../src/pages/goal/ImportedCard.tsx';
import { describe as describeEvent } from '../src/pages/goal/describe.ts';

const transfer = { transferId: 'tr', from: { release: '1.2.0', hostname: 'old-mac', exportedAt: '2026-10-09T08:00:00Z' }, importedAt: '2026-10-09T09:00:00Z', unfinished: true, bundle: 'transfer/goals/g/branch.bundle', artifacts: null, transcripts: false, original: { repoPath: '/Users/a/app', workspaceDir: null, outputDir: null }, repoMapped: null, branchRestored: null, reattachedAt: null };
const goal = (t: Partial<typeof transfer>) => ({ id: 'g', title: 'Billing page', branch: 'goal/g', transfer: { ...transfer, ...t } }) as unknown as Goal;
const render = (g: Goal) => renderToStaticMarkup(<ImportedCard goal={g} onChanged={() => {}} />);

test('an unmapped Imported Goal asks for its checkout here before it can be Reattached', () => {
  const html = render(goal({}));
  expect(html).toContain('old-mac');
  expect(html).toContain('Map repository');
  expect(html).toContain('the goal’s branch is restored into it');
  expect(html).toContain('Its session logs stayed on the computer it came from.');
  expect(html).toMatch(/<button[^>]*disabled=""[^>]*title="Map its repository first"[^>]*>Reattach<\/button>/);
});

test('once mapped it shows where its branch went; a finished one points at Follow-ups', () => {
  expect(render(goal({ repoMapped: { to: '/Volumes/work/app', how: 'chosen', at: 'x' }, branchRestored: { head: 'abcdef1234', at: 'x' } }))).toContain('restored at <span class="mono">abcdef1');
  expect(render(goal({ unfinished: false, repoMapped: { to: '/w/app', how: 'chosen', at: 'x' } }))).toContain('Continue it with a Follow-up.');
});

test('the timeline names the Transfer events', () => {
  const e = (type: string, payload: object) => describeEvent({ id: 'e', ts: '', goalId: 'g', type, payload } as never).text;
  expect(e('goal.imported', { from: { hostname: 'old-mac', release: '1.2.0', exportedAt: '2026-10-09T08:00:00Z' } })).toBe('Imported from old-mac (Foundry 1.2.0, written 2026-10-09 08:00)');
  expect(e('goal.reattached', { workspaceDir: '/w/app-foundry/x' })).toContain('Reattached here');
});
