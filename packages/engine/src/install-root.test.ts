import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { detectInstallRoot, installRoot, isCompiledBinary } from './install-root.ts';

const ROOT = resolve(import.meta.dir, '../../..');

describe('where a Foundry finds its files (ADR-0101)', () => {
  test('a checkout runs from its own tree', () => {
    expect(isCompiledBinary()).toBe(false);
    expect(detectInstallRoot({ env: {} })).toEqual({ kind: 'checkout', root: ROOT, execDir: null });
    expect(installRoot().root).toBe(ROOT);
  });

  test('a tarball install keeps resources/ beside the executable', () => {
    const exists = (p: string) => p === '/opt/foundry/2.35.0/resources/package.json';
    expect(detectInstallRoot({ env: {}, compiled: true, execPath: '/opt/foundry/2.35.0/foundry', exists, realpath: (p) => p })).toEqual({ kind: 'binary', root: '/opt/foundry/2.35.0/resources', execDir: '/opt/foundry/2.35.0' });
  });

  test('a symlinked command resolves to the real executable before looking beside it', () => {
    const exists = (p: string) => p === '/opt/foundry/2.35.0/resources/package.json';
    const realpath = (p: string) => (p === '/home/me/.local/bin/foundry' ? '/opt/foundry/2.35.0/foundry' : p);
    expect(detectInstallRoot({ env: {}, compiled: true, execPath: '/home/me/.local/bin/foundry', exists, realpath }).root).toBe('/opt/foundry/2.35.0/resources');
  });

  test('the macOS app keeps Contents/Resources', () => {
    const exists = (p: string) => p === '/Applications/Foundry.app/Contents/Resources/package.json';
    expect(detectInstallRoot({ env: {}, compiled: true, execPath: '/Applications/Foundry.app/Contents/MacOS/foundry', exists, realpath: (p) => p })).toEqual({
      kind: 'app',
      root: '/Applications/Foundry.app/Contents/Resources',
      execDir: '/Applications/Foundry.app/Contents/MacOS',
    });
  });

  test('FOUNDRY_ROOT names the folder outright, in any layout', () => {
    expect(detectInstallRoot({ env: { FOUNDRY_ROOT: '/srv/foundry-files' } })).toEqual({ kind: 'checkout', root: '/srv/foundry-files', execDir: null });
    expect(detectInstallRoot({ env: { FOUNDRY_ROOT: '/srv/foundry-files' }, compiled: true, execPath: '/usr/local/bin/foundry', exists: () => false, realpath: (p) => p }).kind).toBe('binary');
  });

  test('a compiled binary with nothing beside it says what it expected', () => {
    expect(() => detectInstallRoot({ env: {}, compiled: true, execPath: '/tmp/foundry', exists: () => false, realpath: (p) => p })).toThrow(/expected \/tmp\/resources beside the executable/);
  });
});
