import { expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import type { Report } from '@foundry/engine/usage-types';
import { ReportView, kindLabel } from '../src/pages/ReportsPage.tsx';

const spend = { sessions: 12, costUsd: 18.5, unmeasured: 1, codexSessions: 0, durationMs: 3_600_000 };
const retries = { tasks: 10, retried: 2, attempts: 13, fixTasks: 1, rate: 0.2 };
const estimate = { cost: { factor: 1.4, samples: 3, spread: 'tight' as const }, time: null, samples: 3 };
const report: Report = {
  now: '2026-10-21T12:00:00Z',
  window: { days: 90, from: '2026-07-23T12:00:00Z', to: '2026-10-21T12:00:00Z' },
  step: 'week',
  totals: { ...spend, goals: { total: 4, finished: 3, failed: 1, cancelled: 0, open: 0 }, activeMin: 150, retries, estimate, noGoal: { sessions: 1, costUsd: 0.1, unmeasured: 0, codexSessions: 0, durationMs: 60_000 } },
  series: [{ t: '2026-10-05T00:00:00.000Z', label: 'Oct 5', sessions: 5, costUsd: 8, finished: 1 }, { t: '2026-10-12T00:00:00.000Z', label: 'Oct 12', sessions: 7, costUsd: 10.5, finished: 2 }],
  repos: [{ repoPath: '/home/me/alpha', name: 'alpha', ...spend, goals: { total: 4, finished: 3, failed: 1, cancelled: 0, open: 0 }, activeMin: 150, costPerFinishedGoal: 6.17, retries, estimate }],
  kinds: [{ kind: 'attempt', sessions: 10, costUsd: 16, unmeasured: 1, codexSessions: 0, durationMs: 3_000_000, costShare: 0.86, timeShare: 0.83 }, { kind: 'review-goal', sessions: 2, costUsd: 2.5, unmeasured: 0, codexSessions: 0, durationMs: 600_000, costShare: 0.14, timeShare: 0.17 }],
  misses: [{ goalId: 'g9', title: 'Export orders as CSV', repo: 'alpha', at: '2026-10-10T00:00:00Z', estimateUsd: 4, actualUsd: 12, estimateMin: 30, actualMin: 95, costFactor: 3, timeFactor: 3.17 }],
  note: 'From the sessions Foundry started on this machine.',
};
const html = (r: Report) => renderToStaticMarkup(<MemoryRouter><ReportView report={r} /></MemoryRouter>);

test('the report shows the window numbers, the spend by week, each project, the session kinds by name and the estimate misses (ADR-0060)', () => {
  const h = html(report);
  expect(h).toContain('$18.50');
  expect(h).toContain('3 / 4');
  expect(h).toContain('2.5 h');
  expect(h).toContain('20%');
  expect(h).toContain('×1.4 / —');
  expect(h).toContain('Spend over time · by week');
  expect(h).toContain('Oct 12: $10.50 · 7 sessions · 2 finished');
  expect(h).toContain('alpha');
  expect(h).toContain('$6.17');
  expect(h).toContain('1 failed');
  expect(h).toContain('Workers on tasks');
  expect(h).toContain('Goal reviews');
  expect(h).toContain('86% of $');
  expect(h).toContain('Export orders as CSV');
  expect(h).toContain('href="/goals/g9"');
  expect(h).toContain('cost $4.00 → $12.00 (×3)');
  expect(h).toContain('no goal (probes, setup, goals since deleted)');
  expect(h).toContain('1 Claude Code session with unknown cost left out');
  expect(h).toContain(report.note);
  expect(kindLabel('qa')).toBe('Browser QA');
  expect(kindLabel('something-new')).toBe('something-new');
});

test('a window with nothing in it says so', () => {
  const empty: Report = { ...report, totals: { ...report.totals, sessions: 0, costUsd: 0, goals: { total: 0, finished: 0, failed: 0, cancelled: 0, open: 0 }, noGoal: { sessions: 0, costUsd: 0, unmeasured: 0, codexSessions: 0, durationMs: 0 } }, series: [], repos: [], kinds: [], misses: [] };
  expect(html(empty)).toContain('Nothing ran in this window');
});
