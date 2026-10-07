import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { BriefApp, BriefRun } from '@foundry/core';

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
  const pkg = readPackage(ws);
  if (!pkg) return null;
  const run = runFor(pkg, packageManager(ws), opts.host ?? null);
  return run ? { install: existsSync(join(ws, 'node_modules')) ? null : `${packageManager(ws)} install`, ...run } : null;
}

type Pkg = { name?: string; workspaces?: string[] | { packages?: string[] }; scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> };

function readPackage(dir: string): Pkg | null {
  const file = join(dir, 'package.json');
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** the dev-server command of one package.json, with the port flags the common dev servers need */
function runFor(pkg: Pkg, pm: string, host: string | null): Omit<BriefRun, 'install'> | null {
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  const scripts = pkg.scripts ?? {};
  const url = 'http://localhost:{port}';
  if (deps.expo) return { command: 'npx expo start --web --port {port}', url, platform: 'expo' };
  const script = scripts.dev ? 'dev' : scripts.start ? 'start' : null;
  if (!script) return null;
  // pnpm hands a literal `--` on to the script, where Next takes the `-p` after it for its project directory
  const sep = pm === 'pnpm' ? '' : ' --';
  const args =
    script === 'dev' && deps.vite ? `${sep} --port {port} --strictPort${host ? ` --host ${host}` : ''}` : script === 'dev' && deps.next ? `${sep} -p {port}${host ? ` -H ${host}` : ''}` : '';
  return { command: `${pm} run ${script}${args}`, url, platform: 'web' };
}

/**
 * A run command as the package manager it names expects it. pnpm (7+) passes the `--` of `pnpm run dev -- -p 4200` on
 * to the script, unlike npm, yarn and bun, so `next dev -- -p 4200` takes `-p` for its project directory. Commands
 * written for npm (a Brief, an older detection) drop that `--` when they run through pnpm.
 */
export function forPackageManager(command: string): string {
  return command
    .split(/(\s*(?:&&|\|\||;)\s*)/)
    .map((part) => (/^pnpm\s/.test(part) ? part.replace(/\s--(?=\s|$)/, '') : part))
    .join('');
}

/** dependencies that make a workspace package something a person runs, not a library */
const FRONT_DEPS = ['vite', 'next', 'expo', 'nuxt', 'astro', '@remix-run/dev', '@sveltejs/kit', 'react-scripts', '@angular/core'];
const APP_DEPS = [...FRONT_DEPS, '@nestjs/core', 'express', 'fastify', 'hono', 'koa'];

/**
 * The apps of a monorepo, each started in its own folder: package.json `workspaces` or pnpm-workspace.yaml packages
 * that have a dev/start script and either live under `apps/` or depend on an app framework (libraries with a watch
 * script stay out). Empty when the repository is not a workspace or none of its packages is an app.
 */
export function detectApps(ws: string, opts: { host?: string | null } = {}): BriefApp[] {
  const root = readPackage(ws);
  const patterns = [...(Array.isArray(root?.workspaces) ? root.workspaces : (root?.workspaces?.packages ?? [])), ...pnpmPackages(ws)];
  if (!patterns.length) return [];
  const pm = packageManager(ws);
  const dirs = new Set<string>();
  for (const pattern of patterns) {
    if (pattern.startsWith('!')) continue;
    const glob = new Bun.Glob(`${pattern.replace(/\/+$/, '').replace(/\*\*$/, '*')}/package.json`);
    for (const file of glob.scanSync({ cwd: ws, onlyFiles: true })) if (!file.includes('node_modules')) dirs.add(dirname(file));
  }
  const apps: { app: BriefApp; rank: number }[] = [];
  for (const dir of [...dirs].sort()) {
    const pkg = readPackage(join(ws, dir));
    if (!pkg) continue;
    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    if (!dir.startsWith('apps/') && !APP_DEPS.some((d) => d in deps)) continue;
    const run = runFor(pkg, pm, opts.host ?? null);
    if (!run) continue;
    const base = (pkg.name ?? basename(dir)).replace(/^@[^/]+\//, '');
    let key = base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'app';
    while (apps.some((a) => a.app.key === key)) key += '-2';
    // the app a person looks at first: the web app, then other front ends, then servers
    const rank = /(^|\/)(web|app|site|frontend|client)$/.test(dir) ? 0 : run.platform === 'expo' ? 1 : FRONT_DEPS.some((d) => d in deps) ? 2 : 3;
    apps.push({ app: { key, name: base, dir, install: null, ...run }, rank });
  }
  return apps.sort((a, b) => a.rank - b.rank).map((a) => a.app);
}

function pnpmPackages(ws: string): string[] {
  const file = join(ws, 'pnpm-workspace.yaml');
  if (!existsSync(file)) return [];
  try {
    const doc = Bun.YAML.parse(readFileSync(file, 'utf8')) as { packages?: unknown };
    return Array.isArray(doc?.packages) ? doc.packages.filter((p): p is string => typeof p === 'string') : [];
  } catch {
    return [];
  }
}

/** a compose service the apps depend on (an image, not something built from this repository) and its published host ports */
export interface ComposeService {
  name: string;
  image: string;
  ports: number[];
}

const COMPOSE_FILES = ['compose.yaml', 'compose.yml', 'docker-compose.yml', 'docker-compose.yaml'].flatMap((f) => [f, `docker/${f}`]);

/**
 * The repository's compose file and its dependency services: databases, object storage, queues. Services built from
 * the repository (`build:`) are the apps themselves, which the preview runs natively, so they are left out.
 */
export function detectCompose(ws: string): { file: string; services: ComposeService[] } | null {
  const file = COMPOSE_FILES.find((f) => existsSync(join(ws, f)));
  if (!file) return null;
  let doc: { services?: Record<string, { image?: unknown; build?: unknown; ports?: unknown }> };
  try {
    doc = Bun.YAML.parse(readFileSync(join(ws, file), 'utf8')) as typeof doc;
  } catch {
    return null;
  }
  const services: ComposeService[] = [];
  for (const [name, svc] of Object.entries(doc?.services ?? {})) {
    if (!svc || typeof svc.image !== 'string' || svc.build) continue;
    services.push({ name, image: svc.image, ports: Array.isArray(svc.ports) ? svc.ports.flatMap(publishedPorts) : [] });
  }
  return services.length ? { file, services } : null;
}

/** host ports of one compose `ports` entry: "5432:5432", "127.0.0.1:9000-9001:9000-9001", "${PG_PORT:-5433}:5432", { published: 5432 } */
export function publishedPorts(entry: unknown): number[] {
  if (entry && typeof entry === 'object') {
    const p = Number((entry as { published?: unknown }).published);
    return Number.isInteger(p) && p > 0 ? [p] : [];
  }
  const text = String(entry).replace(/\$\{[^}:]+:-([^}]+)\}/g, '$1').replace(/\/(tcp|udp)$/, '');
  const parts = text.split(':');
  if (parts.length < 2) return []; // container port only: Docker picks the host port
  const host = parts[parts.length - 2]!;
  const [from, to] = host.split('-').map(Number);
  if (!Number.isInteger(from)) return [];
  const last = Number.isInteger(to) ? to! : from!;
  return Array.from({ length: Math.max(0, last - from! + 1) }, (_, i) => from! + i);
}
