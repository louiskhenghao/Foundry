import { describe, expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AccountPoolInfo, PoolAccount } from '../src/api.ts';
import { AccountPoolList } from '../src/pages/AccountPoolList.tsx';

const account = (a: Partial<PoolAccount>): PoolAccount => ({ id: 'native', email: null, orgName: null, plan: null, addedAt: '', current: false, limitedUntil: null, status: null, ...a });
const render = (pool: AccountPoolInfo) => renderToStaticMarkup(<AccountPoolList provider="claude" pool={pool} installed onChange={() => {}} />);

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
  });

  test('auto switch needs a second account', () => {
    const html = render({ autoSwitch: false, accounts: [account({ current: true })] });
    expect(html).toContain('Add a second account first.');
    expect(html).toMatch(/type="checkbox"[^>]*disabled/);
  });
});
