import { expect, test } from 'bun:test';
import type { AgentRunner, RunHandle, RunResult, RunSpec } from '@foundry/runner';
import { ProviderRunner } from './provider-runner.ts';

const OK: RunResult = { sessionId: 's', subtype: 'success', isError: false, costUsd: 0, numTurns: 1, durationMs: 1, usage: null, modelUsage: null, permissionDenials: [], finalText: null, structuredOutput: null, exitCode: 0, pid: null, rateLimit: null, errorMessage: null, skillsUsed: [], toolsUsed: {} };

/** a runner whose sessions end when the test ends them, in the order they started */
function held(): { runner: AgentRunner & { calls: RunSpec[] }; end: () => void } {
  const calls: RunSpec[] = [];
  const ends: (() => void)[] = [];
  const runner = {
    calls,
    active: () => 0,
    async run(spec: RunSpec): Promise<RunHandle> {
      calls.push(spec);
      const result = new Promise<RunResult>((resolve) => ends.push(() => resolve(OK)));
      return { pid: null, events: (async function* () {})(), kill() {}, result };
    },
  };
  return { runner, end: () => ends.shift()?.() };
}

test('a session a person waits for passes its lane down and takes one slot beyond the limit; wouldQueue says when it would wait', async () => {
  const claude = held();
  const runner = new ProviderRunner({ claude: claude.runner, codex: claude.runner }, () => 'claude', 1);
  const spec = (lane?: 'interactive' | 'work'): RunSpec => ({ prompt: 'p', cwd: '/', lane });
  const work = await runner.run(spec());
  expect(runner.wouldQueue()).toBe(true);
  expect(runner.wouldQueue('interactive')).toBe(false);
  const first = await runner.run(spec('interactive'));
  expect(claude.runner.calls.map((c) => c.lane)).toEqual([undefined, 'interactive']);
  expect(runner.active()).toBe(2);
  expect(runner.wouldQueue('interactive')).toBe(true);
  let started = false;
  const second = runner.run(spec('interactive')).then((h) => {
    started = true;
    return h;
  });
  await Bun.sleep(5);
  expect(started).toBe(false);
  // the work session ends: the waiting interactive one starts next to the first
  claude.end();
  await work.result;
  await Bun.sleep(5);
  expect(started).toBe(true);
  expect(runner.active()).toBe(2);
  claude.end();
  claude.end();
  await Promise.all([first.result, (await second).result]);
  expect(runner.active()).toBe(0);
  expect(runner.wouldQueue()).toBe(false);
});
