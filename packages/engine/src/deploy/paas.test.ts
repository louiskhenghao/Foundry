import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FLY_CONFIG, type PaasCredentials, flyConfig, paasDeployability, paasFailureHint, paasSecrets, paasSteps, paasTarget, paasUrl, renderRepoUrl, renderServiceBody } from './paas.ts';

const creds: PaasCredentials = { flyToken: 'fly_SECRET_123456', flyOrg: 'acme', flyRegion: 'lhr', railwayToken: 'rw_SECRET_123456', railwayWorkspace: 'ws1', renderApiKey: 'rnd_SECRET_123456', renderOwner: null, renderRegion: 'oregon', renderPlan: 'free' };
const tmp = (files: Record<string, string>) => {
  const dir = mkdtempSync(join(tmpdir(), 'foundry-paas-'));
  for (const [p, body] of Object.entries(files)) {
    mkdirSync(join(dir, p, '..'), { recursive: true });
    writeFileSync(join(dir, p), body);
  }
  return dir;
};

describe('what a platform would run (ADR-0095)', () => {
  test('a Dockerfile goes anywhere, its EXPOSE as the port; Fly.io wants one; Node.js needs a start script on Render; a Procfile names the start of other stacks', () => {
    const docker = tmp({ Dockerfile: 'FROM node\nEXPOSE 3000\n' });
    expect(paasDeployability(docker, 'fly')).toEqual({ ok: true, app: { dir: '', runtime: 'docker', port: 3000, build: null, start: null, from: 'the Dockerfile' }, notes: [] });
    expect(paasDeployability(tmp({ Dockerfile: 'FROM node\n' }), 'fly')).toMatchObject({ ok: true, notes: ['The Dockerfile exposes no port: the app is told to listen on 8080 (Fly.io’s default).'] });
    const node = tmp({ 'package.json': JSON.stringify({ scripts: { build: 'tsc', start: 'node dist/server.js' } }), 'pnpm-lock.yaml': '', '.env.example': 'PORT=4000\n' });
    expect(paasDeployability(node, 'fly')).toMatchObject({ ok: false, reason: expect.stringContaining('from a Dockerfile') });
    expect(paasDeployability(node, 'railway')).toEqual({ ok: true, app: { dir: '', runtime: 'node', port: 4000, build: 'pnpm install && pnpm run build', start: 'pnpm start', from: 'package.json' }, notes: [] });
    expect(paasDeployability(tmp({ 'package.json': '{}' }), 'render')).toMatchObject({ ok: false, reason: expect.stringContaining('start script') });
    expect(paasDeployability(tmp({ 'package.json': '{}' }), 'railway')).toMatchObject({ ok: true, app: { runtime: 'node', build: 'npm install', start: null } });
    expect(paasDeployability(tmp({ 'requirements.txt': 'flask\n', Procfile: 'web: gunicorn app:app\n' }), 'render')).toMatchObject({ ok: true, app: { runtime: 'python', build: 'pip install -r requirements.txt', start: 'gunicorn app:app', from: 'requirements.txt' } });
    expect(paasDeployability(tmp({ 'requirements.txt': 'flask\n' }), 'render')).toMatchObject({ ok: false, reason: expect.stringContaining('Procfile') });
    expect(paasDeployability(tmp({ 'go.mod': 'module x\n' }), 'railway')).toMatchObject({ ok: true, app: { runtime: 'go', start: './app' } });
    expect(paasDeployability(tmp({ 'README.md': '' }), 'railway')).toMatchObject({ ok: false, reason: expect.stringContaining('no Dockerfile and no known stack') });
    // a monorepo's web app folder
    const mono = tmp({ 'apps/web/Dockerfile': 'FROM node\nEXPOSE 80\n', 'package.json': '{}' });
    expect(paasDeployability(mono, 'fly', 'apps/web')).toMatchObject({ ok: true, app: { dir: 'apps/web', runtime: 'docker', port: 80 } });
    for (const d of [docker, node, mono]) rmSync(d, { recursive: true, force: true });
  });

  test('the target: production under the project’s name, the preview beside it; Foundry’s fly.toml names the app and the port', () => {
    expect(paasTarget('fly', 'shop', false)).toEqual({ project: 'shop', service: 'shop-preview', environment: 'preview' });
    expect(paasTarget('railway', 'shop', false)).toEqual({ project: 'shop', service: 'shop', environment: 'preview' });
    expect(paasTarget('render', 'shop', true)).toEqual({ project: 'shop', service: 'shop', environment: 'production' });
    const toml = flyConfig('shop-preview', 'lhr', 3000);
    expect(toml).toContain('app = "shop-preview"');
    expect(toml).toContain('primary_region = "lhr"');
    expect(toml).toContain('internal_port = 3000');
    expect(flyConfig('shop', 'iad', null)).toContain('internal_port = 8080');
    expect(FLY_CONFIG).toBe('fly.foundry.toml');
  });

  test('the Fly.io steps: the app made once, the variables staged on stdin, the deploy, the status; the token in the environment only', () => {
    const app = { dir: '', runtime: 'docker' as const, port: 3000, build: null, start: null, from: 'the Dockerfile' };
    const steps = paasSteps({ provider: 'fly', cwd: '/w', app, name: 'shop', production: false, credentials: creds, vars: { DATABASE_URL: 'postgres://db/app', 'bad-name': 'x' }, cli: (p) => [p] });
    expect(steps.map((s) => s.argv.join(' '))).toEqual(['fly apps create shop-preview --org acme --json', 'fly secrets import -a shop-preview --stage', 'fly deploy --config fly.foundry.toml -a shop-preview --remote-only --yes --ha=false', 'fly status -a shop-preview --json']);
    expect(steps[0]!.okIf!.test('Error: Name has already been taken')).toBe(true);
    expect(steps[1]!.stdin).toBe('DATABASE_URL=postgres://db/app\n');
    expect(steps.every((s) => s.env?.FLY_API_TOKEN === 'fly_SECRET_123456' && s.env?.CI === '1')).toBe(true);
    expect(JSON.stringify(steps.map((s) => s.argv))).not.toContain('SECRET');
    // without variables there is no secrets step
    expect(paasSteps({ provider: 'fly', cwd: '/w', app, name: 'shop', production: true, credentials: creds, vars: {}, cli: (p) => [p] }).map((s) => s.label)).toEqual(['make the Fly.io app shop (once)', 'deploy to Fly.io (shop)', 'read the address']);
  });

  test('the Railway steps: link or make the project, the preview environment once, the variables, the deploy, the domain', () => {
    const app = { dir: '', runtime: 'node' as const, port: null, build: 'npm ci', start: 'npm start', from: 'package.json' };
    const steps = paasSteps({ provider: 'railway', cwd: '/w', app, name: 'shop', production: false, credentials: creds, vars: { A: '1' }, cli: () => ['npx', '--yes', '@railway/cli@5'] });
    expect(steps.map((s) => s.label)).toEqual(['link the Railway project shop (made with its service when new)', 'the preview environment (once)', 'work in the preview environment', 'set the runtime variables', 'deploy to Railway (shop, preview)', 'the public domain (made once)']);
    expect(steps[0]!.argv).toEqual(['sh', '-c', "npx --yes @railway/cli@5 link -p shop -e production -s shop -w ws1 --json || (npx --yes @railway/cli@5 init --name shop -w ws1 --json && npx --yes @railway/cli@5 add --service shop --json)"]);
    expect(steps[3]!.argv).toEqual(['npx', '--yes', '@railway/cli@5', 'variable', 'set', 'A=1', '-s', 'shop', '-e', 'preview', '--skip-deploys', '--json']);
    expect(steps[4]!.argv.join(' ')).toBe('npx --yes @railway/cli@5 up --ci --service shop --environment preview --json');
    expect(steps.every((s) => s.env?.RAILWAY_API_TOKEN === 'rw_SECRET_123456')).toBe(true);
    const prod = paasSteps({ provider: 'railway', cwd: '/w', app, name: 'shop', production: true, credentials: creds, vars: {}, cli: () => ['railway'] });
    expect(prod.map((s) => s.label)).toEqual(['link the Railway project shop (made with its service when new)', 'work in the production environment', 'deploy to Railway (shop, production)', 'the public domain (made once)']);
    expect(paasSteps({ provider: 'render', cwd: '/w', app, name: 'shop', production: true, credentials: creds, vars: {}, cli: () => [] })).toEqual([]);
  });

  test('the address from the last command: Fly.io’s hostname, Railway’s domain; a platform’s error in Foundry’s words', () => {
    expect(paasUrl('fly', 'some warning\n{"Name":"shop","Hostname":"shop.fly.dev","Status":"running"}')).toBe('https://shop.fly.dev');
    expect(paasUrl('fly', 'Hostname = shop-preview.fly.dev')).toBe('https://shop-preview.fly.dev');
    expect(paasUrl('fly', 'nothing')).toBeNull();
    expect(paasUrl('railway', '{"domain":"shop-production.up.railway.app"}')).toBe('https://shop-production.up.railway.app');
    expect(paasUrl('railway', '{"domains":["shop.up.railway.app"]}')).toBe('https://shop.up.railway.app');
    expect(paasUrl('railway', 'Service Domain created:\nhttps://shop.up.railway.app')).toBe('https://shop.up.railway.app');
    expect(paasFailureHint('fly', 'Error: You must be authenticated to view this. (401 Unauthorized)')).toContain('Fly.io token');
    expect(paasFailureHint('railway', 'Unauthorized. Please login')).toContain('Railway token');
    expect(paasFailureHint('railway', 'Error: workspace required')).toContain('Railway workspace');
    expect(paasFailureHint('fly', 'build failed')).toBeNull();
    expect(paasSecrets(creds, { A: 'short', B: 'long-enough' })).toEqual(['fly_SECRET_123456', 'rw_SECRET_123456', 'rnd_SECRET_123456', 'long-enough']);
  });

  test('Render: the service body from the repository’s branch, no auto-deploy; the GitHub remote as Render wants it', () => {
    const native = renderServiceBody({ name: 'shop-preview', ownerId: 'tea-1', repo: 'https://github.com/o/r', branch: 'foundry/g1', rootDir: 'apps/api', app: { dir: 'apps/api', runtime: 'node', port: null, build: 'npm ci && npm run build', start: 'npm start', from: 'package.json' }, region: 'oregon', plan: 'free', vars: { A: '1', 'bad-name': 'x' } });
    expect(native).toEqual({ type: 'web_service', name: 'shop-preview', ownerId: 'tea-1', repo: 'https://github.com/o/r', branch: 'foundry/g1', autoDeploy: 'no', rootDir: 'apps/api', envVars: [{ key: 'A', value: '1' }], serviceDetails: { env: 'node', region: 'oregon', plan: 'free', envSpecificDetails: { buildCommand: 'npm ci && npm run build', startCommand: 'npm start' } } });
    const docker = renderServiceBody({ name: 'shop', ownerId: 'tea-1', repo: 'https://github.com/o/r', branch: 'main', rootDir: '', app: { dir: '', runtime: 'docker', port: 80, build: null, start: null, from: 'the Dockerfile' }, region: 'frankfurt', plan: 'starter', vars: {} });
    expect(docker.rootDir).toBeUndefined();
    expect(docker.serviceDetails).toEqual({ env: 'docker', region: 'frankfurt', plan: 'starter', envSpecificDetails: { dockerfilePath: './Dockerfile' } });
    expect(renderRepoUrl('git@github.com:o/r.git')).toBe('https://github.com/o/r');
    expect(renderRepoUrl('https://github.com/o/r')).toBe('https://github.com/o/r');
    expect(renderRepoUrl('ssh://git@github.com/o/r.git\n')).toBe('https://github.com/o/r');
    expect(renderRepoUrl('https://gitlab.com/o/r.git')).toBeNull();
    expect(renderRepoUrl(null)).toBeNull();
  });
});
