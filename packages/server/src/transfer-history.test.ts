import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Engine, defaultConfig } from '@foundry/engine';
import { FakeRunner, makeRepo } from '../../engine/src/test-helpers.ts';
import { createApp } from './app.ts';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const f of cleanup.splice(0)) await f();
});

test('an Imported Goal can be read, not changed, and its open questions stay out of the Inbox (ADR-0030)', async () => {
  const home = mkdtempSync(join(tmpdir(), 'foundry-history-api-'));
  const repo = await makeRepo();
  const engine = new Engine(defaultConfig(resolve(import.meta.dir, '../../..'), { dataDir: home, claudeHome: join(home, 'claude'), codexHome: join(home, 'codex'), useGraphify: false, log: () => {} }), new FakeRunner(() => {}));
  engine.beginUpdateDrain(); // nothing runs: the goal below only needs to exist
  cleanup.push(async () => {
    await engine.stop();
    for (const p of [home, repo, `${repo}-foundry`]) rmSync(p, { recursive: true, force: true });
  });
  const app = createApp(engine);
  const goal = await engine.createGoal({ prompt: 'imported fixture', repoPath: repo, nature: 'code' });
  const esc = { id: 'esc_h', goalId: goal.id, taskId: null, attemptId: null, trigger: 'permission_denial' as const, message: 'm', payload: {}, state: 'open' as const, answer: null, createdAt: new Date().toISOString(), answeredAt: null, suggestion: null };
  engine.store.append({ type: 'escalation.raised', goalId: goal.id, payload: { escalation: esc } });
  engine.store.append({ type: 'goal.imported', goalId: goal.id, payload: { transferId: 'tr', from: { release: '1.0.0', hostname: 'old', exportedAt: new Date().toISOString() }, unfinished: true, bundle: null, artifacts: null, transcripts: false, remap: {} } });

  expect((await app.request(`/api/goals/${goal.id}`)).status).toBe(200);
  for (const [method, path] of [['POST', 'cancel'], ['POST', 'restart'], ['PATCH', 'brief'], ['POST', 'deliver'], ['POST', 'selfcheck']] as const) {
    const res = await app.request(`/api/goals/${goal.id}/${path}`, { method, body: '{}', headers: { 'content-type': 'application/json' } });
    expect([path, res.status]).toEqual([path, 409]);
  }
  expect((await app.request('/api/escalations/esc_h/answer', { method: 'POST', body: JSON.stringify({ action: 'skip' }), headers: { 'content-type': 'application/json' } })).status).toBe(409);
  expect(await (await app.request('/api/escalations?open=1')).json()).toEqual([]);
  // deleting stays possible
  expect((await app.request(`/api/goals/${goal.id}`, { method: 'DELETE' })).status).toBe(200);
});
