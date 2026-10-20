import { afterEach, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { defaultConfig } from './config.ts';
import { Engine } from './engine.ts';
import { FakeRunner } from './test-helpers.ts';

const ROOT = resolve(import.meta.dir, '../../..');
let dataDir: string;
afterEach(() => rmSync(dataDir, { recursive: true, force: true }));

test('stop() closes the database last, so the data directory can be deleted afterwards; stopping again is harmless', async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'foundry-stop-'));
  const engine = new Engine(defaultConfig(ROOT, { dataDir, claudeHome: join(dataDir, 'claude-home'), log: () => {} }), new FakeRunner(() => {}));
  expect(existsSync(join(dataDir, 'engine.db'))).toBe(true);
  expect(engine.store.isClosed).toBe(false);
  await engine.stop();
  expect(engine.store.isClosed).toBe(true);
  expect(() => engine.store.count()).toThrow();
  await engine.stop();
  expect(engine.store.isClosed).toBe(true);
});
