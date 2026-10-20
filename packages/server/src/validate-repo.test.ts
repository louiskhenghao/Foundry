import { afterEach, beforeEach, expect, test } from 'bun:test';
import { Goal, upsertGoal } from '@foundry/core';
import { Engine, defaultConfig } from '@foundry/engine';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { FakeRunner, makeRepo, sh } from '../../engine/src/test-helpers.ts';
import { createApp } from './app.ts';

let home: string;
let repo: string;
let engine: Engine;
beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), 'foundry-validate-repo-'));
  repo = await makeRepo();
  engine = new Engine(defaultConfig(resolve(import.meta.dir, '../../..'), {
    dataDir: home, claudeHome: join(home, 'claude'), codexHome: join(home, 'codex'), log: () => {},
  }), new FakeRunner(() => {}));
  engine.beginUpdateDrain();
});
afterEach(async () => {
  await engine.stop();
  for (const path of [home, repo, `${repo}-foundry`]) rmSync(path, { recursive: true, force: true });
});
const validate = (repoPath: string) => createApp(engine).request('/api/validate-repo', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ repoPath }),
});

test('validation includes the last goal or null without changing ready status', async () => {
  const empty = await validate(repo);
  expect(empty.status).toBe(200);
  expect(await empty.json()).toMatchObject({ ok: true, branch: 'main', lastGoal: null });
  const goal = Goal.parse({
    id: 'g_previous', title: 'Previous work', prompt: 'p', repoPath: repo, baseBranch: 'main', branch: 'goal/previous',
    budgets: {}, models: { strong: 'opus', cheap: 'haiku', worker: 'opus' }, state: 'cancelled', stateBeforeBlock: null,
    costUsd: 0, fixCycles: 0, runningSince: null, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    workflow: { profile: 'pstack', tdd: 'preferred', ponytail: 'off' },
  });
  upsertGoal(engine.store.db, goal);
  expect(await (await validate(repo)).json()).toMatchObject({ ok: true, lastGoal: {
    goalId: goal.id, title: goal.title, createdAt: goal.createdAt, workflow: { profile: 'pstack', tdd: 'preferred', ponytail: 'off' },
  } });
  expect(await (await validate(`${repo}/`)).json()).toMatchObject({ ok: true, lastGoal: null });
  rmSync(join(repo, '.git'), { recursive: true });
  expect(await (await validate(repo)).json()).toMatchObject({ ok: false, error: 'not a git repository (you can initialize it)', lastGoal: { goalId: goal.id } });
});

test('missing, non-git and uncommitted repositories preserve validation errors', async () => {
  expect(await (await validate(join(home, 'missing'))).json()).toMatchObject({ ok: false, error: 'path does not exist', lastGoal: null });
  const folder = join(home, 'empty');
  mkdirSync(folder);
  expect(await (await validate(folder)).json()).toMatchObject({ ok: false, error: 'not a git repository (you can initialize it)', lastGoal: null });
  await sh('git init -q -b main', folder);
  expect(await (await validate(folder)).json()).toMatchObject({ ok: false, error: 'repository has no commits yet', lastGoal: null });
});
