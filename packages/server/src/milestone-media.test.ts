import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { getGoal } from '@foundry/core';
import { Engine, defaultConfig, screenshotsDir } from '@foundry/engine';
import { FakeRunner, makeRepo } from '../../engine/src/test-helpers.ts';
import { createApp } from './app.ts';

const setup = async () => {
  const home = mkdtempSync(join(tmpdir(), 'foundry-milestone-media-'));
  const repo = await makeRepo();
  const engine = new Engine(defaultConfig(resolve(import.meta.dir, '../../..'), { dataDir: home, claudeHome: join(home, 'claude'), useGraphify: false, log: () => {} }), new FakeRunner(() => {}));
  engine.beginUpdateDrain();
  const goal = await engine.createGoal({ prompt: 'media', repoPath: repo, nature: 'code' });
  const done = async () => {
    await engine.stop();
    rmSync(home, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  };
  return { home, engine, app: createApp(engine), goal: getGoal(engine.store.db, goal.id)!, done };
};

test("a milestone's copies are served in every format a milestone of files collects, whatever the case of the extension", async () => {
  const { home, app, goal, done } = await setup();
  try {
    const dir = screenshotsDir(home, goal);
    mkdirSync(dir, { recursive: true });
    const cases: Record<string, string> = {
      'a.png': 'image/png',
      'b.jpg': 'image/jpeg',
      'c.JPEG': 'image/jpeg',
      'd.webp': 'image/webp',
      'e.gif': 'image/gif',
      'f.webm': 'video/webm',
      'g.mp4': 'video/mp4',
      'h.MOV': 'video/quicktime',
      'i.json': 'application/json; charset=utf-8',
      'j.txt': 'text/plain; charset=utf-8',
    };
    for (const [f, type] of Object.entries(cases)) {
      writeFileSync(join(dir, f), f);
      const r = await app.request(`/api/goals/${goal.id}/screenshots/${f}`);
      expect([f, r.status, r.headers.get('content-type')]).toEqual([f, 200, type]);
      expect(await r.text()).toBe(f);
    }
    // anything else, or a name that would leave the folder, is still refused
    for (const f of ['k.svg', 'l.html', '..%2Fa.png']) expect([f, (await app.request(`/api/goals/${goal.id}/screenshots/${f}`)).status]).toEqual([f, 400]);
  } finally {
    await done();
  }
});

test("a milestone's file links open the delivered copy once the goal folder is gone, and nothing the delivery did not record", async () => {
  const { engine, app, goal, done } = await setup();
  const out = mkdtempSync(join(tmpdir(), 'foundry-milestone-out-'));
  try {
    mkdirSync(join(out, 'parts'), { recursive: true });
    writeFileSync(join(out, 'parts', 'bracket.step'), 'ISO-10303-21;');
    writeFileSync(join(out, 'notes.txt'), 'not delivered by Foundry');
    engine.store.append({ type: 'goal.artifacts_delivered', goalId: goal.id, payload: { status: 'ok', files: ['parts/bracket.step'], dest: out, detail: '1 artifact(s) copied' } });
    const r = await app.request(`/api/goals/${goal.id}/artifacts/parts/bracket.step`);
    expect(r.status).toBe(200);
    expect(await r.text()).toBe('ISO-10303-21;');
    expect((await app.request(`/api/goals/${goal.id}/artifacts/notes.txt`)).status).toBe(404);
  } finally {
    rmSync(out, { recursive: true, force: true });
    await done();
  }
});
