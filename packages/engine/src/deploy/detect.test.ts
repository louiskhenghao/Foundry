import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { deployability } from './detect.ts';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
/** a repository from a map of files; a package.json value is an object */
function repo(files: Record<string, string | object>): string {
  const root = mkdtempSync(join(tmpdir(), 'foundry-deploy-detect-'));
  dirs.push(root);
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), typeof body === 'string' ? body : JSON.stringify(body));
  }
  return root;
}
const pkg = (deps: Record<string, string>, build = 'build') => ({ dependencies: deps, scripts: build ? { build } : {} });

describe('what Foundry deploys', () => {
  test('a full-stack framework is rendered by the host; an exported one is files', () => {
    const next = deployability(repo({ 'package.json': pkg({ next: '15', react: '19' }), 'bun.lock': '' }));
    expect(next).toEqual({ ok: true, app: { dir: '', framework: 'Next.js', kind: 'ssr', install: ['bun', 'install'], build: ['bun', 'run', 'build'], outputDir: '.' }, notes: [] });
    const exported = deployability(repo({ 'package.json': pkg({ next: '15' }), 'next.config.mjs': "export default { output: 'export' }" }));
    expect(exported).toMatchObject({ ok: true, app: { kind: 'built', outputDir: 'out', install: ['npm', 'install'] } });
    expect(deployability(repo({ 'package.json': pkg({ '@sveltejs/kit': '2', '@sveltejs/adapter-static': '3' }) }))).toMatchObject({ ok: true, app: { framework: 'SvelteKit', kind: 'built', outputDir: 'build' } });
    expect(deployability(repo({ 'package.json': pkg({ astro: '5', '@astrojs/node': '9' }) }))).toMatchObject({ ok: true, app: { framework: 'Astro', kind: 'ssr' } });
    expect(deployability(repo({ 'package.json': pkg({ astro: '5' }) }))).toMatchObject({ ok: true, app: { framework: 'Astro', kind: 'built', outputDir: 'dist' } });
  });

  test("a single-page app built with Vite, in a monorepo's apps folder, beside a component library", () => {
    const r = deployability(repo({ 'package.json': { workspaces: ['apps/*', 'packages/*'] }, 'pnpm-lock.yaml': '', 'apps/web/package.json': pkg({ vite: '7', react: '19' }), 'apps/web/index.html': '<div id=root>', 'packages/ui/package.json': pkg({ vite: '7', react: '19' }) }));
    expect(r).toEqual({ ok: true, app: { dir: 'apps/web', framework: 'Vite', kind: 'built', install: ['pnpm', 'install'], build: ['pnpm', 'run', 'build'], outputDir: 'dist' }, notes: [] });
  });

  test('a folder of pages is uploaded as it is', () => {
    expect(deployability(repo({ 'index.html': '<h1>hi</h1>', 'style.css': '' }))).toMatchObject({ ok: true, app: { framework: 'static pages', kind: 'static', outputDir: '.', install: null, build: null } });
  });

  test('a database the compose file starts is a note, a Dockerfile beside a framework is ignored', () => {
    const r = deployability(repo({ 'package.json': pkg({ next: '15' }), 'docker-compose.yml': 'services:\n  db:\n    image: postgres:17\n', Dockerfile: 'FROM node' }));
    expect(r.ok).toBe(true);
    expect(r.ok && r.notes).toEqual([expect.stringContaining('starts db'), expect.stringContaining('Dockerfile is not used')]);
  });
});

describe('what Foundry does not deploy, and says why', () => {
  test('a backend deployed apart from its pages', () => {
    const r = deployability(repo({ 'apps/web/package.json': pkg({ vite: '7' }), 'apps/web/index.html': '', 'apps/api/package.json': pkg({ express: '5' }) }));
    expect(r).toEqual({ ok: false, reason: expect.stringContaining('a backend deployed apart from its pages (apps/api (express))') });
    expect(deployability(repo({ 'web/package.json': pkg({ next: '15' }), 'backend/go.mod': 'module x' }))).toEqual({ ok: false, reason: expect.stringContaining('backend (Go)') });
  });

  test('workers in Docker or a Procfile', () => {
    expect(deployability(repo({ 'package.json': pkg({ next: '15' }), 'compose.yaml': 'services:\n  worker:\n    build: ./worker\n' }))).toEqual({ ok: false, reason: expect.stringContaining('(worker)') });
    expect(deployability(repo({ 'package.json': pkg({ next: '15' }), Procfile: 'web: npm start\nworker: node jobs.js\n' }))).toEqual({ ok: false, reason: expect.stringContaining('worker (Procfile)') });
  });

  test('a custom server beside the pages, and a server alone', () => {
    expect(deployability(repo({ 'package.json': pkg({ vite: '7', express: '5' }), 'index.html': '' }))).toEqual({ ok: false, reason: expect.stringContaining('runs a server of its own (express) beside Vite') });
    expect(deployability(repo({ 'package.json': pkg({ fastify: '5' }) }))).toEqual({ ok: false, reason: expect.stringContaining('a backend deployed apart') });
  });

  test('several web apps, and nothing recognisable', () => {
    expect(deployability(repo({ 'apps/site/package.json': pkg({ astro: '5' }), 'apps/admin/package.json': pkg({ next: '15' }) }))).toEqual({ ok: false, reason: expect.stringContaining('several web apps (apps/admin, apps/site)') });
    expect(deployability(repo({ 'README.md': '# notes' }))).toEqual({ ok: false, reason: expect.stringContaining('no web app found') });
  });
});
