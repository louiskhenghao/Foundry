import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { getGoal } from '@foundry/core';
import { defaultConfig } from '../config.ts';
import { Engine } from '../engine.ts';
import { FakeRunner, makeRepo, sh, terminal, waitFor } from '../test-helpers.ts';
import { deployDir, deployName } from './deploy.ts';

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
  netlify)
    # the real CLI links the folder to its site; an unlinked folder naming an existing site gets a new one
    if [ -f .netlify/state.json ]; then echo linked >> "${join(dir, 'netlify.log')}"; else echo new >> "${join(dir, 'netlify.log')}"; fi
    mkdir -p .netlify && echo '{"siteId":"s1"}' > .netlify/state.json
    echo '{"site_id":"s1","deploy_url":"https://d1--site.netlify.app","url":"https://site.netlify.app"}' ;;
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

  test('Netlify’s link to its site stays between deploys where the project does not ignore it: without it, Netlify makes a new site each time', async () => {
    const { engine, goal } = await finishedGoal({ 'index.html': '<h1>studio</h1>' });
    for (const n of [1, 2]) {
      engine.deploy(goal.id, { provider: 'netlify', production: false });
      await waitFor(() => (getGoal(engine.store.db, goal.id)!.deployments ?? []).length === n && last(engine, goal.id)?.status !== 'running');
      expect(last(engine, goal.id)!.status).toBe('live');
    }
    expect(readFileSync(join(bin, '..', 'netlify.log'), 'utf8').trim().split('\n')).toEqual(['new', 'linked']);
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
    expect(last(engine, goal.id)!.reason).toContain('a backend deployed apart from its pages');
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

/**
 * A stand-in for ssh (ADR-0091): it logs what it was asked (the destination, the remote command, whether the key file
 * existed), swallows the tar stream into a file, and answers the remote commands as a server with Docker would — or
 * as a broken one, when FAIL_UP or FAIL_DOCKER sits in its folder.
 */
function fakeSsh(dir: string): string {
  const path = join(dir, 'fake-ssh');
  writeFileSync(
    path,
    `#!/bin/sh
key=""
while [ $# -gt 0 ]; do case "$1" in -i) key="$2"; shift 2 ;; -p|-o) shift 2 ;; *) break ;; esac; done
dest="$1"; shift; cmd="$*"
if [ -f "$key" ]; then present=present; else present=missing; fi
printf 'ssh|%s|%s|key=%s\\n' "$dest" "$cmd" "$present" >> "${join(dir, 'ssh.log')}"
case "$cmd" in
  *"tar -xzf -"*) cat > "${join(dir, 'upload.tgz')}" ;;
  "echo foundry-ok") echo foundry-ok ;;
  "p="*) if [ -f "${join(dir, 'FOREIGN')}" ]; then echo "FOUNDRY: the folder already holds files that are not a Foundry deploy: pick another deploy folder for this server in Settings, or empty it yourself" >&2; exit 3; fi; echo made ;;
  "d="*) echo writable; echo project=new ;;
  *"ss -ltnpH"*) echo '::ours::' ;;
  *"docker compose version"*) if [ -f "${join(dir, 'FAIL_DOCKER')}" ]; then echo "sh: 1: docker: not found" >&2; exit 127; fi; echo "Docker Compose version v2.29.1"; echo "27.1.0" ;;
  *"docker compose -p"*) if [ -f "${join(dir, 'FAIL_UP')}" ]; then echo "failed to solve: process \\"/bin/sh -c npm ci\\" did not complete successfully: exit code: 1" >&2; exit 1; fi; echo " Container web-1  Started" ;;
  "node -v"*) echo v24.1.0; echo 5.4.2; echo 1.22.22 ;;
  *"pm2 startOrReload"*) echo "[PM2] Applying action reloadProcessId on app"; echo "[PM2] Saving current process list" ;;
  *"test -w"*) echo writable ;;
esac
`,
  );
  chmodSync(path, 0o755);
  return path;
}
const KEY = '-----BEGIN OPENSSH PRIVATE KEY-----\nFAKEKEYLINE0123456789abcdefghijklmnop\n-----END OPENSSH PRIVATE KEY-----';

describe('deploying to a server of the person’s own (ADR-0091)', () => {
  async function serverGoal(files: Record<string, string>) {
    const { engine, goal } = await finishedGoal(files);
    const fakes = mkdtempSync(join(tmpdir(), 'foundry-deploy-ssh-'));
    engine.deploySsh = [fakeSsh(fakes)];
    engine.updateSettings({ delivery: { servers: [{ id: 'srv1', name: 'box', host: 'h.example', port: 22, user: 'deploy', privateKey: KEY, dir: '~/apps', publicUrl: null, allowPrivileged: false, mode: 'docker' as const }] } });
    const sshLog = () => (existsSync(join(fakes, 'ssh.log')) ? readFileSync(join(fakes, 'ssh.log'), 'utf8').trim().split('\n') : []);
    return { engine, goal, fakes, sshLog };
  }

  test('a compose project is copied over ssh and started there; the key is a file only meanwhile and never in a record; a server deploy is production', async () => {
    const { engine, goal, fakes, sshLog } = await serverGoal({ 'compose.yaml': 'services:\n  web:\n    build: .\n    ports:\n      - "8080:80"\n', Dockerfile: 'FROM nginx\n' });
    const info = engine.deployInfo(goal.id, 'server', false, 'srv1');
    expect(info.server).toMatchObject({ ok: true, app: { kind: 'compose', file: 'compose.yaml', services: ['web'], port: 8080 } });
    expect(info.providers.at(-1)).toEqual({ id: 'server', target: 'srv1', kind: 'server', label: 'box', configured: true, refused: null, permissive: false, mode: 'docker', host: 'h.example', user: 'deploy' });
    expect(info.plan.map((s) => s.command).join('\n')).toContain('-i <key file>');
    expect(info.plan.map((s) => s.command).join('\n')).toContain("tar -czf - --no-xattrs --exclude=.git --exclude=node_modules --exclude=.vercel --exclude=.netlify --exclude=.wrangler -C '<deploy folder>' .");
    expect(info.plan.map((s) => s.command).join('\n')).not.toContain('FAKEKEY');

    // the readiness check reaches the server with the key on disk, and leaves nothing behind
    const ready = await engine.deployReadiness(goal.id, 'server', 'srv1');
    expect(ready.ok).toBe(true);
    expect(ready.items.map((i) => [i.id, i.ok, i.severity])).toEqual([
      ['key', true, 'error'],
      ['reach', true, 'error'],
      ['docker', true, 'error'],
      ['folder', true, 'error'],
      ['ports', true, 'error'],
      ['front', false, 'warn'],
    ]);
    expect(sshLog().every((l) => l.endsWith('key=present'))).toBe(true);
    expect(existsSync(join(dataDir, 'tmp')) ? readdirSync(join(dataDir, 'tmp')) : []).toEqual([]);

    engine.deploy(goal.id, { provider: 'server', target: 'srv1', production: false });
    await waitFor(() => last(engine, goal.id)?.status !== 'running' && (getGoal(engine.store.db, goal.id)!.deployments ?? []).length === 1);
    expect(last(engine, goal.id)).toMatchObject({ provider: 'server', target: { id: 'srv1', label: 'box' }, production: true, status: 'live', url: 'http://h.example:8080', framework: 'docker compose (compose.yaml)' });
    const name = deployName(goal);
    const log = sshLog().filter((l) => !l.includes('foundry-ok') && !l.includes('compose version') && !l.includes('|d=') && !l.includes('ss -ltnpH'));
    expect(log).toHaveLength(3);
    // the folder is made with Foundry's marker, or left alone when it holds something else
    expect(log[0]).toContain(`|p=~/apps/${name}; if [ -d "$p" ] && [ ! -e "$p/.foundry-deploy" ]`);
    expect(log[0]).toContain('mkdir -p "$p" && touch "$p/.foundry-deploy"|key=present');
    expect(log.slice(1)).toEqual([`ssh|deploy@h.example|tar -xzf - -C ~/apps/${name}|key=present`, `ssh|deploy@h.example|cd ~/apps/${name} && docker compose -p '${name}' -f 'compose.yaml' up -d --build --remove-orphans|key=present`]);
    // what went over: the checkout, without its .git
    const listed = await sh(`tar -tzf ${JSON.stringify(join(fakes, 'upload.tgz'))}`, fakes);
    expect(listed).toContain('./compose.yaml');
    expect(listed).not.toContain('.git/');
    const recorded = engine.store.listByGoal(goal.id, 5000).filter((e) => e.type.startsWith('deploy.'));
    expect(recorded.filter((e) => e.type === 'deploy.command').map((e) => (e.payload as { command: string }).command)).toEqual([expect.stringContaining('-i <key file>'), expect.stringContaining("-C '<deploy folder>'"), expect.stringContaining('up -d --build --remove-orphans')]);
    expect(JSON.stringify(recorded)).not.toContain('FAKEKEY');
    expect(JSON.stringify(recorded)).not.toContain(dataDir);
    expect(existsSync(join(dataDir, 'tmp')) ? readdirSync(join(dataDir, 'tmp')) : []).toEqual([]);

    // a public address names the deploy instead of host and port
    engine.updateSettings({ delivery: { servers: [{ id: 'srv1', name: 'box', host: 'h.example', port: 22, user: 'deploy', privateKey: null, dir: '~/apps', publicUrl: 'https://app.example.com', allowPrivileged: false, mode: 'docker' as const }] } });
    engine.deploy(goal.id, { provider: 'server', target: 'srv1', production: true });
    await waitFor(() => (getGoal(engine.store.db, goal.id)!.deployments ?? []).length === 2 && last(engine, goal.id)?.status !== 'running');
    expect(last(engine, goal.id)).toMatchObject({ status: 'live', url: 'https://app.example.com' });

    // compose failing on the server is said with its own last words
    writeFileSync(join(fakes, 'FAIL_UP'), '');
    engine.deploy(goal.id, { provider: 'server', target: 'srv1', production: true });
    await waitFor(() => (getGoal(engine.store.db, goal.id)!.deployments ?? []).length === 3 && last(engine, goal.id)?.status !== 'running');
    expect(last(engine, goal.id)!.reason).toBe('start it with docker compose failed (exit 1): failed to solve: process "/bin/sh -c npm ci" did not complete successfully: exit code: 1');
    rmSync(fakes, { recursive: true, force: true });
  }, 60_000);

  test('a Dockerfile alone gets the compose file Foundry writes, in the checkout only', async () => {
    const { engine, goal, fakes, sshLog } = await serverGoal({ Dockerfile: 'FROM nginx\nEXPOSE 80\n' });
    expect(engine.deployInfo(goal.id).server).toMatchObject({ ok: true, app: { kind: 'dockerfile', file: 'compose.foundry.yaml', port: 80 } });
    engine.deploy(goal.id, { provider: 'server', target: 'srv1', production: true });
    await waitFor(() => last(engine, goal.id)?.status !== 'running' && (getGoal(engine.store.db, goal.id)!.deployments ?? []).length === 1);
    expect(last(engine, goal.id)).toMatchObject({ status: 'live', url: 'http://h.example:80', framework: 'Dockerfile' });
    expect(sshLog().at(-1)).toContain("-f 'compose.foundry.yaml' up -d");
    expect(readFileSync(join(deployDir(engine, goal), 'compose.foundry.yaml'), 'utf8')).toContain('"80:80"');
    expect(existsSync(join(repo, 'compose.foundry.yaml'))).toBe(false);
    expect(await sh(`tar -tzf ${JSON.stringify(join(fakes, 'upload.tgz'))}`, fakes)).toContain('./compose.foundry.yaml');
    rmSync(fakes, { recursive: true, force: true });
  }, 60_000);

  test('what is refused: a server without its key, one no longer in Settings, a project with neither compose file nor Dockerfile; readiness says what the server lacks', async () => {
    const { engine, goal, fakes } = await serverGoal({ 'index.html': '<h1>studio</h1>' });
    expect(engine.deployInfo(goal.id).providers.at(-1)).toMatchObject({ id: 'server', target: 'srv1', configured: true, refused: expect.stringContaining('no compose file') });
    expect(() => engine.deploy(goal.id, { provider: 'server', target: 'nope', production: true })).toThrow(/not in Settings any more/);
    expect(() => engine.deploy(goal.id, { provider: 'server', production: true })).toThrow(/no server was chosen/);
    engine.deploy(goal.id, { provider: 'server', target: 'srv1', production: true });
    await waitFor(() => last(engine, goal.id)?.status === 'failed');
    expect(last(engine, goal.id)).toMatchObject({ provider: 'server', target: { id: 'srv1', label: 'box' }, reason: expect.stringContaining('no compose file') });

    writeFileSync(join(fakes, 'FAIL_DOCKER'), '');
    const ready = await engine.deployReadiness(goal.id, 'server', 'srv1');
    expect(ready.ok).toBe(false);
    expect(ready.items.find((i) => i.id === 'docker')).toMatchObject({ ok: false, detail: expect.stringContaining('Docker is not installed on h.example'), fix: { url: expect.stringContaining('docs.docker.com') } });

    engine.updateSettings({ delivery: { servers: [{ id: 'srv1', name: 'box', host: 'h.example', port: 22, user: 'deploy', privateKey: '', dir: '~/apps', publicUrl: null, allowPrivileged: false, mode: 'docker' as const }] } });
    expect(engine.deployInfo(goal.id).providers.at(-1)).toMatchObject({ configured: false });
    expect(() => engine.deploy(goal.id, { provider: 'server', target: 'srv1', production: true })).toThrow(/has no SSH key/);
    const hostReady = await engine.deployReadiness(goal.id, 'netlify', null);
    expect(hostReady).toMatchObject({ ok: true, items: [{ id: 'token', ok: true }] });
    rmSync(fakes, { recursive: true, force: true });
  }, 60_000);
});

describe('what a server deploy refuses before it touches anything (ADR-0091)', () => {
  test('a compose file that reaches outside its project is refused with the reasons; allowed for the server, it runs and the activity says what it reaches', async () => {
    const { engine, goal } = await finishedGoal({ 'compose.yaml': 'services:\n  agent:\n    build: .\n    ports: ["8080:80"]\n    volumes:\n      - /var/run/docker.sock:/var/run/docker.sock\n      - /etc:/host-etc:ro\n', Dockerfile: 'FROM nginx\n' });
    const fakes = mkdtempSync(join(tmpdir(), 'foundry-deploy-ssh-'));
    engine.deploySsh = [fakeSsh(fakes)];
    const box = { id: 'srv1', name: 'box', host: 'h.example', port: 22, user: 'deploy', privateKey: KEY, dir: '~/apps', publicUrl: null, allowPrivileged: false, mode: 'docker' as const };
    engine.updateSettings({ delivery: { servers: [box] } });
    const info = engine.deployInfo(goal.id, 'server', true, 'srv1');
    expect(info.server).toMatchObject({ ok: true, app: { review: { dangers: ['agent mounts the Docker socket (/var/run/docker.sock): the container would control every container on the server', 'agent bind-mounts /etc, outside the project folder'] } } });
    expect(info.providers.at(-1)).toMatchObject({ id: 'server', target: 'srv1', permissive: false, refused: null });
    engine.deploy(goal.id, { provider: 'server', target: 'srv1', production: true });
    await waitFor(() => last(engine, goal.id)?.status === 'failed');
    const reason = last(engine, goal.id)!.reason!;
    expect(reason).toStartWith('compose.yaml reaches outside its project, which the server box does not allow: agent mounts the Docker socket');
    expect(reason).toContain('allow it for this server under Settings → Git & delivery → Servers');
    expect(existsSync(join(fakes, 'ssh.log'))).toBe(false);

    engine.updateSettings({ delivery: { servers: [{ ...box, privateKey: null, allowPrivileged: true, mode: 'docker' as const }] } });
    expect(engine.deployInfo(goal.id, 'server', true, 'srv1').providers.at(-1)).toMatchObject({ permissive: true });
    engine.deploy(goal.id, { provider: 'server', target: 'srv1', production: true });
    await waitFor(() => (getGoal(engine.store.db, goal.id)!.deployments ?? []).length === 2 && last(engine, goal.id)?.status !== 'running');
    expect(last(engine, goal.id)).toMatchObject({ status: 'live', url: 'http://h.example:8080' });
    const notes = engine.store.listByGoal(goal.id, 5000).filter((e) => e.type === 'engine.note').map((e) => (e.payload as { level: string; message: string }));
    expect(notes).toContainEqual({ level: 'warn', message: 'deploy: compose.yaml reaches outside its project, allowed for the server box: agent mounts the Docker socket (/var/run/docker.sock): the container would control every container on the server; agent bind-mounts /etc, outside the project folder' });
    rmSync(fakes, { recursive: true, force: true });
  }, 60_000);

  test('a project folder on the server that holds something else is never written over: the deploy stops at its first step and says so', async () => {
    const { engine, goal } = await finishedGoal({ 'compose.yaml': 'services:\n  web:\n    build: .\n    ports: ["8080:80"]\n', Dockerfile: 'FROM nginx\n' });
    const fakes = mkdtempSync(join(tmpdir(), 'foundry-deploy-ssh-'));
    engine.deploySsh = [fakeSsh(fakes)];
    engine.updateSettings({ delivery: { servers: [{ id: 'srv1', name: 'box', host: 'h.example', port: 22, user: 'deploy', privateKey: KEY, dir: '~/apps', publicUrl: null, allowPrivileged: false, mode: 'docker' as const }] } });
    writeFileSync(join(fakes, 'FOREIGN'), '');
    engine.deploy(goal.id, { provider: 'server', target: 'srv1', production: true });
    await waitFor(() => last(engine, goal.id)?.status === 'failed');
    expect(last(engine, goal.id)!.reason).toBe('make the folder on the server failed (exit 3): FOUNDRY: the folder already holds files that are not a Foundry deploy: pick another deploy folder for this server in Settings, or empty it yourself');
    // nothing was copied, nothing started
    expect(existsSync(join(fakes, 'upload.tgz'))).toBe(false);
    expect(readFileSync(join(fakes, 'ssh.log'), 'utf8')).not.toContain('docker compose -p');
    rmSync(fakes, { recursive: true, force: true });
  }, 60_000);
});

describe('a server in PM2 mode (ADR-0091)', () => {
  test('a Node.js project is installed, built and started under PM2 as the ssh user; Foundry’s ecosystem file goes with the checkout; the readiness check asks for node and pm2', async () => {
    const { engine, goal } = await finishedGoal({ 'package.json': JSON.stringify({ name: 'shop', scripts: { start: 'node server.js', build: 'echo built' } }), 'yarn.lock': '', '.env.example': 'PORT=4000\n', 'server.js': 'require("http").createServer().listen(4000)' });
    const fakes = mkdtempSync(join(tmpdir(), 'foundry-deploy-ssh-'));
    engine.deploySsh = [fakeSsh(fakes)];
    engine.updateSettings({ delivery: { servers: [{ id: 'pm', name: 'node box', host: 'n.example', port: 22, user: 'deploy', privateKey: KEY, dir: '~/apps', publicUrl: null, allowPrivileged: false, mode: 'pm2' }] } });
    const info = engine.deployInfo(goal.id, 'server', true, 'pm');
    expect(info.server).toMatchObject({ ok: true, app: { kind: 'pm2', port: 4000, pm2: { manager: 'yarn', build: 'yarn run build', generated: true } } });
    expect(info.providers.at(-1)).toMatchObject({ id: 'server', target: 'pm', mode: 'pm2', host: 'n.example', user: 'deploy', refused: null });
    expect(info.plan.map((s) => s.label)).toEqual(['make the folder on the server', 'copy the project over', 'install, build and start it under PM2']);
    const ready = await engine.deployReadiness(goal.id, 'server', 'pm');
    expect(ready.items.map((i) => [i.id, i.ok])).toEqual([
      ['key', true],
      ['reach', true],
      ['runtime', true],
      ['folder', true],
      ['ports', true],
      ['front', false],
    ]);
    engine.deploy(goal.id, { provider: 'server', target: 'pm', production: true });
    await waitFor(() => last(engine, goal.id)?.status !== 'running' && (getGoal(engine.store.db, goal.id)!.deployments ?? []).length === 1);
    expect(last(engine, goal.id)).toMatchObject({ status: 'live', url: 'http://n.example:4000', framework: 'PM2 (yarn)', target: { id: 'pm', label: 'node box' } });
    const name = deployName(goal);
    const log = readFileSync(join(fakes, 'ssh.log'), 'utf8');
    expect(log).toContain(`cd ~/apps/${name} && export NODE_ENV=production && command -v yarn >/dev/null 2>&1 || corepack enable >/dev/null 2>&1 || true; yarn install --frozen-lockfile && yarn run build && pm2 startOrReload 'ecosystem.foundry.config.cjs' --update-env && pm2 save|key=present`);
    expect(await sh(`tar -tzf ${JSON.stringify(join(fakes, 'upload.tgz'))}`, fakes)).toContain('./ecosystem.foundry.config.cjs');
    expect(readFileSync(join(deployDir(engine, goal), 'ecosystem.foundry.config.cjs'), 'utf8')).toContain(`name: ${JSON.stringify(name)}, script: "yarn", args: 'start'`);
    expect(existsSync(join(repo, 'ecosystem.foundry.config.cjs'))).toBe(false);
    rmSync(fakes, { recursive: true, force: true });
  }, 60_000);
});
