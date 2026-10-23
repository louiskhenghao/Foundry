import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { Engine, defaultConfig } from '@foundry/engine';
import { FakeMemoryBackend as FakeBackend } from '../../engine/src/memory/fake-backend.ts';
import { FakeRunner, makeRepo } from '../../engine/src/test-helpers.ts';
import { createApp } from './app.ts';

test('the Hindsight card: status, a try before saving, the save, and a folder left out', async () => {
  const home = mkdtempSync(join(tmpdir(), 'foundry-memory-api-'));
  const repo = await makeRepo();
  const engine = new Engine(defaultConfig(resolve(import.meta.dir, '../../..'), { dataDir: home, claudeHome: join(home, 'claude'), useGraphify: false, log: () => {} }), new FakeRunner(() => {}));
  engine.beginUpdateDrain();
  const fake = new FakeBackend();
  engine.memoryDeps = { backend: () => fake, reflectTimeoutMs: 200, retainTimeoutMs: 500 };
  const app = createApp(engine);
  const json = (method: string, path: string, body?: unknown) => app.request(path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  try {
    expect(await (await app.request('/api/memory')).json()).toMatchObject({ configured: false, url: null, tokenSet: false, reachable: null, retainTranscripts: true, seedCommits: 300, excludedFolders: [] });

    // try an address: the server answers, or not
    expect(await (await json('POST', '/api/memory/test', { url: 'http://127.0.0.1:1', token: 'tok-abcdef' })).json()).toEqual({ ok: true, version: '1.1.0-test', error: null });
    fake.down = true;
    expect(await (await json('POST', '/api/memory/test', { url: 'http://127.0.0.1:1' })).json()).toMatchObject({ ok: false, version: null, error: expect.stringContaining('refused') });
    fake.down = false;
    expect((await json('POST', '/api/memory/test', { url: 'not a url' })).status).toBe(400);

    // save: the status says it is set and reachable, and never carries the token itself
    const saved = await json('PUT', '/api/memory', { url: 'http://127.0.0.1:1/', token: 'tok-abcdef', retainTranscripts: false });
    expect(saved.status).toBe(200);
    const status = await saved.json();
    expect(status).toMatchObject({ configured: true, url: 'http://127.0.0.1:1', tokenSet: true, reachable: true, version: '1.1.0-test', retainTranscripts: false });
    expect(JSON.stringify(status)).not.toContain('tok-abcdef');
    expect(engine.settings.values().memory).toMatchObject({ url: 'http://127.0.0.1:1/', token: 'tok-abcdef', retainTranscripts: false });
    // an empty token keeps the saved one; null forgets it
    await json('PUT', '/api/memory', { url: 'http://127.0.0.1:1/', token: '' });
    expect(engine.settings.values().memory.token).toBe('tok-abcdef');
    await json('PUT', '/api/memory', { url: 'http://127.0.0.1:1/', token: null });
    expect(engine.settings.values().memory.token).toBeNull();

    // a folder: its bank, and the switch on the Learnings page
    expect(await (await app.request(`/api/memory/folder?repo=${encodeURIComponent(repo)}`)).json()).toEqual({ repoPath: repo, bank: `coding-agent::${basename(repo)}`, enabled: true, excluded: false });
    expect(await (await json('PUT', '/api/memory/folder', { repoPath: repo, on: false })).json()).toMatchObject({ enabled: false, excluded: true });
    expect(engine.settings.values().memory.excludedFolders).toEqual([repo]);
    expect(await (await json('PUT', '/api/memory/folder', { repoPath: repo, on: true })).json()).toMatchObject({ enabled: true, excluded: false });
    expect((await app.request('/api/memory/folder?repo=relative')).status).toBe(400);
    // the everywhere notebook's card asks for the person's own bank
    expect(await (await app.request('/api/memory/folder?repo=*')).json()).toEqual({ repoPath: '*', bank: 'foundry::person', enabled: true, excluded: false });

    // off again: nothing is set
    await json('PUT', '/api/memory', { url: null });
    expect(await (await app.request('/api/memory')).json()).toMatchObject({ configured: false, reachable: null });
  } finally {
    await engine.stop();
    for (const path of [home, repo, `${repo}-foundry`]) rmSync(path, { recursive: true, force: true });
  }
}, 30_000);
