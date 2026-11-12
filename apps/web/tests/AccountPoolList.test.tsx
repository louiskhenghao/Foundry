import { describe, expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AccountPoolInfo, PoolAccount } from '../src/api.ts';
import { AccountPoolList } from '../src/pages/AccountPoolList.tsx';

const account = (a: Partial<PoolAccount>): PoolAccount => ({ id: 'native', email: null, orgName: null, plan: null, addedAt: '', current: false, limitedUntil: null, status: null, ...a });
const render = (pool: AccountPoolInfo, provider: 'claude' | 'codex' = 'claude') => renderToStaticMarkup(<AccountPoolList provider={provider} pool={pool} installed onChange={() => {}} />);

describe('a coding agent\'s accounts (ADR-0065)', () => {
  test('the current one is marked; another can be made current, moved and removed; this computer\'s sign-in is never removed here', () => {
    const html = render({ autoSwitch: false, accounts: [account({ id: 'native', email: 'me@example.com', current: true, plan: 'max' }), account({ id: 'acc_b', email: 'b@example.com', plan: 'pro', limitedUntil: new Date(Date.now() + 3600_000).toISOString() })] });
    expect(html).toContain('me@example.com');
    expect(html).toContain('current');
    expect(html).toContain('limited until');
    expect(html.match(/Use now/g)).toHaveLength(1);
    expect(html.match(/>Remove</g)).toHaveLength(1);
    expect(html).toContain('Add account');
    expect(html).toContain('Off: new sessions pause until the limit resets');
    // no usage read yet: a sentence on each row, no bar
    expect(html.match(/Usage not read yet\./g)).toHaveLength(2);
  });

  test('auto switch needs a second account', () => {
    const html = render({ autoSwitch: false, accounts: [account({ current: true })] });
    expect(html).toContain('Add a second account first.');
    expect(html).toMatch(/type="checkbox"[^>]*disabled/);
  });
});

describe('each account\'s own usage on its row (ADR-0090)', () => {
  const checkedAt = new Date().toISOString();
  test('Claude: bars with the figure on every row, the cards with the reset on the account sessions run on; the colour follows how much is used', () => {
    const html = render({ autoSwitch: false, accounts: [
      account({ id: 'native', email: 'me@example.com', current: true, plan: 'Ultra', claudeUsage: { state: 'available', checkedAt, fiveHour: { usedPercent: 12, resetsAt: new Date(Date.now() + 2 * 3600_000).toISOString() }, sevenDay: { usedPercent: 53, resetsAt: new Date(Date.now() + 3 * 86_400_000).toISOString() }, models: [{ name: 'Fable', usedPercent: 91, resetsAt: null }], extraUsage: { usedPercent: 6.2, used: 12.34, limit: 200, currency: 'USD' } } }),
      account({ id: 'acc_b', email: 'b@example.com', claudeUsage: { state: 'available', checkedAt, fiveHour: null, sevenDay: { usedPercent: 2, resetsAt: null }, models: [], extraUsage: null } }),
    ] });
    expect(html).toContain('Session');
    expect(html).toContain('All models');
    expect(html).toContain('Fable');
    expect(html).toContain('Extra usage');
    expect(html).toContain('$12.34 of $200.00');
    expect(html).toContain('Resets today');
    expect(html).toContain('bg-work');
    expect(html).toContain('bg-you');
    expect(html).toContain('bg-bad');
    expect(html).toMatch(/Usage as of \d+s ago/);
    // the current account's windows are cards (one section each); the other's are bars on one line
    expect(html.match(/<section/g)).toHaveLength(4);
    expect(html).toContain('No active session');
    expect(html.match(/role="meter"/g)).toHaveLength(6);
  });

  test('a lapsed sign-in says so in words, and a Codex account shows the windows its quota names', () => {
    const html = render({ autoSwitch: false, accounts: [
      account({ id: 'native', email: 'me@example.com', current: true, codexQuota: { state: 'available', checkedAt, ordinaryUsageAllowed: false, buckets: [{ id: 'codex', label: 'codex', primary: { usedPercent: 100, windowDurationMins: 10080, resetsAt: null }, secondary: { usedPercent: 40, windowDurationMins: 300, resetsAt: null } }] } }),
      account({ id: 'acc_b', email: 'b@example.com', codexQuota: { state: 'unavailable', checkedAt, message: 'Sign in with ChatGPT using codex login to read quota.' } }),
    ] }, 'codex');
    expect(html).toContain('All models');
    expect(html).toContain('Session');
    expect(html).toContain('Codex reports ordinary usage as blocked.');
    expect(html).toContain('Reset time not reported');
    expect(html).toContain('Usage unavailable');
    expect(html).toContain('Sign in with ChatGPT using codex login to read quota.');
  });
});
