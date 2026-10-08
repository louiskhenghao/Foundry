import { expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import { ExportPanel, ImportPanel, ImportResult } from '../src/pages/TransferPage.tsx';
import type { GoalRow, IncomingReport } from '../src/api.ts';

const render = (node: React.ReactNode) => renderToStaticMarkup(<StaticRouter>{node}</StaticRouter>);

test('export offers the four categories; transcripts wait for goals', () => {
  const html = render(<ExportPanel initialGoals={[{ id: 'g1', title: 'Dark mode', state: 'done', follows: null } as unknown as GoalRow]} />);
  for (const label of ['Settings', 'Keys &amp; secrets', 'Goals', 'Session transcripts', 'All goals (1)', 'Choose goals']) expect(html).toContain(label);
  expect(html).toContain('Engine (install)');
  expect(html).toContain('Export');
});

const report: IncomingReport = {
  uploadId: 'in_x', release: '1.2.0', exportedAt: '2026-10-09T08:00:00Z', hostname: 'old-mac', categories: { settings: true, secrets: true, goals: true },
  goals: [
    { id: 'g_new', title: 'Billing page', state: 'running', provider: 'claude', createdAt: '', costUsd: 1, repoPath: '/Users/a/app', remoteUrl: null, baseBranch: 'main', branch: 'goal/g_new', unfinished: true, events: 40, bundle: true, artifacts: false, status: 'new', follows: { goalId: 'g_far', title: 'Login page', inFile: false, here: false } },
    { id: 'g_here', title: 'Dark mode', state: 'done', provider: 'claude', createdAt: '', costUsd: 2, repoPath: '/Users/a/app', remoteUrl: null, baseBranch: 'main', branch: 'goal/g_here', unfinished: false, events: 80, bundle: false, artifacts: false, status: 'here', follows: null },
  ],
  repos: [{ original: '/Users/a/app', remoteUrl: null, goals: ['g_new', 'g_here'], match: null }],
  settings: [{ section: 'models', keys: ['models.cheap'] }],
  secrets: true,
};

test('import shows each goal as new or already here, the repositories to map, differing settings and the locked secrets', () => {
  const html = render(<ImportPanel initial={report} />);
  expect(html).toContain('old-mac');
  expect(html).toContain('unfinished — can be Reattached here');
  expect(html).toContain('already here');
  expect(html).toContain('follows “Login page”, not in this file');
  expect(html).toContain('/Users/a/app');
  expect(html).toContain('leave unmapped');
  expect(html).toContain('Use imported');
  expect(html).toContain('Bring Keys &amp; secrets in');
  expect(html).toContain('Unlock the Keys &amp; secrets first');
});

test('the result names what came in, what was skipped and what waits', () => {
  const html = render(<ImportResult r={{ imported: [{ id: 'g_new', title: 'Billing page' }], skipped: [{ id: 'g_here', title: 'Dark mode', reason: 'already here' }], settings: ['models.cheap'], secrets: [], previewEnv: { applied: [], waiting: ['/Users/a/app'] }, repos: [] }} />);
  expect(html).toContain('Imported 1 goal');
  expect(html).toContain('skipped “Dark mode” — already here');
  expect(html).toContain('preview variables wait');
});
