import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BriefRun } from '@foundry/core';

/** the package manager a checkout uses, from its lockfile */
export function packageManager(ws: string): 'bun' | 'pnpm' | 'yarn' | 'npm' {
  if (existsSync(join(ws, 'bun.lock')) || existsSync(join(ws, 'bun.lockb'))) return 'bun';
  if (existsSync(join(ws, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(ws, 'yarn.lock'))) return 'yarn';
  return 'npm';
}

/**
 * How to start the result when the Brief did not say: read from package.json. Knows the port flags of the common dev
 * servers (Vite, Next, Expo); anything else gets PORT in the environment and must honour it. null = nothing startable.
 */
export function detectRun(ws: string): BriefRun | null {
  const file = join(ws, 'package.json');
  if (!existsSync(file)) return null;
  let pkg: { scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  try {
    pkg = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
  const pm = packageManager(ws);
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  const scripts = pkg.scripts ?? {};
  const install = existsSync(join(ws, 'node_modules')) ? null : `${pm} install`;
  const url = 'http://localhost:{port}';
  if (deps.expo) return { install, command: 'npx expo start --web --port {port}', url, platform: 'expo' };
  const script = scripts.dev ? 'dev' : scripts.start ? 'start' : null;
  if (!script) return null;
  const base = `${pm} run ${script}`;
  const args = script === 'dev' && deps.vite ? ' -- --port {port} --strictPort' : script === 'dev' && deps.next ? ' -- -p {port}' : '';
  return { install, command: base + args, url, platform: 'web' };
}
