import { expect, test } from 'bun:test';
import { Engine, readHomeConfig, writeHomeConfig } from '@foundry/engine';
import { FakeRunner } from '../../engine/src/test-helpers.ts';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { serveLoop } from './serve-loop.ts';

const ROOT = resolve(import.meta.dir, '../../..');
const until = async <T>(f: () => T | null | undefined | false, ms = 20_000): Promise<T> => {
  const t0 = Date.now();
  for (;;) {
    const v = f();
    if (v) return v as T;
    if (Date.now() - t0 > ms) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 25));
  }
};

test('serve switches the data folder in this process: a copy, the choice kept, a folder that cannot boot falls back, a plain restart keeps the folder', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'foundry-serve-loop-'));
  const home = join(dir, 'home');
  const A = join(dir, 'a');
  mkdirSync(A);
  writeHomeConfig(home, { dataDirs: { claude: A }, recent: [] });
  let failOn: string | null = null;
  const loop = serveLoop({
    root: ROOT,
    config: { foundryHome: home, provider: 'claude', claudeHome: join(dir, 'claude'), codexHome: join(dir, 'codex'), host: '127.0.0.1', port: 0, log: () => {} },
    makeEngine: (cfg) => {
      // never the checkout's own data/: the choice kept under `home` decides every boot here
      if (!cfg.dataDir.startsWith(dir)) throw new Error(`a test engine on ${cfg.dataDir}`);
      if (cfg.dataDir === failOn) throw new Error('no boot for you');
      return new Engine(cfg, new FakeRunner(() => {}));
    },
    log: () => {},
    // the 202 that asked must leave before the server closes its connections
    graceMs: 50,
  });
  try {
    let cur = await until(() => loop.current());
    expect(cur.engine.config.dataDir).toBe(A);
    expect(cur.engine.restart.attached).toBe(true);
    const url = (path: string) => `http://127.0.0.1:${loop.current()!.server.port}${path}`;
    const post = (path: string, body: unknown) => fetch(url(path), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const get = async (path: string) => (await fetch(url(path))).json();
    // something to carry over: a saved setting and its event
    cur.engine.updateSettings({ engine: { maxConcurrent: 5 } });
    const events = cur.engine.store.count();
    expect(await get('/api/data-dir')).toMatchObject({ current: A, source: 'config', restart: { attached: true, pending: null }, notice: null });

    // a folder with other things in it is refused, and nothing stops
    const other = join(dir, 'other');
    mkdirSync(other);
    writeFileSync(join(other, 'x.txt'), '');
    expect((await post('/api/data-dir/switch', { path: other, mode: 'blank' })).status).toBe(422);
    expect(loop.current()?.engine).toBe(cur.engine);

    // a copy into an empty folder
    const B = join(dir, 'b');
    const r = await post('/api/data-dir/switch', { path: B, mode: 'clone' });
    expect(r.status).toBe(202);
    expect(await r.json()).toEqual({ started: true, to: B, mode: 'clone' });
    const first = cur.engine;
    cur = await until(() => {
      const c = loop.current();
      return c && c.engine !== first ? c : null;
    });
    expect(cur.engine.config.dataDir).toBe(B);
    expect(cur.engine.config.dataDirSource).toBe('config');
    // what the first engine wrote is there (an engine's own start adds notes of its own, before and after the count was taken)
    expect(cur.engine.store.count()).toBeGreaterThanOrEqual(events);
    expect((cur.engine.store.db.query("SELECT count(*) AS n FROM events WHERE type = 'settings.changed'").get() as { n: number }).n).toBe(1);
    expect(cur.engine.settings.values().engine.maxConcurrent).toBe(5);
    expect(existsSync(join(A, 'engine.db'))).toBe(true);
    expect(readHomeConfig(home)).toMatchObject({ dataDirs: { claude: B }, recent: [A] });
    expect(await get('/api/data-dir')).toMatchObject({ current: B, source: 'config', recent: [A], notice: null });

    // a restart on the same folder: a new engine, the same data
    const second = cur.engine;
    expect((await post('/api/engine/restart', {})).status).toBe(202);
    cur = await until(() => {
      const c = loop.current();
      return c && c.engine !== second ? c : null;
    });
    expect(cur.engine.config.dataDir).toBe(B);
    // what the first engine wrote is there (an engine's own start adds notes of its own, before and after the count was taken)
    expect(cur.engine.store.count()).toBeGreaterThanOrEqual(events);
    expect((cur.engine.store.db.query("SELECT count(*) AS n FROM events WHERE type = 'settings.changed'").get() as { n: number }).n).toBe(1);

    // a folder whose boot fails: back on B, the choice put back, and a notice for Settings
    const C = join(dir, 'c');
    failOn = C;
    const third = cur.engine;
    expect((await post('/api/data-dir/switch', { path: C, mode: 'blank' })).status).toBe(202);
    cur = await until(() => {
      const c = loop.current();
      return c && c.engine !== third ? c : null;
    });
    expect(cur.engine.config.dataDir).toBe(B);
    expect(cur.engine.dataDirNotice).toMatchObject({ kind: 'fell-back', from: C, to: B, error: 'no boot for you' });
    expect(readHomeConfig(home).dataDirs.claude).toBe(B);
    expect((await get('/api/data-dir')).notice).toMatchObject({ kind: 'fell-back' });
    expect((await post('/api/data-dir/notice/dismiss', {})).status).toBe(200);
    expect(cur.engine.dataDirNotice).toBeNull();
  } finally {
    await loop.shutdown();
    rmSync(dir, { recursive: true, force: true });
  }
}, 60_000);
