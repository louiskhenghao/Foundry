import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Goal } from '@foundry/core';
import { composeProject, parsePs, ServicesManager, type Exec } from './services.ts';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const workspace = () => {
  const d = mkdtempSync(join(tmpdir(), 'foundry-services-'));
  dirs.push(d);
  writeFileSync(join(d, 'compose.yaml'), 'services:\n  db:\n    image: postgres:16\n    ports: ["5432:5432"]\n  minio:\n    image: minio/minio\n    ports: ["9000:9000"]\n  cache:\n    image: redis\n    ports: ["6379:6379"]\n');
  return d;
};
const goal = { id: 'g1', repoPath: '/Users/me/Projects/My Shop' } as Goal;

/** a fake docker: minio already runs in Foundry's project; port 5432 is the person's own Postgres */
function fake(running = ['minio']) {
  const calls: string[][] = [];
  const exec: Exec = async (args) => {
    calls.push(args);
    if (args.includes('ps')) return { code: 0, stdout: running.map((s) => JSON.stringify({ Service: s, State: 'running', Health: 'healthy' })).join('\n'), stderr: '' };
    if (args.includes('up')) running.push(...args.slice(args.lastIndexOf('90') + 1));
    return { code: 0, stdout: '', stderr: '' };
  };
  return { calls, exec };
}

describe('ServicesManager', () => {
  test('one project per repository; reuses what already runs, starts the rest, never the person’s own service', async () => {
    const ws = workspace();
    const { calls, exec } = fake();
    const m = new ServicesManager({ exec, which: () => '/usr/bin/docker', portFree: async (p) => p !== 5432, log: () => {} });
    const st = await m.status(goal, ws, true);
    expect(st).toMatchObject({ project: 'foundry-my-shop', docker: 'available', file: 'compose.yaml' });
    expect(st!.services.map((s) => [s.name, s.state])).toEqual([['db', 'external'], ['minio', 'running'], ['cache', 'stopped']]);
    const after = await m.up(goal, ws);
    const up = calls.find((c) => c.includes('up'))!;
    expect(up.slice(-1)).toEqual(['cache']);
    expect(up).toContain('--project-directory');
    expect(up[up.indexOf('--project-directory') + 1]).toBe('/Users/me/Projects/My Shop');
    expect(after!.services.find((s) => s.name === 'cache')!.state).toBe('running');
    await m.stop(goal, ws, ['minio']);
    expect(calls.find((c) => c.includes('stop'))!.slice(-1)).toEqual(['minio']);
  });

  test('inside the Docker image or without docker it only describes the services and the command', async () => {
    const ws = workspace();
    const { calls, exec } = fake();
    const inImage = new ServicesManager({ exec, which: () => '/usr/bin/docker', inContainer: () => true, portFree: async () => true, log: () => {} });
    const st = await inImage.up(goal, ws);
    expect(st).toMatchObject({ docker: 'in-container', command: 'docker compose -p foundry-my-shop -f compose.yaml up -d db minio cache' });
    expect(st!.services.every((s) => s.state === 'unknown')).toBe(true);
    expect((await new ServicesManager({ exec, which: () => null, portFree: async () => true, log: () => {} }).status(goal, ws, true))!.docker).toBe('unavailable');
    expect(calls).toEqual([]);
  });

  test("inside the image with the host's Docker shared, services start there in the container's network, without ports", async () => {
    const ws = workspace();
    const { calls, exec } = fake();
    const dir = mkdtempSync(join(tmpdir(), 'foundry-services-override-'));
    const m = new ServicesManager({ exec, which: () => '/usr/bin/docker', inContainer: () => true, hostDocker: () => ({ container: 'foundry', dir, id: 'c0ffee' }), portFree: async () => true, log: () => {} });
    const st = await m.up(goal, ws);
    expect(st!.docker).toBe('available');
    const up = calls.find((c) => c.includes('up'))!;
    // minio runs, but joined to an earlier Foundry container's network (no label for this one): it is started again
    expect(up.slice(-3)).toEqual(['db', 'minio', 'cache']);
    const files = up.flatMap((a, i) => (a === '-f' ? [up[i + 1]!] : []));
    expect(files).toEqual([join(ws, 'compose.yaml'), join(dir, 'foundry-my-shop.host-docker.yml')]);
    const override = readFileSync(files[1]!, 'utf8');
    for (const name of ['db', 'minio', 'cache']) expect(override).toContain(`"${name}":\n    network_mode: "container:foundry"\n    ports: !reset []\n    labels:\n      dev.foundry.container: "c0ffee"`);
  });

  test('a failing docker call is reported, not thrown; no compose file means no services', async () => {
    const ws = workspace();
    const m = new ServicesManager({ exec: async () => ({ code: 1, stdout: '', stderr: 'Cannot connect to the Docker daemon\n' }), which: () => 'docker', portFree: async () => true, log: () => {} });
    expect((await m.status(goal, ws, true))!.error).toBe('Cannot connect to the Docker daemon');
    expect(await m.status(goal, mkdtempSync(join(tmpdir(), 'foundry-services-none-')), true)).toBeNull();
  });

  test('compose ps output: JSON lines or one array; project names are safe', () => {
    expect(parsePs('{"Service":"db","State":"running"}\n{"Service":"x","State":"exited"}').map((r) => r.Service)).toEqual(['db', 'x']);
    expect(parsePs('[{"Service":"db"}]')).toEqual([{ Service: 'db' }]);
    expect(composeProject('/a/Telegram平台/')).toBe('foundry-telegram');
  });
});
