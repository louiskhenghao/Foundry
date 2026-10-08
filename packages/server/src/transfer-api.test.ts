import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { getGoal } from '@foundry/core';
import { Engine, defaultConfig } from '@foundry/engine';
import { FakeRunner, makeRepo, sh, waitFor } from '../../engine/src/test-helpers.ts';
import { createApp } from './app.ts';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const f of cleanup.splice(0)) await f();
});
const json = (body: unknown) => ({ method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });

test('the Transfer API: export and download on one Foundry, upload, unlock, apply and map on another (ADR-0030)', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'foundry-transfer-api-'));
  const repo = await makeRepo();
  const make = (name: string) => {
    const dataDir = join(tmp, name);
    const e = new Engine(defaultConfig(resolve(import.meta.dir, '../../..'), { dataDir, claudeHome: join(dataDir, 'claude'), codexHome: join(dataDir, 'codex'), alwaysReviewTasks: false, useGraphify: false, log: () => {} }), new FakeRunner((spec) => writeFileSync(join(spec.cwd, 'done.txt'), 'ok')));
    cleanup.push(() => e.stop());
    return { e, app: createApp(e) };
  };
  cleanup.push(async () => {
    for (const p of [tmp, repo, `${repo}-foundry`]) rmSync(p, { recursive: true, force: true });
  });
  const a = make('a');
  const goal = await a.e.createGoal({ prompt: 'create done.txt', repoPath: repo, autoBrief: { mustChecks: ['test -f done.txt'] } });
  await waitFor(() => ['done', 'over_delivered'].includes(getGoal(a.e.store.db, goal.id)!.state), 30_000);
  a.e.updateSettings({ tools: { groqApiKey: 'gsk-0123456789abc' } });

  expect((await a.app.request('/api/transfer/export', json({ categories: { secrets: true } }))).status).toBe(400);
  const exported = await (await a.app.request('/api/transfer/export', json({ categories: { goals: true, secrets: true }, goalIds: 'all', password: 'pw' }))).json();
  expect(exported).toMatchObject({ goals: 1, categories: { goals: true, secrets: true, settings: false } });
  const download = await a.app.request(`/api/transfer/download/${exported.downloadId}`);
  expect(download.headers.get('content-disposition')).toContain('foundry-transfer-');
  const file = await download.arrayBuffer();

  const b = make('b');
  const report = await (await b.app.request('/api/transfer/incoming', { method: 'POST', body: file, headers: { 'content-type': 'application/octet-stream' } })).json();
  expect(report.goals.map((g: { id: string; status: string }) => [g.id, g.status])).toEqual([[goal.id, 'new']]);
  expect((await b.app.request(`/api/transfer/incoming/${report.uploadId}/secrets`, json({ password: 'no' }))).status).toBe(422);
  expect((await (await b.app.request(`/api/transfer/incoming/${report.uploadId}/secrets`, json({ password: 'pw' }))).json()).settings[0]).toMatchObject({ key: 'tools.groqApiKey', imported: 'gsk-…9abc' });
  const applied = await (await b.app.request(`/api/transfer/incoming/${report.uploadId}/apply`, json({ repos: { [repo]: null }, secrets: { password: 'pw' } }))).json();
  expect(applied).toMatchObject({ imported: [{ id: goal.id }], secrets: ['tools.groqApiKey'] });
  expect((await b.app.request(`/api/transfer/incoming/${report.uploadId}`)).status).toBe(404);

  // finished on the other computer: it can be mapped (for Follow-ups), not Reattached
  const clone = join(tmp, 'clone');
  await sh(`git clone -q ${repo} ${clone}`, tmp);
  expect(await (await b.app.request(`/api/goals/${goal.id}/map-repo`, json({ path: clone }))).json()).toMatchObject({ to: clone, restored: [goal.id] });
  expect((await b.app.request(`/api/goals/${goal.id}/reattach`, { method: 'POST' })).status).toBe(409);
  // only a Transfer file may be large
  expect((await b.app.request('/api/goals', { method: 'POST', body: 'x', headers: { 'content-length': String(31 * 1024 * 1024) } })).status).toBe(413);
});
