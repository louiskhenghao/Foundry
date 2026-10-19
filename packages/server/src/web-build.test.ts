import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Engine, defaultConfig } from '@foundry/engine';
import { FakeRunner } from '../../engine/src/test-helpers.ts';
import { createApp } from './app.ts';

test('the health check names the web build being served, and a rebuild changes it', async () => {
  const home = mkdtempSync(join(tmpdir(), 'foundry-web-build-'));
  const dist = join(home, 'dist');
  mkdirSync(join(dist, 'assets'), { recursive: true });
  const page = (entry: string) => `<!doctype html><html><head><script type="module" crossorigin src="/assets/${entry}"></script><link rel="stylesheet" href="/assets/index-x.css"></head><body></body></html>`;
  writeFileSync(join(dist, 'index.html'), page('index-Cg0pepnd.js'));
  const engine = new Engine(defaultConfig(resolve(import.meta.dir, '../../..'), { dataDir: join(home, 'data'), claudeHome: join(home, 'claude'), useGraphify: false, log: () => {} }), new FakeRunner(() => {}));
  try {
    const app = createApp(engine, { webDist: dist });
    const served = async () => ((await (await app.request('/api/health')).json()) as { webBuild: string | null }).webBuild;
    expect(await served()).toBe('index-Cg0pepnd.js');
    writeFileSync(join(dist, 'index.html'), page('index-B7xQe2aa.js'));
    const later = new Date(Date.now() + 5000);
    utimesSync(join(dist, 'index.html'), later, later);
    expect(await served()).toBe('index-B7xQe2aa.js');
    // no web build at all: nothing to compare with
    expect(((await (await createApp(engine).request('/api/health')).json()) as { webBuild: string | null }).webBuild).toBeNull();
  } finally {
    await engine.stop();
    rmSync(home, { recursive: true, force: true });
  }
});
