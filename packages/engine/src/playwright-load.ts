/**
 * Playwright, found where this install keeps it. A checkout resolves the package the engine depends on; a compiled binary
 * (ADR-0104) does not bundle it, because Playwright finds its browsers from its own files on disk, so a release carries the
 * package in `<root>/node_modules/playwright` and the engine imports it from there by path. One path for both, so that the
 * bundler never sees a literal `import('playwright')` to pull into the executable.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { installRoot, type InstallRoot } from './install-root.ts';

export interface PlaywrightLocation {
  packageDir: string;
  /** the package's main module, what a session's script `require`s */
  main: string;
  /** the ES module entry the engine imports */
  esm: string;
  /** Playwright's own CLI (`install chromium`) */
  cli: string;
  version: string;
}

export function locatePlaywright(install: InstallRoot = installRoot()): PlaywrightLocation | null {
  let pkgPath: string | null = null;
  if (install.kind === 'checkout') {
    try {
      pkgPath = Bun.resolveSync('playwright/package.json', import.meta.dir);
    } catch {
      pkgPath = null;
    }
  } else {
    const p = join(install.root, 'node_modules', 'playwright', 'package.json');
    pkgPath = existsSync(p) ? p : null;
  }
  if (!pkgPath) return null;
  const dir = dirname(pkgPath);
  let version = '?';
  try {
    version = String(JSON.parse(readFileSync(pkgPath, 'utf8')).version ?? '?');
  } catch {}
  return { packageDir: dir, main: join(dir, 'index.js'), esm: join(dir, 'index.mjs'), cli: join(dir, 'cli.js'), version };
}

export type Playwright = typeof import('playwright');

/** the module, imported by path: a compiled binary never bundles it and a checkout gets the same copy */
export async function loadPlaywright(install: InstallRoot = installRoot()): Promise<Playwright> {
  const loc = locatePlaywright(install);
  if (!loc) throw new Error(`Playwright is not installed with Foundry (expected under ${install.kind === 'checkout' ? 'packages/engine/node_modules' : join(install.root, 'node_modules')})`);
  return (await import(pathToFileURL(loc.esm).href)) as Playwright;
}
