import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { getGoal } from '@foundry/core';
import { Engine, defaultConfig, goalWorkspacePath } from '@foundry/engine';
import { FakeRunner, makeRepo } from '../../engine/src/test-helpers.ts';
import { createApp } from './app.ts';

/** a figure goal's page (ADR-0076) is served to run, but only in a sandbox with an opaque origin; everything else as before */
const setup = async () => {
  const home = mkdtempSync(join(tmpdir(), 'foundry-figure-artifacts-'));
  const repo = await makeRepo();
  const engine = new Engine(defaultConfig(resolve(import.meta.dir, '../../..'), { dataDir: home, claudeHome: join(home, 'claude'), useGraphify: false, log: () => {} }), new FakeRunner(() => {}));
  engine.beginUpdateDrain();
  const goal = await engine.createGoal({ prompt: 'a kettle', repoPath: repo, nature: 'code' });
  const done = async () => {
    await engine.stop();
    rmSync(home, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  };
  return { home, engine, app: createApp(engine), goal: getGoal(engine.store.db, goal.id)!, done };
};

test('an artifact page runs sandboxed; other artifacts are served as before', async () => {
  const { home, app, goal, done } = await setup();
  try {
    const dir = join(goalWorkspacePath(home, goal), 'artifacts');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'kettle.html'), '<!doctype html><svg></svg>');
    writeFileSync(join(dir, 'shot.png'), 'png');
    const page = await app.request(`/api/goals/${goal.id}/artifacts/kettle.html`);
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(page.headers.get('content-security-policy')).toBe('sandbox allow-scripts');
    expect(page.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await page.text()).toContain('<svg>');
    const png = await app.request(`/api/goals/${goal.id}/artifacts/shot.png`);
    expect(png.status).toBe(200);
    expect(png.headers.get('content-security-policy')).toBeNull();
  } finally {
    await done();
  }
});

test('the file preview renders a page only on request, still sandboxed; without it, and for any other file, plain text', async () => {
  const { home, app, goal, done } = await setup();
  try {
    const dir = join(goalWorkspacePath(home, goal), 'artifacts');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'kettle.html'), '<!doctype html><svg></svg>');
    writeFileSync(join(dir, 'core.js'), 'const x = 1;');
    const q = (f: string, render = false) => `/api/files?path=${encodeURIComponent(join(dir, f))}${render ? '&render=1' : ''}`;
    const source = await app.request(q('kettle.html'));
    expect([source.status, source.headers.get('content-type'), source.headers.get('content-security-policy')]).toEqual([200, 'text/plain; charset=utf-8', 'sandbox']);
    const rendered = await app.request(q('kettle.html', true));
    expect([rendered.status, rendered.headers.get('content-type'), rendered.headers.get('content-security-policy')]).toEqual([200, 'text/html; charset=utf-8', 'sandbox allow-scripts']);
    const js = await app.request(q('core.js', true));
    expect([js.status, js.headers.get('content-type'), js.headers.get('content-security-policy')]).toEqual([200, 'text/plain; charset=utf-8', 'sandbox']);
  } finally {
    await done();
  }
});

test("once the goal's folder is gone, the copies its delivery made stand in: served (sandboxed when rendered), and nothing else in the Output folder", async () => {
  const { engine, app, goal, done } = await setup();
  const out = mkdtempSync(join(tmpdir(), 'foundry-figure-out-'));
  try {
    writeFileSync(join(out, 'toaster.html'), '<!doctype html><svg></svg>');
    writeFileSync(join(out, 'notes.txt'), 'mine, not delivered');
    engine.store.append({ type: 'goal.artifacts_delivered', goalId: goal.id, payload: { status: 'ok', files: ['toaster.html'], dest: out, detail: '1 artifact(s) copied' } });
    const q = (f: string, render = false) => `/api/files?path=${encodeURIComponent(join(out, f))}${render ? '&render=1' : ''}`;
    const source = await app.request(q('toaster.html'));
    expect([source.status, source.headers.get('content-type'), source.headers.get('content-security-policy')]).toEqual([200, 'text/plain; charset=utf-8', 'sandbox']);
    const rendered = await app.request(q('toaster.html', true));
    expect([rendered.status, rendered.headers.get('content-type'), rendered.headers.get('content-security-policy')]).toEqual([200, 'text/html; charset=utf-8', 'sandbox allow-scripts']);
    expect(await rendered.text()).toContain('<svg>');
    expect((await app.request(q('notes.txt'))).status).toBe(403);
    // the artifacts route reads the same copy
    expect((await app.request(`/api/goals/${goal.id}/artifacts/toaster.html`)).status).toBe(200);
  } finally {
    rmSync(out, { recursive: true, force: true });
    await done();
  }
});
