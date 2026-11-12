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
      // the platforms (ADR-0095) take the whole project, not a folder of pages: refused in words, no token yet
      ['fly', false, expect.stringContaining('from a Dockerfile')],
      ['railway', false, expect.stringContaining('no Dockerfile and no known stack')],
      ['render', false, expect.stringContaining('no Dockerfile and no known stack')],
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
      ['env', true, 'warn'],
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

describe('a server in PM2 mode (ADR-0092)', () => {
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
      ['env', false],
    ]);
    // the example file lists PORT without a value here: told, never blocking (ADR-0095)
    expect(ready.items.find((i) => i.id === 'env')).toMatchObject({ severity: 'warn', detail: expect.stringContaining('PORT') });
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

describe('the runtime variables go with a server deploy (ADR-0095)', () => {
  async function serverGoal(files: Record<string, string>) {
    const { engine, goal } = await finishedGoal(files);
    const fakes = mkdtempSync(join(tmpdir(), 'foundry-deploy-ssh-'));
    engine.deploySsh = [fakeSsh(fakes)];
    engine.updateSettings({ delivery: { servers: [{ id: 'srv1', name: 'box', host: 'h.example', port: 22, user: 'deploy', privateKey: KEY, dir: '~/apps', publicUrl: null, allowPrivileged: false, mode: 'docker' as const }] } });
    const sshLog = () => (existsSync(join(fakes, 'ssh.log')) ? readFileSync(join(fakes, 'ssh.log'), 'utf8').trim().split('\n') : []);
    return { engine, goal, fakes, sshLog };
  }  test('a compose project gets an env file and an override every service reads; the values stay out of every record; a PM2 process starts with them', async () => {
    const { engine, goal, fakes, sshLog } = await serverGoal({ 'compose.yaml': 'services:\n  web:\n    build: .\n    ports:\n      - "8080:80"\n  worker:\n    build: .\n', Dockerfile: 'FROM nginx\n', '.env.example': 'DATABASE_URL=\nSESSION_SECRET=\n' });
    engine.setDeployEnv(goal.id, 'server:srv1', { DATABASE_URL: 'postgres://db-host-0123/app', SESSION_SECRET: 'sess-secret-456789' }, 0);
    const ready = await engine.deployReadiness(goal.id, 'server', 'srv1');
    expect(ready.items.find((i) => i.id === 'env')).toMatchObject({ ok: true, detail: '2 set (DATABASE_URL, SESSION_SECRET)' });
    engine.deploy(goal.id, { provider: 'server', target: 'srv1', production: true });
    await waitFor(() => last(engine, goal.id)?.status !== 'running' && (getGoal(engine.store.db, goal.id)!.deployments ?? []).length === 1);
    expect(last(engine, goal.id)).toMatchObject({ status: 'live' });
    expect(sshLog().at(-1)).toContain("-f 'compose.yaml' -f 'compose.foundry.env.yaml' up -d --build --remove-orphans");
    const listed = await sh(`tar -tzf ${JSON.stringify(join(fakes, 'upload.tgz'))}`, fakes);
    expect(listed).toContain('./.foundry.env');
    expect(listed).toContain('./compose.foundry.env.yaml');
    const dir = deployDir(engine, goal);
    expect(readFileSync(join(dir, '.foundry.env'), 'utf8')).toBe("DATABASE_URL='postgres://db-host-0123/app'\nSESSION_SECRET='sess-secret-456789'\n");
    expect(readFileSync(join(dir, 'compose.foundry.env.yaml'), 'utf8')).toContain('  worker:\n    env_file:\n      - .foundry.env');
    const recorded = JSON.stringify(engine.store.listByGoal(goal.id, 5000));
    expect(recorded).not.toContain('db-host-0123');
    expect(recorded).not.toContain('sess-secret');
    expect(recorded).toContain('2 runtime variables go with it (DATABASE_URL, SESSION_SECRET)');
    rmSync(fakes, { recursive: true, force: true });
  }, 60_000);

  test('in PM2 mode the process starts with them: the env file is sourced before pm2 startOrReload', async () => {
    const { engine, goal, fakes, sshLog } = await serverGoal({ 'package.json': JSON.stringify({ scripts: { start: 'node server.js' } }), 'server.js': '' });
    engine.updateSettings({ delivery: { servers: [{ id: 'srv1', name: 'box', host: 'h.example', port: 22, user: 'deploy', privateKey: null, dir: '~/apps', publicUrl: null, allowPrivileged: false, mode: 'pm2' }] } });
    engine.setDeployEnv(goal.id, 'server:srv1', { PORT: '4100' }, 0);
    engine.deploy(goal.id, { provider: 'server', target: 'srv1', production: true });
    await waitFor(() => last(engine, goal.id)?.status !== 'running' && (getGoal(engine.store.db, goal.id)!.deployments ?? []).length === 1);
    expect(last(engine, goal.id)).toMatchObject({ status: 'live', url: 'http://h.example:4100' });
    expect(sshLog().at(-1)).toContain('export NODE_ENV=production && set -a && . ./.foundry.env && set +a && ');
    expect(await sh(`tar -tzf ${JSON.stringify(join(fakes, 'upload.tgz'))}`, fakes)).toContain('./.foundry.env');
    rmSync(fakes, { recursive: true, force: true });
  }, 60_000);
});

/** a stand-in for flyctl and the Railway CLI (ADR-0095): logs each call with its tokens' presence and its stdin, prints what the real one prints */
function fakePaas(dir: string): string {
  const path = join(dir, 'fake-paas');
  writeFileSync(
    path,
    `#!/bin/sh
cli="$1"; shift
in=""; if [ ! -t 0 ]; then in="$(cat)"; fi
printf '%s|%s|fly=%s railway=%s ci=%s|stdin=%s|%s\\n' "$cli" "$*" "\${FLY_API_TOKEN:+set}" "\${RAILWAY_API_TOKEN:+set}" "$CI" "$(printf '%s' "$in" | tr '\\n' ';')" "$(pwd)" >> "${join(dir, 'paas.log')}"
if [ -f "${join(dir, 'FAIL_DEPLOY')}" ]; then case "$*" in *deploy*|*"up --ci"*) echo "Error: failed to fetch an image or build from source: error building: executor failed running [/bin/sh -c npm ci]: exit code: 1" >&2; exit 1 ;; esac; fi
case "$cli" in
  fly)
    case "$*" in
      *"apps create"*) if [ -f "${join(dir, 'FLY_APP')}" ]; then echo "Error: failed creating app: Validation failed: Name has already been taken" >&2; exit 1; fi; touch "${join(dir, 'FLY_APP')}"; echo '{"Name":"x"}' ;;
      *"secrets import"*) echo "Secrets are staged for the first deployment" ;;
      *"deploy"*) echo "==> Building image"; echo "Visit your newly deployed app at https://ignored.fly.dev/" ;;
      *"status"*) echo '{"Name":"x","Hostname":"x.fly.dev","Status":"running"}' ;;
      *"version"*) echo "flyctl v0.3.100 linux/amd64" ;;
    esac ;;
  railway)
    case "$*" in
      *"link"*) if [ -f "${join(dir, 'RW_PROJECT')}" ]; then echo '{"project":"x"}'; else echo "Project not found" >&2; exit 1; fi ;;
      *"init"*) touch "${join(dir, 'RW_PROJECT')}"; echo '{"id":"p1"}' ;;
      *"add"*) echo '{"service":"x"}' ;;
      *"environment new"*) if [ -f "${join(dir, 'RW_PREVIEW')}" ]; then echo "Environment already exists" >&2; exit 1; fi; touch "${join(dir, 'RW_PREVIEW')}"; echo '{"environment":"preview"}' ;;
      *"environment "*) echo "Activated environment" ;;
      *"variable set"*) echo '{"ok":true}' ;;
      *"up --ci"*) echo '{"deploymentId":"d1","status":"SUCCESS"}' ;;
      *"domain"*) echo '{"domain":"x-preview.up.railway.app"}' ;;
    esac ;;
esac
`,
  );
  chmodSync(path, 0o755);
  return path;
}

describe('deploying to a platform (ADR-0095)', () => {
  async function paasGoal(files: Record<string, string>) {
    const { engine, goal } = await finishedGoal(files);
    const fakes = mkdtempSync(join(tmpdir(), 'foundry-deploy-paas-'));
    const cli = fakePaas(fakes);
    engine.deployCli = (p) => (p === 'fly' || p === 'railway' ? [cli, p] : [bin, p]);
    engine.updateSettings({ delivery: { flyToken: 'fly_SECRET_TOKEN_1', flyOrg: 'acme', railwayToken: 'rw_SECRET_TOKEN_1', renderApiKey: 'rnd_SECRET_KEY_1' } });
    const paasLog = () => (existsSync(join(fakes, 'paas.log')) ? readFileSync(join(fakes, 'paas.log'), 'utf8').trim().split('\n') : []);
    return { engine, goal, fakes, paasLog };
  }

  test('Fly.io: the app made once, the variables staged on stdin, the deploy from the checkout with Foundry’s fly.toml, the address from the status; nothing secret in the record', async () => {
    const { engine, goal, fakes, paasLog } = await paasGoal({ Dockerfile: 'FROM nginx\nEXPOSE 80\n' });
    engine.setDeployEnv(goal.id, 'fly', { DATABASE_URL: 'postgres://db-host-0123/app' }, 0);
    const info = engine.deployInfo(goal.id, 'fly', false);
    expect(info.paas.fly).toMatchObject({ ok: true, app: { runtime: 'docker', port: 80 } });
    expect(info.providers.find((p) => p.id === 'fly')).toMatchObject({ kind: 'paas', label: 'Fly.io', configured: true, refused: null });
    expect(info.plan.map((s) => s.command)).toEqual([expect.stringContaining(`apps create ${deployName(goal)}-preview --org acme --json`), expect.stringContaining('secrets import'), expect.stringContaining('--config fly.foundry.toml'), expect.stringContaining('status')]);
    const ready = await engine.deployReadiness(goal.id, 'fly', null);
    expect(ready.items.map((i) => [i.id, i.ok])).toEqual([['token', true], ['cli', true], ['env', true]]);
    engine.deploy(goal.id, { provider: 'fly', production: false });
    await waitFor(() => last(engine, goal.id)?.status !== 'running' && (getGoal(engine.store.db, goal.id)!.deployments ?? []).length === 1);
    expect(last(engine, goal.id)).toMatchObject({ status: 'live', url: 'https://x.fly.dev', production: false, provider: 'fly' });
    // the readiness check asked flyctl for its version; the deploy's own calls follow
    const log = paasLog().filter((l) => l.split('|')[1] !== 'version');
    expect(log.map((l) => l.split('|')[1]!.split(' ').slice(0, 2).join(' '))).toEqual(['apps create', 'secrets import', 'deploy --config', 'status -a']);
    expect(log[1]).toContain('stdin=DATABASE_URL=postgres://db-host-0123/app|');
    expect(log.every((l) => l.includes('fly=set') && l.includes('ci=1'))).toBe(true);
    expect(readFileSync(join(deployDir(engine, goal), 'fly.foundry.toml'), 'utf8')).toContain(`app = "${deployName(goal)}-preview"`);
    const recorded = JSON.stringify(engine.store.listByGoal(goal.id, 5000));
    expect(recorded).not.toContain('SECRET');
    expect(recorded).not.toContain('db-host-0123');
    expect(recorded).toContain('1 runtime variable goes to Fly.io first (DATABASE_URL)');
    // the second deploy finds the app there; production goes to the app under the project's name
    engine.deploy(goal.id, { provider: 'fly', production: true, smoke: false });
    await waitFor(() => (getGoal(engine.store.db, goal.id)!.deployments ?? []).length === 2 && last(engine, goal.id)?.status !== 'running');
    expect(last(engine, goal.id)).toMatchObject({ status: 'live', production: true });
    expect(paasLog().at(-4)).toContain(`apps create ${deployName(goal)} --org acme`);
    rmSync(fakes, { recursive: true, force: true });
  }, 60_000);

  test('Railway: the project linked or made, the preview environment once, the deploy, the domain; a failed build is told in the platform’s words', async () => {
    const { engine, goal, fakes, paasLog } = await paasGoal({ 'package.json': JSON.stringify({ scripts: { start: 'node server.js' } }), 'server.js': '' });
    expect(engine.deployInfo(goal.id, 'fly', false).providers.find((p) => p.id === 'fly')).toMatchObject({ refused: expect.stringContaining('from a Dockerfile') });
    engine.deploy(goal.id, { provider: 'railway', production: false });
    await waitFor(() => last(engine, goal.id)?.status !== 'running' && (getGoal(engine.store.db, goal.id)!.deployments ?? []).length === 1);
    expect(last(engine, goal.id)).toMatchObject({ status: 'live', url: 'https://x-preview.up.railway.app' });
    const heads = paasLog().map((l) => l.split('|')[1]!.split(' ').slice(0, 2).join(' '));
    expect(heads).toEqual(['link -p', 'init --name', 'add --service', 'environment new', 'environment preview', 'up --ci', 'domain -s']);
    expect(paasLog().every((l) => l.includes('railway=set'))).toBe(true);
    writeFileSync(join(fakes, 'FAIL_DEPLOY'), '');
    engine.deploy(goal.id, { provider: 'railway', production: false });
    await waitFor(() => (getGoal(engine.store.db, goal.id)!.deployments ?? []).length === 2 && last(engine, goal.id)?.status !== 'running');
    expect(last(engine, goal.id)).toMatchObject({ status: 'failed', reason: expect.stringContaining('deploy to Railway') });
    expect(last(engine, goal.id)!.reason).toContain('npm ci');
    rmSync(fakes, { recursive: true, force: true });
  }, 60_000);

  test('Render: through its API — the service made once from the repository’s pushed branch, the variables, the deploy watched to live, the address; a Local only goal and an unpushed commit are refused in words', async () => {
    const { engine, goal, fakes } = await paasGoal({ Dockerfile: 'FROM nginx\nEXPOSE 80\n' });
    const calls: string[] = [];
    let sha = '';
    let status = 'build_in_progress';
    // the real API (the live run): a new service starts its first deploy and names it; a second deploy asked while one runs is answered 202 with no body
    let queued = false;
    let created = false;
    engine.paasPollMs = 5;
    engine.paasFetch = async (url, init) => {
      const path = url.replace('https://api.render.com/v1', '');
      calls.push(`${init.method} ${path}${init.body ? ` ${init.body}` : ''}`);
      expect((init.headers as Record<string, string>).authorization).toBe('Bearer rnd_SECRET_KEY_1');
      const json = (data: unknown, s = 200) => new Response(JSON.stringify(data), { status: s, headers: { 'content-type': 'application/json' } });
      if (path.startsWith('/owners')) return json([{ owner: { id: 'tea-1', name: 'Acme' } }]);
      if (path.startsWith('/services?')) return json(created ? [{ service: { id: 'srv-1', name: `${deployName(goal)}-preview` } }] : []);
      if (path === '/services' && init.method === 'POST') {
        created = true;
        return json({ deployId: 'dep-1', service: { id: 'srv-1', name: `${deployName(goal)}-preview` } }, 201);
      }
      if (path === '/services/srv-1/env-vars') return json([]);
      if (path === '/services/srv-1/deploys' && init.method === 'POST') {
        queued = true;
        return new Response('', { status: 202 });
      }
      if (path === '/services/srv-1/deploys?limit=5') return json([{ deploy: { id: 'dep-old', commit: { id: 'ffff' } } }, { deploy: { id: 'dep-2', commit: { id: sha } } }]);
      if (path === '/services/srv-1/deploys/dep-1' || path === '/services/srv-1/deploys/dep-2') {
        const s = status;
        status = 'live';
        return json({ id: path.split('/').at(-1), status: s, commit: { id: path.endsWith('dep-1') && queued ? 'eeee' : sha } });
      }
      if (path === '/services/srv-1') return json({ id: 'srv-1', serviceDetails: { url: 'https://x-preview.onrender.com' } });
      return json({ message: `unexpected ${path}` }, 404);
    };
    // no GitHub remote: refused before any call
    engine.deploy(goal.id, { provider: 'render', production: false });
    await waitFor(() => last(engine, goal.id)?.status !== 'running' && (getGoal(engine.store.db, goal.id)!.deployments ?? []).length === 1);
    expect(last(engine, goal.id)).toMatchObject({ status: 'failed', reason: expect.stringContaining('no GitHub remote') });
    expect(calls).toEqual([]);
    // a remote, but the goal's branch is not pushed there yet
    await sh('git remote add origin git@github.com:o/r.git', repo);
    engine.deploy(goal.id, { provider: 'render', production: false });
    await waitFor(() => (getGoal(engine.store.db, goal.id)!.deployments ?? []).length === 2 && last(engine, goal.id)?.status !== 'running');
    expect(last(engine, goal.id)!.reason).toContain('does not have this commit yet');
    // pushed (the remote-tracking ref stands in for the push): the service is made from that branch, the commit deployed and watched
    const g = getGoal(engine.store.db, goal.id)!;
    sha = (await sh(`git rev-parse ${g.branch}`, repo)).trim();
    await sh(`git update-ref refs/remotes/origin/${g.branch} ${sha}`, repo);
    engine.setDeployEnv(goal.id, 'render', { API_KEY: 'api-key-value-0123' }, 0);
    const ready = await engine.deployReadiness(goal.id, 'render', null);
    expect(ready.items.map((i) => [i.id, i.ok])).toEqual([['token', true], ['remote', true], ['key', true], ['env', true]]);
    expect(ready.items.find((i) => i.id === 'key')!.detail).toBe('workspace Acme');
    engine.deploy(goal.id, { provider: 'render', production: false });
    await waitFor(() => (getGoal(engine.store.db, goal.id)!.deployments ?? []).length === 3 && last(engine, goal.id)?.status !== 'running');
    expect(last(engine, goal.id)).toMatchObject({ status: 'live', url: 'https://x-preview.onrender.com' });
    const made = calls.find((c) => c.startsWith('POST /services '))!;
    expect(JSON.parse(made.slice('POST /services '.length))).toMatchObject({ type: 'web_service', name: `${deployName(goal)}-preview`, ownerId: 'tea-1', repo: 'https://github.com/o/r', branch: g.branch, autoDeploy: 'no', envVars: [{ key: 'API_KEY', value: 'api-key-value-0123' }], serviceDetails: { env: 'docker', region: 'oregon', plan: 'free' } });
    // the new service's own first deploy is this commit: watched, no second deploy asked for
    expect(calls.filter((c) => !c.startsWith('GET /owners') && !c.startsWith('GET /services?'))).toEqual([made, 'GET /services/srv-1/deploys/dep-1', 'GET /services/srv-1/deploys/dep-1', 'GET /services/srv-1']);
    // a deploy to the service that exists now: asked for, answered 202 with no body, found in the list by its commit
    status = 'build_in_progress';
    calls.length = 0;
    engine.deploy(goal.id, { provider: 'render', production: false, smoke: false });
    await waitFor(() => (getGoal(engine.store.db, goal.id)!.deployments ?? []).length === 4 && last(engine, goal.id)?.status !== 'running');
    expect(last(engine, goal.id)).toMatchObject({ status: 'live', url: 'https://x-preview.onrender.com' });
    expect(calls.filter((c) => !c.startsWith('GET /owners') && !c.startsWith('GET /services?'))).toEqual(['PUT /services/srv-1/env-vars [{"key":"API_KEY","value":"api-key-value-0123"}]', `POST /services/srv-1/deploys {"commitId":"${sha}"}`, 'GET /services/srv-1/deploys?limit=5', 'GET /services/srv-1/deploys/dep-2', 'GET /services/srv-1/deploys/dep-2', 'GET /services/srv-1']);
    const recorded = JSON.stringify(engine.store.listByGoal(goal.id, 5000));
    expect(recorded).not.toContain('SECRET');
    expect(recorded).not.toContain('api-key-value');
    // production deploys from the base branch on GitHub, which must hold the commit
    engine.deploy(goal.id, { provider: 'render', production: true, smoke: false });
    await waitFor(() => (getGoal(engine.store.db, goal.id)!.deployments ?? []).length === 5 && last(engine, goal.id)?.status !== 'running');
    expect(last(engine, goal.id)!.reason).toContain(`production from ${g.baseBranch} on GitHub`);
    rmSync(fakes, { recursive: true, force: true });
  }, 60_000);
});
