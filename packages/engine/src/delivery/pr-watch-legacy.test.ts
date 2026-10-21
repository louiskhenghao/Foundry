import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DeliveryPolicy, IDLE_DELIVERY, type Goal, getGoal, upsertGoal } from '@foundry/core';
import { defaultConfig } from '../config.ts';
import { Engine } from '../engine.ts';
import { FakeRunner, makeRepo } from '../test-helpers.ts';
import { checkOpenPrs } from './pr-watch.ts';

const ROOT = resolve(import.meta.dir, '../../../..');
const dirs: string[] = [];
const engines: Engine[] = [];
afterEach(async () => {
  for (const e of engines.splice(0)) await e.stop();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

test('the pull-request watch reads goals of an earlier release, and one row it cannot read never stops it', async () => {
  const repo = await makeRepo();
  const dataDir = mkdtempSync(join(tmpdir(), 'foundry-pr-watch-legacy-'));
  dirs.push(repo, dataDir);
  const log: string[] = [];
  const engine = new Engine(defaultConfig(ROOT, { dataDir, claudeHome: join(dataDir, 'claude-home'), log: (m) => log.push(m) }), new FakeRunner(() => {}));
  engines.push(engine);
  const made = await engine.createGoal({ prompt: 'shipped long ago', repoPath: repo });
  const base = getGoal(engine.store.db, made.id)!;
  // a goal delivered before review rounds and reverts existed, written as that release wrote it
  const { reviews, reviewCycles, reverts, ...delivery } = { ...IDLE_DELIVERY, policy: DeliveryPolicy.parse({ mode: 'pr' }), status: 'delivered', outcome: 'merged', finishedAt: new Date().toISOString() } as typeof IDLE_DELIVERY & Record<string, unknown>;
  void reviews, reviewCycles, reverts;
  upsertGoal(engine.store.db, { ...base, id: 'g_legacy', state: 'done', delivery } as unknown as Goal);
  // and a row no reader can make sense of
  upsertGoal(engine.store.db, { ...base, id: 'g_broken', state: 'done', delivery: null } as unknown as Goal);
  await expect(checkOpenPrs(engine)).resolves.toBeUndefined();
  expect(log.some((m) => m.includes('g_broken'))).toBe(true);
  expect(log.some((m) => m.includes('g_legacy'))).toBe(false);
});
