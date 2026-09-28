import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fetchMinimaxQuota, parseMinimaxQuota } from './minimax.ts';

const now = new Date('2026-09-28T10:00:00Z');

describe('parseMinimaxQuota', () => {
  test('a Token Plan: percent left per model, reset time, and low under 10% of either window', () => {
    const q = parseMinimaxQuota(
      {
        model_remains: [
          { model_name: 'MiniMax-M2', current_interval_usage_count: 450, current_interval_total_count: 500, current_interval_remaining_percent: 90, current_weekly_usage_count: 4000, current_weekly_total_count: 5000, current_weekly_remaining_percent: 80, remains_time: 3_600_000 },
          { model_name: 'video', current_interval_usage_count: 1, current_interval_total_count: 20, current_interval_remaining_percent: 5, remains_time: 0 },
          { model_name: 'music', current_interval_total_count: 0, current_weekly_total_count: 0, current_interval_status: 3, current_weekly_status: 3 },
        ],
      },
      now,
    );
    expect(q).toEqual({
      state: 'plan',
      low: true,
      checkedAt: now.toISOString(),
      models: [
        { name: 'MiniMax-M2', remainingPercent: 90, weeklyRemainingPercent: 80, resetsAt: '2026-09-28T11:00:00.000Z' },
        { name: 'video', remainingPercent: 5, weeklyRemainingPercent: null, resetsAt: null },
      ],
    });
  });

  test('without a percent, the count is what is left, as mmx reads it', () => {
    const q = parseMinimaxQuota({ model_remains: [{ model_name: 'M', current_interval_usage_count: 30, current_interval_total_count: 200 }] }, now);
    expect(q.state === 'plan' && q.models[0]!.remainingPercent).toBe(15);
    expect(q.state === 'plan' && q.low).toBe(false);
  });

  test('a pay-as-you-go balance is low under 1', () => {
    expect(parseMinimaxQuota({ available_amount: '0.42', cash_balance: '0.42' }, now)).toEqual({ state: 'balance', available: 0.42, low: true, checkedAt: now.toISOString() });
    expect(parseMinimaxQuota({ available_amount: 25 }, now)).toMatchObject({ state: 'balance', low: false });
  });

  test('an mmx error or an unknown answer is an error, never a quota', () => {
    expect(parseMinimaxQuota({ error: { code: 3, message: 'No credentials found.' } }, now)).toMatchObject({ state: 'error', message: 'No credentials found.' });
    expect(parseMinimaxQuota({}, now)).toMatchObject({ state: 'error' });
  });
});

describe('fetchMinimaxQuota', () => {
  test('without mmx or without a key it does not run anything', async () => {
    expect(await fetchMinimaxQuota({ bin: null, signedIn: true, env: {}, cwd: '/' })).toMatchObject({ state: 'unavailable', reason: 'no-cli' });
    expect(await fetchMinimaxQuota({ bin: '/bin/false', signedIn: false, env: {}, cwd: '/' })).toMatchObject({ state: 'unavailable', reason: 'no-key' });
  });
  test('progress lines before the JSON do not hide mmx\'s own error', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'foundry-fake-mmx-'));
    const bin = join(dir, 'mmx');
    writeFileSync(bin, '#!/bin/sh\necho "Detecting region... failed"\necho \'{"error":{"code":1,"message":"Could not determine the API key region."}}\'\nexit 1\n', { mode: 0o755 });
    expect(await fetchMinimaxQuota({ bin, signedIn: true, env: {}, cwd: dir })).toMatchObject({ state: 'error', message: 'Could not determine the API key region.' });
  });
  test('output that is not JSON becomes an error with the message', async () => {
    expect(await fetchMinimaxQuota({ bin: '/bin/echo', signedIn: true, env: {}, cwd: '/' })).toMatchObject({ state: 'error' });
  });
});
