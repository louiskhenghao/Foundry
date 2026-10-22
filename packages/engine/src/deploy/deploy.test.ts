import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { getGoal } from '@foundry/core';
import { defaultConfig } from '../config.ts';
import { Engine } from '../engine.ts';
import { FakeRunner, makeRepo, sh, terminal, waitFor } from '../test-helpers.ts';
import { deployDir } from './deploy.ts';

const ROOT = resolve(import.meta.dir, '../../../..');
let dataDir: string;
let repo: string;
let bin: string;
let log: string;
const engines: Engine[] = [];

/**
 * A stand-in for the three hosts' CLIs: it writes each call (the arguments, and whether each token reached it) to a
 * log, prints what the real one prints, and fails when FAIL_DEPLOY is set in its own folder.
 */
function fakeCli(dir: string): string {
  const path = join(dir, 'fake-host');
  writeFileSync(
    path,
    `#!/bin/sh
host="$1"; shift
printf '%s|%s|vercel=%s netlify=%s cloudflare=%s account=%s|%s\\n' "$host" "$*" "\${VERCEL_TOKEN:+set}" "\${NETLIFY_AUTH_TOKEN:+set}" "\${CLOUDFLARE_API_TOKEN:+set}" "$CLOUDFLARE_ACCOUNT_ID" "$(pwd)" >> "${join(dir, 'calls.log')}"
if [ -f "${join(dir, 'FAIL_DEPLOY')}" ]; then echo "Error: the token $VERCEL_TOKEN was refused" >&2; exit 1; fi
case "$*" in
  *"--team nosuch"*) printf 'npm warn deprecated @opentelemetry/sdk-trace-node@2.12.0: Use @opentelemetry/sdk-trace package\\nnpm warn deprecated glob@8.1.0: Glob versions prior to v9 are no longer supported\\n ›   Error: Failed to create site: 404: Not Found\\n' >&2; exit 1 ;;
esac
case "$host" in
  vercel) echo "Vercel CLI 64.5.0"; echo "https://site-abc-preview.vercel.app" ;;
  netlify) echo '{"site_id":"s1","deploy_url":"https://d1--site.netlify.app","url":"https://site.netlify.app"}' ;;
  cloudflare)
    case "$*" in
      *"project create"*) if [ -f "${join(dir, 'PROJECT')}" ]; then echo "A project with this name already exists [code: 8000002]" >&2; exit 1; fi; touch "${join(dir, 'PROJECT')}"; echo "Successfully created the project" ;;
      *) if [ -f .wrangler/deploy/config.json ]; then echo 'There is a deploy configuration at ".wrangler/deploy/config.json".' >&2; exit 1; fi; echo "✨ Deployment complete! Take a peek over at https://4f2a.site.pages.dev" ;;
    esac ;;
esac
`,
  );
  chmodSync(path, 0o755);
  return path;
}
const calls = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : []);

beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'foundry-deploy-'));
  repo = await makeRepo();
  const fakes = mkdtempSync(join(tmpdir(), 'foundry-deploy-cli-'));
  bin = fakeCli(fakes);
  log = join(fakes, 'calls.log');
});
afterEach(async () => {
  for (const e of engines.splice(0)) await e.stop().catch(() => {});
  for (const p of [dataDir, repo, `${repo}-foundry`, join(bin, '..')]) rmSync(p, { recursive: true, force: true });
});

/** a finished goal in a repository holding `files`, an engine whose hosts are the stand-in, every host's token set */
async function finishedGoal(files: Record<string, string>) {
  for (const [p, body] of Object.entries(files)) writeFileSync(join(repo, p), body);
  await sh('git add -A && git -c user.name=t -c user.email=t@t commit -q -m site', repo);
  const engine = new Engine(defaultConfig(ROOT, { dataDir, claudeHome: join(dataDir, 'claude-home'), alwaysReviewTasks: false, log: () => {} }), new FakeRunner(() => {}));
  engines.push(engine);
  engine.updateSettings({ delivery: { vercelToken: 'vcp_SECRET_TOKEN', netlifyToken: 'nfp_SECRET_TOKEN', cloudflareToken: 'cf_SECRET_TOKEN', cloudflareAccountId: 'acc123' } });
  engine.deployCli = (p) => [bin, p];
  const goal = await engine.createGoal({ prompt: 'a page', repoPath: repo, autoBrief: { mustChecks: ['true'] } });
  await waitFor(() => terminal(getGoal(engine.store.db, goal.id)!.state));
  return { engine, goal: getGoal(engine.store.db, goal.id)! };
}
const last = (engine: Engine, id: string) => (getGoal(engine.store.db, id)!.deployments ?? []).at(-1);

describe('deploying a finished goal', () => {
  test('a folder of pages goes to Vercel from a checkout of the goal’s commit; the token reaches the CLI, never the record', async () => {
    const { engine, goal } = await finishedGoal({ 'index.html': '<h1>studio</h1>' });
    const info = engine.deployInfo(goal.id, 'vercel');
    expect(info.app).toMatchObject({ ok: true, app: { framework: 'static pages', kind: 'static' } });
    expect(info.providers.map((p) => [p.id, p.configured, p.refused])).toEqual([
      ['vercel', true, null],
      ['netlify', true, null],
      ['cloudflare', true, null],
    ]);
    expect(info.plan.map((s) => s.command)).toEqual([`${bin} vercel deploy --yes`]);

    engine.deploy(goal.id, { provider: 'vercel', production: false });
    expect(() => engine.deploy(goal.id, { provider: 'vercel', production: false })).toThrow(/is running/);
    await waitFor(() => last(engine, goal.id)?.status === 'live');
    expect(last(engine, goal.id)).toMatchObject({ provider: 'vercel', production: false, url: 'https://site-abc-preview.vercel.app', framework: 'static pages', ref: expect.any(String) });
    const [call] = calls();
    expect(call).toContain('vercel|deploy --yes|vercel=set netlify= cloudflare= account=|');
    // the checkout deployed is the goal's commit, in a folder of its own named after the host project
    const dir = deployDir(engine, goal);
    expect(call!.endsWith(`|${dir}`) || call!.endsWith(`|/private${dir}`)).toBe(true);
    expect(readFileSync(join(dir, 'index.html'), 'utf8')).toBe('<h1>studio</h1>');
    expect(await sh('git rev-parse HEAD', dir)).toBe(await sh(`git rev-parse ${goal.branch}`, repo));
    const recorded = engine.store.listByGoal(goal.id, 5000).filter((e) => e.type.startsWith('deploy.'));
    expect(JSON.stringify(recorded)).not.toContain('SECRET_TOKEN');

    // production: asked for, it is said on the command line
    engine.deploy(goal.id, { provider: 'vercel', production: true });
    await waitFor(() => (getGoal(engine.store.db, goal.id)!.deployments ?? []).length === 2 && last(engine, goal.id)?.status === 'live');
    expect(calls()[1]).toContain('vercel|deploy --yes --prod|');
  }, 60_000);

  test('Netlify uploads the folder as it is; Cloudflare Pages makes its project once and files a preview under the goal’s branch', async () => {
    // Wrangler's own folder is ignored, as in the projects it sets up: the deploy folder's clean-up leaves it
    const { engine, goal } = await finishedGoal({ 'index.html': '<h1>studio</h1>', '.gitignore': '.wrangler\n' });
    engine.deploy(goal.id, { provider: 'netlify', production: false });
    await waitFor(() => last(engine, goal.id)?.status === 'live');
    expect(last(engine, goal.id)!.url).toBe('https://d1--site.netlify.app');
    expect(calls()[0]).toMatch(/^netlify\|deploy --json --site-name [a-z0-9-]+ --no-build --dir \. --message .*\|vercel= netlify=set /);

    engine.deploy(goal.id, { provider: 'cloudflare', production: false });
    await waitFor(() => (getGoal(engine.store.db, goal.id)!.deployments ?? []).length === 2 && last(engine, goal.id)?.status === 'live');
    expect(last(engine, goal.id)!.url).toBe('https://4f2a.site.pages.dev');
    const cf = calls().filter((c) => c.startsWith('cloudflare|'));
    expect(cf[0]).toMatch(/pages project create [a-z0-9-]+ --production-branch main --force\|.*cloudflare=set account=acc123/);
    expect(cf[1]).toContain(`pages deploy . --project-name`);
    expect(cf[1]).toContain(`--branch ${goal.branch.replace(/[^A-Za-z0-9-]+/g, '-')}`);
    // again: the project exists, which is no failure
    engine.deploy(goal.id, { provider: 'cloudflare', production: true });
    await waitFor(() => (getGoal(engine.store.db, goal.id)!.deployments ?? []).length === 3 && last(engine, goal.id)?.status !== 'running');
    expect(last(engine, goal.id)).toMatchObject({ status: 'live', production: true, url: 'https://site.pages.dev' });
    expect(calls().at(-1)).toContain('--branch main');
    // a redirect a Workers build left in the folder (Wrangler once handed new projects to Workers) is cleared first
    const leftover = join(deployDir(engine, goal), '.wrangler', 'deploy');
    mkdirSync(leftover, { recursive: true });
    writeFileSync(join(leftover, 'config.json'), '{"configPath":"../../dist/wrangler.json"}');
    engine.deploy(goal.id, { provider: 'cloudflare', production: false });
    await waitFor(() => (getGoal(engine.store.db, goal.id)!.deployments ?? []).length === 4 && last(engine, goal.id)?.status !== 'running');
    expect(last(engine, goal.id)).toMatchObject({ status: 'live', url: 'https://4f2a.site.pages.dev' });
  }, 60_000);

  test('a failing host says why, its token blanked out', async () => {
    const { engine, goal } = await finishedGoal({ 'index.html': '<h1>studio</h1>' });
    writeFileSync(join(bin, '..', 'FAIL_DEPLOY'), '');
    engine.deploy(goal.id, { provider: 'vercel', production: false });
    await waitFor(() => last(engine, goal.id)?.status === 'failed');
    expect(last(engine, goal.id)!.reason).toContain('deploy to Vercel failed (exit 1): Error: the token *** was refused');
    expect(JSON.stringify(engine.store.listByGoal(goal.id, 5000))).not.toContain('SECRET_TOKEN');
  }, 60_000);

  test('a Netlify team the token cannot reach is said first, past the npm warnings npx printed', async () => {
    const { engine, goal } = await finishedGoal({ 'index.html': '<h1>studio</h1>' });
    engine.updateSettings({ delivery: { netlifyTeam: 'nosuch' } });
    engine.deploy(goal.id, { provider: 'netlify', production: true });
    await waitFor(() => last(engine, goal.id)?.status === 'failed');
    const reason = last(engine, goal.id)!.reason!;
    expect(reason).toStartWith('deploy to Netlify failed (exit 1): Netlify has no team "nosuch" this token can reach: set Settings → Git & delivery → Netlify team');
    expect(reason).toEndWith('(›   Error: Failed to create site: 404: Not Found)');
    expect(reason).not.toContain('npm warn');
  }, 60_000);

  test('what is not deployed: a separate backend, a server-rendered app on Cloudflare, an unfinished goal, a host not set up', async () => {
    const { engine, goal } = await finishedGoal({ 'package.json': JSON.stringify({ dependencies: { express: '5' }, scripts: { start: 'node server.js' } }) });
    expect(engine.deployInfo(goal.id).app).toEqual({ ok: false, reason: expect.stringContaining('a backend deployed apart from its pages') });
    engine.deploy(goal.id, { provider: 'vercel', production: false });
    await waitFor(() => last(engine, goal.id)?.status === 'failed');
    expect(last(engine, goal.id)!.reason).toContain('never a separate backend');
    expect(calls()).toEqual([]);

    engine.updateSettings({ delivery: { netlifyToken: null } });
    expect(() => engine.deploy(goal.id, { provider: 'netlify', production: false })).toThrow(/Netlify is not set up/);
    const fresh = await engine.createGoal({ prompt: 'still to do', repoPath: repo });
    expect(() => engine.deploy(fresh.id, { provider: 'vercel', production: false })).toThrow(/only a finished goal is deployed/);
    engine.cancelGoal(fresh.id);
  }, 60_000);

  test('Cloudflare Pages takes files, not a server-rendered app', async () => {
    const { engine, goal } = await finishedGoal({ 'package.json': JSON.stringify({ dependencies: { next: '15' }, scripts: { build: 'next build' } }) });
    expect(engine.deployInfo(goal.id).providers.find((p) => p.id === 'cloudflare')!.refused).toContain('renders on a server');
    engine.deploy(goal.id, { provider: 'cloudflare', production: false });
    await waitFor(() => last(engine, goal.id)?.status === 'failed');
    expect(last(engine, goal.id)!.reason).toContain('deploy it to Vercel or Netlify');
  }, 60_000);
});
