import { afterEach, beforeEach, expect, test } from 'bun:test';
import { Engine, defaultConfig } from '@foundry/engine';
import { getGoal } from '@foundry/core';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { FakeRunner, makeRepo, waitFor } from '../../engine/src/test-helpers.ts';
import { createApp } from './app.ts';

let home: string;
let repo: string;
let engine: Engine;
beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), 'foundry-schedules-api-'));
  repo = await makeRepo();
  // no update drain here: the run the test fires must be allowed to start
  engine = new Engine(defaultConfig(resolve(import.meta.dir, '../../..'), { dataDir: home, claudeHome: join(home, 'claude'), codexHome: join(home, 'codex'), log: () => {}, alwaysReviewTasks: false }), new FakeRunner(() => {}));
});
afterEach(async () => {
  await engine.stop();
  for (const path of [home, repo, `${repo}-foundry`]) rmSync(path, { recursive: true, force: true });
});
const call = (path: string, method: string, body?: unknown) => createApp(engine).request(path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });

test('schedules are saved, listed, run, turned off and deleted over the API', async () => {
  const saved = await call('/api/schedules', 'PUT', { name: 'Weekly upgrade', cadence: { kind: 'weekly', weekday: 1, at: '03:00' }, recipe: { prompt: 'Upgrade the dependencies.', repoPath: repo, budgetPreset: 'quick', autoBrief: { mustChecks: ['true'] } }, autoApprove: false });
  expect(saved.status).toBe(200);
  const { schedule } = await saved.json();
  expect(schedule).toMatchObject({ name: 'Weekly upgrade', enabled: true, autoApprove: false, runs: 0 });
  const listed = await (await call('/api/schedules', 'GET')).json();
  expect(listed.schedules.map((s: { id: string; nextRunAt: string | null }) => [s.id, !!s.nextRunAt])).toEqual([[schedule.id, true]]);

  const bad = await call('/api/schedules', 'PUT', { name: '', cadence: { kind: 'daily', at: '3:00' }, recipe: { prompt: 'x', repoPath: repo } });
  expect(bad.status).toBe(400);

  const ran = await call(`/api/schedules/${schedule.id}/run`, 'POST');
  expect(ran.status).toBe(200);
  const { goalId } = await ran.json();
  expect(goalId).toBeTruthy();
  expect(getGoal(engine.store.db, goalId)!.schedule).toMatchObject({ id: schedule.id, name: 'Weekly upgrade' });
  await waitFor(() => ['done', 'over_delivered', 'failed'].includes(getGoal(engine.store.db, goalId)!.state), 20_000);
  const after = await (await call('/api/schedules', 'GET')).json();
  expect(after.schedules[0]).toMatchObject({ runs: 1, lastRun: { goalId, skipped: null }, lastGoal: { id: goalId } });

  const off = await call(`/api/schedules/${schedule.id}/enable`, 'POST', { enabled: false });
  expect((await off.json()).schedule.enabled).toBe(false);
  expect((await (await call('/api/schedules', 'GET')).json()).schedules[0].nextRunAt).toBeNull();

  expect((await call(`/api/schedules/${schedule.id}`, 'DELETE')).status).toBe(200);
  expect((await (await call('/api/schedules', 'GET')).json()).schedules).toEqual([]);
  expect((await call(`/api/schedules/${schedule.id}`, 'DELETE')).status).toBe(404);
  expect((await call(`/api/schedules/${schedule.id}/run`, 'POST')).status).toBe(404);
}, 30_000);
