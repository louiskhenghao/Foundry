import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectApps, detectCompose, detectRun, previewBindHost, publishedPorts } from './detect.ts';

const dirs: string[] = [];
const ws = (pkg: object, files: string[] = []) => {
  const d = mkdtempSync(join(tmpdir(), 'foundry-detect-'));
  dirs.push(d);
  writeFileSync(join(d, 'package.json'), JSON.stringify(pkg));
  for (const f of files) {
    mkdirSync(join(d, f), { recursive: true });
  }
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('detectRun', () => {
  test('nothing to run without a package.json or a dev/start script', () => {
    expect(detectRun(mkdtempSync(join(tmpdir(), 'foundry-detect-empty-')))).toBeNull();
    expect(detectRun(ws({ scripts: { test: 'bun test' } }))).toBeNull();
  });
  test('vite and next get their port flag, expo its web start, plain scripts rely on PORT', () => {
    expect(detectRun(ws({ scripts: { dev: 'vite' }, devDependencies: { vite: '^5' } }))).toMatchObject({ command: 'npm run dev -- --port {port} --strictPort', platform: 'web', install: 'npm install' });
    expect(detectRun(ws({ scripts: { dev: 'next dev' }, dependencies: { next: '14' } }, ['node_modules']))).toMatchObject({ command: 'npm run dev -- -p {port}', install: null });
    expect(detectRun(ws({ scripts: { start: 'expo start' }, dependencies: { expo: '~51' } }))).toMatchObject({ command: 'npx expo start --web --port {port}', platform: 'expo' });
    expect(detectRun(ws({ scripts: { start: 'node server.js' } }))).toMatchObject({ command: 'npm run start', url: 'http://localhost:{port}' });
  });
  test('in Docker, vite and next listen on every interface; expo and plain scripts are unchanged', () => {
    const host = '0.0.0.0';
    expect(detectRun(ws({ scripts: { dev: 'vite' }, devDependencies: { vite: '^5' } }), { host })).toMatchObject({ command: 'npm run dev -- --port {port} --strictPort --host 0.0.0.0', url: 'http://localhost:{port}' });
    expect(detectRun(ws({ scripts: { dev: 'next dev' }, dependencies: { next: '14' } }), { host })).toMatchObject({ command: 'npm run dev -- -p {port} -H 0.0.0.0' });
    expect(detectRun(ws({ scripts: { start: 'expo start' }, dependencies: { expo: '~51' } }), { host })).toMatchObject({ command: 'npx expo start --web --port {port}' });
    expect(detectRun(ws({ scripts: { start: 'node server.js' } }), { host })).toMatchObject({ command: 'npm run start' });
    // no host (a local install): the commands stay loopback-only, exactly as before
    expect(detectRun(ws({ scripts: { dev: 'vite' }, devDependencies: { vite: '^5' } }), { host: null })!.command).toBe('npm run dev -- --port {port} --strictPort');
  });
});

describe('previewBindHost', () => {
  test('0.0.0.0 only inside the image (FOUNDRY_DOCKER), null for a local install', () => {
    expect(previewBindHost({ FOUNDRY_DOCKER: '1' })).toBe('0.0.0.0');
    expect(previewBindHost({})).toBeNull();
    expect(previewBindHost({ FOUNDRY_DOCKER: '' })).toBeNull();
  });
});

const tree = (files: Record<string, string>) => {
  const d = mkdtempSync(join(tmpdir(), 'foundry-detect-tree-'));
  dirs.push(d);
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(join(d, path, '..'), { recursive: true });
    writeFileSync(join(d, path), body);
  }
  return d;
};
const pkg = (o: object) => JSON.stringify(o);

describe('detectApps', () => {
  test('workspace apps under apps/ or with an app framework, front end first; libraries and non-workspaces stay out', () => {
    const d = tree({
      'package.json': pkg({ workspaces: ['apps/*', 'packages/*'] }),
      'bun.lock': '',
      'apps/api/package.json': pkg({ name: '@acme/api', scripts: { dev: 'bun --watch src/main.ts' } }),
      'apps/web/package.json': pkg({ name: '@acme/web', scripts: { dev: 'vite' }, devDependencies: { vite: '^5' } }),
      'packages/ui/package.json': pkg({ name: '@acme/ui', scripts: { dev: 'tsc --watch' } }),
      'packages/admin/package.json': pkg({ name: 'admin', scripts: { dev: 'next dev' }, dependencies: { next: '15' } }),
    });
    expect(detectApps(d).map((a) => [a.key, a.dir, a.command])).toEqual([
      ['web', 'apps/web', 'bun run dev -- --port {port} --strictPort'],
      ['admin', 'packages/admin', 'bun run dev -- -p {port}'],
      ['api', 'apps/api', 'bun run dev'],
    ]);
    expect(detectApps(tree({ 'package.json': pkg({ scripts: { dev: 'vite' } }) }))).toEqual([]);
  });
  test('pnpm-workspace.yaml and the object form of workspaces count too', () => {
    expect(detectApps(tree({ 'pnpm-workspace.yaml': 'packages:\n  - "apps/*"\n', 'pnpm-lock.yaml': '', 'apps/site/package.json': pkg({ scripts: { start: 'node s.js' } }) })).map((a) => [a.key, a.command])).toEqual([['site', 'pnpm run start']]);
    expect(detectApps(tree({ 'package.json': pkg({ workspaces: { packages: ['apps/*'] } }), 'apps/web/package.json': pkg({ scripts: { dev: 'x' } }) })).map((a) => a.key)).toEqual(['web']);
  });
});

describe('detectCompose', () => {
  test('dependency services with their host ports; services built from the repo are the apps and stay out', () => {
    const d = tree({ 'docker-compose.yml': 'services:\n  db:\n    image: postgres:16\n    ports: ["${PG_PORT:-5433}:5432"]\n  minio:\n    image: minio/minio\n    ports:\n      - "127.0.0.1:9000-9001:9000-9001"\n  api:\n    build: ./apps/api\n    image: acme/api\n' });
    expect(detectCompose(d)).toEqual({ file: 'docker-compose.yml', services: [{ name: 'db', image: 'postgres:16', ports: [5433] }, { name: 'minio', image: 'minio/minio', ports: [9000, 9001] }] });
    expect(detectCompose(tree({ 'compose.yaml': 'services:\n  web:\n    build: .\n' }))).toBeNull();
    expect(detectCompose(tree({ 'docker/compose.yml': 'services:\n  redis:\n    image: redis\n' }))?.file).toBe('docker/compose.yml');
  });
  test('published ports: short, ranged, bound, long form; a container-only port has none', () => {
    expect(publishedPorts('5432:5432')).toEqual([5432]);
    expect(publishedPorts('6379')).toEqual([]);
    expect(publishedPorts('8080:80/tcp')).toEqual([8080]);
    expect(publishedPorts({ target: 5432, published: '15432' })).toEqual([15432]);
  });
});
