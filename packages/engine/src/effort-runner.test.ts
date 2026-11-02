import { describe, expect, test } from 'bun:test';
import type { ClaudeRunner, RunHandle, RunSpec } from '@foundry/runner';
import { EventStore, openDatabase } from '@foundry/core';
import { EffortRunner } from './effort-runner.ts';

/** the effort runner hands every session its goal's level — and, since ADR-0085, a level the binary no longer takes runs as its nearest neighbour */
describe('EffortRunner', () => {
  const seen: RunSpec[] = [];
  const inner: ClaudeRunner = {
    active: () => 0,
    run: async (spec: RunSpec) => {
      seen.push(spec);
      return {} as RunHandle;
    },
  } as unknown as ClaudeRunner;
  const store = new EventStore(openDatabase(':memory:'));

  test('passes a level the binary takes, maps one it does not to the nearest, and says so once', async () => {
    const notes: string[] = [];
    const runner = new EffortRunner(inner, () => store.db, () => 'max', () => ['low', 'medium', 'high', 'xhigh', 'ultra'], (m) => notes.push(m));
    seen.length = 0;
    await runner.run({ prompt: 'p', cwd: '/', model: 'opus' } as RunSpec);
    await runner.run({ prompt: 'p', cwd: '/', model: 'opus', effort: 'high' } as RunSpec);
    await runner.run({ prompt: 'p', cwd: '/', model: 'opus' } as RunSpec);
    expect(seen.map((s) => s.effort)).toEqual(['ultra', 'high', 'ultra']);
    expect(notes).toEqual(['[effort] max is not a level this coding agent takes (low, medium, high, xhigh, ultra): sessions asking for it run with ultra']);
  });
  test('with no list of levels every level goes through as asked', async () => {
    const runner = new EffortRunner(inner, () => store.db, () => 'max');
    seen.length = 0;
    await runner.run({ prompt: 'p', cwd: '/', model: 'opus' } as RunSpec);
    expect(seen[0]!.effort).toBe('max');
  });
});
