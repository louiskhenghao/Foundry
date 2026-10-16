import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { IdPrefix, getGoal, newId, type Check } from '@foundry/core';
import { defaultConfig } from '../config.ts';
import { Engine } from '../engine.ts';
import { FakeRunner, makeRepo, sh } from '../test-helpers.ts';
import { goalWorkspacePath } from '../workspace.ts';

const ROOT = resolve(import.meta.dir, '../../../..');
let dataDir: string;
let engine: Engine;
beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'foundry-baseline-artifacts-'));
  engine = new Engine(defaultConfig(ROOT, { dataDir, claudeHome: join(dataDir, 'claude-home'), log: () => {} }), new FakeRunner(() => {}));
});
afterEach(async () => {
  await engine.stop();
  rmSync(dataDir, { recursive: true, force: true });
});

test("the baseline sees the goal's artifacts: a check that measures an export is not 'already failing' because git never carries exports", async () => {
  const repo = await makeRepo();
  const goal = await engine.createGoal({ prompt: 'a bracket', repoPath: repo, autoBrief: { mustChecks: ['true'] } });
  const check: Check = { id: newId(IdPrefix.check), goalId: goal.id, taskId: null, name: 'bracket exported', tier: 'must', spec: { type: 'command', cmd: 'test -s artifacts/STEP/bracket.step', timeoutMs: 60_000, expectExitCode: 0 } };
  engine.store.append({ type: 'check.created', goalId: goal.id, payload: { check } });
  const head = (await sh('git rev-parse HEAD', repo)).trim();
  const g = getGoal(engine.store.db, goal.id)!;
  // no export yet anywhere: it really fails
  expect((await engine.baseline.failing(g, head)).has(check.id)).toBe(true);
  // the goal workspace holds the export (git-excluded): the baseline worktree gets it, so the check passes there too
  const art = join(goalWorkspacePath(dataDir, g), 'artifacts', 'STEP');
  mkdirSync(art, { recursive: true });
  writeFileSync(join(art, 'bracket.step'), 'ISO-10303-21;');
  await sh('git commit -q --allow-empty -m "chore: next"', repo);
  const next = (await sh('git rev-parse HEAD', repo)).trim();
  expect((await engine.baseline.failing(g, next)).has(check.id)).toBe(false);
});
