import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { IDLE_DELIVERY, getGoal, type Goal } from '@foundry/core';
import type { ClaudeRunner } from '@foundry/runner';
import { ensureSelfCheck, runSelfCheck } from '../checks/selfcheck.ts';
import { defaultConfig } from '../config.ts';
import { Engine } from '../engine.ts';
import { failureTail, installSteps } from './manager.ts';
import { makeRepo, sh } from '../test-helpers.ts';

const ROOT = resolve(import.meta.dir, '../../../..');
const noRunner = { active: () => 0, run: async () => { throw new Error('no sessions in this test'); } } as unknown as ClaudeRunner;

let dataDir: string;
let ws: string;
let engine: Engine;
beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'foundry-preview-data-'));
  ws = mkdtempSync(join(tmpdir(), 'foundry-preview-ws-'));
  engine = new Engine(defaultConfig(ROOT, { dataDir, claudeHome: join(dataDir, 'claude-home'), log: () => {} }), noRunner);
  engine.config.preview = { portFrom: 47100, portTo: 47110, idleMinutes: 60 };
});
afterEach(async () => {
  await engine.stop();
  for (const d of [dataDir, ws]) rmSync(d, { recursive: true, force: true });
});

const goal = (over: Partial<Goal> = {}): Goal => {
  const now = new Date().toISOString();
  const g: Goal = {
    id: 'g_preview01', title: 'preview', prompt: 'p', workspaceDir: ws, checkpoint: null, selfCheck: false, previewRef: null, previewPlace: 'auto', interview: null, effort: null, modelPreset: null, modelSubstitutions: {}, repoPath: '/nowhere', baseBranch: 'main', branch: 'goal/g_preview01',
    budgets: { maxCostUsd: 5, maxDurationMin: 120, maxConcurrent: 3, attemptsPerTask: 3 }, budgetPreset: 'custom', mode: 'expert', workflow: { tdd: 'off', pace: 'thorough' },
    models: { strong: 'opus', cheap: 'haiku', worker: 'opus' }, state: 'running', stateBeforeBlock: null, costUsd: 0, fixCycles: 0, delivery: IDLE_DELIVERY, attachments: [], baseSync: null, autoskills: null, follows: null,
    completion: { graphRefresh: false, docs: [], docsRun: null, graphRun: null, artifactsRun: null }, nature: 'auto', outputDir: null, runningSince: null, createdAt: now, updatedAt: now, ...over,
  };
  engine.store.append({ type: 'goal.created', goalId: g.id, payload: { goal: g } });
  return getGoal(engine.store.db, g.id)!;
};

/** true while the url still answers after `ms` of polling for it to go away */
const answersWithin = async (url: string, ms: number): Promise<boolean> => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const up = await fetch(url, { signal: AbortSignal.timeout(500) }).then(() => true, () => false);
    if (!up) return false;
    await new Promise((r) => setTimeout(r, 100));
  }
  return true;
};

describe('PreviewManager', () => {
  test("a finished goal whose folder was cleaned up previews the base branch in Foundry's preview folder; another branch can be picked", async () => {
    const repo = await makeRepo();
    writeFileSync(join(repo, 'package.json'), JSON.stringify({ scripts: { start: 'node server.js' } }));
    await sh('git add package.json && git commit -qm "chore: start script" && git checkout -qb feature && echo hi > feature.txt && git add feature.txt && git commit -qm "feat: x" && git checkout -q main', repo);
    const gone = join(dataDir, 'progress', 'preview-goal');
    // still being worked on: always the goal's own folder, and the branch cannot be changed
    const running = goal({ repoPath: repo, workspaceDir: gone });
    expect(engine.preview.status(running.id).workspace).toMatchObject({ kind: 'goal', path: gone });
    expect(engine.preview.setSource(running, 'feature')).rejects.toThrow(/being worked on/);

    engine.store.append({ type: 'goal.state_changed', goalId: running.id, payload: { from: 'running', to: 'done', reason: 'test' } });
    // the person's checkout is on main, the branch the preview would run: it runs there, as it is
    const g0 = getGoal(engine.store.db, running.id)!;
    expect(engine.preview.status(g0.id).workspace).toMatchObject({ kind: 'checkout', path: repo, branch: 'main', place: 'auto', checkoutBranch: 'main' });
    await engine.preview.prepare(g0);
    expect(await sh('git rev-parse --abbrev-ref HEAD', repo)).toContain('main');
    // pinned to Foundry's folder, main runs there instead
    await engine.preview.setSource(g0, undefined, 'foundry');
    const g = getGoal(engine.store.db, running.id)!;
    const ws0 = engine.preview.status(g.id).workspace!;
    expect(ws0).toMatchObject({ kind: 'branch', branch: 'main', place: 'foundry' });
    expect(ws0.fallback).toContain('cleaned up');
    expect(ws0.path).not.toBe(gone);
    await engine.preview.prepare(g);
    expect(existsSync(join(ws0.path, 'package.json'))).toBe(true);
    expect(engine.preview.status(g.id).apps.map((a) => a.run.command)).toEqual(['npm run start']);

    const { options, selectable } = await engine.preview.sources(g);
    expect(selectable).toBe(true);
    expect(options.map((o) => [o.ref, o.available])).toEqual([
      ['goal/g_preview01', false],
      ['main', true],
      ['feature', true],
    ]);
    const picked = await engine.preview.setSource(g, 'feature');
    expect(picked).toMatchObject({ kind: 'branch', branch: 'feature', fallback: null });
    expect(existsSync(join(picked.path, 'feature.txt'))).toBe(true);
    expect(engine.preview.setSource(g, 'nope')).rejects.toThrow(/no branch nope/);
    // auto: feature is not what the checkout is on, so it stays in Foundry's folder; pinned to the checkout, the checkout runs as it is
    await engine.preview.setSource(getGoal(engine.store.db, g.id)!, undefined, 'auto');
    expect(engine.preview.status(g.id).workspace).toMatchObject({ kind: 'branch', branch: 'feature', checkoutBranch: 'main' });
    await engine.preview.setSource(getGoal(engine.store.db, g.id)!, undefined, 'checkout');
    expect(engine.preview.status(g.id).workspace).toMatchObject({ kind: 'checkout', path: repo, branch: 'main', place: 'checkout' });
    rmSync(repo, { recursive: true, force: true });
  });

  test('runs each app of a workspace on its own port, tells each where the others are, and stops them one at a time', async () => {
    const serve = `bun -e "Bun.serve({ port: Number(process.env.PORT), fetch: () => new Response(process.env.FOUNDRY_APP_API_URL ?? 'none') })"`;
    writeFileSync(join(ws, 'package.json'), JSON.stringify({ workspaces: ['apps/*'] }));
    for (const dir of ['web', 'api']) {
      mkdirSync(join(ws, 'apps', dir), { recursive: true });
      writeFileSync(join(ws, 'apps', dir, 'package.json'), JSON.stringify({ name: `@demo/${dir}`, scripts: { start: serve } }));
    }
    const g = goal();
    const before = engine.preview.status(g.id);
    expect(before.source).toBe('detected');
    expect(before.apps.map((a) => [a.key, a.dir])).toEqual([['web', 'apps/web'], ['api', 'apps/api']]);
    const st = await engine.preview.start(g, 'human');
    const [web, api] = st.apps;
    expect(web!.ready && api!.ready).toBe(true);
    expect(web!.port).not.toBe(api!.port);
    // the primary app is the first one; the web app was told where the API is
    expect(st.url).toBe(web!.url);
    expect(await fetch(web!.url!).then((r) => r.text())).toBe(api!.url!);
    await engine.preview.stop(g.id, 'test', 'web');
    expect(engine.preview.status(g.id).apps.map((a) => a.running)).toEqual([false, true]);
    expect(await answersWithin(web!.url!, 3000)).toBe(false);
    expect((await engine.preview.start(g, 'human', 'web')).apps[0]!.running).toBe(true);
    await expect(engine.preview.start(g, 'human', 'nope')).rejects.toThrow(/no app "nope"/);
    await engine.preview.stop(g.id, 'test');
    expect(engine.preview.status(g.id).running).toBe(false);
  }, 60_000);

  test('starts the detected dev script on a free port from the range, answers, and stops', async () => {
    writeFileSync(join(ws, 'package.json'), JSON.stringify({ scripts: { start: `bun -e "Bun.serve({ port: Number(process.env.PORT), fetch: () => new Response('hi from preview') })"` } }));
    const g = goal();
    expect(engine.preview.status(g.id)).toMatchObject({ running: false, run: { command: 'npm run start', platform: 'web' }, source: 'detected' });
    const st = await engine.preview.start(g, 'human');
    expect(st.running).toBe(true);
    expect(st.ready).toBe(true);
    expect(st.port).toBeGreaterThanOrEqual(47100);
    expect(await fetch(st.url!).then((r) => r.text())).toBe('hi from preview');
    expect(engine.store.listByGoal(g.id).some((e) => e.type === 'preview.started')).toBe(true);
    // starting again is a no-op that keeps the same process
    expect((await engine.preview.start(g, 'human')).port).toBe(st.port);
    await engine.preview.stop(g.id, 'test');
    expect(engine.preview.status(g.id).running).toBe(false);
    // the server itself (npm → sh → bun, grandchildren of the shell) is gone too, not orphaned on the port
    expect(await answersWithin(st.url!, 3000)).toBe(false);
    expect(engine.store.listByGoal(g.id).some((e) => e.type === 'preview.stopped')).toBe(true);
  }, 30_000);

  test('in Docker the detected command binds every interface and the server gets HOST/HOSTNAME=0.0.0.0', async () => {
    const saved = process.env.FOUNDRY_DOCKER;
    process.env.FOUNDRY_DOCKER = '1';
    try {
      writeFileSync(join(ws, 'package.json'), JSON.stringify({ scripts: { start: `bun -e "Bun.serve({ port: Number(process.env.PORT), hostname: process.env.HOST, fetch: () => new Response(process.env.HOST + ' ' + process.env.HOSTNAME) })"` } }));
      const g = goal();
      const st = await engine.preview.start(g, 'human');
      expect(st.ready).toBe(true);
      expect(st.url).toBe(`http://localhost:${st.port}`);
      expect(await fetch(st.url!).then((r) => r.text())).toBe('0.0.0.0 0.0.0.0');
      await engine.preview.stop(g.id, 'test');
      writeFileSync(join(ws, 'package.json'), JSON.stringify({ scripts: { dev: 'vite' }, devDependencies: { vite: '^5' } }));
      expect(engine.preview.status(g.id).run?.command).toBe('npm run dev -- --port {port} --strictPort --host 0.0.0.0');
    } finally {
      if (saved === undefined) delete process.env.FOUNDRY_DOCKER;
      else process.env.FOUNDRY_DOCKER = saved;
    }
  }, 30_000);

  test('nothing to run: start refuses with a reason, and the self-check records an error instead of throwing', async () => {
    const g = goal({ selfCheck: true });
    await expect(engine.preview.start(g, 'human')).rejects.toThrow(/nothing to run/);
    const check = ensureSelfCheck(engine, g)!;
    expect(check.spec.type).toBe('selfcheck');
    expect(check.tier).toBe('must');
    expect(ensureSelfCheck(engine, g)!.id).toBe(check.id); // idempotent
    const r = await runSelfCheck(engine, g, { taskId: 't_x' });
    expect(r?.status).toBe('error');
    expect(r?.summary).toContain('nothing to run');
    expect(engine.store.listByGoal(g.id).some((e) => e.type === 'selfcheck.finished')).toBe(true);
  });
});

describe('what the preview card can tell', () => {
  const until = async (check: () => boolean, ms = 8000) => {
    for (const t0 = Date.now(); Date.now() - t0 < ms && !check(); ) await new Promise((r) => setTimeout(r, 100));
  };
  test('a demo-style command: its other servers are found, named by folder, and their ports kept from other goals', async () => {
    const serve = (port: string) => `bun -e 'Bun.serve({ port: ${port}, fetch: () => new Response("ok") }); setInterval(() => {}, 1000)'`;
    mkdirSync(join(ws, 'apps', 'admin'), { recursive: true });
    mkdirSync(join(ws, 'node_modules'));
    writeFileSync(join(ws, 'apps', 'admin', 'package.json'), JSON.stringify({ name: '@demo/admin' }));
    // plus a raw TCP listener (a debugger, an internal port): kept from other goals, but not offered as a link
    const tcp = `bun -e 'Bun.listen({ hostname: "127.0.0.1", port: 47102, socket: { data() {} } }); setInterval(() => {}, 1000)'`;
    // and an API that listens on IPv6 only, as Node does when `localhost` resolves to ::1
    mkdirSync(join(ws, 'apps', 'api'), { recursive: true });
    const v6 = `bun -e 'Bun.serve({ hostname: "::1", port: 47104, fetch: () => new Response("v6") }); setInterval(() => {}, 1000)'`;
    writeFileSync(join(ws, 'package.json'), JSON.stringify({ scripts: { start: `(cd apps/admin && ${serve('47101')}) & ${tcp} & (cd apps/api && ${v6}) & ${serve('Number(process.env.PORT)')}` } }));
    const g = goal();
    const st = await engine.preview.start(g, 'human');
    expect(st.port).toBe(47100);
    expect(st.workspace).toEqual({ kind: 'goal', path: ws, branch: 'goal/g_preview01', preparing: false, fallback: null, place: 'auto', checkoutBranch: null });
    await until(() => engine.preview.status(g.id).apps[0]!.discovered.length > 1);
    expect(engine.preview.status(g.id).apps[0]!.discovered).toEqual([
      { port: 47101, url: 'http://localhost:47101', name: 'admin', dir: 'apps/admin' },
      { port: 47104, url: 'http://localhost:47104', name: 'api', dir: 'apps/api' },
    ]);
    // another goal's preview skips the ports the demo took, the TCP one included
    const other = mkdtempSync(join(tmpdir(), 'foundry-preview-other-'));
    writeFileSync(join(other, 'package.json'), JSON.stringify({ scripts: { start: serve('Number(process.env.PORT)') } }));
    mkdirSync(join(other, 'node_modules'));
    const g2 = goal({ id: 'g_preview02', workspaceDir: other, branch: 'goal/g_preview02' });
    expect((await engine.preview.start(g2, 'human')).port).toBe(47103);
    await engine.preview.stop(g2.id, 'test');
    await engine.preview.stop(g.id, 'test');
    rmSync(other, { recursive: true, force: true });
  }, 30_000);

  test('an app that fails shows its last lines, not only its exit code', async () => {
    writeFileSync(join(ws, 'package.json'), JSON.stringify({ scripts: { start: `echo starting; echo "Error: Cannot find module '@prisma/client'" >&2; exit 3` } }));
    mkdirSync(join(ws, 'node_modules'));
    const g = goal();
    await engine.preview.start(g, 'human');
    await until(() => !!engine.preview.status(g.id).error);
    const app = engine.preview.status(g.id).apps[0]!;
    expect(app.error).toBe('exited with code 3');
    expect(app.errorDetail).toEqual(['starting', "Error: Cannot find module '@prisma/client'"]);
  }, 30_000);

  test('environment: entered and imported variables reach the app, Foundry’s own win, values never leave as text', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'foundry-preview-repo-'));
    Bun.spawnSync(['git', 'init', '-q', repo]);
    writeFileSync(join(repo, '.env'), 'FROM_FILE=file-value\nSHARED=file\nPORT=1\n');
    writeFileSync(join(ws, '.env.example'), 'FROM_FILE=\nNEEDED_KEY=example\nSECRET_KEY=\n');
    const echo = `bun -e 'console.log("token is " + process.env.SHARED); Bun.serve({ port: Number(process.env.PORT), fetch: () => Response.json({ f: process.env.FROM_FILE ?? null, s: process.env.SHARED, port: process.env.PORT }) }); setInterval(() => {}, 1000)'`;
    writeFileSync(join(ws, 'package.json'), JSON.stringify({ scripts: { start: echo } }));
    mkdirSync(join(ws, 'node_modules'));
    const g = goal({ repoPath: repo });
    const view = engine.preview.setEnv(g, { SHARED: 'entered-secret-value' }, 0);
    expect(view).toMatchObject({ rev: 1, keys: ['SHARED'], checkout: { files: ['.env'], keys: ['FROM_FILE', 'PORT', 'SHARED'] }, missing: ['FROM_FILE', 'SECRET_KEY', 'NEEDED_KEY'] });
    // the view names variables, never their values
    expect(JSON.stringify(view)).not.toContain('entered-secret-value');
    expect(JSON.stringify(view)).not.toContain('file-value');
    // nothing is taken from the checkout until the person imports it
    let st = await engine.preview.start(g, 'human');
    expect(await fetch(st.url!).then((r) => r.json())).toEqual({ f: null, s: 'entered-secret-value', port: String(st.port) });
    // the app printed the secret: its output shows it hidden
    await new Promise((r) => setTimeout(r, 300));
    expect(engine.preview.status(g.id).apps[0]!.log.join('\n')).toContain('token is ••••');
    expect(engine.preview.status(g.id).apps[0]!.log.join('\n')).not.toContain('entered-secret-value');
    await engine.preview.stop(g.id, 'test');
    const imported = engine.preview.importCheckoutEnv(g);
    expect(imported.added).toEqual(['FROM_FILE', 'PORT']);
    expect(imported.view.missing).toEqual(['SECRET_KEY', 'NEEDED_KEY']);
    st = await engine.preview.start(g, 'human');
    // the entered SHARED is kept over the checkout's; Foundry's PORT wins over the imported one
    expect(await fetch(st.url!).then((r) => r.json())).toEqual({ f: 'file-value', s: 'entered-secret-value', port: String(st.port) });
    expect(engine.preview.redact(g, 'a file-value b')).toBe('a •••• b');
    // nothing is written into the goal's folder, where sessions work
    expect(existsSync(join(ws, '.env'))).toBe(false);
    await engine.preview.stop(g.id, 'test');
    rmSync(repo, { recursive: true, force: true });
  }, 30_000);
});

describe('the sweeper', () => {
  test('on a finished goal it leaves a preview the person started, stops Foundry’s own, and says why', async () => {
    const serve = `bun -e 'Bun.serve({ port: Number(process.env.PORT), fetch: () => new Response("ok") }); setInterval(() => {}, 1000)'`;
    writeFileSync(join(ws, 'package.json'), JSON.stringify({ scripts: { start: serve } }));
    mkdirSync(join(ws, 'node_modules'));
    const g = goal({ state: 'done' });
    await engine.preview.start(g, 'human');
    await (engine.preview as any).sweep();
    expect(engine.preview.status(g.id).running).toBe(true);
    await engine.preview.stop(g.id, 'human');
    expect(engine.preview.status(g.id).apps[0]!.stopped).toBeNull();
    await engine.preview.start(g, 'milestone');
    await (engine.preview as any).sweep();
    const app = engine.preview.status(g.id).apps[0]!;
    expect(app.running).toBe(false);
    expect(app.stopped).toBe('goal ended');
    expect(engine.store.listByGoal(g.id).filter((e) => e.type === 'preview.stopped').map((e) => (e.payload as { reason: string }).reason)).toContain('goal ended');
  }, 30_000);
});

describe('failureTail', () => {
  test('keeps the app’s own lines and drops npm, pnpm, yarn and bun run banners', () => {
    expect(failureTail(['[preview] note', '> x@ start /w', '> node server.js', '', 'listening…', 'Error: boom', ' ELIFECYCLE  Command failed with exit code 3.', ' WARN   Local package.json exists, but node_modules missing', 'error Command failed with exit code 3.', 'info Visit https://yarnpkg.com/en/docs/cli/run', 'error: script "start" exited with code 3', 'npm error code 3', 'npm error path /w', '$ next dev'])).toEqual(['listening…', 'Error: boom', ' WARN   Local package.json exists, but node_modules missing']);
  });
});

describe('installSteps', () => {
  const app = (dir: string, install: string | null = null) => ({ key: dir || 'app', name: dir || 'app', dir, install, command: 'x', url: null, platform: 'web' as const });
  test('installs only where a package.json has no node_modules beside it or at the root', () => {
    writeFileSync(join(ws, 'package.json'), '{}');
    writeFileSync(join(ws, 'bun.lock'), '');
    expect(installSteps(ws, [app('')])).toEqual([{ dir: '', command: 'bun install' }]);
    expect(installSteps(ws, [app('', 'make deps')])).toEqual([{ dir: '', command: 'make deps' }]);
    mkdirSync(join(ws, 'node_modules'));
    expect(installSteps(ws, [app('')])).toEqual([]);
  });
  test('an app folder without a package.json is the person\'s to set up', () => {
    mkdirSync(join(ws, 'svc'));
    expect(installSteps(ws, [app('svc', 'pip install -r requirements.txt')])).toEqual([]);
  });
});
