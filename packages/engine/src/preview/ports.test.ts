import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BriefApp } from '@foundry/core';
import { nativePort, rewriteLocalPorts } from './ports.ts';

const dirs: string[] = [];
const tree = (files: Record<string, string>) => {
  const d = mkdtempSync(join(tmpdir(), 'foundry-ports-'));
  dirs.push(d);
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(join(d, path, '..'), { recursive: true });
    writeFileSync(join(d, path), body);
  }
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const app = (dir: string, command: string): BriefApp => ({ key: dir || 'app', name: dir || 'app', dir, install: null, command, url: null, platform: 'web' });

describe('nativePort', () => {
  test('a port in the script, PORT in env files, a default in the server entry, then the framework default', () => {
    const ws = tree({
      'apps/web/package.json': JSON.stringify({ scripts: { dev: 'next dev -p 3001' }, dependencies: { next: '15' } }),
      'apps/admin/package.json': JSON.stringify({ scripts: { dev: 'next dev' }, dependencies: { next: '15' } }),
      'apps/api/package.json': JSON.stringify({ scripts: { dev: 'bun --watch src/main.ts' } }),
      'apps/api/src/main.ts': 'app.listen(Number(process.env.PORT ?? 4000));',
      'apps/worker/package.json': JSON.stringify({ scripts: { start: 'node w.js' } }),
      'apps/worker/.env': 'PORT=4100\n',
      'apps/site/package.json': JSON.stringify({ scripts: { dev: 'vite' }, devDependencies: { vite: '5' } }),
      'apps/lib/package.json': JSON.stringify({ scripts: { dev: 'tsc -w' } }),
    });
    expect(nativePort(ws, app('apps/web', 'pnpm run dev -p {port}'))).toBe(3001);
    expect(nativePort(ws, app('apps/admin', 'npm run dev -- -p {port}'))).toBe(3000);
    expect(nativePort(ws, app('apps/api', 'bun run dev'))).toBe(4000);
    expect(nativePort(ws, app('apps/worker', 'npm start'))).toBe(4100);
    expect(nativePort(ws, app('apps/site', 'npm run dev -- --port {port}'))).toBe(5173);
    expect(nativePort(ws, app('apps/lib', 'npm run dev'))).toBeNull();
  });
});

describe('rewriteLocalPorts', () => {
  test('moves local addresses of a moved port and reports names only; other values are left out', () => {
    const r = rewriteLocalPorts({ NEXT_PUBLIC_API_URL: 'http://localhost:4000/api', AUTH_URL: 'http://127.0.0.1:3000', DATABASE_URL: 'postgres://u:p@localhost:5432/db', OTHER: 'https://example.com:4000' }, new Map([[4000, 4201], [3000, 4200]]));
    expect(r.vars).toEqual({ NEXT_PUBLIC_API_URL: 'http://localhost:4201/api', AUTH_URL: 'http://127.0.0.1:4200' });
    expect(r.changes).toEqual([{ key: 'NEXT_PUBLIC_API_URL', from: 4000, to: 4201 }, { key: 'AUTH_URL', from: 3000, to: 4200 }]);
    expect(rewriteLocalPorts({ A: 'http://localhost:4000' }, new Map()).changes).toEqual([]);
  });
});
