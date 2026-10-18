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
    expect(info.providers.map((p: { id: string; configured: boolean }) => [p.id, p.configured])).toEqual([
      ['vercel', false],
      ['netlify', false],
      ['cloudflare', false],
    ]);
    const refused = await post(goal.id, { provider: 'vercel', production: false });
    expect(refused.status).toBe(409);
    expect((await refused.json()).error).toContain('only a finished goal is deployed');
    expect((await post(goal.id, { provider: 'heroku' })).status).toBe(400);
  } finally {
    await engine.stop();
    for (const path of [home, repo, `${repo}-foundry`]) rmSync(path, { recursive: true, force: true });
  }
}, 30_000);
