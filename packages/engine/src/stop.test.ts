import { afterEach, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { EventStore, openDatabase } from '@foundry/core';
import { defaultConfig } from './config.ts';
import { Engine } from './engine.ts';
import { FakeRunner } from './test-helpers.ts';

const ROOT = resolve(import.meta.dir, '../../..');
let dataDir: string;
afterEach(() => rmSync(dataDir, { recursive: true, force: true }));

test('stop() closes the database file last, so the data directory can be deleted afterwards; late work runs on a copy; stopping again is harmless', async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'foundry-stop-'));
  const engine = new Engine(defaultConfig(ROOT, { dataDir, claudeHome: join(dataDir, 'claude-home'), log: () => {} }), new FakeRunner(() => {}));
  expect(existsSync(join(dataDir, 'engine.db'))).toBe(true);
  expect(engine.store.isClosed).toBe(false);
  const before = engine.store.count();
  await engine.stop();
  expect(engine.store.isClosed).toBe(true);
  // work that was still in flight goes on against the copy: no throw, and the file keeps what it had
  engine.store.append({ type: 'engine.note', goalId: null, payload: { level: 'info', message: 'late' } });
  expect(engine.store.count()).toBe(before + 1);
  const file = new EventStore(openDatabase(join(dataDir, 'engine.db')));
  expect(file.count()).toBe(before);
  file.close();
  await engine.stop();
  expect(engine.store.isClosed).toBe(true);
});
