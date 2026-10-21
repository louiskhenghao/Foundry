import { describe, expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import { AgyQuotaCard } from '../src/components/AgyQuotaCard.tsx';
import { UsageActivity, UsagePillView } from '../src/pages/UsagePage.tsx';
import type { Usage } from '../src/api.ts';

type Quota = NonNullable<Usage['agyQuota']>;
// the shape `agy -p /usage` reported on a real account (agy 1.4.4), one group per shared limit
const fixture = (gemini = 0.4286): Quota => ({ state: 'available', checkedAt: '2026-10-21T18:36:55Z', error: null, groups: [
  { name: 'Gemini Models', description: 'Models within this group: Gemini Flash, Gemini Pro', buckets: [{ id: 'gemini-weekly', name: 'Weekly Limit Remaining', window: 'weekly', remainingFraction: gemini, resetTime: '2026-10-28T17:39:12Z' }] },
  { name: 'Claude and GPT models', description: null, buckets: [{ id: '3p-weekly', name: 'Weekly Limit Remaining', window: 'weekly', remainingFraction: 1, resetTime: null }] },
] });
const render = (quota?: Quota | null) => renderToStaticMarkup(<AgyQuotaCard quota={quota} />);
const header = (usages: Partial<Record<'claude' | 'codex' | 'agy', Usage>>) => renderToStaticMarkup(<StaticRouter location="/"><UsagePillView usages={usages} /></StaticRouter>);

describe('Antigravity account quota', () => {
  test('one card per group: what is left of its weekly limit and when it resets', () => {
    const html = render(fixture());
    expect(html).toContain('Gemini Models');
    expect(html).toContain('Models within this group: Gemini Flash, Gemini Pro');
    expect(html).toContain('42.9% remaining');
    expect(html).toContain('100% remaining');
    expect(html.match(/role="meter"/g)).toHaveLength(2);
    expect(html).toContain('Resets ');
    expect(html).toContain('Reset time unavailable');
  });

  test('a quota not read yet, or one agy did not report, says so instead of showing a limit', () => {
    expect(render()).toContain('has not been read yet');
    expect(render({ state: 'unavailable', groups: [], checkedAt: '2026-10-21T18:36:55Z', error: 'agy is not installed' })).toContain('agy is not installed');
    expect(render({ ...fixture(), groups: [{ name: 'Gemini Models', description: null, buckets: [{ id: 'g', name: 'Weekly Limit Remaining', window: null, remainingFraction: null, resetTime: null }] }] })).not.toContain('role="meter"');
  });

  test('the header names every group, and a used-up group asks for attention', () => {
    expect(header({ agy: agyUsage(fixture()) })).toContain('Antigravity · Gemini Models 42.9% remaining · Claude and GPT models 100% remaining');
    expect(header({ agy: agyUsage(fixture()) })).not.toContain('needs attention');
    expect(header({ agy: agyUsage(fixture(0)) })).toContain('needs attention');
    expect(header({ agy: agyUsage(undefined) })).toContain('Antigravity · quota unavailable');
    expect(header({})).toContain('Antigravity · usage unavailable');
  });

  test('local activity counts tokens: Antigravity reports no dollars', () => {
    const html = renderToStaticMarkup(<UsageActivity provider="agy" u={agyUsage(fixture())} />);
    expect(html).toContain('reporting period is not an account limit');
    expect(html).toContain('output tokens');
    expect(html).not.toContain('5-hour window');
  });
});

function agyUsage(quota?: Quota): Usage {
  const window = { label: '5-hour window', windowStart: '2026-10-21T13:00:00Z', windowEnd: '2026-10-21T18:00:00Z', resetsAt: null, status: null, isUsingOverage: false, lastSignalAt: null, sessions: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreateTokens: 0, costUsd: 0 };
  return { provider: 'agy', costAvailable: false, agyQuota: quota, now: '2026-10-21T18:36:55Z', fiveHour: window, sevenDay: { ...window, label: '7-day window' }, series: { hourly: [], daily: [] }, byModel: [], byGoal: [], byKind: [], totals: { cacheHitRate: null, avgCostPerSession: null, avgDurationMs: null, errorSessions: 0 }, limited: null, pausedUntil: null } as Usage;
}
