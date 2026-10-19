import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Engine, defaultConfig } from '@foundry/engine';
import { FakeRunner, makeRepo } from '../../engine/src/test-helpers.ts';
import { createApp } from './app.ts';

test("a goal's sessions cut before they reported a cost come with an estimate at their model's measured rate", async () => {
  const home = mkdtempSync(join(tmpdir(), 'foundry-cost-estimate-'));
  const repo = await makeRepo();
  const engine = new Engine(defaultConfig(resolve(import.meta.dir, '../../..'), { dataDir: home, claudeHome: join(home, 'claude'), useGraphify: false, log: () => {} }), new FakeRunner(() => {}));
  engine.beginUpdateDrain();
  try {
    const goal = await engine.createGoal({ prompt: 'p', repoPath: repo, nature: 'code' });
    const usage = (sessionId: string, inputTokens: number, costUsd: number, costStatus: 'reported' | 'unavailable') =>
      engine.store.append({ type: 'session.usage', goalId: goal.id, payload: { sessionId, kind: 'attempt', model: 'claude-opus-5-5', inputTokens, outputTokens: 0, cacheReadTokens: 0, cacheCreateTokens: 0, costUsd, durationMs: 1, subtype: costStatus === 'reported' ? 'success' : 'killed_timeout', rateLimit: null, skillsUsed: [], costStatus } });
    usage('s-measured', 1000, 0.05, 'reported');
    usage('s-cut', 3000, 0, 'unavailable');
    const d = (await (await createApp(engine).request(`/api/goals/${goal.id}`)).json()) as { costEstimate: { usd: number; sessions: number; estimated: number; bySession: Record<string, number> } };
    expect(d.costEstimate.sessions).toBe(1);
    expect(d.costEstimate.estimated).toBe(1);
    expect(d.costEstimate.usd).toBeCloseTo(0.15, 10);
    expect(Object.keys(d.costEstimate.bySession)).toEqual(['s-cut']);
  } finally {
    await engine.stop();
    rmSync(home, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
    rmSync(`${repo}-foundry`, { recursive: true, force: true });
  }
});
