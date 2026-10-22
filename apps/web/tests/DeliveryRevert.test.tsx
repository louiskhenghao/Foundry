import { expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { DeliveryRevert } from '@foundry/core/browser';
import { REVERT_STATUS, RevertRows } from '../src/pages/goal/DeliveryRevert.tsx';

const revert = (over: Partial<DeliveryRevert> = {}): DeliveryRevert => ({ id: 'rvt_1', status: 'open', reason: 'the export breaks on Mondays', merge: false, reverts: [{ prNumber: 41, ref: 'abc1234def', title: 'feat: export' }], branch: 'goal/g1-revert', pr: { number: 45, url: 'https://github.com/acme/app/pull/45' }, commits: ['c1'], mergedRef: null, detail: 'pull request #45 opened; merging it undoes the goal\'s work on main', at: '2026-10-21T10:00:00Z', finishedAt: null, ...over });

test('each revert shows how it went, its pull request, what it undoes and why; a failed one its reason in red (ADR-0059)', () => {
  const h = renderToStaticMarkup(<RevertRows reverts={[revert(), revert({ id: 'rvt_2', status: 'merged', mergedRef: 'fed9876543', reason: '', detail: 'origin/goal/g1-revert deleted; your local main: fast-forwarded main by 1 commit', finishedAt: '2026-10-21T11:00:00Z' }), revert({ id: 'rvt_3', status: 'failed', pr: null, branch: null, detail: 'reverting the merge of pull request #41 conflicts with what main got since, in src/export.ts', finishedAt: '2026-10-21T12:00:00Z' })]} />);
  expect(h).toContain('revert PR open');
  expect(h).toContain('https://github.com/acme/app/pull/45');
  expect(h).toContain('PR #45');
  expect(h).toContain('Undoes the merge of #41');
  expect(h).toContain('the export breaks on Mondays');
  expect(h).toContain('reverted');
  expect(h).toContain('merged fed9876');
  expect(h).toContain('revert failed');
  expect(h).toContain('text-bad-ink');
  expect(h).toContain('conflicts with what main got since, in src/export.ts');
  // a stack names every merge it undoes
  const stack = renderToStaticMarkup(<RevertRows reverts={[revert({ reverts: [{ prNumber: 44, ref: 'd', title: 'd' }, { prNumber: 43, ref: 'c', title: 'c' }] })]} />);
  expect(stack).toContain('Undoes the merges of #44, #43');
  expect(renderToStaticMarkup(<RevertRows reverts={[]} />)).toBe('');
  expect(Object.keys(REVERT_STATUS).sort()).toEqual(['armed', 'closed', 'failed', 'merged', 'open', 'running']);
});
