/**
 * The platforms (ADR-0093): Fly.io, Railway and Render run the whole project — from its Dockerfile, or from its stack
 * where the platform builds one itself — with a preview beside production: a second app on Fly.io (`<name>-preview`),
 * a `preview` environment of the same project on Railway, a second service on Render. Fly.io and Railway take the
 * checkout from here, through their CLIs with a token in the environment; Render deploys from the repository's pushed
 * branch through its API with a key, so a Local only goal has nothing for it. The runtime variables kept for the place
 * (deploy/env.ts) go to the platform's own store before the deploy.
 *
 * What is written here is Foundry's and stays in the checkout: a `fly.foundry.toml` for the app being deployed; nothing
 * of the project changes, and nothing is committed back.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DeployPaasProvider, DeployServer } from '@foundry/core';
import { ENV_KEY } from '../preview/env.ts';
import type { DeployStep } from './providers.ts';
import { shellQuote } from './server.ts';

export type PaasProvider = DeployPaasProvider;
export const PAAS_PROVIDERS: PaasProvider[] = ['fly', 'railway', 'render'];
export const PAAS_LABEL: Record<PaasProvider, string> = { fly: 'Fly.io', railway: 'Railway', render: 'Render' };
/** the config Foundry writes for the Fly.io app being deployed (the app's name differs between preview and production) */
export const FLY_CONFIG = 'fly.foundry.toml';
export const RENDER_API = 'https://api.render.com/v1';

export type PaasRuntime = 'docker' | 'node' | 'python' | 'go' | 'ruby' | 'rust' | 'elixir';
export interface PaasApp {
  /** the project's folder, relative to the repository ('' = the repository) */
  dir: string;
  runtime: PaasRuntime;
  /** the port the project listens on, when a file says (a Dockerfile's EXPOSE, PORT in an env file) */
  port: number | null;
  /** a native runtime's build and start, as Render needs them; null for a Dockerfile */
  build: string | null;
  start: string | null;
  /** what the detection read, in words */
  from: string;
}
export type PaasDeployability = { ok: true; app: PaasApp; notes: string[] } | { ok: false; reason: string };

const read = (p: string) => {
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return '';
  }
};
const manager = (root: string) => (existsSync(join(root, 'bun.lock')) || existsSync(join(root, 'bun.lockb')) ? 'bun' : existsSync(join(root, 'pnpm-lock.yaml')) ? 'pnpm' : existsSync(join(root, 'yarn.lock')) ? 'yarn' : 'npm');
/** the `web:` line of a Procfile, if one */
const procfileWeb = (root: string) => read(join(root, 'Procfile')).match(/^web:\s*(.+)$/m)?.[1]?.trim() ?? null;
/** the port a project's files name */
function filePort(root: string): number | null {
  const d = read(join(root, 'Dockerfile')).match(/^\s*EXPOSE\s+(\d+)/im);
  if (d) return Number(d[1]);
  for (const f of ['.env.production', '.env', '.env.example', '.env.sample']) {
    const m = read(join(root, f)).match(/^\s*(?:export\s+)?PORT\s*=\s*"?(\d{2,5})"?\s*$/m);
    if (m) return Number(m[1]);
  }
  return null;
}

/**
 * What a repository is for a platform: a Dockerfile (any platform builds it), else its stack — Node.js with a start
 * script, Python, Go, Ruby, Rust, Elixir — which Fly.io and Railway build themselves; Render needs a build and a start
 * command for a native runtime, read from package.json or a Procfile, else a Dockerfile.
 */
export function paasDeployability(root: string, provider: PaasProvider, dir = ''): PaasDeployability {
  const at = join(root, dir);
  const port = filePort(at);
  const notes: string[] = [];
  if (existsSync(join(at, 'Dockerfile'))) {
    if (port == null && provider === 'fly') notes.push('The Dockerfile exposes no port: the app is told to listen on 8080 (Fly.io’s default).');
    return { ok: true, app: { dir, runtime: 'docker', port, build: null, start: null, from: 'the Dockerfile' }, notes };
  }
  if (provider === 'fly') return { ok: false, reason: 'Fly.io deploys here from a Dockerfile, and the project has none: add one (the follow-up goal on the card writes it), or deploy to Railway, which builds from the stack itself' };
  const pkg = read(join(at, 'package.json'));
  if (pkg) {
    let scripts: Record<string, string> = {};
    try {
      scripts = (JSON.parse(pkg) as { scripts?: Record<string, string> }).scripts ?? {};
    } catch {}
    const pm = manager(at);
    const start = scripts.start ? `${pm} start` : procfileWeb(at);
    if (!start && provider === 'render') return { ok: false, reason: 'Render starts a Node.js project with its start script, and package.json has none (nor a Procfile `web:` line): add `"start"` to its scripts, or a Dockerfile' };
    const install = pm === 'npm' ? (existsSync(join(at, 'package-lock.json')) ? 'npm ci' : 'npm install') : `${pm} install`;
    return { ok: true, app: { dir, runtime: 'node', port, build: scripts.build ? `${install} && ${pm} run build` : install, start, from: 'package.json' }, notes };
  }
  const stacks: [string, PaasRuntime, string | null, string | null][] = [
    ['requirements.txt', 'python', 'pip install -r requirements.txt', procfileWeb(at)],
    ['pyproject.toml', 'python', 'pip install .', procfileWeb(at)],
    ['go.mod', 'go', 'go build -o app .', './app'],
    ['Gemfile', 'ruby', 'bundle install', procfileWeb(at) ?? 'bundle exec rackup -p $PORT'],
    ['Cargo.toml', 'rust', 'cargo build --release', procfileWeb(at)],
    ['mix.exs', 'elixir', 'mix deps.get && mix compile', procfileWeb(at)],
  ];
  for (const [file, runtime, build, start] of stacks) {
    if (!existsSync(join(at, file))) continue;
    if (provider === 'render' && !start) return { ok: false, reason: `Render needs a start command for a ${runtime} project: add a Procfile with a \`web:\` line, or a Dockerfile` };
    return { ok: true, app: { dir, runtime, port, build, start, from: file }, notes };
  }
  return { ok: false, reason: 'no Dockerfile and no known stack (package.json, requirements.txt, pyproject.toml, go.mod, Gemfile, Cargo.toml, mix.exs): add a Dockerfile — the follow-up goal on the card writes one' };
}

/** the app, environment or service a deploy goes to: production under the project's name, the preview beside it */
export const paasTarget = (provider: PaasProvider, name: string, production: boolean) => (provider === 'railway' ? { project: name, service: name, environment: production ? 'production' : 'preview' } : { project: name, service: production ? name : `${name}-preview`, environment: production ? 'production' : 'preview' });

/** Foundry's fly.toml for the app being deployed: the Dockerfile, the port it listens on, a small machine that stops when idle */
export function flyConfig(app: string, region: string, port: number | null): string {
  return `# written by Foundry (Deploy): the app ${app}, built from the repository's Dockerfile; run the deploy again to change it\napp = "${app}"\nprimary_region = "${region}"\n\n[build]\n\n[http_service]\n  internal_port = ${port ?? 8080}\n  force_https = true\n  auto_stop_machines = "stop"\n  auto_start_machines = true\n  min_machines_running = 0\n\n[[vm]]\n  size = "shared-cpu-1x"\n  memory = "256mb"\n`;
}

export interface PaasCredentials {
  flyToken: string | null;
  flyOrg: string | null;
  flyRegion: string;
  railwayToken: string | null;
  railwayWorkspace: string | null;
  renderApiKey: string | null;
  renderOwner: string | null;
  renderRegion: string;
  renderPlan: string;
}
export const paasConfigured = (p: PaasProvider, c: PaasCredentials) => (p === 'fly' ? !!c.flyToken : p === 'railway' ? !!c.railwayToken : !!c.renderApiKey);

export interface PaasPlanInput {
  provider: PaasProvider;
  /** the folder the project is in (the checkout, or its app folder) */
  cwd: string;
  app: PaasApp;
  name: string;
  production: boolean;
  credentials: PaasCredentials;
  /** the runtime variables kept for the place, to the platform's own store first */
  vars: Record<string, string>;
  /** how a CLI is run: Fly.io's binary, Railway's package through npx */
  cli: (p: 'fly' | 'railway') => string[];
}

/** non-interactive everywhere: no prompt can wait for a person who is not there */
const QUIET = { CI: '1', NO_COLOR: '1' };
const envLines = (vars: Record<string, string>) =>
  Object.entries(vars)
    .filter(([k]) => ENV_KEY.test(k))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n')
    .concat('\n');

/**
 * The commands a Fly.io or Railway deploy runs, in order. Fly.io: the app made (once), the variables staged as secrets,
 * the deploy from the checkout, the hostname read. Railway: the project linked (made with its service when it is not
 * there), the environment, the variables, the deploy, the domain. Render goes through its API (renderDeploy).
 */
export function paasSteps(i: PaasPlanInput): DeployStep[] {
  const c = i.credentials;
  const t = paasTarget(i.provider, i.name, i.production);
  const at = (label: string, argv: string[], env: Record<string, string> = {}, okIf?: RegExp, stdin?: string): DeployStep => ({ label, argv, env: { ...QUIET, ...env }, cwd: i.cwd, ...(okIf ? { okIf } : {}), ...(stdin != null ? { stdin } : {}) });
  const hasVars = Object.keys(i.vars).length > 0;
  switch (i.provider) {
    case 'fly': {
      const env = { FLY_API_TOKEN: c.flyToken ?? '', FLY_NO_UPDATE_CHECK: '1' };
      const fly = i.cli('fly');
      return [
        at(`make the Fly.io app ${t.service} (once)`, [...fly, 'apps', 'create', t.service, ...(c.flyOrg ? ['--org', c.flyOrg] : []), '--json'], env, /already been taken|already exists/i),
        ...(hasVars ? [at('stage the runtime variables as secrets', [...fly, 'secrets', 'import', '-a', t.service, '--stage'], env, undefined, envLines(i.vars))] : []),
        at(`deploy to Fly.io (${t.service})`, [...fly, 'deploy', '--config', FLY_CONFIG, '-a', t.service, '--remote-only', '--yes', '--ha=false'], env),
        at('read the address', [...fly, 'status', '-a', t.service, '--json'], env),
      ];
    }
    case 'railway': {
      const env = { RAILWAY_API_TOKEN: c.railwayToken ?? '' };
      const rw = i.cli('railway');
      const ws = c.railwayWorkspace ? ['-w', c.railwayWorkspace] : [];
      // quoted only where a shell would read something into it, so the card shows the line as a person would type it
      const q = (a: string[]) => a.map((x) => (/^[A-Za-z0-9_@%+=:,./-]+$/.test(x) ? x : shellQuote(x))).join(' ');
      // the project and its service exist after the first deploy: link them, else make them (one line, so the card shows it whole)
      const link = `${q([...rw, 'link', '-p', t.project, '-e', 'production', '-s', t.service, ...ws, '--json'])} || (${q([...rw, 'init', '--name', t.project, ...ws, '--json'])} && ${q([...rw, 'add', '--service', t.service, '--json'])})`;
      return [
        at(`link the Railway project ${t.project} (made with its service when new)`, ['sh', '-c', link], env),
        ...(i.production ? [] : [at('the preview environment (once)', [...rw, 'environment', 'new', 'preview', '--json'], env, /already exists|already taken/i)]),
        at(`work in the ${t.environment} environment`, [...rw, 'environment', t.environment], env),
        ...(hasVars ? [at('set the runtime variables', [...rw, 'variable', 'set', ...Object.entries(i.vars).filter(([k]) => ENV_KEY.test(k)).map(([k, v]) => `${k}=${v}`), '-s', t.service, '-e', t.environment, '--skip-deploys', '--json'], env)] : []),
        at(`deploy to Railway (${t.service}, ${t.environment})`, [...rw, 'up', '--ci', '--service', t.service, '--environment', t.environment, '--json'], env),
        at('the public domain (made once)', [...rw, 'domain', '-s', t.service, '-e', t.environment, '--json'], env),
      ];
    }
    case 'render':
      return [];
  }
}

/** the address a Fly.io or Railway deploy ended with, from the last command's output */
export function paasUrl(provider: PaasProvider, stdout: string): string | null {
  const json = (() => {
    const start = stdout.indexOf('{');
    const end = stdout.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(stdout.slice(start, end + 1)) as Record<string, unknown>;
    } catch {
      return null;
    }
  })();
  if (provider === 'fly') {
    const host = typeof json?.Hostname === 'string' ? json.Hostname : stdout.match(/([a-z0-9-]+\.fly\.dev)/i)?.[1];
    return host ? `https://${host.replace(/^https?:\/\//, '')}` : null;
  }
  if (provider === 'railway') {
    const domain = typeof json?.domain === 'string' ? json.domain : Array.isArray(json?.domains) ? String((json!.domains as unknown[])[0] ?? '') : (stdout.match(/https?:\/\/[^\s"']+/)?.[0] ?? null);
    return domain ? (domain.startsWith('http') ? domain : `https://${domain}`) : null;
  }
  return null;
}

/** what a platform's error means for Foundry's settings, when its own words do not say it */
export function paasFailureHint(provider: PaasProvider, out: string): string | null {
  if (provider === 'fly' && /not authorized|unauthorized|401|invalid token/i.test(out)) return 'Fly.io refused the token: set Settings → Git & delivery → Fly.io token to a deploy or org token (fly tokens create deploy)';
  if (provider === 'fly' && /Could not find App|app not found/i.test(out)) return 'the Fly.io app is not there: the first step makes it; check the Fly.io organization in Settings';
  if (provider === 'railway' && /Unauthorized|not logged in|invalid token/i.test(out)) return 'Railway refused the token: set Settings → Git & delivery → Railway token to an account or workspace token (railway.com/account/tokens), not a project token';
  if (provider === 'railway' && /workspace required|Multiple workspaces/i.test(out)) return 'the token reaches several Railway workspaces: set Settings → Git & delivery → Railway workspace to the one to use';
  return null;
}

/** the values a platform deploy's records never show: the tokens, and every runtime variable's value */
export const paasSecrets = (c: PaasCredentials, vars: Record<string, string>) => [c.flyToken, c.railwayToken, c.renderApiKey, ...Object.values(vars)].filter((v): v is string => !!v && v.length >= 6);

// ---------------------------------------------------------------------------------------------------------------------
// Render, through its API

export interface RenderCall {
  method: 'GET' | 'POST' | 'PUT';
  path: string;
  body?: unknown;
}
export type RenderFetch = (url: string, init: RequestInit) => Promise<Response>;
/** one call to Render's API with the key; the body parsed as JSON, or the text */
export async function renderApi(key: string, call: RenderCall, doFetch: RenderFetch = (u, i) => fetch(u, i)): Promise<{ status: number; data: unknown }> {
  const r = await doFetch(`${RENDER_API}${call.path}`, { method: call.method, headers: { authorization: `Bearer ${key}`, accept: 'application/json', ...(call.body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: call.body !== undefined ? JSON.stringify(call.body) : undefined, signal: AbortSignal.timeout(60_000) });
  const text = await r.text();
  let data: unknown = text;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {}
  return { status: r.status, data };
}

export interface RenderServiceSpec {
  name: string;
  ownerId: string;
  repo: string;
  branch: string;
  rootDir: string;
  app: PaasApp;
  region: string;
  plan: string;
  vars: Record<string, string>;
}
/** the body that makes a Render web service from the repository's branch (no auto-deploy: Foundry deploys the commit it means) */
export function renderServiceBody(s: RenderServiceSpec): Record<string, unknown> {
  const native = s.app.runtime !== 'docker';
  return {
    type: 'web_service',
    name: s.name,
    ownerId: s.ownerId,
    repo: s.repo,
    branch: s.branch,
    autoDeploy: 'no',
    rootDir: s.rootDir || undefined,
    envVars: Object.entries(s.vars).filter(([k]) => ENV_KEY.test(k)).map(([key, value]) => ({ key, value })),
    serviceDetails: {
      env: s.app.runtime,
      region: s.region,
      plan: s.plan,
      envSpecificDetails: native ? { buildCommand: s.app.build ?? '', startCommand: s.app.start ?? '' } : { dockerfilePath: './Dockerfile' },
    },
  };
}

/** the repository's GitHub address as Render wants it (https), from the remote git names */
export function renderRepoUrl(remote: string | null): string | null {
  if (!remote) return null;
  const m = remote.trim().match(/^(?:git@github\.com:|https?:\/\/github\.com\/|ssh:\/\/git@github\.com\/)([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/);
  return m ? `https://github.com/${m[1]}` : null;
}

/** a Render deploy's terminal states */
export const RENDER_DONE = new Set(['live', 'build_failed', 'update_failed', 'canceled', 'deactivated']);

/** unused here but kept with the platforms: a server's shape is not a platform's */
export type _Server = DeployServer;
