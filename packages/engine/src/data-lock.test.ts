import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DataFolderInUse, LOCK_FILE, claimDataDir, processAlive, readDataLock, releaseDataDir } from './data-lock.ts';

describe('one Foundry per data folder (ADR-0102)', () => {
  test('a claim by a live process refuses, a dead one is taken over, the holder lets go', () => {
    const dir = mkdtempSync(join(tmpdir(), 'foundry-lock-'));
    try {
      claimDataDir(dir, { pid: 1001, port: 4111, alive: () => true });
      expect(readDataLock(dir)).toMatchObject({ pid: 1001, port: 4111 });
      expect(() => claimDataDir(dir, { pid: 2002, alive: () => true })).toThrow(DataFolderInUse);
      expect(() => claimDataDir(dir, { pid: 2002, alive: () => true })).toThrow(/pid 1001, port 4111/);
      // the same process claims again (an in-process restart)
      claimDataDir(dir, { pid: 1001, port: 4112, alive: () => true });
      // gone: taken over
      claimDataDir(dir, { pid: 2002, alive: () => false });
      expect(readDataLock(dir)?.pid).toBe(2002);
      releaseDataDir(dir, 1001);
      expect(existsSync(join(dir, LOCK_FILE))).toBe(true);
      releaseDataDir(dir, 2002);
      expect(existsSync(join(dir, LOCK_FILE))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('liveness by signal 0', () => {
    expect(processAlive(process.pid)).toBe(true);
    expect(processAlive(0)).toBe(false);
    expect(processAlive(2 ** 22 + 12345)).toBe(false);
  });
});
