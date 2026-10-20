import { expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Attachment } from '@foundry/core/browser';
import { ScheduleDialog } from '../src/components/ScheduleDialog.tsx';
import { lastRunLabel, nextRunLabel } from '../src/pages/SchedulesPage.tsx';
import { recipeFromBody, scheduleNameFrom } from '../src/pages/new-goal-schedule.ts';

test('the recipe keeps the goal as the form sends it, with links, without uploads, references, an issue or a follow-up', () => {
  const link: Attachment = { id: 'a1', kind: 'link', name: 'notes', mime: null, size: null, path: null, url: 'https://example.com/notes', note: 'read first', addedAt: '2026-10-21T00:00:00Z', markdown: null };
  const file: Attachment = { ...link, id: 'a2', kind: 'file', name: 'spec.pdf', url: null, path: 'attachments/_staging/a2/spec.pdf' };
  const r = recipeFromBody({ prompt: 'Upgrade.', repoPath: '/repo', title: 'Weekly', attachments: [link, file], references: [{ target: 'x' }], issue: { repo: 'a/b' }, follows: { goalId: 'g' }, workflow: { pace: 'fast' }, delivery: { mode: 'pr' } });
  expect(r).toEqual({ prompt: 'Upgrade.', repoPath: '/repo', title: 'Weekly', workflow: { pace: 'fast' }, delivery: { mode: 'pr' }, links: [{ url: 'https://example.com/notes', name: 'notes', note: 'read first' }] });
  expect(scheduleNameFrom('', 'Upgrade the dependencies\nand run the tests')).toBe('Upgrade the dependencies');
  expect(scheduleNameFrom('Weekly', 'x')).toBe('Weekly');
  expect(scheduleNameFrom('', 'a'.repeat(80))).toHaveLength(58);
});

test('next and last runs in words', () => {
  const now = new Date('2026-10-21T10:00:00');
  expect(nextRunLabel(null, now)).toBe('off');
  expect(nextRunLabel(new Date('2026-10-21T10:00:30').toISOString(), now)).toStartWith('now (');
  expect(nextRunLabel(new Date('2026-10-21T13:00:00').toISOString(), now)).toStartWith('in 3 h (');
  expect(nextRunLabel(new Date('2026-10-28T03:00:00').toISOString(), now)).toStartWith('in 7 days (');
  const at = new Date(Date.now() - 3_600_000).toISOString();
  expect(lastRunLabel({ lastRun: null, lastGoal: null })).toBe('never ran');
  expect(lastRunLabel({ lastRun: { at, goalId: null, skipped: 'the previous run is still going' }, lastGoal: null })).toContain('skipped');
  expect(lastRunLabel({ lastRun: { at, goalId: 'g', skipped: null }, lastGoal: { id: 'g', title: 't', state: 'over_delivered' } })).toContain('over delivered');
  expect(lastRunLabel({ lastRun: { at, goalId: 'g', skipped: null }, lastGoal: null })).toContain('the goal was deleted');
});

test('the dialog shows the cadence in words and the weekday or day picker for its kind', () => {
  const html = (cadence: Parameters<typeof ScheduleDialog>[0]['initial']['cadence']) => renderToStaticMarkup(<ScheduleDialog open editing={false} initial={{ name: 'Weekly upgrade', cadence, autoApprove: true }} busy={false} error={null} onClose={() => {}} onSave={() => {}} />);
  expect(html({ kind: 'weekly', weekday: 1, at: '03:00' })).toContain('Runs every Monday at 03:00');
  expect(html({ kind: 'weekly', weekday: 1, at: '03:00' })).toContain('aria-label="Weekday"');
  expect(html({ kind: 'monthly', day: 5, at: '06:00' })).toContain('aria-label="Day of the month"');
  expect(html({ kind: 'daily', at: '03:00' })).not.toContain('aria-label="Weekday"');
  expect(html({ kind: 'daily', at: '03:00' })).toContain('Approve each run');
});
