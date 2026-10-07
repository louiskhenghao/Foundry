import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RunHandle, RunResult, RunSpec } from '@foundry/runner';
import { SessionCosts } from './session-costs.ts';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** a CLI that, like Claude Code, reports the session's whole cost so far */
const cli = (totals: number[]) => {
  const specs: RunSpec[] = [];
  const run = async (spec: RunSpec): Promise<RunHandle> => {
    specs.push(spec);
    const result = { sessionId: 's1', costUsd: totals[specs.length - 1]! } as RunResult;
    return { pid: null, kill() {}, events: (async function* () { yield { kind: 'result' as const, result }; })(), result: Promise.resolve(result) };
  };
  return { specs, run };
};

describe('SessionCosts', () => {
  test('a resumed session is booked for what the run added, its budget raised by what it already spent, also after a restart', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'foundry-session-costs-'));
    dirs.push(dir);
    const c = cli([1.5, 2, 6.5]);
    const costs = new SessionCosts(dir);
    expect((await (await costs.run({ prompt: 'a', cwd: '.', maxBudgetUsd: 6 }, c.run)).result).costUsd).toBe(1.5);
    const second = await costs.run({ prompt: 'b', cwd: '.', maxBudgetUsd: 6, resumeSessionId: 's1' }, c.run);
    const events: unknown[] = [];
    for await (const ev of second.events) events.push(ev);
    expect(events).toEqual([{ kind: 'result', result: { sessionId: 's1', costUsd: 0.5 } }]);
    expect((await second.result).costUsd).toBe(0.5);
    expect(c.specs[1]!.maxBudgetUsd).toBe(7.5);
    // a new engine (restart) still knows the session spent $2
    const third = await new SessionCosts(dir).run({ prompt: 'c', cwd: '.', maxBudgetUsd: 6, resumeSessionId: 's1' }, c.run);
    expect((await third.result).costUsd).toBe(4.5);
    expect(c.specs[2]!.maxBudgetUsd).toBe(8);
  });

  test("a resume the CLI did not restore reports the run's own cost: it is booked whole and added to the session's total", async () => {
    const dir = mkdtempSync(join(tmpdir(), 'foundry-session-costs-'));
    dirs.push(dir);
    const mu = (out: number) => ({ 'model-a': { outputTokens: out } });
    // real shapes: `usage` is this run's, `modelUsage` the session's whole when restored
    const runs: RunResult[] = [
      { sessionId: 's1', costUsd: 1.7, usage: { output_tokens: 3972 }, modelUsage: mu(3972) } as unknown as RunResult,
      // restored: the model usage holds the earlier 3972 on top of this run's 1686
      { sessionId: 's1', costUsd: 2.2, usage: { output_tokens: 1686 }, modelUsage: mu(5658) } as unknown as RunResult,
      // not restored (another session finished in the folder in between): only this run's tokens and cost
      { sessionId: 's1', costUsd: 0.5, usage: { output_tokens: 1000 }, modelUsage: mu(1000) } as unknown as RunResult,
      // a long restored run whose own output dwarfs the earlier: the CLI restores the state it saved last (0.5, 1000)
      { sessionId: 's1', costUsd: 5.5, usage: { output_tokens: 39021 }, modelUsage: mu(40021) } as unknown as RunResult,
    ];
    let n = 0;
    const run = async (): Promise<RunHandle> => {
      const result = runs[n++]!;
      return { pid: null, kill() {}, events: (async function* () {})(), result: Promise.resolve(result) };
    };
    const costs = new SessionCosts(dir);
    const booked = [];
    for (const resume of [undefined, 's1', 's1', 's1']) booked.push((await (await costs.run({ prompt: 'x', cwd: '.', resumeSessionId: resume }, run)).result).costUsd);
    expect(booked.map((c) => Math.round(c * 100) / 100)).toEqual([1.7, 0.5, 0.5, 5]);
  });
});
