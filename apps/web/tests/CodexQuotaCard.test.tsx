import { describe, expect, test } from 'bun:test';
import React, { type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CodexQuotaCard } from '../src/components/CodexQuotaCard.tsx';

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
    expect(html).toContain('100% used');
    expect(html).toContain('6.5% used');
    expect(html).toContain('Primary window · 5h');
    expect(html).toContain('Secondary window · 7d');
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
});
