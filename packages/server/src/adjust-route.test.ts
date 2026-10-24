import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Engine, defaultConfig } from '@foundry/engine';
import { FakeRunner, makeRepo } from '../../engine/src/test-helpers.ts';
import { createApp } from './app.ts';

/** Adjust the result (ADR-0077) over HTTP: refused while the beta is off or the goal is at work; the goal view says whether it can be done */
const setup = async (betaAdjust: boolean) => {
  const home = mkdtempSync(join(tmpdir(), 'foundry-adjust-route-'));
  const repo = await makeRepo();
  const engine = new Engine(defaultConfig(resolve(import.meta.dir, '../../..'), { dataDir: home, claudeHome: join(home, 'claude'), useGraphify: false, betaAdjust, log: () => {} }), new FakeRunner(() => {}));
  engine.beginUpdateDrain();
  const goal = await engine.createGoal({ prompt: 'a kettle', repoPath: repo, nature: 'code' });
  const done = async () => {
    await engine.stop();
    rmSync(home, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  };
  return { app: createApp(engine), goal, done };
};

test('with the beta off the box is hidden and a request is refused', async () => {
  const { app, goal, done } = await setup(false);
  try {
    const view = (await (await app.request(`/api/goals/${goal.id}`)).json()) as { adjust: { enabled: boolean; can: boolean; reason: string | null } };
    expect(view.adjust).toMatchObject({ enabled: false, can: false });
    const r = await app.request(`/api/goals/${goal.id}/adjust`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'make the lid red' }) });
    expect(r.status).toBe(400);
    expect(((await r.json()) as { error: string }).error).toContain('Settings → Beta');
  } finally {
    await done();
  }
});

test('with the beta on, a goal still at work says so (409) and the view carries the reason', async () => {
  const { app, goal, done } = await setup(true);
  try {
    const view = (await (await app.request(`/api/goals/${goal.id}`)).json()) as { adjust: { enabled: boolean; can: boolean; reason: string | null; next: number; history: unknown[] } };
    expect(view.adjust).toMatchObject({ enabled: true, can: false, next: 1, history: [] });
    expect(view.adjust.reason).toContain('still at work');
    const r = await app.request(`/api/goals/${goal.id}/adjust`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'make the lid red' }) });
    expect(r.status).toBe(409);
    expect(((await r.json()) as { error: string }).error).toContain('still at work');
    const empty = await app.request(`/api/goals/${goal.id}/adjust`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: '  ' }) });
    expect(empty.status).toBe(400);
  } finally {
    await done();
  }
});
