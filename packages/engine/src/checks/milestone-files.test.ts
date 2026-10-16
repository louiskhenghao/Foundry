import { afterEach, beforeEach, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { getGoal, listTasks } from '@foundry/core';
import { defaultConfig } from '../config.ts';
import { Engine } from '../engine.ts';
import { FakeRunner, makeRepo } from '../test-helpers.ts';
import { goalWorkspacePath, screenshotsDir } from '../workspace.ts';
import { captureMilestone } from './walkthrough.ts';

const ROOT = resolve(import.meta.dir, '../../../..');
let dataDir: string;
let engine: Engine;
beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'foundry-milestone-files-'));
  engine = new Engine(defaultConfig(ROOT, { dataDir, claudeHome: join(dataDir, 'claude-home'), log: () => {} }), new FakeRunner(() => {}));
});
afterEach(async () => {
  await engine.stop();
  rmSync(dataDir, { recursive: true, force: true });
});

const brief = (scenario: 'cad' | 'frontend') => ({
  goalId: 'g', title: 'a bracket', understanding: 'u', assumptions: [], questions: [], areas: [], styleOptions: [], costEstimateUsd: 1, timeEstimateMin: 5, run: null,
  tasks: [{ key: 'T1', title: 'model the bracket', spec: 's', kind: 'feature' as const, scope: null, scenario, areaKey: null, tdd: 'inherit' as const, dependsOnKeys: [], parallelizable: false, relevantFiles: [], milestone: 'look at the bracket' }],
  checks: [{ key: 'C1', name: 'ok', tier: 'must' as const, taskKey: 'T1', areaKey: null, spec: { type: 'command' as const, cmd: 'true', timeoutMs: 60_000, expectExitCode: 0 } }],
});

test("a cad task's milestone shows the snapshots it left under artifacts/, not a walkthrough of an app the goal does not have", async () => {
  const repo = await makeRepo();
  const goal = await engine.createGoal({ prompt: 'a bracket', repoPath: repo, brief: brief('cad') as never });
  const task = listTasks(engine.store.db, goal.id)[0]!;
  const art = join(goalWorkspacePath(dataDir, getGoal(engine.store.db, goal.id)!), 'artifacts');
  // nothing exported yet: the milestone says so instead of pretending a preview failed
  let ev = await captureMilestone(engine, goal, task);
  expect(ev).toMatchObject({ status: 'fail', error: 'the task left no snapshots under artifacts/: there is nothing to look at' });
  mkdirSync(join(art, 'samples'), { recursive: true });
  for (const f of ['bracket.step', 'bracket.stl', 'bracket_iso.png', 'bracket_front.png']) writeFileSync(join(art, f), 'x');
  writeFileSync(join(art, 'samples', 'style-1.png'), 'x');
  ev = await captureMilestone(engine, goal, task);
  expect(ev!.status).toBe('pass');
  expect(ev!.error).toBeNull();
  expect(ev!.shots.map((s) => s.caption)).toEqual(['bracket_front.png', 'bracket_iso.png']);
  expect(ev!.summary).toContain('Models: ');
  expect(ev!.summary).toContain('bracket.step');
  // copies sit in the screenshots folder, where the card and the notification channels read them
  for (const s of ev!.shots) expect(existsSync(join(screenshotsDir(dataDir, getGoal(engine.store.db, goal.id)!), s.file))).toBe(true);
  expect(engine.store.listByGoal(goal.id).filter((e) => e.type === 'milestone.evidence')).toHaveLength(2);
});

test('after the goal folder is gone, the copies delivered to the output folder show', async () => {
  const repo = await makeRepo();
  const goal = await engine.createGoal({ prompt: 'a bracket', repoPath: repo, brief: brief('cad') as never });
  const task = listTasks(engine.store.db, goal.id)[0]!;
  const out = mkdtempSync(join(tmpdir(), 'foundry-milestone-out-'));
  writeFileSync(join(out, 'bracket_iso.png'), 'x');
  engine.store.append({ type: 'goal.artifacts_delivered', goalId: goal.id, payload: { status: 'ok', files: ['bracket_iso.png', 'gone.png'], dest: out, detail: '1 artifact(s) copied' } });
  const ev = await captureMilestone(engine, getGoal(engine.store.db, goal.id)!, task);
  expect(ev).toMatchObject({ status: 'pass', shots: [{ caption: 'bracket_iso.png' }] });
  rmSync(out, { recursive: true, force: true });
});
