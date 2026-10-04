import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addressPort, descendants, listeningPorts, parseLsof } from './listeners.ts';

const procs: ReturnType<typeof Bun.spawn>[] = [];
const dirs: string[] = [];
afterEach(() => {
  for (const p of procs.splice(0)) {
    try {
      process.kill(-p.pid, 'SIGTERM');
    } catch {}
  }
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('listeningPorts', () => {
  test('finds every port a start command’s child servers listen on, with each server’s folder', async () => {
    const ws = realpathSync(mkdtempSync(join(tmpdir(), 'foundry-listen-')));
    dirs.push(ws);
    for (const d of ['admin', 'api']) mkdirSync(join(ws, 'apps', d), { recursive: true });
    const serve = (port: number) => `bun -e 'Bun.serve({ port: ${port}, fetch: () => new Response("ok") }); setInterval(() => {}, 1000)'`;
    // an orchestrator like a demo script: a shell that starts two servers in their own folders
    const root = Bun.spawn(['sh', '-c', `(cd apps/admin && ${serve(47311)}) & (cd apps/api && ${serve(47312)}) & wait`], { cwd: ws, detached: true, stdout: 'ignore', stderr: 'ignore' });
    procs.push(root);
    let found: Awaited<ReturnType<typeof listeningPorts>> = [];
    for (let i = 0; i < 40 && found.length < 2; i++) {
      await Bun.sleep(150);
      found = await listeningPorts(root.pid);
    }
    expect(found.map((l) => [l.port, l.cwd])).toEqual([
      [47311, join(ws, 'apps', 'admin')],
      [47312, join(ws, 'apps', 'api')],
    ]);
    expect(await listeningPorts(999_999_999)).toEqual([]);
  }, 20_000);
});

describe('listener parsing', () => {
  test('process trees, addresses and lsof fields', () => {
    expect(descendants(1, new Map([[2, 1], [3, 2], [4, 9], [5, 1]]))).toEqual([1, 2, 5, 3]);
    expect([addressPort('*:3000'), addressPort('127.0.0.1:4201'), addressPort('[::1]:4210'), addressPort('nonsense')]).toEqual([3000, 4201, 4210, null]);
    expect(parseLsof('p12\nf5\nn*:3000\nn[::1]:3001\np13\nn/srv/app\n')).toEqual([{ pid: 12, name: '*:3000' }, { pid: 12, name: '[::1]:3001' }, { pid: 13, name: '/srv/app' }]);
  });
});
