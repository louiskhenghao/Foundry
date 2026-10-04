import { expect, test } from 'bun:test';
import { CodexQuotaReader, quotaView } from './codex-quota.ts';
import type { CodexUsageSnapshot } from './codex-usage.ts';
import { parseCodexUsage } from './codex-usage.ts';

const data = () => parseCodexUsage({ ordinaryUsageAllowed: null, rateLimits: { primary: { usedPercent: 100, windowDurationMins: 300, resetsAt: 1 } }, rateLimitsByLimitId: { alpha: { limitName: 'Alpha', primary: { usedPercent: 20, windowDurationMins: 300, resetsAt: 1 } }, beta: { primary: null, secondary: null } } });

test('native quota prefers all named buckets and preserves unknown permission, even after resets', () => {
  const result = quotaView(data());
  expect(result.state).toBe('available');
  if (result.state !== 'available') throw new Error();
  expect(result.ordinaryUsageAllowed).toBeNull();
  expect(result.buckets.map((b) => b.id)).toEqual(['alpha', 'beta']);
  expect(result.buckets[0]!.primary!.usedPercent).toBe(20);
  expect(result.buckets[1]!.primary).toBeNull();
});

test('quota polling coalesces, caches, and explicit refresh makes a new native read', async () => {
  let reads = 0;
  const reader = new CodexQuotaReader({ bin: () => 'codex', home: '/test', read: async () => { reads++; return data(); } });
  await Promise.all([reader.read(), reader.read(), reader.read(true)]);
  expect(reads).toBe(1);
  await reader.read(); expect(reads).toBe(1);
  await reader.read(true); expect(reads).toBe(2);
});

test('account changes abort pending reads and discard old account quota', async () => {
  let finish!: (value: CodexUsageSnapshot) => void;
  let signal!: AbortSignal;
  const reader = new CodexQuotaReader({ bin: () => 'codex', home: '/test', read: async (_bin, _home, options) => {
    signal = options!.signal!;
    return new Promise((resolve) => { finish = resolve; });
  } });
  const old = reader.read();
  reader.invalidate();
  expect(signal.aborted).toBe(true);
  finish(data());
  expect((await old).state).toBe('unavailable');
  expect(reader.current()).toBeUndefined();
});

test('unavailable CLI and raw upstream failures never leak credentials or become zero quota', async () => {
  const missing = new CodexQuotaReader({ bin: () => null, home: '/test' });
  expect((await missing.read()).state).toBe('unavailable');
  const broken = new CodexQuotaReader({ bin: () => 'codex', home: '/test', read: async () => { throw new Error('secret-token'); } });
  const result = await broken.read();
  expect(result.state).toBe('error');
  expect(JSON.stringify(result)).not.toContain('secret-token');
  expect('buckets' in result).toBe(false);
});
