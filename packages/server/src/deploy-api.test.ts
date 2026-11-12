import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Engine, defaultConfig } from '@foundry/engine';
import { FakeRunner, makeRepo } from '../../engine/src/test-helpers.ts';
import { createApp } from './app.ts';

test('Deploy: what a goal offers, and a deploy refused before it starts', async () => {
  const home = mkdtempSync(join(tmpdir(), 'foundry-deploy-api-'));
  const repo = await makeRepo();
  const engine = new Engine(defaultConfig(resolve(import.meta.dir, '../../..'), { dataDir: home, claudeHome: join(home, 'claude'), useGraphify: false, log: () => {} }), new FakeRunner(() => {}));
  engine.beginUpdateDrain();
  const app = createApp(engine);
  const post = (id: string, body: unknown) => app.request(`/api/goals/${id}/deploy`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const goal = await engine.createGoal({ prompt: 'a goal', repoPath: repo, nature: 'code' });
    const info = await (await app.request(`/api/goals/${goal.id}/deploy?provider=vercel`)).json();
    expect(info).toMatchObject({ finished: false, running: false, app: { ok: false }, plan: [], deployments: [] });
    expect(info.providers.map((p: { id: string; kind: string; configured: boolean }) => [p.id, p.kind, p.configured])).toEqual([
      ['vercel', 'host', false],
      ['netlify', 'host', false],
      ['cloudflare', 'host', false],
      ['fly', 'paas', false],
      ['railway', 'paas', false],
      ['render', 'paas', false],
    ]);
    // the platforms (ADR-0093): what each would run of the project, and a token missing refuses the deploy in words
    expect(info.paas).toEqual({ fly: { ok: false, reason: expect.stringContaining('from a Dockerfile') }, railway: { ok: false, reason: expect.stringContaining('no Dockerfile and no known stack') }, render: { ok: false, reason: expect.stringContaining('no Dockerfile and no known stack') } });
    expect((await (await app.request(`/api/goals/${goal.id}/deploy/readiness?provider=railway`)).json()).items[0]).toMatchObject({ id: 'token', ok: false, label: 'Railway token in Settings' });
    const refused = await post(goal.id, { provider: 'vercel', production: false });
    expect(refused.status).toBe(409);
    expect((await refused.json()).error).toContain('only a finished goal is deployed');
    expect((await post(goal.id, { provider: 'heroku' })).status).toBe(400);

    // a server from Settings is a place of its own on the card (ADR-0091): named, with its key or without, refusing a project it cannot run
    engine.updateSettings({ delivery: { servers: [{ id: 'srv1', name: 'box', host: 'h.example', port: 22, user: 'deploy', privateKey: null, dir: '~/apps', publicUrl: null, allowPrivileged: false, mode: 'docker' as const }] } });
    const withServer = await (await app.request(`/api/goals/${goal.id}/deploy?provider=server&target=srv1`)).json();
    expect(withServer.providers.at(-1)).toEqual({ id: 'server', target: 'srv1', kind: 'server', label: 'box', configured: false, refused: expect.stringContaining('no compose file'), permissive: false, mode: 'docker', host: 'h.example', user: 'deploy' });
    expect(withServer.server).toEqual({ ok: false, reason: expect.stringContaining('no compose file') });
    expect(withServer.plan).toEqual([]);
    // the readiness check: a host's token, or a server's items (none tried without its key)
    const host = await (await app.request(`/api/goals/${goal.id}/deploy/readiness?provider=vercel`)).json();
    expect(host).toMatchObject({ ok: false, items: [{ id: 'token', ok: false, fix: { settings: 'git' } }] });
    const server = await (await app.request(`/api/goals/${goal.id}/deploy/readiness?provider=server&target=srv1`)).json();
    expect(server.ok).toBe(false);
    expect(server.items.map((i: { id: string; ok: boolean; severity: string }) => [i.id, i.ok, i.severity])).toEqual([['key', false, 'error'], ['reach', false, 'error'], ['docker', false, 'error'], ['folder', false, 'error'], ['front', false, 'warn'], ['env', true, 'warn']]);
    // the runtime variables of a place (ADR-0093): names only come back, a save needs the revision, other sources add names
    const envUrl = `/api/goals/${goal.id}/deploy/env?place=server:srv1`;
    expect(await (await app.request(envUrl)).json()).toMatchObject({ place: 'server:srv1', rev: 0, keys: [], missing: [], fromPreview: [] });
    const put = (body: unknown) => app.request(envUrl, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    expect(await (await put({ vars: { DATABASE_URL: 'postgres://db/app' }, rev: 0 })).json()).toMatchObject({ rev: 1, keys: ['DATABASE_URL'] });
    expect((await put({ vars: { DATABASE_URL: null }, rev: 0 })).status).toBe(409);
    expect((await put({ vars: { 'bad name': 'x' }, rev: 1 })).status).toBe(400);
    expect((await app.request(`/api/goals/${goal.id}/deploy/env?place=heroku`)).status).toBe(400);
    engine.preview.env.set(repo, { SESSION_SECRET: 'abcdefghij' }, 0);
    const copied = await (await app.request(`/api/goals/${goal.id}/deploy/env/from-preview?place=server:srv1`, { method: 'POST' })).json();
    expect(copied).toMatchObject({ added: ['SESSION_SECRET'], view: { keys: ['DATABASE_URL', 'SESSION_SECRET'] } });
    expect(JSON.stringify(copied)).not.toContain('abcdefghij');
    expect((await app.request(`/api/goals/${goal.id}/deploy/readiness?provider=server&target=nope`)).status).toBe(409);
    expect((await app.request(`/api/goals/${goal.id}/deploy/readiness?provider=nope`)).status).toBe(400);
    const noTarget = await post(goal.id, { provider: 'server', production: true });
    expect(noTarget.status).toBe(409);
  } finally {
    await engine.stop();
    for (const path of [home, repo, `${repo}-foundry`]) rmSync(path, { recursive: true, force: true });
  }
}, 30_000);

test('Server recipes (ADR-0092): listed whole, run on a server the engine knows, their runs read back', async () => {
  const home = mkdtempSync(join(tmpdir(), 'foundry-recipes-api-'));
  const engine = new Engine(defaultConfig(resolve(import.meta.dir, '../../..'), { dataDir: home, claudeHome: join(home, 'claude'), useGraphify: false, log: () => {} }), new FakeRunner(() => {}));
  engine.beginUpdateDrain();
  const app = createApp(engine);
  try {
    const { recipes } = await (await app.request('/api/servers/recipes')).json();
    expect(recipes.map((r: { id: string }) => r.id)).toEqual(['install-docker', 'install-node-pm2', 'install-postgres', 'install-redis', 'nginx-site']);
    expect(recipes[0].text).toContain('set -euo pipefail');
    expect(recipes[0].changes.length).toBeGreaterThan(0);
    // no such server, no key: refused before anything runs
    expect((await app.request('/api/servers/nope/recipes/install-redis/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status).toBe(409);
    engine.updateSettings({ delivery: { servers: [{ id: 'srv1', name: 'box', host: 'h.example', port: 22, user: 'root', privateKey: null, dir: '~/apps', publicUrl: null, allowPrivileged: false, mode: 'docker' }] } });
    const noKey = await app.request('/api/servers/srv1/recipes/install-redis/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ params: {} }) });
    expect(noKey.status).toBe(409);
    expect((await noKey.json()).error).toContain('has no SSH key');
    expect(await (await app.request('/api/servers/srv1/recipes/runs')).json()).toEqual({ runs: [] });
  } finally {
    await engine.stop();
    rmSync(home, { recursive: true, force: true });
  }
}, 30_000);
