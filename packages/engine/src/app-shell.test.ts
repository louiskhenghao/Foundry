import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { APP_STATE_FILE, choosePort, isPortFree, keepPort, watchParentPipe, writeAppState } from './app-shell.ts';
import { readHomeConfig, writeHomeConfig } from './data-dir.ts';

const tmp = () => mkdtempSync(join(tmpdir(), 'foundry-app-'));

describe('the engine under the menu bar app (ADR-0105)', () => {
  test('the port: the one kept in ~/.foundry/config.json, else 4111 or the next free, kept for next time', () => {
    const home = tmp();
    try {
      const taken = new Set([4111, 4112]);
      expect(choosePort({ home, free: (p) => !taken.has(p) })).toBe(4113);
      expect(readHomeConfig(home).port).toBe(4113);
      // kept across starts while it is free
      expect(choosePort({ home, free: (p) => !taken.has(p) })).toBe(4113);
      // taken by something else since: the next free one, kept instead
      taken.add(4113);
      const said: string[] = [];
      expect(choosePort({ home, free: (p) => !taken.has(p), log: (m) => said.push(m) })).toBe(4114);
      expect(said[0]).toContain('port 4113 is taken');
      // a port the installer's service was given is kept the same way, for the CLI
      keepPort(home, 4200);
      expect(readHomeConfig(home).port).toBe(4200);
      // the other choices in the file stay
      writeHomeConfig(home, { ...readHomeConfig(home), dataDirs: { claude: '/data' } });
      choosePort({ home, free: () => true });
      expect(readHomeConfig(home).dataDirs).toEqual({ claude: '/data' });
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('a port something listens on is not free', () => {
    const s = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response('') });
    try {
      expect(isPortFree(s.port!)).toBe(false);
    } finally {
      s.stop(true);
    }
  });

  test('where the engine listens is written whole, for the shell to read', () => {
    const home = tmp();
    try {
      writeAppState(home, { pid: 42, port: 4113, url: 'http://127.0.0.1:4113', dataDir: '/d', version: '2.35.0', startedAt: 'now' });
      expect(JSON.parse(readFileSync(join(home, APP_STATE_FILE), 'utf8'))).toMatchObject({ pid: 42, port: 4113, dataDir: '/d' });
      expect(existsSync(join(home, `${APP_STATE_FILE}.${process.pid}.tmp`))).toBe(false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('the end of stdin is the shell gone', async () => {
    let gone = false;
    let close!: () => void;
    const stream = new ReadableStream<Uint8Array>({ start: (c) => { c.enqueue(new Uint8Array([1])); close = () => c.close(); } });
    watchParentPipe(() => (gone = true), stream);
    await Bun.sleep(10);
    expect(gone).toBe(false);
    close();
    await Bun.sleep(10);
    expect(gone).toBe(true);
  });
});
