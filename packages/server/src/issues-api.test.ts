import { afterEach, beforeEach, expect, test } from 'bun:test';
import { Engine, defaultConfig } from '@foundry/engine';
import { FakeGh } from '../../engine/src/delivery/gh.fake.ts';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { FakeRunner, makeRepo } from '../../engine/src/test-helpers.ts';
import { createApp } from './app.ts';

let home: string;
let repo: string;
let engine: Engine;
let gh: FakeGh;
beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), 'foundry-issues-api-'));
  repo = await makeRepo();
  gh = new FakeGh();
  gh.issues.set('acme/app#7', { number: 7, url: 'https://github.com/acme/app/issues/7', title: 'Export orders as CSV', state: 'OPEN', body: 'The orders page needs a CSV export.', labels: ['feature'], author: 'pat', createdAt: '2026-10-01T10:00:00Z', comments: [] });
  engine = new Engine(defaultConfig(resolve(import.meta.dir, '../../..'), { dataDir: home, claudeHome: join(home, 'claude'), codexHome: join(home, 'codex'), log: () => {} }), new FakeRunner(() => {}), gh);
  engine.beginUpdateDrain();
});
afterEach(async () => {
  await engine.stop();
  for (const path of [home, repo, `${repo}-foundry`]) rmSync(path, { recursive: true, force: true });
});
const post = (path: string, body: unknown) => createApp(engine).request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('POST /api/issues/read gives the issue, the text to start from and the staged thread; the goal is then made with them', async () => {
  const r = await post('/api/issues/read', { ref: 'https://github.com/acme/app/issues/7', repoPath: repo });
  expect(r.status).toBe(200);
  const read = await r.json();
  expect(read).toMatchObject({ issue: { repo: 'acme/app', number: 7, title: 'Export orders as CSV', state: 'open' }, title: 'Export orders as CSV', prompt: 'The orders page needs a CSV export.', attachment: { kind: 'link', name: 'acme/app#7', markdown: { status: 'ready' } } });
  const created = await post('/api/goals', { prompt: read.prompt, title: read.title, repoPath: repo, issue: read.issue, attachments: [read.attachment] });
  expect(created.status).toBe(201);
  const goal = await created.json();
  expect(goal.issue).toEqual(read.issue);
  expect(goal.attachments.map((a: { id: string }) => a.id)).toEqual([read.attachment.id]);
  const detail = await (await createApp(engine).request(`/api/goals/${goal.id}`)).json();
  expect(detail.goal.issue.number).toBe(7);
});

test('the errors name their cause: a bad reference, an unknown issue, gh not connected', async () => {
  expect(await (await post('/api/issues/read', { ref: 'fix it' })).json()).toMatchObject({ error: expect.stringContaining('not an issue reference'), code: 'bad-ref' });
  expect((await post('/api/issues/read', { ref: 'fix it' })).status).toBe(400);
  const missing = await post('/api/issues/read', { ref: 'acme/app#8' });
  expect(missing.status).toBe(404);
  expect(await missing.json()).toMatchObject({ code: 'not-found' });
  gh.authenticated = false;
  const login = await post('/api/issues/read', { ref: 'acme/app#7' });
  expect(login.status).toBe(409);
  expect(await login.json()).toMatchObject({ code: 'gh-login', error: expect.stringContaining('connect GitHub') });
});
