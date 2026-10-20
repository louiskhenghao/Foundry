import { expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Deployment, SmokeScript } from '@foundry/core/browser';
import { SmokeView, againLabel } from '../src/pages/goal/DeploySmoke.tsx';

const script = (over: Partial<SmokeScript> = {}): SmokeScript => ({ script: 'e2e/milestones/home.spec.ts', taskId: 't1', status: 'pass', error: null, summary: '1 test: shows the home page', clips: [], shots: [], outputs: [], log: null, ...over });
const dep = (over: Partial<Deployment> = {}): Deployment => ({ provider: 'vercel', production: false, status: 'live', url: 'https://site-abc-preview.vercel.app', reason: null, ref: 'abc', framework: 'static pages', at: '2026-10-21T10:00:00Z', endedAt: '2026-10-21T10:01:00Z', ...over });
const html = (d: Deployment, scripts = 2) => renderToStaticMarkup(<SmokeView goalId="g1" deployment={d} scripts={scripts} busy={false} onAgain={() => {}} />);

test('a passed smoke says what it tried, lists each script with its outcome, and offers Smoke again on the live address (ADR-0058)', () => {
  const h = html(dep({ smoke: { status: 'pass', detail: '2 scripts passed against https://site-abc-preview.vercel.app', scripts: [script(), script({ script: 'e2e/milestones/gallery.spec.ts', summary: '1 test: opens a picture' })], at: '2026-10-21T10:01:00Z', endedAt: '2026-10-21T10:03:00Z' } }));
  expect(h).toContain('smoke passed');
  expect(h).toContain('2 scripts passed against https://site-abc-preview.vercel.app');
  expect(h).toContain('e2e/milestones/home.spec.ts');
  expect(h).toContain('e2e/milestones/gallery.spec.ts');
  expect(h).toContain('1 test: opens a picture');
  expect(h).toContain('Smoke again');
});

test('a failed script shows the first line of what went wrong; a running smoke offers no button', () => {
  const failed = html(dep({ smoke: { status: 'fail', detail: '1 of 1 script failed against https://site-abc-preview.vercel.app: e2e/milestones/home.spec.ts — "shows the home page" failed', scripts: [script({ status: 'fail', error: '"shows the home page" failed: expect(locator).toBeVisible()\nLocator: getByText("Home")' })], at: '2026-10-21T10:01:00Z', endedAt: '2026-10-21T10:03:00Z' } }));
  expect(failed).toContain('smoke failed');
  // the first line is shown, the whole error is the tooltip
  expect(failed).toContain('&quot;shows the home page&quot; failed: expect(locator).toBeVisible()</span>');
  expect(failed).toContain('title="&quot;shows the home page&quot; failed: expect(locator).toBeVisible()\nLocator: getByText(&quot;Home&quot;)"');
  expect(failed).toContain('Smoke again');
  const running = html(dep({ smoke: { status: 'running', detail: 'e2e/milestones/home.spec.ts', scripts: [], at: '2026-10-21T10:01:00Z', endedAt: null } }));
  expect(running).toContain('smoke running…');
  expect(running).not.toContain('Smoke again');
});

test('a live deploy without a smoke offers the first try; a failed deploy, or a goal without scripts, nothing', () => {
  expect(html(dep())).toContain('Try the scripts against it');
  expect(againLabel(null)).toBe('Try the scripts against it');
  expect(againLabel({ status: 'skipped', detail: 'the goal has no milestone scripts to try against it', scripts: [], at: '2026-10-21T10:01:00Z', endedAt: '2026-10-21T10:01:00Z' })).toBe('Try the scripts against it');
  expect(againLabel({ status: 'fail', detail: '', scripts: [], at: '2026-10-21T10:01:00Z', endedAt: '2026-10-21T10:01:00Z' })).toBe('Smoke again');
  expect(html(dep({ status: 'failed', url: null, reason: 'the build failed' }))).toBe('');
  expect(html(dep(), 0)).toBe('');
  const skipped = html(dep({ smoke: { status: 'skipped', detail: 'the goal has no milestone scripts to try against it', scripts: [], at: '2026-10-21T10:01:00Z', endedAt: '2026-10-21T10:01:00Z' } }), 0);
  expect(skipped).toContain('no smoke');
  expect(skipped).not.toContain('Try the scripts');
});
