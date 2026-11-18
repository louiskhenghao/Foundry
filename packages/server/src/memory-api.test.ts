import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

test('the Hindsight card: Foundry runs the server, a failed one is tried again, the address of the person is kept for later (ADR-0109)', async () => {
  const home = mkdtempSync(join(tmpdir(), 'foundry-memory-run-'));
  const engine = new Engine(defaultConfig(resolve(import.meta.dir, '../../..'), { dataDir: home, claudeHome: join(home, 'claude'), useGraphify: false, log: () => {} }), new FakeRunner(() => {}));
  engine.beginUpdateDrain();
  const fake = new FakeBackend();
  let signedIn = false;
  const spawned: string[] = [];
  engine.memoryDeps = {
    backend: () => fake,
    server: {
      uv: () => '/usr/local/bin/uv',
      run: async (argv) => {
        if (argv[1] === 'venv') {
          mkdirSync(join(argv[4]!, 'bin'), { recursive: true });
          writeFileSync(join(argv[4]!, 'bin', 'python'), '');
        }
        return { code: 0, tail: '' };
      },
      // nobody is signed in at first: the server cannot start
      llm: async () => (signedIn ? 'claude-code' : null),
      spawn: (argv) => {
        let exit!: (c: number | null) => void;
        spawned.push(argv.join(' '));
        return { pid: 99_999_002, exited: new Promise<number | null>((r) => (exit = r)), kill: () => exit(0) };
      },
      answers: async () => '1.1.0',
      portFree: async () => true,
      commandOf: async () => '',
      pollMs: 5,
      stopGraceMs: 50,
    },
  };
  const app = createApp(engine);
  const json = (method: string, path: string, body?: unknown) => app.request(path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const status = async () => (await app.request('/api/memory')).json();
  try {
    engine.memory.startServer();
    await json('PUT', '/api/memory', { url: 'http://127.0.0.1:1/' });
    expect(await status()).toMatchObject({ run: false, server: { phase: 'off', installed: null } });
    // run it here: installed, then stopped for want of a sign-in; the address of the person's own server stays
    const on = await json('PUT', '/api/memory', { run: true, reflectSec: 120 });
    expect(on.status).toBe(200);
    expect(engine.settings.values().memory).toMatchObject({ run: true, url: 'http://127.0.0.1:1/', reflectSec: 120 });
    const failed = Date.now();
    while ((await status()).server.phase !== 'failed' && Date.now() - failed < 5_000) await Bun.sleep(10);
    expect(await status()).toMatchObject({ run: true, configured: false, server: { phase: 'failed', installed: '1.1.0', error: expect.stringContaining('neither Claude Code nor Codex') } });
    // signed in now: the same answer again tries again
    signedIn = true;
    await json('PUT', '/api/memory', { run: true });
    const started = Date.now();
    while ((await status()).server.phase !== 'running' && Date.now() - started < 5_000) await Bun.sleep(10);
    // the address in use is the server's; the person's own stays what they saved, for the card's form
    expect(await status()).toMatchObject({ run: true, configured: true, url: 'http://127.0.0.1:8888', ownUrl: 'http://127.0.0.1:1', reachable: true, server: { phase: 'running', port: 8888, llm: 'claude-code' } });
    expect(spawned).toHaveLength(1);
    // off: the server stops, the person's address is used again
    await json('PUT', '/api/memory', { run: false });
    expect(await status()).toMatchObject({ run: false, url: 'http://127.0.0.1:1', server: { phase: 'off' } });
    // the server's own Codex sign-in: a CLI that cannot run ends the sign-in with the reason; cancelling is always allowed
    engine.memoryDeps.server!.codexBin = () => '/nonexistent/codex';
    (engine.memory as unknown as { ownServer: null }).ownServer = null;
    const tried = await json('POST', '/api/memory/server/sign-in');
    expect(tried.status).toBe(200);
    expect((await tried.json()).server.signIn).toMatchObject({ done: true, ok: false, error: expect.stringContaining('nonexistent') });
    expect((await json('DELETE', '/api/memory/server/sign-in')).status).toBe(200);
  } finally {
    await engine.stop();
    rmSync(home, { recursive: true, force: true });
  }
}, 30_000);
