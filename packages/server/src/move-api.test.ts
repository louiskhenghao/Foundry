import { expect, test } from 'bun:test';
import { Goal } from '@foundry/core';
import { Engine, defaultConfig } from '@foundry/engine';
import { FakeRunner } from '../../engine/src/test-helpers.ts';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createApp } from './app.ts';

const ROOT = resolve(import.meta.dir, '../../..');
const post = (body: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const now = () => new Date().toISOString();

test('the move routes (ADR-0107): a checkout never offers or takes a move, and goals at work here refuse one', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'foundry-move-api-'));
  const engine = new Engine(defaultConfig(ROOT, { provider: 'claude', dataDir: join(dir, 'data'), foundryHome: join(dir, 'home'), claudeHome: join(dir, 'claude'), codexHome: join(dir, 'codex'), log: () => {} }), new FakeRunner(() => {}));
  const app = createApp(engine);
  const call = async (path: string, init?: RequestInit) => {
    const r = await app.request(path, init);
    return { status: r.status, body: await r.json() };
  };
  try {
    // these tests run from a checkout: it looks for nothing, and offers nothing
    expect((await call('/api/move')).body).toMatchObject({ kind: 'checkout', offer: false, installs: [], here: { goals: 0 }, job: null, last: null });
    // no serve loop to swap a move in
    expect((await call('/api/move', post({ id: 'source:/x' }))).status).toBe(409);
    engine.restart.attached = true;
    const refused = await call('/api/move', post({ id: 'source:/x' }));
    expect(refused).toMatchObject({ status: 409, body: { error: 'a checkout does not take a move: install the app or the binary, and move there' } });
    // a goal at work here: a move would restart under it
    engine.store.append({ type: 'goal.created', goalId: 'g_1', payload: { goal: Goal.parse({ id: 'g_1', title: 'busy', prompt: 'p', repoPath: '/repo', baseBranch: 'main', branch: 'goal/g_1', budgets: {}, models: { strong: 'opus', cheap: 'haiku', worker: 'opus' }, state: 'running', stateBeforeBlock: null, costUsd: 0, fixCycles: 0, runningSince: null, createdAt: now(), updatedAt: now() }) } });
    const busy = await call('/api/move', post({ id: 'source:/x' }));
    expect(busy.status).toBe(409);
    expect(busy.body.error).toContain('at work');
    expect((await call('/api/move', post({}))).status).toBe(400);
  } finally {
    await engine.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});
