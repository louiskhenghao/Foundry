import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { IdPrefix, getGoal, newId, type Task } from '@foundry/core';
import type { ScriptDeps } from '../checks/milestone-script.ts';
import { scriptDeps } from '../checks/walkthrough.ts';
import { defaultConfig } from '../config.ts';
import { Engine } from '../engine.ts';
import { FakeRunner, makeRepo, sh, terminal, waitFor } from '../test-helpers.ts';
import { screenshotsDir } from '../workspace.ts';
import { deployDir } from './deploy.ts';
import { addressProbe } from './smoke.ts';

const ROOT = resolve(import.meta.dir, '../../../..');
const SCRIPT = 'e2e/milestones/home.spec.ts';
const URL = 'https://site-abc-preview.vercel.app';
let dataDir: string;
let repo: string;
let bin: string;
const engines: Engine[] = [];

/** a stand-in for Vercel's CLI: prints the address the real one prints, fails when FAIL sits beside it */
function fakeCli(dir: string): string {
  const path = join(dir, 'fake-host');
  writeFileSync(path, `#!/bin/sh\nif [ -f "${join(dir, 'FAIL')}" ]; then echo "Error: refused" >&2; exit 1; fi\necho "Vercel CLI 64.5.0"\necho "${URL}"\n`);
  chmodSync(path, 0o755);
  return path;
}

const realProbe = addressProbe.fetch;
/** what the deployed address answers the smoke's first look: the page itself unless a test says otherwise */
let answer: () => Response;
const probed: string[] = [];

beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'foundry-smoke-'));
  repo = await makeRepo();
  bin = fakeCli(mkdtempSync(join(tmpdir(), 'foundry-smoke-cli-')));
  answer = () => new Response('<h1>studio</h1>');
  probed.length = 0;
  addressProbe.fetch = async (url) => (probed.push(url), answer());
});
afterEach(async () => {
  addressProbe.fetch = realProbe;
  scriptDeps.current = undefined;
  for (const e of engines.splice(0)) await e.stop().catch(() => {});
  for (const p of [dataDir, repo, `${repo}-foundry`, join(bin, '..')]) rmSync(p, { recursive: true, force: true });
});

type Seen = { argv: string[]; cwd: string; env: Record<string, string | undefined>; wrapper: string };
/** a stand-in for `npx playwright test`: remembers how it was called and writes the report it is given */
function fakeRun(report: (dir: string) => unknown, seen: Seen[], code = 0): ScriptDeps {
  return {
    run: async (argv, opts) => {
      const name = /--config '([^']+)'/.exec(argv.join(' '))?.[1];
      const wrapper = name && existsSync(join(opts.cwd, name)) ? readFileSync(join(opts.cwd, name), 'utf8') : '';
      seen.push({ argv, cwd: opts.cwd, env: opts.env, wrapper });
      const out = /outputFile: ("[^"]+")/.exec(wrapper)?.[1];
      if (out) {
        const dir = mkdtempSync(join(tmpdir(), 'foundry-fake-pw-'));
        writeFileSync(JSON.parse(out), JSON.stringify(report(dir)));
      }
      return { code, stdout: '', stderr: '', timedOut: false };
    },
  };
}
const passing = (dir: string) => {
  writeFileSync(join(dir, 'home.png'), 'png');
  return { suites: [{ title: SCRIPT, specs: [{ title: 'shows the home page', tests: [{ projectName: 'chromium', results: [{ status: 'passed', attachments: [{ name: 'the home page', contentType: 'image/png', path: join(dir, 'home.png') }] }] }] }] }] };
};
const failing = () => ({ suites: [{ title: SCRIPT, specs: [{ title: 'shows the home page', tests: [{ results: [{ status: 'failed', error: { message: 'expect(locator).toBeVisible()\nLocator: getByText("Home")' }, attachments: [] }] }] }] }] });

/** a finished goal whose site is a folder of pages, with a milestone script on its one landed feature task; Vercel set up */
async function finishedGoal(withScript = true) {
  writeFileSync(join(repo, 'index.html'), '<h1>studio</h1>');
  if (withScript) {
    mkdirSync(join(repo, 'e2e/milestones'), { recursive: true });
    writeFileSync(join(repo, SCRIPT), "import { test } from '@playwright/test';\ntest('shows the home page', async ({ page }) => { await page.goto('/'); });\n");
    writeFileSync(join(repo, 'playwright.config.ts'), "export default { testDir: 'e2e', use: { baseURL: `http://localhost:${process.env.PORT ?? 3000}` }, webServer: { command: 'npx serve .', port: 3000 } };\n");
  }
  await sh('git add -A && git -c user.name=t -c user.email=t@t commit -q -m site', repo);
  const engine = new Engine(defaultConfig(ROOT, { dataDir, claudeHome: join(dataDir, 'claude-home'), alwaysReviewTasks: false, log: () => {} }), new FakeRunner(() => {}));
  engines.push(engine);
  engine.updateSettings({ delivery: { vercelToken: 'vcp_SECRET_TOKEN' } });
  engine.deployCli = () => [bin];
  const goal = await engine.createGoal({ prompt: 'a page', repoPath: repo, autoBrief: { mustChecks: ['true'] } });
  await waitFor(() => terminal(getGoal(engine.store.db, goal.id)!.state));
  expect(getGoal(engine.store.db, goal.id)!.state).toBe('done');
  if (withScript) {
    // the feature's task as a planned goal has it: landed, with its milestone script
    const now = new Date().toISOString();
    const task: Task = { id: newId(IdPrefix.task), goalId: goal.id, title: 'home page', spec: 's', kind: 'feature', scope: null, scenario: 'frontend', area: null, tdd: 'inherit', dependsOn: [], relevantFiles: [SCRIPT], parallelizable: false, retryBudget: 1, origin: 'brief', milestone: 'open the home page', milestoneScript: SCRIPT, milestoneVisits: 0, checkpointOf: null, difficulty: 'standard', state: 'done', branch: null, worktreePath: null, baseRef: null, commitRef: null, commitMessage: null, hint: null, extraAttempts: 0, delegatedGoalId: null, summary: null, createdAt: now, updatedAt: now };
    engine.store.append({ type: 'task.created', goalId: goal.id, payload: { task } });
  }
  return { engine, goal: getGoal(engine.store.db, goal.id)! };
}
const deployments = (engine: Engine, id: string) => getGoal(engine.store.db, id)!.deployments ?? [];
const last = (engine: Engine, id: string) => deployments(engine, id).at(-1);
const smokeEvents = (engine: Engine, id: string) => engine.store.listByGoal(id, 5000).filter((e) => e.type.startsWith('deploy.smoke_'));

describe('the smoke after a deploy (ADR-0058)', () => {
  test('a preview deploy is followed by every milestone script against its address, in the deploy’s checkout, with no server of the script’s own', async () => {
    const { engine, goal } = await finishedGoal();
    expect(engine.deployInfo(goal.id).smoke).toEqual({ scripts: [SCRIPT] });
    const seen: Seen[] = [];
    scriptDeps.current = fakeRun(passing, seen);
    engine.deploy(goal.id, { provider: 'vercel', production: false });
    await waitFor(() => last(engine, goal.id)?.smoke?.status === 'pass');
    const dep = last(engine, goal.id)!;
    expect(dep).toMatchObject({ status: 'live', url: URL });
    expect(dep.smoke).toMatchObject({ status: 'pass', detail: `1 script passed against ${URL}`, endedAt: expect.any(String) });
    expect(dep.smoke!.scripts).toEqual([
      expect.objectContaining({ script: SCRIPT, taskId: expect.stringMatching(/^task_|^t_/), status: 'pass', error: null, summary: '1 test: shows the home page (chromium)', shots: [{ file: expect.stringMatching(/^smoke-.*-1-01\.png$/), caption: 'the home page' }], log: expect.stringMatching(/^smoke-.*-1-log\.txt$/) }),
    ]);
    // the script ran where the deploy ran, against the address: no webServer, baseURL the address on every project, no ports
    expect(seen).toHaveLength(1);
    expect(seen[0]!.cwd).toBe(deployDir(engine, goal));
    expect(seen[0]!.argv.join(' ')).toContain(`playwright test '${SCRIPT}' --config 'playwright.foundry-`);
    expect(seen[0]!.wrapper).toContain('webServer: undefined');
    expect(seen[0]!.wrapper).toContain(`baseURL: ${JSON.stringify(URL)}`);
    expect(seen[0]!.wrapper).toContain('const placed = kept.map(');
    expect(seen[0]!.env.PORT).toBeUndefined();
    expect(seen[0]!.env.API_PORT).toBeUndefined();
    const dir = screenshotsDir(dataDir, goal);
    expect(existsSync(join(dir, dep.smoke!.scripts[0]!.shots[0]!.file))).toBe(true);
    expect(readFileSync(join(dir, dep.smoke!.scripts[0]!.log!), 'utf8')).toContain(`# against ${URL}`);
    expect(smokeEvents(engine, goal.id).map((e) => e.type)).toEqual(['deploy.smoke_started', 'deploy.smoke_finished']);
    expect(smokeEvents(engine, goal.id)[1]!.payload).toMatchObject({ provider: 'vercel', production: false, url: URL, deployedAt: dep.at, status: 'pass' });

    // production gets no smoke unless asked: a script writes what it tries
    engine.deploy(goal.id, { provider: 'vercel', production: true });
    await waitFor(() => deployments(engine, goal.id).length === 2 && last(engine, goal.id)?.status === 'live');
    expect(last(engine, goal.id)!.smoke).toBeUndefined();
    expect(seen).toHaveLength(1);
    engine.deploy(goal.id, { provider: 'vercel', production: true, smoke: true });
    await waitFor(() => deployments(engine, goal.id).length === 3 && last(engine, goal.id)?.smoke?.status === 'pass');
    expect(last(engine, goal.id)).toMatchObject({ production: true, smoke: { status: 'pass' } });
    expect(seen).toHaveLength(2);
    // the earlier deploys keep their own smoke
    expect(deployments(engine, goal.id).map((d) => d.smoke?.status ?? null)).toEqual(['pass', null, 'pass']);
  }, 60_000);

  test('a failing script fails the smoke and says which; Smoke again tries the live address once more; a failed deploy is not tried', async () => {
    const { engine, goal } = await finishedGoal();
    const seen: Seen[] = [];
    scriptDeps.current = fakeRun(failing, seen, 1);
    engine.deploy(goal.id, { provider: 'vercel', production: false, smoke: true });
    await waitFor(() => last(engine, goal.id)?.smoke?.status === 'fail');
    const dep = last(engine, goal.id)!;
    expect(dep.smoke!.detail).toBe(`1 of 1 script failed against ${URL}: ${SCRIPT} — "shows the home page" failed: expect(locator).toBeVisible()`);
    expect(dep.smoke!.scripts[0]).toMatchObject({ status: 'fail', error: '"shows the home page" failed: expect(locator).toBeVisible()\nLocator: getByText("Home")' });

    // the host's environment mended: again, on the same deploy
    scriptDeps.current = fakeRun(passing, seen);
    engine.smokeDeployment(goal.id, dep.at);
    expect(() => engine.smokeDeployment(goal.id, dep.at)).toThrow(/a smoke of this goal is running/);
    await waitFor(() => last(engine, goal.id)?.smoke?.status === 'pass');
    expect(deployments(engine, goal.id)).toHaveLength(1);
    expect(last(engine, goal.id)!.smoke).toMatchObject({ status: 'pass', detail: `1 script passed against ${URL}` });
    expect(seen).toHaveLength(2);
    expect(seen[1]!.cwd).toBe(deployDir(engine, goal));
    expect(smokeEvents(engine, goal.id).map((e) => e.type)).toEqual(['deploy.smoke_started', 'deploy.smoke_finished', 'deploy.smoke_started', 'deploy.smoke_finished']);

    expect(() => engine.smokeDeployment(goal.id, '2000-01-01T00:00:00.000Z')).toThrow(/not on the goal/);
    writeFileSync(join(bin, '..', 'FAIL'), '');
    engine.deploy(goal.id, { provider: 'vercel', production: false });
    await waitFor(() => deployments(engine, goal.id).length === 2 && last(engine, goal.id)?.status === 'failed');
    expect(() => engine.smokeDeployment(goal.id, last(engine, goal.id)!.at)).toThrow(/failed: only a live address is tried/);
    expect(last(engine, goal.id)!.smoke).toBeUndefined();
  }, 60_000);

  test('an address behind a host’s login is not tried: the smoke says which setting asks for it, and no script runs', async () => {
    const { engine, goal } = await finishedGoal();
    const seen: Seen[] = [];
    scriptDeps.current = fakeRun(passing, seen);
    answer = () => new Response(null, { status: 302, headers: { location: `https://vercel.com/sso-api?url=${encodeURIComponent(URL)}` } });
    engine.deploy(goal.id, { provider: 'vercel', production: false });
    await waitFor(() => last(engine, goal.id)?.smoke?.status === 'fail');
    expect(last(engine, goal.id)!.smoke!.detail).toStartWith('not tried: the address asks for a Vercel login: the project’s Deployment Protection is on');
    expect(seen).toHaveLength(0);
    expect(probed).toEqual([URL]);
    expect(smokeEvents(engine, goal.id).map((e) => e.type)).toEqual(['deploy.smoke_finished']);

    // a 401 (Netlify's visitor access answers so) is a login as well; once the person opens the address, Smoke again tries the scripts
    answer = () => new Response('Login Redirect', { status: 401 });
    engine.smokeDeployment(goal.id, last(engine, goal.id)!.at);
    await waitFor(() => probed.length === 2 && !engine.deployInfo(goal.id).smoking);
    expect(last(engine, goal.id)!.smoke!.detail).toContain('asks for a Vercel login');
    answer = () => new Response('<h1>studio</h1>');
    engine.smokeDeployment(goal.id, last(engine, goal.id)!.at);
    await waitFor(() => last(engine, goal.id)?.smoke?.status === 'pass');
    expect(seen).toHaveLength(1);
  }, 60_000);

  test('a goal without milestone scripts gets a skipped smoke with the reason, and no Smoke again', async () => {
    const { engine, goal } = await finishedGoal(false);
    expect(engine.deployInfo(goal.id).smoke).toEqual({ scripts: [] });
    const seen: Seen[] = [];
    scriptDeps.current = fakeRun(passing, seen);
    engine.deploy(goal.id, { provider: 'vercel', production: false });
    await waitFor(() => last(engine, goal.id)?.smoke?.status === 'skipped');
    expect(last(engine, goal.id)!.smoke).toMatchObject({ status: 'skipped', detail: 'the goal has no milestone scripts to try against it', scripts: [] });
    expect(seen).toHaveLength(0);
    expect(smokeEvents(engine, goal.id).map((e) => e.type)).toEqual(['deploy.smoke_finished']);
    expect(() => engine.smokeDeployment(goal.id, last(engine, goal.id)!.at)).toThrow(/no milestone scripts/);
  }, 60_000);
});
