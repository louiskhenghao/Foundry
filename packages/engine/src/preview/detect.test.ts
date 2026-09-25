import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectRun, previewBindHost } from './detect.ts';

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
