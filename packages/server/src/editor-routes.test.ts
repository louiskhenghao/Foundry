import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Engine, defaultConfig, goalWorkspacePath } from '@foundry/engine';
import { FakeRunner, makeRepo } from '../../engine/src/test-helpers.ts';
import { createApp } from './app.ts';
import { SEEK_LISTENER } from './film-page.ts';

/** the Editor (ADR-0086) over HTTP: a motion-studio film's scrubber page and its files in a sandbox, Re-render refused while the goal is at work, everything 404 with the beta off */
const setup = async (betaEditor: boolean) => {
  const home = mkdtempSync(join(tmpdir(), 'foundry-editor-route-'));
  const repo = await makeRepo();
  const engine = new Engine(defaultConfig(resolve(import.meta.dir, '../../..'), { dataDir: home, claudeHome: join(home, 'claude'), useGraphify: false, betaEditor, log: () => {} }), new FakeRunner(() => {}));
  engine.beginUpdateDrain();
  const goal = await engine.createGoal({ prompt: 'a launch film', repoPath: repo, nature: 'video' });
  // a film as motion-studio's scaffold leaves it, in the goal's progress folder
  const ws = goalWorkspacePath(engine.config.dataDir, goal);
  mkdirSync(join(ws, 'motion', 'launch'), { recursive: true });
  mkdirSync(join(ws, 'motion', 'lib'), { recursive: true });
  writeFileSync(join(ws, 'motion', 'launch', 'film.json'), JSON.stringify({ title: 'Launch <film>', duration: 15, fps: 60, formats: ['16x9', '9x16'] }));
  writeFileSync(join(ws, 'motion', 'launch', 'index.html'), '<!doctype html><canvas id="c"></canvas><script src="./film.js"></script><script>window.seek = (t) => true;</script>');
  writeFileSync(join(ws, 'motion', 'launch', 'film.js'), 'window.FILM = { duration: 15 };');
  writeFileSync(join(ws, 'motion', 'lib', 'motion.js'), 'window.Motion = {};');
  const done = async () => {
    await engine.stop();
    rmSync(home, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  };
  return { app: createApp(engine), goal, done };
};

test('with the beta off: no films on the goal view, the pages are 404, Re-render is refused', async () => {
  const { app, goal, done } = await setup(false);
  try {
    const view = (await (await app.request(`/api/goals/${goal.id}`)).json()) as { editor: { enabled: boolean; projects: unknown[]; films: unknown[]; rerender: unknown } };
    expect(view.editor).toEqual({ enabled: false, projects: [], films: [], rerender: null });
    expect((await app.request(`/api/goals/${goal.id}/film/launch`)).status).toBe(404);
    expect((await app.request(`/api/goals/${goal.id}/motion/launch/index.html`)).status).toBe(404);
    const r = await app.request(`/api/goals/${goal.id}/rerender`, { method: 'POST' });
    expect(r.status).toBe(400);
    expect(((await r.json()) as { error: string }).error).toContain('Settings → Beta');
  } finally {
    await done();
  }
});

test('with the beta on: the film on the goal view, its scrubber page, its own files in a sandbox with the seek listener, never a file outside motion/', async () => {
  const { app, goal, done } = await setup(true);
  try {
    const view = (await (await app.request(`/api/goals/${goal.id}`)).json()) as { editor: { enabled: boolean; films: { slug: string; title: string; duration: number; fps: number; formats: string[]; url: string }[]; rerender: unknown } };
    expect(view.editor.enabled).toBe(true);
    expect(view.editor.films).toEqual([{ slug: 'launch', title: 'Launch <film>', duration: 15, fps: 60, formats: ['16x9', '9x16'], url: `/api/goals/${goal.id}/film/launch` }]);
    // a video goal without a HyperFrames project has nothing to render
    expect(view.editor.rerender).toBeNull();

    const page = await app.request(`/api/goals/${goal.id}/film/launch`);
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toContain('text/html');
    const html = await page.text();
    expect(html).toContain('Launch &lt;film&gt;');
    expect(html).toContain(`sandbox="allow-scripts" src="/api/goals/${goal.id}/motion/launch/index.html?format=16x9&amp;render=1"`);
    expect(html).toContain('<option value="9x16">');
    expect(html).not.toContain('content-security-policy');

    const film = await app.request(`/api/goals/${goal.id}/motion/launch/index.html`);
    expect(film.status).toBe(200);
    expect(film.headers.get('content-security-policy')).toBe('sandbox allow-scripts');
    const body = await film.text();
    expect(body.startsWith('<!doctype html>')).toBe(true);
    expect(body.endsWith(SEEK_LISTENER)).toBe(true);
    const script = await app.request(`/api/goals/${goal.id}/motion/launch/film.js`);
    expect(script.status).toBe(200);
    expect(script.headers.get('content-type')).toContain('text/javascript');
    expect(await script.text()).toBe('window.FILM = { duration: 15 };');
    expect((await app.request(`/api/goals/${goal.id}/motion/lib/motion.js`)).status).toBe(200);
    expect((await app.request(`/api/goals/${goal.id}/motion/launch/..%2F..%2Fpackage.json`)).status).toBe(400);
    expect((await app.request(`/api/goals/${goal.id}/motion/launch/.git`)).status).toBe(400);
    expect((await app.request(`/api/goals/${goal.id}/motion/launch/missing.js`)).status).toBe(404);
    expect((await app.request(`/api/goals/${goal.id}/film/nope`)).status).toBe(404);

    // the goal is at work: no Re-render yet
    const r = await app.request(`/api/goals/${goal.id}/rerender`, { method: 'POST' });
    expect(r.status).toBe(409);
    expect(((await r.json()) as { error: string }).error).toContain('still at work');
  } finally {
    await done();
  }
});
