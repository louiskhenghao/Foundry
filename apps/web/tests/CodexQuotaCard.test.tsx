import { describe, expect, test } from 'bun:test';
import React, { type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CodexQuotaCard } from '../src/components/CodexQuotaCard.tsx';
import { UsageActivity, UsagePillView } from '../src/pages/UsagePage.tsx';
import { StaticRouter } from 'react-router-dom/server';
import type { Usage } from '../src/api.ts';

type Quota = NonNullable<ComponentProps<typeof CodexQuotaCard>['quota']>;
const fixture = (): Quota => ({ state: 'available', checkedAt: '2026-10-04T01:00:00Z', ordinaryUsageAllowed: null, buckets: [
  { id: 'codex-main', label: 'Main models', primary: { usedPercent: 100, windowDurationMins: 300, resetsAt: 1 }, secondary: { usedPercent: 22, windowDurationMins: 10080, resetsAt: null } },
  { id: 'codex-fast', label: 'Fast models', primary: { usedPercent: 6.5, windowDurationMins: 300, resetsAt: null }, secondary: null },
] });
const render = (quota?: Quota) => renderToStaticMarkup(<CodexQuotaCard quota={quota} />);

describe('Codex account quota', () => {
  test('shows all native buckets and windows without treating a past reset as recovery', () => {
    const html = render(fixture());
    expect(html).toContain('codex-main');
    expect(html).toContain('codex-fast');
    expect(html).toContain('0% remaining');
    expect(html).toContain('93.5% remaining');
    expect(html).toContain('aria-label="5-hour limit remaining"');
    expect(html).toContain('aria-valuenow="93.5"');
    expect(html).toContain('width:93.5%');
    expect(html).toContain('5-hour limit');
    expect(html).toContain('Weekly limit');
    expect(html).toContain('Reported reset:');
    expect(html).toContain('Reset time unavailable');
    expect(html).toContain('>unknown</span>');
    expect(html).not.toContain('>allowed</span>');
    expect(html).not.toContain('>blocked</span>');
    expect(html).not.toContain('rolled over');
  });

  test('only explicit ordinary usage allowance changes the reported status', () => {
    expect(render({ ...fixture(), ordinaryUsageAllowed: false } as Quota)).toContain('>blocked</span>');
    expect(render({ ...fixture(), ordinaryUsageAllowed: true } as Quota)).toContain('>allowed</span>');
  });

  test('handles missing, unavailable, error and empty quota observations', () => {
    expect(render()).toContain('has not been read yet');
    expect(render({ state: 'unavailable', checkedAt: '2026-10-04T01:00:00Z', message: 'Sign in to Codex' })).toContain('Sign in to Codex');
    expect(render({ state: 'error', checkedAt: '2026-10-04T01:00:00Z', message: 'Quota read failed' })).toContain('Quota read failed');
    expect(render({ ...fixture(), buckets: [] } as Quota)).toContain('No quota windows were returned');
  });

  for (const slot of ['primary','secondary'] as const) test(`a weekly-only account in ${slot} never shows a five-hour limit in the card, header or local activity`, () => {
    const quota: Quota = { state:'available',checkedAt:'2026-10-04T01:00:00Z',ordinaryUsageAllowed:null,buckets:[{
      id:'account',label:'Codex',primary:null,secondary:null,[slot]:{usedPercent:38,windowDurationMins:10080,resetsAt:null},
    }] };
    const u = localUsage(quota);
    const card = render(quota);
    const header = renderToStaticMarkup(<StaticRouter location="/"><UsagePillView usages={{codex:u}} /></StaticRouter>);
    const activity = renderToStaticMarkup(<UsageActivity provider="codex" u={u} />);
    expect(card).toContain('Weekly limit');
    expect(card.match(/role="meter"/g)).toHaveLength(1);
    expect(header).toContain('Codex · Weekly 62% remaining');
    expect(activity).toContain('Foundry activity · last 7 days');
    expect(activity).toContain('reporting period is not an account limit');
    for (const html of [card,header,activity]) {
      expect(html).not.toMatch(/5-hour|5h|Primary window|Secondary window/);
      expect(html).not.toContain('no reset signal');
    }
    expect(header).not.toContain('· reset');
    expect(activity).not.toContain('overage');
  });

  test('short-only and nonstandard account windows use their actual durations', () => {
    for (const [mins,label] of [[300,'5-hour limit'],[1440,'Daily limit'],[120,'2-hour limit'],[45,'45-minute limit']] as const) {
      const html = render({ ...fixture(),buckets:[{id:'one',label:'Models',primary:{usedPercent:20,windowDurationMins:mins,resetsAt:null},secondary:null}] } as Quota);
      expect(html).toContain(label);
      expect(html).not.toContain('Weekly limit');
      expect(html.match(/role="meter"/g)).toHaveLength(1);
    }
  });

  test('unknown durations, no windows and unavailable quota never default to five hours or unlimited', () => {
    const quota = { ...fixture(),buckets:[{id:'one',label:'Models',primary:{usedPercent:null,windowDurationMins:null,resetsAt:null},secondary:null}] } as Quota;
    expect(render(quota)).toContain('duration unknown');
    for (const q of [undefined, { ...fixture(),buckets:[] } as Quota,quota]) {
      const html = renderToStaticMarkup(<StaticRouter location="/"><UsagePillView usages={{codex:localUsage(q)}} /></StaticRouter>);
      expect(html).not.toMatch(/5h|5-hour|Weekly|unlimited/);
      expect(html).not.toContain('0% used');
    }
  });

  test('multiple windows stay distinct and a full window never implies a blocked account', () => {
    const u = localUsage(fixture());
    const html = renderToStaticMarkup(<StaticRouter location="/"><UsagePillView usages={{codex:u}} /></StaticRouter>);
    expect(html).toContain('3 quota windows');
    expect(html).not.toContain('blocked');
    u.codexQuota = { ...fixture(),ordinaryUsageAllowed:false } as Quota;
    expect(renderToStaticMarkup(<StaticRouter location="/"><UsagePillView usages={{codex:u}} /></StaticRouter>)).toContain('blocked');
  });

  test('multiple weekly quota groups retain their names and report weekly limits in the header', () => {
    const quota: Quota = { state:'available',checkedAt:'2026-10-04T01:00:00Z',ordinaryUsageAllowed:null,buckets:['base_model_inference','codex'].map(id=>({
      id,label:id,primary:{usedPercent:38,windowDurationMins:10080,resetsAt:null},secondary:null,
    })) };
    const html = render(quota);
    expect(html).toContain('base_model_inference');
    expect(html).toContain('codex');
    expect(html.match(/role="meter"/g)).toHaveLength(2);
    const header = renderToStaticMarkup(<StaticRouter location="/"><UsagePillView usages={{codex:localUsage(quota)}} /></StaticRouter>);
    expect(header).toContain('Codex · 2 weekly limits');
    expect(html + header).not.toMatch(/5-hour|5h/);
  });

  test('the header stays general while reporting both engines and independently paused sessions', () => {
    const renderHeader = (usages: Partial<Record<'claude' | 'codex', Usage>>) => renderToStaticMarkup(<StaticRouter location="/"><UsagePillView usages={usages} /></StaticRouter>);
    expect(renderHeader({})).toContain('>Usage</span>');
    expect(renderHeader({})).toContain('href="/usage"');
    expect(renderHeader({})).not.toContain('needs attention');
    const codex = { ...localUsage(fixture()), pausedUntil: '2999-01-01T00:00:00Z' };
    const claude = { ...localUsage(), provider: 'claude' as const };
    const html = renderHeader({ claude, codex });
    expect(html).toContain('Claude Code · Foundry activity (5h)');
    expect(html).toContain('Codex · sessions paused');
    expect(html).toContain('needs attention');
    expect(html).toContain('>Usage</span>');
    expect(html).not.toContain('reset now');
    expect(renderHeader({ claude })).toContain('Codex · usage unavailable');
  });

  test('remaining meters clamp invalid bounds and do not turn missing usage into a full bar', () => {
    for (const [used, remaining] of [[-10, 100], [120, 0], [25, 75]]) {
      const html = render({ ...fixture(), buckets: [{ id:'one', label:'Models', primary:{usedPercent:used, windowDurationMins:10080, resetsAt:null}, secondary:null }] } as Quota);
      expect(html).toContain(`aria-valuenow="${remaining}"`);
      expect(html).toContain(`width:${remaining}%`);
      expect(html).toContain(`${remaining}% remaining`);
    }
    const html = render({ ...fixture(), buckets: [{ id:'one', label:'Models', primary:{usedPercent:null, windowDurationMins:10080, resetsAt:null}, secondary:null }] } as Quota);
    expect(html).not.toContain('role="meter"');
    expect(html).not.toContain('100% remaining');
  });

  test('Claude keeps its native signals and existing activity windows', () => {
    const u = localUsage();
    const activity = renderToStaticMarkup(<UsageActivity provider="claude" u={u} />);
    expect(activity).toContain('5-hour window');
    expect(activity).toContain('7-day window');
    expect(activity).toContain('overage');
  });
});

function localUsage(quota?: Quota): Usage {
  const window = { label:'5-hour window',windowStart:'2026-10-03T20:00:00Z',windowEnd:'2026-10-04T01:00:00Z',resetsAt:'2026-10-04T01:00:00Z',status:'allowed',isUsingOverage:true,lastSignalAt:'2026-10-04T01:00:00Z',sessions:0,inputTokens:0,outputTokens:0,cacheReadTokens:0,cacheCreateTokens:0,costUsd:0 };
  return { provider:'codex',costAvailable:false,codexQuota:quota,now:'2026-10-04T01:00:00Z',fiveHour:window,sevenDay:{...window,label:'7-day window'},series:{hourly:[],daily:[]},byModel:[],byGoal:[],byKind:[],totals:{cacheHitRate:null,avgCostPerSession:null,avgDurationMs:null,errorSessions:0},limited:null,pausedUntil:null } as Usage;
}
