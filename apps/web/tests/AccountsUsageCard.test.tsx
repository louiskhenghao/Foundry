import { describe, expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import type { AccountUsage, ClaudeUsage } from '@foundry/engine/usage-types';
import { AccountsUsageCard } from '../src/components/AccountsUsageCard.tsx';

const win = (w: Partial<AccountUsage['fiveHour']> = {}): AccountUsage['fiveHour'] => ({ status: null, resetsAt: null, lastSignalAt: null, isUsingOverage: false, sessions: 0, costUsd: 0, outputTokens: 0, ...w });
const account = (a: Partial<AccountUsage>): AccountUsage => ({ id: 'native', label: 'me@example.com', plan: 'max', current: false, limitedUntil: null, fiveHour: win(), sevenDay: win(), ...a });
const usage: ClaudeUsage = { state: 'available', checkedAt: new Date().toISOString(), fiveHour: null, sevenDay: { usedPercent: 53, resetsAt: new Date(Date.now() + 3 * 86_400_000).toISOString() }, models: [{ name: 'Fable', usedPercent: 11, resetsAt: null }], extraUsage: null };
const render = (provider: 'claude' | 'codex', accounts: AccountUsage[]) => renderToStaticMarkup(<StaticRouter location="/usage"><AccountsUsageCard provider={provider} accounts={accounts} /></StaticRouter>);

describe('usage per account (ADR-0065, ADR-0090)', () => {
  test('Claude: each account with its own usage windows as Claude reports them, and what Foundry spent on it with the last signal', () => {
    const html = render('claude', [
      account({ claudeUsage: usage, fiveHour: win({ status: 'rejected', resetsAt: new Date(Date.now() + 2 * 3600_000).toISOString(), sessions: 3, costUsd: 4.2 }), limitedUntil: new Date(Date.now() + 2 * 3600_000).toISOString() }),
      account({ id: 'acc_b', label: 'work@example.com', current: true, claudeUsage: usage, fiveHour: win({ status: 'allowed', sessions: 1, costUsd: 0.5 }) }),
    ]);
    expect(html).toContain('me@example.com');
    expect(html).toContain('limit reached');
    expect(html).toContain('resets in');
    expect(html).toContain('limited until');
    expect(html).toContain('within limit');
    expect(html.match(/>current</g)).toHaveLength(1);
    // the windows: Session at 0% without one open, the week over all models, the model's week; the current account as cards
    expect(html).toContain('53%');
    expect(html).toContain('Fable');
    expect(html).toContain('No active session');
    expect(html.match(/role="meter"/g)).toHaveLength(6);
    // three cards for the current account, inside the Card's own section
    expect(html.match(/<section/g)).toHaveLength(4);
    expect(html).toContain('usage as of just now');
    expect(html).toContain('$4.20 · 3 sessions');
  });

  test('an account whose usage was not read, or could not be, says so instead of showing a bar', () => {
    const html = render('claude', [account({}), account({ id: 'acc_b', label: 'b@example.com', claudeUsage: { state: 'unavailable', checkedAt: new Date().toISOString(), message: 'Sign in to Claude Code to read its usage.' } })]);
    expect(html).toContain('Usage not read yet.');
    expect(html).toContain('Usage unavailable');
    expect(html).toContain('Sign in to Claude Code to read its usage.');
    expect(html).not.toContain('role="meter"');
  });

  test('Codex: each account\'s own quota windows and Foundry\'s activity on it, never a dollar figure', () => {
    const html = render('codex', [
      account({ codexQuota: { state: 'unavailable', checkedAt: new Date().toISOString(), message: 'signed out' }, sevenDay: win({ sessions: 2, outputTokens: 12_300 }) }),
      account({ id: 'acc_b', label: 'work@example.com', current: true, codexQuota: { state: 'available', checkedAt: new Date().toISOString(), ordinaryUsageAllowed: true, buckets: [{ id: 'codex', label: 'codex', primary: { usedPercent: 38, windowDurationMins: 10080, resetsAt: Math.round(Date.now() / 1000) + 86_400 }, secondary: null }] } }),
    ]);
    expect(html).toContain('Usage unavailable');
    expect(html).toContain('signed out');
    expect(html).toContain('2 sessions · 12.3k output tokens');
    expect(html).toContain('All models');
    expect(html).toContain('38%');
    expect(html).toContain('Resets tomorrow');
    expect(html).not.toContain('$');
  });
});
