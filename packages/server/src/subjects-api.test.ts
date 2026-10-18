import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { getBrief, type Brief } from '@foundry/core';
import { Engine, defaultConfig } from '@foundry/engine';
import { FakeRunner, makeRepo } from '../../engine/src/test-helpers.ts';
import { createApp } from './app.ts';

const png = () => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(6000).fill(7)]);

/** a goal whose Brief awaits approval; no tick runs anything in the background */
const setup = async () => {
  const home = mkdtempSync(join(tmpdir(), 'foundry-subjects-api-'));
  const repo = await makeRepo();
  const engine = new Engine(defaultConfig(resolve(import.meta.dir, '../../..'), { dataDir: home, claudeHome: join(home, 'claude'), useGraphify: false, log: () => {} }), new FakeRunner(() => {}));
  engine.beginUpdateDrain();
  const goal = await engine.createGoal({ prompt: 'a showcase of one car', repoPath: repo, nature: 'code' });
  const brief = { goalId: goal.id, title: '', understanding: 'u', areas: [], assumptions: [], checks: [], tasks: [], costEstimateUsd: 0, timeEstimateMin: 0, questions: [], styleOptions: [] } as Brief;
  engine.store.append({ type: 'brief.proposed', goalId: goal.id, payload: { brief } });
  engine.store.append({ type: 'goal.state_changed', goalId: goal.id, payload: { from: 'clarifying', to: 'awaiting_brief_approval', reason: 'test' } });
  const done = async () => {
    await engine.stop();
    rmSync(home, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
    rmSync(`${repo}-foundry`, { recursive: true, force: true });
  };
  return { engine, app: createApp(engine), goalId: goal.id, done };
};

const json = (method: string, body: unknown) => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const upload = (bytes: Uint8Array, name: string, caption?: string) => {
  const form = new FormData();
  form.append('file', new File([bytes as Uint8Array<ArrayBuffer>], name));
  if (caption) form.append('caption', caption);
  return { method: 'POST', body: form };
};

test('Subjects and their pictures through the API: named, changed, pictured, served, removed; only while the Brief waits', async () => {
  const { engine, app, goalId, done } = await setup();
  try {
    const base = `/api/goals/${goalId}/brief/subjects`;
    const made = await app.request(base, json('POST', { name: 'Porsche 911 GT3 (992)', lookFor: 'the nose', search: false }));
    expect(made.status).toBe(201);
    expect(await made.json()).toMatchObject({ key: 'P1', name: 'Porsche 911 GT3 (992)', lookFor: 'the nose', pictures: [], search: null });
    expect((await app.request(`${base}/P1`, json('PATCH', { lookFor: 'the nose and the wing' }))).status).toBe(200);
    // a picture: kept under the Subject's name, served as what it is
    const up = await app.request(`${base}/P1/pictures`, upload(png(), 'front.png', 'front three-quarter'));
    expect(up.status).toBe(201);
    expect(await up.json()).toEqual({ pictures: [{ file: 'P1-1.png', source: 'person', url: null, caption: 'front three-quarter' }] });
    const served = await app.request(`/api/goals/${goalId}/subjects/P1-1.png`);
    expect([served.status, served.headers.get('content-type')]).toEqual([200, 'image/png']);
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(png());
    // what is not a picture, a name that leaves the folder, a picture that is not there
    expect((await app.request(`${base}/P1/pictures`, upload(new TextEncoder().encode('<svg onload=alert(1)>'), 'x.svg'))).status).toBe(400);
    expect((await app.request(`/api/goals/${goalId}/subjects/..%2Fx.png`)).status).toBe(400);
    expect((await app.request(`/api/goals/${goalId}/subjects/P1-1.svg`)).status).toBe(400);
    expect((await app.request(`/api/goals/${goalId}/subjects/P1-9.png`)).status).toBe(404);
    expect((await app.request(`${base}/P9/pictures`, upload(png(), 'a.png'))).status).toBe(404);
    const detail = (await (await app.request(`/api/goals/${goalId}`)).json()) as { brief: { brief: Brief }; subjectSearches: string[]; likenessRuns: string[] };
    expect(detail.brief.brief.subjects).toMatchObject([{ key: 'P1', lookFor: 'the nose and the wing', pictures: [{ file: 'P1-1.png' }] }]);
    expect(detail.subjectSearches).toEqual([]);
    expect(detail.likenessRuns).toEqual([]);
    // a search starts, and a second one for the same Subject waits for it
    expect((await app.request(`${base}/P1/search`, { method: 'POST' })).status).toBe(202);
    expect((await app.request(`${base}/P1/search`, { method: 'POST' })).status).toBe(409);
    expect((await app.request(`${base}/P1/pictures/P1-1.png`, { method: 'DELETE' })).status).toBe(200);
    expect((await app.request(base + '/P1', { method: 'DELETE' })).status).toBe(200);
    expect(getBrief(engine.store.db, goalId)!.brief.subjects).toEqual([]);
    // once the Brief is approved, Subjects no longer change
    engine.store.append({ type: 'goal.state_changed', goalId, payload: { from: 'awaiting_brief_approval', to: 'running', reason: 'test' } });
    const late = await app.request(base, json('POST', { name: 'Big Ben' }));
    expect(late.status).toBe(409);
    expect(((await late.json()) as { error: string }).error).toContain('while the Brief awaits approval');
  } finally {
    await done();
  }
});
