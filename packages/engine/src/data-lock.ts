/**
 * One Foundry per data folder (ADR-0105). Two engines on one engine.db write the same event log from two processes and
 * each rebuilds its read models from what it alone saw. That used to take two checkouts pointed at one folder; with the
 * app beside a checkout, both read the folder ~/.foundry/config.json names. `foundry serve` claims the folder with an
 * `engine.pid` file and refuses one whose claimant still runs; a claim left by a process that is gone is taken over.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const LOCK_FILE = 'engine.pid';

export interface DataLock {
  pid: number;
  port: number | null;
  startedAt: string;
}

/** the process is there: signal 0 asks without sending; EPERM means it is there and someone else's */
export function processAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export function readDataLock(dataDir: string): DataLock | null {
  const file = join(dataDir, LOCK_FILE);
  if (!existsSync(file)) return null;
  try {
    const j = JSON.parse(readFileSync(file, 'utf8'));
    return typeof j.pid === 'number' ? { pid: j.pid, port: typeof j.port === 'number' ? j.port : null, startedAt: String(j.startedAt ?? '') } : null;
  } catch {
    return null;
  }
}

export class DataFolderInUse extends Error {
  constructor(
    readonly dataDir: string,
    readonly holder: DataLock,
  ) {
    super(`another Foundry has this data folder open (pid ${holder.pid}${holder.port ? `, port ${holder.port}` : ''}): ${dataDir} — stop that one first, or give this one its own folder (FOUNDRY_DATA_DIR)`);
  }
}

/** claim the folder for this process; a live claim by another process refuses, a dead one is taken over */
export function claimDataDir(dataDir: string, opts: { pid?: number; port?: number | null; alive?: (pid: number) => boolean } = {}): void {
  const pid = opts.pid ?? process.pid;
  const alive = opts.alive ?? processAlive;
  const held = readDataLock(dataDir);
  if (held && held.pid !== pid && alive(held.pid)) throw new DataFolderInUse(dataDir, held);
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(join(dataDir, LOCK_FILE), JSON.stringify({ pid, port: opts.port ?? null, startedAt: new Date().toISOString() }) + '\n');
}

/** let the folder go, when this process holds it */
export function releaseDataDir(dataDir: string, pid: number = process.pid): void {
  if (readDataLock(dataDir)?.pid === pid) rmSync(join(dataDir, LOCK_FILE), { force: true });
}
