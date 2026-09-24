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
 * The interface previews listen on, or null for the dev server's own default (loopback). In Docker a published port
 * only reaches a server that listens on every interface, so the image (FOUNDRY_DOCKER) gets 0.0.0.0; a local install
 * keeps its previews on localhost.
 */
export function previewBindHost(env: Record<string, string | undefined> = process.env): string | null {
  return env.FOUNDRY_DOCKER ? '0.0.0.0' : null;
}

/**
 * How to start the result when the Brief did not say: read from package.json. Knows the port flags of the common dev
 * servers (Vite, Next, Expo); anything else gets PORT in the environment and must honour it. With `host`, Vite and Next
 * are told to listen there too (Expo's web server already listens on every interface). null = nothing startable.
 */
export function detectRun(ws: string, opts: { host?: string | null } = {}): BriefRun | null {
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
  const host = opts.host;
  const args =
    script === 'dev' && deps.vite ? ` -- --port {port} --strictPort${host ? ` --host ${host}` : ''}` : script === 'dev' && deps.next ? ` -- -p {port}${host ? ` -H ${host}` : ''}` : '';
  return { install, command: base + args, url, platform: 'web' };
}
