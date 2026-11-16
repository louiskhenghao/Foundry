import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadPlaywright, locatePlaywright } from './playwright-load.ts';

describe('Playwright found where the install keeps it (ADR-0101)', () => {
  test('a checkout resolves the package the engine depends on, with its CLI', () => {
    const loc = locatePlaywright({ kind: 'checkout', root: '/unused', execDir: null });
    expect(loc).not.toBeNull();
    expect(existsSync(loc!.cli)).toBe(true);
    expect(existsSync(loc!.esm)).toBe(true);
    expect(loc!.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  test('a release reads <root>/node_modules/playwright, and says so when it is missing', () => {
    const root = mkdtempSync(join(tmpdir(), 'foundry-pw-'));
    try {
      const install = { kind: 'binary' as const, root, execDir: join(root, '..') };
      expect(locatePlaywright(install)).toBeNull();
      mkdirSync(join(root, 'node_modules', 'playwright'), { recursive: true });
      writeFileSync(join(root, 'node_modules', 'playwright', 'package.json'), JSON.stringify({ name: 'playwright', version: '9.9.9' }));
      expect(locatePlaywright(install)).toEqual({
        packageDir: join(root, 'node_modules', 'playwright'),
        main: join(root, 'node_modules', 'playwright', 'index.js'),
        esm: join(root, 'node_modules', 'playwright', 'index.mjs'),
        cli: join(root, 'node_modules', 'playwright', 'cli.js'),
        version: '9.9.9',
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('the module imported by path is Playwright', async () => {
    const pw = await loadPlaywright({ kind: 'checkout', root: '/unused', execDir: null });
    expect(typeof pw.chromium.launch).toBe('function');
    await expect(loadPlaywright({ kind: 'binary', root: '/nowhere', execDir: '/nowhere' })).rejects.toThrow(/not installed with Foundry/);
  });
});
