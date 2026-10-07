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
});
