import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BriefApp } from '@foundry/core';
import { ENV_FILES, parseDotenv } from './env.ts';

/**
 * The port an app listens on when a person runs it by hand. Other apps (and the app itself: an auth callback URL) name
 * it in their env files, so a preview that keeps it needs no rewiring. Read from, in order: a port in the script the
 * command runs (`next dev -p 3001`, `PORT=4000 node …`), PORT in the app's env files, a default in its server entry
 * (`process.env.PORT ?? 4000`, `listen(4000)`), then the framework's default. null = unknown.
 */
export function nativePort(ws: string, app: BriefApp): number | null {
  const dir = join(ws, app.dir);
  const pkg = readJson(join(dir, 'package.json'));
  const script = scriptOf(app.command ?? '', pkg?.scripts ?? {});
  const flagged = portIn(script ?? '');
  if (flagged) return flagged;
  const env = envFiles(ws, app.dir);
  const fromEnv = Number(env.PORT);
  if (Number.isInteger(fromEnv) && fromEnv > 0 && fromEnv < 65536) return fromEnv;
  for (const file of ENTRY_FILES) {
    const text = readText(join(dir, file));
    const m = text && (/\bPORT\b[^\n;]{0,30}?(?:\?\?|\|\|)\s*['"]?(\d{2,5})\b/.exec(text) ?? /\.listen\(\s*(\d{2,5})\b/.exec(text));
    if (m) return Number(m[1]);
  }
  const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };
  return FRAMEWORK_PORTS.find(([dep]) => dep in deps)?.[1] ?? null;
}

/** the default port of the dev servers Foundry detects, most specific first (Nuxt, Astro and SvelteKit also depend on Vite) */
const FRAMEWORK_PORTS: [string, number][] = [
  ['next', 3000],
  ['nuxt', 3000],
  ['astro', 4321],
  ['@sveltejs/kit', 5173],
  ['react-scripts', 3000],
  ['@angular/core', 4200],
  ['expo', 8081],
  ['vite', 5173],
];
const ENTRY_FILES = ['src/main.ts', 'src/index.ts', 'src/server.ts', 'src/app.ts', 'src/main.js', 'src/index.js', 'src/server.js', 'main.ts', 'index.ts', 'server.ts', 'main.js', 'index.js', 'server.js'];

/** the package.json script a run command starts (`pnpm run dev`, `npm start`, `bun dev`), or null */
function scriptOf(command: string, scripts: Record<string, string>): string | null {
  const m = /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?([\w:.-]+)/.exec(command);
  const name = m?.[1] === 'run' ? null : m?.[1];
  return name && scripts[name] ? scripts[name] : null;
}

/** a fixed port in a command line: `-p 3001`, `--port=3001`, `PORT=3001` */
function portIn(text: string): number | null {
  const m = /(?:(?:^|\s)(?:-p|--port)[\s=]+|\bPORT=)(\d{2,5})\b/.exec(text);
  return m ? Number(m[1]) : null;
}

/** the env files in an app's folder and the repository root, merged the way the app loads them (its own folder wins) */
export function envFiles(ws: string, dir: string): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const d of dir ? ['', dir] : ['']) for (const name of ENV_FILES) Object.assign(vars, parseDotenv(readText(join(ws, d, name)) ?? ''));
  return vars;
}

const LOCAL_URL = /\b(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]):(\d{2,5})\b/g;

/**
 * Values that point at an app's usual port while it runs on another one, rewritten to the port it got
 * (`http://localhost:4000/api` → `http://localhost:4201/api`). Only changed keys are returned.
 */
export function rewriteLocalPorts(vars: Record<string, string>, moved: Map<number, number>): { vars: Record<string, string>; changes: { key: string; from: number; to: number }[] } {
  const out: Record<string, string> = {};
  const changes: { key: string; from: number; to: number }[] = [];
  if (!moved.size) return { vars: out, changes };
  for (const [key, value] of Object.entries(vars)) {
    let changed = false;
    const next = value.replace(LOCAL_URL, (all, host: string, port: string) => {
      const to = moved.get(Number(port));
      if (to == null) return all;
      changed = true;
      if (!changes.some((c) => c.key === key && c.from === Number(port))) changes.push({ key, from: Number(port), to });
      return `${host}:${to}`;
    });
    if (changed) out[key] = next;
  }
  return { vars: out, changes };
}

function readJson(path: string): { scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> } | null {
  try {
    return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
  } catch {
    return null;
  }
}

function readText(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}
