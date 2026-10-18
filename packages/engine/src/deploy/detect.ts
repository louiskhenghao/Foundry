/**
 * Whether a repository is something Foundry deploys (ADR-0041): a web page or an all-in-one web app — a folder of
 * pages, a site or single-page app a build turns into files, or a full-stack web framework the hosts run (Next.js,
 * Nuxt, SvelteKit, Astro, Remix…). A worker in Docker, a backend deployed apart from its front end, or a custom server
 * is not: the hosts do not run those, and half a system deployed is a broken one. The reason is said in words either way.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { packageManager } from '../preview/detect.ts';
import type { AppKind } from './providers.ts';

export interface WebApp {
  /** the app's folder, relative to the repository ('' = the repository itself) */
  dir: string;
  framework: string;
  kind: AppKind;
  install: string[] | null;
  build: string[] | null;
  /** where its build leaves the files, relative to `dir` ('.' for a folder of pages as it is) */
  outputDir: string;
}

export type Deployability = { ok: true; app: WebApp; notes: string[] } | { ok: false; reason: string };

type Pkg = { name?: string; dependencies?: Record<string, string>; devDependencies?: Record<string, string>; scripts?: Record<string, string>; workspaces?: unknown };

/** frameworks the hosts render on a server */
const SSR: [string, string][] = [
  ['next', 'Next.js'],
  ['nuxt', 'Nuxt'],
  ['@remix-run/react', 'Remix'],
  ['@react-router/dev', 'React Router'],
  ['@solidjs/start', 'SolidStart'],
  ['@tanstack/react-start', 'TanStack Start'],
  ['@analogjs/platform', 'Analog'],
];
/** frameworks whose build leaves files, and where */
const BUILT: [string, string, string][] = [
  ['gatsby', 'Gatsby', 'public'],
  ['@docusaurus/core', 'Docusaurus', 'build'],
  ['@11ty/eleventy', 'Eleventy', '_site'],
  ['react-scripts', 'Create React App', 'build'],
  ['@angular/core', 'Angular', 'dist'],
  ['vitepress', 'VitePress', '.vitepress/dist'],
  ['vite', 'Vite', 'dist'],
  ['parcel', 'Parcel', 'dist'],
];
/** a server of its own: a backend, or an app the hosts cannot run as it is */
const SERVERS = ['express', 'fastify', 'koa', '@nestjs/core', '@hapi/hapi', 'restify', '@hono/node-server', 'elysia', 'socket.io', 'bullmq', 'bull', 'amqplib', 'kafkajs'];
/** a backend in another language, by the file that marks it */
const OTHER_BACKENDS: [string, string][] = [
  ['go.mod', 'Go'],
  ['Cargo.toml', 'Rust'],
  ['pom.xml', 'Java'],
  ['build.gradle', 'Java'],
  ['Gemfile', 'Ruby'],
  ['requirements.txt', 'Python'],
  ['pyproject.toml', 'Python'],
  ['manage.py', 'Django'],
  ['composer.json', 'PHP'],
];
/** folders a repository keeps its apps in */
const APP_FOLDERS = ['apps', 'packages', 'services', 'web', 'frontend', 'client', 'site', 'www', 'server', 'backend', 'api', 'worker', 'workers'];

function readPkg(dir: string): Pkg | null {
  try {
    return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as Pkg;
  } catch {
    return null;
  }
}
const deps = (p: Pkg) => ({ ...(p.dependencies ?? {}), ...(p.devDependencies ?? {}) });
const isDir = (p: string) => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};
const read = (p: string) => {
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return '';
  }
};

/** what one folder with a package.json is: a web app (and which), a server, or neither */
function classify(root: string, dir: string, pkg: Pkg): { web: WebApp | null; server: string | null } {
  const d = deps(pkg);
  const has = (n: string) => n in d;
  const server = SERVERS.find(has) ?? null;
  const pm = packageManager(root);
  const install = [pm, 'install'];
  const build = pkg.scripts?.build ? [pm, 'run', 'build'] : null;
  const abs = join(root, dir);
  const ssr = SSR.find(([n]) => has(n));
  if (ssr) {
    // a Next.js app that exports files, a SvelteKit app with the static adapter: files after all
    const nextExport = ssr[0] === 'next' && /output\s*:\s*['"]export['"]/.test(read(join(abs, 'next.config.js')) + read(join(abs, 'next.config.mjs')) + read(join(abs, 'next.config.ts')));
    return { web: { dir, framework: ssr[1], kind: nextExport ? 'built' : 'ssr', install, build, outputDir: nextExport ? 'out' : '.' }, server };
  }
  if (has('@sveltejs/kit')) return { web: { dir, framework: 'SvelteKit', kind: has('@sveltejs/adapter-static') ? 'built' : 'ssr', install, build, outputDir: 'build' }, server };
  if (has('astro')) {
    const adapter = Object.keys(d).some((n) => /^@astrojs\/(node|vercel|netlify|cloudflare)$/.test(n));
    return { web: { dir, framework: 'Astro', kind: adapter ? 'ssr' : 'built', install, build, outputDir: 'dist' }, server };
  }
  // a library built with Vite or Parcel (a monorepo's components) is no app: an app has a page to start from
  const page = existsSync(join(abs, 'index.html')) || existsSync(join(abs, 'src', 'index.html'));
  const built = BUILT.find(([n]) => has(n) && (page || (n !== 'vite' && n !== 'parcel')));
  if (built && build) return { web: { dir, framework: built[1], kind: 'built', install, build, outputDir: built[2] }, server };
  return { web: null, server };
}

/** the folders of a repository that hold an app: the repository itself and one or two levels under the usual app folders */
function appFolders(root: string): string[] {
  const out: string[] = [''];
  for (const top of APP_FOLDERS) {
    const p = join(root, top);
    if (!isDir(p)) continue;
    if (existsSync(join(p, 'package.json')) || OTHER_BACKENDS.some(([f]) => existsSync(join(p, f)))) out.push(top);
    let names: string[] = [];
    try {
      names = readdirSync(p);
    } catch {}
    for (const n of names.sort()) if (!n.startsWith('.') && n !== 'node_modules' && isDir(join(p, n))) out.push(`${top}/${n}`);
  }
  return out;
}

/** services the repository builds and runs in Docker (a compose service with `build:`), and whether a Procfile runs a worker */
function ownServices(root: string): string[] {
  const out: string[] = [];
  for (const f of ['compose.yaml', 'compose.yml', 'docker-compose.yml', 'docker-compose.yaml']) {
    if (!existsSync(join(root, f))) continue;
    try {
      const doc = Bun.YAML.parse(read(join(root, f))) as { services?: Record<string, { build?: unknown }> };
      for (const [name, svc] of Object.entries(doc?.services ?? {})) if (svc?.build) out.push(name);
    } catch {}
  }
  if (/^worker\s*:/m.test(read(join(root, 'Procfile')))) out.push('worker (Procfile)');
  return out;
}

/** dependency services a compose file starts (databases, queues): the deployed app needs its own on the host */
function composeImages(root: string): string[] {
  for (const f of ['compose.yaml', 'compose.yml', 'docker-compose.yml', 'docker-compose.yaml']) {
    if (!existsSync(join(root, f))) continue;
    try {
      const doc = Bun.YAML.parse(read(join(root, f))) as { services?: Record<string, { image?: unknown; build?: unknown }> };
      return Object.entries(doc?.services ?? {}).flatMap(([name, svc]) => (svc && typeof svc.image === 'string' && !svc.build ? [name] : []));
    } catch {}
  }
  return [];
}

export function deployability(root: string): Deployability {
  const webs: WebApp[] = [];
  const backends: string[] = [];
  for (const dir of appFolders(root)) {
    const abs = join(root, dir);
    const pkg = readPkg(abs);
    if (pkg) {
      const c = classify(root, dir, pkg);
      if (c.web && c.server) return { ok: false, reason: `${dir || 'the project'} runs a server of its own (${c.server}) beside ${c.web.framework}: the hosts run web frameworks, not a custom server. Foundry deploys web pages and all-in-one web apps only.` };
      if (c.web) webs.push(c.web);
      else if (c.server) backends.push(`${dir || 'the project'} (${c.server})`);
      continue;
    }
    const other = OTHER_BACKENDS.find(([f]) => existsSync(join(abs, f)));
    if (other && dir) backends.push(`${dir} (${other[1]})`);
  }
  const services = ownServices(root);
  if (services.length) return { ok: false, reason: `the project runs services of its own in Docker or as workers (${services.join(', ')}): Foundry deploys web pages and all-in-one web apps only, never workers.` };
  if (backends.length) return { ok: false, reason: `the project has a backend deployed apart from its pages (${backends.join(', ')}): Foundry deploys web pages and all-in-one web apps only, never a separate backend.` };
  if (webs.length > 1) return { ok: false, reason: `the project has several web apps (${webs.map((w) => w.dir || 'the repository').join(', ')}): Foundry deploys a repository with one.` };
  const notes: string[] = [];
  const images = composeImages(root);
  if (images.length) notes.push(`The compose file also starts ${images.join(', ')}: the deployed app needs its own on the host (set its connection in the host's environment).`);
  if (existsSync(join(root, 'Dockerfile')) && webs.length) notes.push('The Dockerfile is not used: the host builds the app its own way.');
  if (webs.length === 1) return { ok: true, app: webs[0]!, notes };
  // a folder of pages: an index.html and no build of its own
  if (!readPkg(root) && existsSync(join(root, 'index.html'))) return { ok: true, app: { dir: '', framework: 'static pages', kind: 'static', install: null, build: null, outputDir: '.' }, notes };
  if (readPkg(root) && existsSync(join(root, 'index.html')) && !readPkg(root)?.scripts?.build) return { ok: true, app: { dir: '', framework: 'static pages', kind: 'static', install: null, build: null, outputDir: '.' }, notes };
  return { ok: false, reason: 'no web app found: Foundry deploys a folder of pages, a site or single-page app built with a known tool, or a full-stack web framework (Next.js, Nuxt, SvelteKit, Astro, Remix…).' };
}
