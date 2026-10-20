import { afterEach, beforeEach, expect, test } from 'bun:test';
import { Engine, defaultConfig } from '@foundry/engine';
import { getGoal } from '@foundry/core';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { FakeRunner, makeRepoWithRemote, waitFor } from '../../engine/src/test-helpers.ts';
import { FakeGh } from '../../engine/src/delivery/gh.fake.ts';
import { createApp } from './app.ts';

let home: string;
let repo: string;
let engine: Engine;
let gh: FakeGh;
beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), 'foundry-review-api-'));
  const made = await makeRepoWithRemote();
  repo = made.repo;
  gh = new FakeGh(made.bare);
  engine = new Engine(
    defaultConfig(resolve(import.meta.dir, '../../..'), { dataDir: home, claudeHome: join(home, 'claude'), codexHome: join(home, 'codex'), log: () => {}, alwaysReviewTasks: false, delivery: { pollMs: 10, noChecksGraceMs: 30, checksTimeoutMs: 3000, automergeWaitMs: 200, updateLocalBase: true, prWatchMs: 60_000 } }),
    new FakeRunner((spec) => writeFileSync(join(spec.cwd, spec.label?.includes('review comments') ? 'renamed.txt' : 'done.txt'), 'ok')),
    gh,
  );
});
afterEach(async () => {
  await engine.stop();
  for (const path of [home, repo, `${repo}-foundry`]) rmSync(path, { recursive: true, force: true });
});
const post = (path: string) => createApp(engine).request(path, { method: 'POST' });

test('POST …/delivery/prs/:n/fix-reviews refuses when nothing waits, and addresses a waiting round beyond the budget', async () => {
  const goal = await engine.createGoal({ prompt: 'csv export', repoPath: repo, autoBrief: { mustChecks: ['test -f done.txt'] }, delivery: { mode: 'pr', fixReviewCycles: 0 } });
  await waitFor(() => getGoal(engine.store.db, goal.id)!.delivery.status === 'delivered', 20_000);
  const nothing = await post(`/api/goals/${goal.id}/delivery/prs/1/fix-reviews`);
  expect(nothing.status).toBe(409);
  expect(await nothing.json()).toMatchObject({ error: expect.stringContaining('no review comments are waiting on PR #1') });

  gh.addReviewComment(1, { body: 'rename this' });
  const r = await post(`/api/goals/${goal.id}/delivery/prs/1/fix-reviews`);
  expect(r.status).toBe(200);
  const body = await r.json();
  expect(body.delivery.reviews[0]).toMatchObject({ prNumber: 1, requested: true });
  await waitFor(() => getGoal(engine.store.db, goal.id)!.delivery.reviews[0]?.status === 'addressed', 30_000);
  await waitFor(() => getGoal(engine.store.db, goal.id)!.delivery.status === 'delivered', 20_000);
  expect(getGoal(engine.store.db, goal.id)!.delivery.reviewCycles).toBe(1);
  expect(gh.replies.length).toBe(1);
});
