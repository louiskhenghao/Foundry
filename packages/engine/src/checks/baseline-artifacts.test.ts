import { afterEach, beforeEach, expect, test } from 'bun:test';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
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
  const art = join(goalWorkspacePath(dataDir, g), 'artifacts', 'STEP');
  mkdirSync(art, { recursive: true });
  writeFileSync(join(art, 'bracket.step'), 'ISO-10303-21;');
  const commit = async (m: string) => {
    await sh(`git commit -q --allow-empty -m "${m}"`, repo);
    return (await sh('git rev-parse HEAD', repo)).trim();
  };
  // a goal that keeps no artifacts (nothing of it is judged by files): its baseline is left as git has it
  expect((await engine.baseline.failing(g, await commit('chore: next'))).has(check.id)).toBe(true);
  // a cad goal's workspace holds the export (git-excluded): the baseline worktree gets it, so the check passes there too
  engine.store.append({ type: 'goal.nature_set', goalId: goal.id, payload: { nature: 'cad', reason: 'a model' } });
  expect((await engine.baseline.failing(getGoal(engine.store.db, goal.id)!, await commit('chore: after'))).has(check.id)).toBe(false);
});

test('a re-export at the same commit gets a baseline of its own, and a copy that fails gives a strict baseline that is not kept', async () => {
  const repo = await makeRepo();
  const goal = await engine.createGoal({ prompt: 'a bracket', repoPath: repo, autoBrief: { mustChecks: ['true'] } });
  engine.store.append({ type: 'goal.nature_set', goalId: goal.id, payload: { nature: 'cad', reason: 'a model' } });
  const exported: Check = { id: newId(IdPrefix.check), goalId: goal.id, taskId: null, name: 'bracket exported', tier: 'must', spec: { type: 'command', cmd: 'test -s artifacts/bracket.step', timeoutMs: 60_000, expectExitCode: 0 } };
  const red: Check = { id: newId(IdPrefix.check), goalId: goal.id, taskId: null, name: 'always red', tier: 'must', spec: { type: 'command', cmd: 'test -f never.txt', timeoutMs: 60_000, expectExitCode: 0 } };
  for (const check of [exported, red]) engine.store.append({ type: 'check.created', goalId: goal.id, payload: { check } });
  const g = getGoal(engine.store.db, goal.id)!;
  const head = (await sh('git rev-parse HEAD', repo)).trim();
  expect((await engine.baseline.failing(g, head)).has(exported.id)).toBe(true);
  await sh('echo /artifacts/ >> .git/info/exclude', repo);
  // the export appears in the goal workspace without a commit: the same commit, another baseline
  const art = join(goalWorkspacePath(dataDir, g), 'artifacts');
  mkdirSync(art, { recursive: true });
  writeFileSync(join(art, 'bracket.step'), 'ISO-10303-21;');
  const after = await engine.baseline.failing(g, head);
  expect([after.has(exported.id), after.has(red.id)]).toEqual([false, true]);
  if (process.getuid?.() === 0) return; // root reads any file: the failing copy cannot be staged
  // an export the copy cannot read: no check counts as already failing (a lenient baseline would excuse regressions), and the result is not kept
  writeFileSync(join(art, 'part.step'), 'ISO-10303-21;');
  chmodSync(join(art, 'part.step'), 0o000);
  try {
    expect((await engine.baseline.failing(g, head)).size).toBe(0);
    const notes = engine.store.listByGoal(goal.id, 5000).filter((e) => e.type === 'engine.note').map((e) => (e.payload as { message: string }).message);
    expect(notes.some((m) => m.includes('could not be measured') && m.includes('counts as a regression'))).toBe(true);
  } finally {
    chmodSync(join(art, 'part.step'), 0o644);
  }
  expect((await engine.baseline.failing(g, head)).has(red.id)).toBe(true);
});

test('a re-export of the same size that kept its times is another state of the exports: its baseline is measured again', async () => {
  const repo = await makeRepo();
  const goal = await engine.createGoal({ prompt: 'a bracket', repoPath: repo, autoBrief: { mustChecks: ['true'] } });
  engine.store.append({ type: 'goal.nature_set', goalId: goal.id, payload: { nature: 'cad', reason: 'a model' } });
  const check: Check = { id: newId(IdPrefix.check), goalId: goal.id, taskId: null, name: 'second revision', tier: 'must', spec: { type: 'command', cmd: 'grep -q rev2 artifacts/bracket.step', timeoutMs: 60_000, expectExitCode: 0 } };
  engine.store.append({ type: 'check.created', goalId: goal.id, payload: { check } });
  const g = getGoal(engine.store.db, goal.id)!;
  const head = (await sh('git rev-parse HEAD', repo)).trim();
  // git-excluded, as for every goal that keeps artifacts: the goal's own merges never commit the export
  await sh('echo /artifacts/ >> .git/info/exclude', repo);
  const art = join(goalWorkspacePath(dataDir, g), 'artifacts');
  mkdirSync(art, { recursive: true });
  const at = new Date(Date.UTC(2026, 0, 1));
  writeFileSync(join(art, 'bracket.step'), 'rev1');
  utimesSync(join(art, 'bracket.step'), at, at);
  expect((await engine.baseline.failing(g, head)).has(check.id)).toBe(true);
  // the same size and the same time (a coarse clock, or a copy that keeps times), other content
  writeFileSync(join(art, 'bracket.step'), 'rev2');
  utimesSync(join(art, 'bracket.step'), at, at);
  expect((await engine.baseline.failing(g, head)).has(check.id)).toBe(false);
});
