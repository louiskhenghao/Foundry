/** what the move's tests share: data folders with goals, a checkout, a computer of their own */
import { EventStore, Goal, openDatabase } from '@foundry/core';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { localProbe, type Probe, type RunResult } from './probe.ts';

export const tmp = () => realpathSync(mkdtempSync(join(tmpdir(), 'foundry-find-')));

/** a data folder with `n` goals, as an engine leaves it */
export function seedFolder(dir: string, n: number): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'provider'), 'claude');
  const store = new EventStore(openDatabase(join(dir, 'engine.db')));
  const now = new Date().toISOString();
  for (let i = 0; i < n; i++) {
    const id = `g_${i}`;
    store.append({ type: 'goal.created', goalId: id, payload: { goal: Goal.parse({ id, title: `goal ${i}`, prompt: 'p', repoPath: '/repo', baseBranch: 'main', branch: `goal/${id}`, budgets: {}, models: { strong: 'opus', cheap: 'haiku', worker: 'opus' }, state: 'done', stateBeforeBlock: null, costUsd: 0, fixCycles: 0, runningSince: null, createdAt: now, updatedAt: now }) } });
  }
  store.close();
}

/** a checkout as the move recognises one: its entry point, a package.json, a data folder */
export function seedCheckout(dir: string, goals: number, version = '2.35.0'): void {
  mkdirSync(join(dir, 'apps/cli/src'), { recursive: true });
  writeFileSync(join(dir, 'apps/cli/src/main.ts'), '');
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ version }));
  seedFolder(join(dir, 'data'), goals);
}

/** a computer of a test's own: commands answered from a table, the rest of the files real */
export function fakeProbe(o: { home: string; platform?: NodeJS.Platform; env?: NodeJS.ProcessEnv; run?: (argv: string[]) => RunResult | null; json?: (url: string, init?: { method?: string; body?: unknown }) => any }): Probe & { ran: string[][] } {
  const real = localProbe({ ...process.env, ...(o.env ?? {}) });
  const ran: string[][] = [];
  return {
    ...real,
    platform: o.platform ?? 'darwin',
    home: o.home,
    env: { HOME: o.home, FOUNDRY_HOME: join(o.home, '.foundry'), PATH: process.env.PATH, ...(o.env ?? {}) },
    uid: 501,
    self: [process.pid],
    ran,
    async run(argv, opts) {
      ran.push(argv);
      const r = o.run?.(argv);
      if (r) return r;
      // what a test does not answer runs for real only when it is a copy (cp, the file work of a move)
      if (argv[0] === 'cp' || argv[0] === 'git') return real.run(argv, opts);
      return { code: 1, stdout: '', stderr: '' };
    },
    async json(url, init) {
      return o.json ? o.json(url, init) : null;
    },
  };
}

