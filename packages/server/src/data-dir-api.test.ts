import { expect, test } from 'bun:test';
import { Goal } from '@foundry/core';
import { Engine, defaultConfig, readHomeConfig } from '@foundry/engine';
import { FakeRunner } from '../../engine/src/test-helpers.ts';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createApp } from './app.ts';

const ROOT = resolve(import.meta.dir, '../../..');
const post = (body: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const now = () => new Date().toISOString();
const goal = (id: string, title: string, state: Goal['state']) => Goal.parse({ id, title, prompt: 'p', repoPath: '/repo', baseBranch: 'main', branch: `goal/${id}`, budgets: {}, models: { strong: 'opus', cheap: 'haiku', worker: 'opus' }, state, stateBeforeBlock: null, costUsd: 0, fixCycles: 0, runningSince: null, createdAt: now(), updatedAt: now() });

test('the data folder routes: the status, a folder tested, and what a switch is refused for', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'foundry-data-dir-api-'));
  const data = join(dir, 'data');
  const home = join(dir, 'home');
  const engine = new Engine(defaultConfig(ROOT, { provider: 'claude', dataDir: data, foundryHome: home, claudeHome: join(dir, 'claude'), codexHome: join(dir, 'codex'), log: () => {} }), new FakeRunner(() => {}));
  const app = createApp(engine);
  const call = async (path: string, init?: RequestInit) => {
    const r = await app.request(path, init);
    return { status: r.status, body: await r.json() };
  };
  try {
    expect((await call('/api/data-dir')).body).toMatchObject({ current: data, source: 'override', readOnly: null, recent: [], configFile: join(home, 'config.json'), notice: null, restart: { attached: false, pending: null } });
    const empty = join(dir, 'empty');
    mkdirSync(empty);
    const tested = await call('/api/data-dir/test', post({ path: empty }));
    expect(tested.body).toMatchObject({ path: empty, kind: 'empty', ok: true, current: { path: data } });
    expect(tested.body.modes).toContain('blank');
    // no serve loop to start the engine again
    expect(await call('/api/data-dir/switch', post({ path: empty, mode: 'blank' }))).toMatchObject({ status: 409 });
    engine.restart.attached = true;
    // a folder that fails the test, and a way of opening that does not fit the folder
    const refused = await call('/api/data-dir/switch', post({ path: data, mode: 'open' }));
    expect(refused.status).toBe(422);
    expect(refused.body.error).toContain('the data folder in use');
    expect(refused.body.test.kind).toBe('current');
    expect((await call('/api/data-dir/switch', post({ path: empty, mode: 'open' }))).status).toBe(422);
    // a goal at work
    engine.store.append({ type: 'goal.created', goalId: 'g_1', payload: { goal: goal('g_1', 'at work', 'running') } });
    const busy = await call('/api/data-dir/switch', post({ path: empty, mode: 'blank' }));
    expect(busy.status).toBe(409);
    expect(busy.body).toMatchObject({ goals: [{ id: 'g_1', title: 'at work', state: 'running' }], sessions: 0 });
    expect(busy.body.error).toBe('1 goal is at work: pause it or wait until it has finished — "at work"');
    expect((await call('/api/engine/restart', post({}))).status).toBe(409);
    expect(engine.restart.pendingRequest()).toBeNull();
    // paused: not at work (ADR-0080)
    engine.store.append({ type: 'goal.state_changed', goalId: 'g_1', payload: { from: 'running', to: 'paused', reason: 'test' } });
    const ok = await call('/api/data-dir/switch', post({ path: empty, mode: 'blank' }));
    expect(ok).toMatchObject({ status: 202, body: { started: true, to: empty, mode: 'blank' } });
    expect(engine.restart.pendingRequest()).toEqual({ kind: 'data-dir', to: empty, mode: 'blank' });
    expect((await call('/api/data-dir')).body.restart).toEqual({ attached: true, pending: { kind: 'data-dir', to: empty, mode: 'blank' } });
    // keep the folder in use from now on (after a chosen one went missing)
    engine.dataDirNotice = { kind: 'missing', chosen: '/Volumes/gone', at: now() };
    expect((await call('/api/data-dir/keep', post({}))).body).toEqual({ ok: true, current: data });
    expect(readHomeConfig(home).dataDirs.claude).toBe(data);
    expect(engine.dataDirNotice).toBeNull();
  } finally {
    await engine.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('with FOUNDRY_DATA_DIR set the folder is not chosen here', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'foundry-data-dir-env-'));
  process.env.FOUNDRY_DATA_DIR = join(dir, 'data');
  let engine: Engine | null = null;
  try {
    engine = new Engine(defaultConfig(ROOT, { provider: 'claude', claudeHome: join(dir, 'claude'), codexHome: join(dir, 'codex'), log: () => {} }), new FakeRunner(() => {}));
    expect([engine.config.dataDir, engine.config.dataDirSource]).toEqual([join(dir, 'data'), 'env']);
    const app = createApp(engine);
    const status = await (await app.request('/api/data-dir')).json();
    expect(status.readOnly).toMatchObject({ reason: 'env' });
    engine.restart.attached = true;
    const r = await app.request('/api/data-dir/switch', post({ path: join(dir, 'other'), mode: 'blank' }));
    expect(r.status).toBe(403);
    expect((await app.request('/api/data-dir/keep', post({}))).status).toBe(403);
  } finally {
    delete process.env.FOUNDRY_DATA_DIR;
    await engine?.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});
