import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { IDLE_DELIVERY, getGoal, type Goal } from '@foundry/core';
import { defaultConfig } from '../config.ts';
import { Engine } from '../engine.ts';
import { composeProject } from '../preview/services.ts';
import { goalWorkspacePath } from '../workspace.ts';
import { listPorts, parseDockerPs, PortError, releasePort, type PortsDeps } from './ports.ts';
import { parseNetstat, parseProcNet, parsePs } from './scan.ts';

const ROOT = resolve(import.meta.dir, '../../../..');
const line = (addr: string, owner: string) => `tcp4       0      0  ${addr}         *.*                    LISTEN                 0            0  131072  131072  ${owner}  00100 00000006 000000000057b18f 00000001 00000800      1      0 000000`;

describe('parsing', () => {
  test('netstat names every listener, a process name with spaces too', () => {
    const out = ['Proto Recv-Q …', line('127.0.0.1.4111', 'bun:42'), line('*.3000', 'Google Chrome He:77'), 'tcp4  0  0  10.0.0.2.5000  10.0.0.3.6000  ESTABLISHED  0 0 1 1  x:1  00100 0'].join('\n');
    expect(parseNetstat(out)).toEqual([
      { port: 4111, address: '127.0.0.1', pid: 42, process: 'bun' },
      { port: 3000, address: '*', pid: 77, process: 'Google Chrome He' },
    ]);
  });

  test('/proc/net/tcp: LISTEN rows with their port, address and inode', () => {
    const text = '  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode\n   0: 00000000:0BB8 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 4242 1\n   1: 0100007F:100F 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 4343 1\n   2: 0100007F:100F 0200000A:9999 01 00000000:00000000 00:00000000 00000000  1000        0 4444 1';
    expect(parseProcNet(text, false)).toEqual([
      { port: 3000, address: '*', inode: '4242' },
      { port: 4111, address: '127.0.0.1', inode: '4343' },
    ]);
  });

  test('ps and docker ps', () => {
    expect([...parsePs('  42   501 /Applications/Visual Studio Code.app/Contents/MacOS/Code\n  7 0 launchd\n')]).toEqual([
      [42, { uid: 501, command: '/Applications/Visual Studio Code.app/Contents/MacOS/Code' }],
      [7, { uid: 0, command: 'launchd' }],
    ]);
    const ps = JSON.stringify({ ID: 'abc', Names: 'shop-db-1', Ports: '0.0.0.0:5432->5432/tcp, [::]:5432->5432/tcp, 6000/tcp', Labels: 'com.docker.compose.project=foundry-shop,com.docker.compose.project.working_dir=/x' });
    expect(parseDockerPs(ps)).toEqual([{ id: 'abc', name: 'shop-db-1', ports: [5432], project: 'foundry-shop', workingDir: '/x' }]);
  });
});

let dataDir: string;
const engines: Engine[] = [];
beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'foundry-ports-'));
});
afterEach(async () => {
  for (const e of engines.splice(0)) await e.stop();
  rmSync(dataDir, { recursive: true, force: true });
});

const setup = () => {
  const engine = new Engine(defaultConfig(ROOT, { dataDir, claudeHome: join(dataDir, 'claude-home'), log: () => {} }));
  engines.push(engine);
  const now = new Date().toISOString();
  const g = {
    id: 'g_ports1', title: 'Shop', prompt: 'p', workspaceDir: join(dataDir, 'ws'), checkpoint: null, selfCheck: false, previewRef: null, previewPlace: 'auto', milestonePause: true, clarifyStage: null, interview: null, effort: null, modelPreset: null, modelSubstitutions: {}, repoPath: '/Users/me/Projects/shop', baseBranch: 'main', branch: 'goal/g_ports1',
    budgets: { maxCostUsd: 5, maxDurationMin: 120, maxConcurrent: 3, attemptsPerTask: 3 }, budgetPreset: 'custom', mode: 'expert', workflow: { tdd: 'off', pace: 'thorough' },
    models: { strong: 'opus', cheap: 'haiku', worker: 'opus' }, state: 'running', stateBeforeBlock: null, costUsd: 0, fixCycles: 0, delivery: IDLE_DELIVERY, attachments: [], baseSync: null, autoskills: null, follows: null,
    completion: { graphRefresh: false, docs: [], docsRun: null, graphRun: null, artifactsRun: null }, nature: 'auto', outputDir: null, runningSince: null, createdAt: now, updatedAt: now,
  } as Goal;
  engine.store.append({ type: 'goal.created', goalId: g.id, payload: { goal: g } });
  return { engine, goal: getGoal(engine.store.db, g.id)! };
};

/** a computer with Foundry, a dev server in a goal's folder, one in a project, a system daemon, an invisible holder,
 * three tailscale serves (Foundry's own address, one Foundry added, one the person added) and two containers */
const machine = (engine: Engine, goal: Goal, calls: string[] = []): PortsDeps => {
  const ws = goalWorkspacePath(engine.config.dataDir, goal);
  const netstat = [
    line(`127.0.0.1.${engine.config.port}`, `bun:${process.pid}`),
    line('*.3001', 'node:201'),
    line('*.5173', 'node:202'),
    line('*.8770', 'sharingd:203'),
    line('100.64.0.1.3000', 'io.tailscale.ipn:204'),
    line('*.5432', 'com.docker.backe:205'),
  ].join('\n') + '\ntcp4  0  0  *.9999  *.*  LISTEN  0 0 131072 131072  00100 00000006';
  const uid = 501;
  return {
    platform: 'darwin',
    uid,
    run: async (argv) => {
      if (argv[0] === 'netstat') return netstat;
      if (argv[0] === 'ps') return [`${process.pid} ${uid} bun`, `201 ${uid} node`, `202 ${uid} node`, '203 0 /usr/libexec/sharingd', '204 0 io.tailscale.ipn', `205 ${uid} com.docker.backend`].join('\n');
      if (argv[0] === 'lsof') return [`p201`, `n${ws}/apps/web`, 'p202', `n${homedir()}/Projects/blog`].join('\n');
      return '';
    },
    serves: async () => [
      { port: 443, target: `http://127.0.0.1:${engine.config.port}`, targetPort: engine.config.port, url: 'https://mac.ts.net', ours: false },
      { port: 4200, target: 'http://127.0.0.1:4200', targetPort: 4200, url: 'https://mac.ts.net:4200', ours: true },
      { port: 3000, target: 'http://127.0.0.1:3000', targetPort: 3000, url: 'https://mac.ts.net:3000', ours: false },
    ],
    dockerPs: async () => [JSON.stringify({ ID: 'a', Names: 'shop-db-1', Ports: '0.0.0.0:5432->5432/tcp', Labels: `com.docker.compose.project=${composeProject(goal.repoPath)}` }), JSON.stringify({ ID: 'b', Names: 'grafana', Ports: '0.0.0.0:3300->3000/tcp', Labels: '' })].join('\n'),
    kill: (pid, sig) => void calls.push(`kill ${pid} ${sig}`),
    alive: () => false,
    stopServe: async (p) => void calls.push(`serve off ${p}`),
    dockerStop: async (c) => void calls.push(`docker stop ${c}`),
  };
};

describe('the Ports page', () => {
  test('every port says who holds it and whether it can be released', async () => {
    const { engine, goal } = setup();
    const v = await listPorts(engine, machine(engine, goal));
    const at = (port: number) => v.rows.filter((r) => r.port === port).map((r) => ({ kind: r.kind, label: r.label, allowed: r.release.allowed, confirm: !!r.release.confirm, relevant: r.relevant }));
    expect(at(engine.config.port)).toEqual([{ kind: 'server', label: 'Foundry', allowed: false, confirm: false, relevant: true }]);
    expect(at(3001)).toEqual([{ kind: 'task', label: 'Started in a goal folder', allowed: true, confirm: true, relevant: true }]);
    expect(at(5173)).toEqual([{ kind: 'process', label: 'node', allowed: true, confirm: true, relevant: true }]);
    expect(at(8770)).toEqual([{ kind: 'process', label: 'sharingd', allowed: false, confirm: false, relevant: false }]);
    expect(at(9999)).toEqual([{ kind: 'unknown', label: 'Unknown holder', allowed: false, confirm: false, relevant: false }]);
    // Tailscale's socket on a served port is the serve's row, said once
    expect(at(443)).toEqual([{ kind: 'serve-self', label: 'Tailscale serve → Foundry', allowed: false, confirm: false, relevant: true }]);
    expect(at(4200)).toEqual([{ kind: 'serve-foundry', label: 'Tailscale serve (by Foundry)', allowed: true, confirm: true, relevant: true }]);
    expect(at(3000)).toEqual([{ kind: 'serve-person', label: 'Tailscale serve (yours)', allowed: true, confirm: true, relevant: true }]);
    expect(at(5432)).toEqual([{ kind: 'service', label: 'Service · shop-db-1', allowed: true, confirm: true, relevant: true }]);
    expect(at(3300)).toEqual([{ kind: 'container', label: 'Docker · grafana', allowed: true, confirm: true, relevant: true }]);
    expect(v.rows.find((r) => r.port === 3001)!.goalId).toBe(goal.id);
  });

  test('releasing stops the right thing, notes it on the goal, and refuses what may not be stopped', async () => {
    const { engine, goal } = setup();
    const calls: string[] = [];
    const deps = machine(engine, goal, calls);
    const id = async (port: number) => (await listPorts(engine, deps)).rows.find((r) => r.port === port)!.id;
    await releasePort(engine, await id(3001), deps);
    await releasePort(engine, await id(3000), deps);
    await releasePort(engine, await id(3300), deps);
    expect(calls).toEqual(['kill 201 SIGTERM', 'serve off 3000', 'docker stop grafana']);
    expect(engine.store.listByGoal(goal.id).some((e) => e.type === 'engine.note' && String((e.payload as { message: string }).message).includes('on the Ports page'))).toBe(true);
    await expect(releasePort(engine, await id(443), deps)).rejects.toBeInstanceOf(PortError);
    await expect(releasePort(engine, await id(engine.config.port), deps)).rejects.toThrow('Foundry itself');
    await expect(releasePort(engine, 'process:1:1', deps)).rejects.toThrow('refresh');
  });

  test('a serve the page was opened through is never offered, whatever it forwards', async () => {
    const { engine, goal } = setup();
    const v = await listPorts(engine, { ...machine(engine, goal), viaHost: 'mac.ts.net:3000' });
    expect(v.rows.find((r) => r.port === 3000)).toMatchObject({ kind: 'serve-self', release: { allowed: false } });
  });
});
