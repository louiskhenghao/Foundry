import { describe, expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import type { AccountUsage } from '@foundry/engine/usage-types';
import { AccountsUsageCard } from '../src/components/AccountsUsageCard.tsx';

const win = (w: Partial<AccountUsage['fiveHour']> = {}): AccountUsage['fiveHour'] => ({ status: null, resetsAt: null, lastSignalAt: null, isUsingOverage: false, sessions: 0, costUsd: 0, outputTokens: 0, ...w });
const account = (a: Partial<AccountUsage>): AccountUsage => ({ id: 'native', label: 'me@example.com', plan: 'max', current: false, limitedUntil: null, fiveHour: win(), sevenDay: win(), ...a });
const render = (provider: 'claude' | 'codex', accounts: AccountUsage[]) => renderToStaticMarkup(<StaticRouter location="/usage"><AccountsUsageCard provider={provider} accounts={accounts} /></StaticRouter>);

describe('usage per account (ADR-0065)', () => {
  test('Claude: each account with its own window signals and what Foundry spent on it', () => {
    const html = render('claude', [
      account({ fiveHour: win({ status: 'rejected', resetsAt: new Date(Date.now() + 2 * 3600_000).toISOString(), sessions: 3, costUsd: 4.2 }), limitedUntil: new Date(Date.now() + 2 * 3600_000).toISOString() }),
      account({ id: 'acc_b', label: 'work@example.com', current: true, fiveHour: win({ status: 'allowed', sessions: 1, costUsd: 0.5 }) }),
    ]);
    expect(html).toContain('me@example.com');
    expect(html).toContain('limit reached');
    expect(html).toContain('resets in');
    expect(html).toContain('limited until');
    expect(html).toContain('within limit');
    expect(html).toContain('no signal yet');
    expect(html.match(/>current</g)).toHaveLength(1);
  });

  test('Codex: each account\'s own quota and Foundry\'s activity on it, never a dollar figure', () => {
    const html = render('codex', [account({ codexQuota: { state: 'unavailable', checkedAt: '', message: 'signed out' }, sevenDay: win({ sessions: 2, outputTokens: 12_300 }) })]);
    expect(html).toContain('quota unavailable');
    expect(html).toContain('2 sessions · 12.3k output tokens');
    expect(html).not.toContain('$');
  });
});
