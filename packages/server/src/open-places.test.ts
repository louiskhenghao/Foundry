import { expect, test } from 'bun:test';
import { Engine, defaultConfig } from '@foundry/engine';
import { FakeRunner, makeRepo } from '../../engine/src/test-helpers.ts';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createApp } from './app.ts';

test('an Open menu place is resolved on the server: a resolve worktree only for a task of the goal, never a path from the request', async () => {
  const home = mkdtempSync(join(tmpdir(), 'foundry-open-places-'));
  const repo = await makeRepo();
  const engine = new Engine(defaultConfig(resolve(import.meta.dir, '../../..'), { dataDir: home, claudeHome: join(home, 'claude'), useGraphify: false, log: () => {} }), new FakeRunner(() => {}));
  engine.beginUpdateDrain();
  const app = createApp(engine);
  try {
    const goal = await engine.createGoal({ prompt: 'open places', repoPath: repo, nature: 'code' });
    const open = (which: string) => app.request(`/api/goals/${goal.id}/open`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ target: 'finder', which }) });
    for (const which of [`resolve:${'../'.repeat(30)}etc`, 'resolve:t_nope', 'task:t_nope']) {
      const r = await open(which);
      expect(r.status).toBe(404);
      expect((await r.json()).error).toContain('nothing to open');
    }
  } finally {
    await engine.stop();
    rmSync(home, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  }
});

test('a change another site makes the browser send is refused; the UI, tools and the dev server get through', async () => {
  const { crossSite } = await import('./app.ts');
  const req = (headers: Record<string, string>) => new Request('http://127.0.0.1:4111/api/x', { method: 'POST', headers: { host: '127.0.0.1:4111', ...headers } });
  expect(crossSite(req({ 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' }))).toBe(true);
  expect(crossSite(req({ 'sec-fetch-site': 'same-origin', origin: 'http://127.0.0.1:4111' }))).toBe(false);
  // the web dev server on another port of the same host
  expect(crossSite(req({ 'sec-fetch-site': 'same-site', origin: 'http://127.0.0.1:5173' }))).toBe(false);
  // browsers without Sec-Fetch-Site: the Origin's host decides
  expect(crossSite(req({ origin: 'https://evil.example' }))).toBe(true);
  expect(crossSite(req({ origin: 'http://127.0.0.1:5173' }))).toBe(false);
  expect(crossSite(req({ origin: 'null' }))).toBe(true);
  // curl, the CLI and the sessions' hooks send neither
  expect(crossSite(req({}))).toBe(false);
});
