import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Engine, defaultConfig } from '@foundry/engine';
import { makeFakeHome } from '../../engine/src/skills/fake-home.test-helper.ts';
import { FakeRunner, makeRepo } from '../../engine/src/test-helpers.ts';
import { createApp } from './app.ts';

type Usage = { goals: number; sessions: number; lastUsedAt: string | null; unused: boolean };
type Overview = { installed: { name: string; scope: string; usage?: Usage | null }[]; usageWindow: { goals: number; limit: number } | null };

describe('GET /api/skills carries skill usage', () => {
  const fake = makeFakeHome();
  let repo: string;
  let engine: Engine;
  const get = async (query = '') => {
    const r = await createApp(engine).request(`/api/skills${query}`);
    expect(r.status).toBe(200);
    return (await r.json()) as Overview;
  };
  const rows = (o: Overview, name: string) => o.installed.filter((s) => s.name === name);

  beforeAll(async () => {
    repo = await makeRepo();
    engine = new Engine(defaultConfig(resolve(import.meta.dir, '../../..'), { provider: 'claude', dataDir: fake.dataDir, claudeHome: fake.claudeHome, codexHome: join(fake.home, '.codex'), useGraphify: false, log: () => {} }), new FakeRunner(() => {}));
    engine.beginUpdateDrain();
    const a = await engine.createGoal({ prompt: 'a', repoPath: repo, nature: 'code' });
    const b = await engine.createGoal({ prompt: 'b', repoPath: repo, nature: 'code' });
    engine.store.append({ type: 'session.usage', goalId: a.id, payload: { sessionId: 's-a', kind: 'attempt', model: 'claude-opus-5-5', inputTokens: 1, outputTokens: 0, cacheReadTokens: 0, cacheCreateTokens: 0, costUsd: 0, durationMs: 1, subtype: 'success', rateLimit: null, skillsUsed: ['mattpocock-skills:tdd'] } });
    engine.store.append({ type: 'attempt.finished', goalId: b.id, payload: { attemptId: 'at-b', state: 'observing', resultSubtype: 'success', costUsd: 0, numTurns: 1, endRef: null, permissionDenials: [], toolsUsed: {}, skillsUsed: ['tdd'] } });
  });
  afterAll(async () => {
    await engine.stop();
    rmSync(fake.home, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
    rmSync(`${repo}-foundry`, { recursive: true, force: true });
  });

  test('every user and plugin row says how many of the last goals invoked it; the rest are unused', async () => {
    const o = await get();
    expect(o.usageWindow).toEqual({ goals: 2, limit: 30 });
    const tdd = rows(o, 'tdd');
    expect(tdd.map((s) => s.scope).sort()).toEqual(['plugin', 'user']);
    for (const s of tdd) {
      expect(s.usage).toMatchObject({ goals: 2, unused: false });
      expect(typeof s.usage?.lastUsedAt).toBe('string');
    }
    expect(rows(o, 'diagnosing-bugs')[0]?.usage).toEqual({ goals: 0, sessions: 0, lastUsedAt: null, unused: true });
    expect(rows(o, 'plain')[0]?.usage?.unused).toBe(true);
  });

  test('?goals=N sets the window, clamped to 1–500, anything unparsable falls back to 30', async () => {
    expect((await get('?goals=1')).usageWindow).toEqual({ goals: 1, limit: 1 });
    expect((await get('?goals=abc')).usageWindow?.limit).toBe(30);
    expect((await get('?goals=0')).usageWindow?.limit).toBe(1);
    expect((await get('?goals=9999')).usageWindow?.limit).toBe(500);
  });

  test('project rows carry no usage', async () => {
    const proj = rows(await get(`?repo=${encodeURIComponent(fake.repo)}`), 'proj-real');
    expect(proj).toHaveLength(1);
    expect(proj[0]!.usage).toBeNull();
  });

  test('the Codex side counts nothing', async () => {
    const o = await get('?provider=codex');
    expect(o.usageWindow).toBeNull();
    for (const s of o.installed) expect(s.usage ?? null).toBeNull();
  });
});
