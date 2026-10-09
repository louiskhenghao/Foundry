import { describe, expect, test } from 'bun:test';
import type { EngineEvent } from '@foundry/core';
import { DeliveryDigest, type DigestMessage } from './digest.ts';

const ev = (type: string, payload: object) => ({ id: 'ev', ts: '2026-10-09T00:00:00Z', goalId: 'g1', type, payload }) as EngineEvent;
const branch = (i: number) => ({ taskId: `t${i}`, index: i, branch: `goal/g1-${i}`, base: 'main', commit: 'abc', title: `feat: part ${i}` });
const opened = (n: number) => ev('delivery.pr_opened', { number: n, url: `https://github.com/x/y/pull/${n}`, base: 'main', head: `goal/g1-${n}`, taskId: null, title: `feat: part ${n}` });

describe('delivery digest', () => {
  test('a stack says what will open, then every PR in one message once all are open', () => {
    const said: DigestMessage[] = [];
    const d = new DeliveryDigest((m) => said.push(m));
    expect(d.take(ev('delivery.stack_built', { branches: [branch(1), branch(2), branch(3)] }), 'Dark mode')).toBe(true);
    expect(said[0]!.text).toStartWith('📦 Opening 3 pull requests — Dark mode');
    expect(said[0]!.text).toContain('3. feat: part 3');
    expect(d.take(opened(11), 'Dark mode')).toBe(true);
    expect(d.take(opened(12), 'Dark mode')).toBe(true);
    expect(said).toHaveLength(1);
    d.take(opened(13), 'Dark mode');
    expect(said).toHaveLength(2);
    expect(said[1]!.text).toStartWith('🔀 3 pull requests opened — Dark mode');
    expect(said[1]!.text).toContain('• #12 feat: part 12\n  https://github.com/x/y/pull/12');
    // the stack is told; a later PR of the same goal (a fix) gets its usual message
    expect(d.take(opened(14), 'Dark mode')).toBe(false);
  });

  test('a one-PR delivery keeps the usual messages', () => {
    const said: DigestMessage[] = [];
    const d = new DeliveryDigest((m) => said.push(m));
    expect(d.take(ev('delivery.stack_built', { branches: [branch(1)] }), 'x')).toBe(false);
    expect(d.take(opened(1), 'x')).toBe(false);
    expect(said).toHaveLength(0);
  });

  test('a delivery that ends early reports the PRs opened so far before its own message', () => {
    const said: DigestMessage[] = [];
    const d = new DeliveryDigest((m) => said.push(m));
    d.take(ev('delivery.stack_built', { branches: [branch(1), branch(2), branch(3)] }), 'x');
    d.take(opened(1), 'x');
    expect(d.take(ev('delivery.failed', { step: 'pr', reason: 'boom' }), 'x')).toBe(false);
    expect(said[1]!.text).toStartWith('🔀 1 of 3 pull requests opened — x');
  });

  test('merges are told together once they go quiet', async () => {
    const said: DigestMessage[] = [];
    const d = new DeliveryDigest((m) => said.push(m), { mergeQuietMs: 40 });
    for (const n of [11, 12, 13]) expect(d.take(ev('delivery.merged', { prNumber: n, method: 'squash', ref: null, taskId: null }), 'x')).toBe(true);
    expect(said).toHaveLength(0);
    await Bun.sleep(80);
    expect(said.map((m) => m.text)).toEqual(['🎉 3 pull requests merged — x\n#11, #12, #13']);
    d.take(ev('delivery.merged', { prNumber: 14, method: 'squash', ref: null, taskId: null }), 'x');
    await Bun.sleep(80);
    expect(said[1]!.text).toBe('🎉 PR #14 merged — x');
  });

  test('a stack whose PRs never all open is reported after the wait', async () => {
    const said: DigestMessage[] = [];
    const d = new DeliveryDigest((m) => said.push(m), { prWaitMs: 40 });
    d.take(ev('delivery.stack_built', { branches: [branch(1), branch(2)] }), 'x');
    d.take(opened(1), 'x');
    await Bun.sleep(80);
    expect(said[1]!.text).toStartWith('🔀 1 of 2 pull requests opened — x');
  });
});
