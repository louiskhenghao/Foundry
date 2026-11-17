/**
 * The earlier installs on this computer, found rather than named (ADR-0107): source checkouts the installer recorded,
 * a checkout's launchd agent or systemd unit, the Foundry processes running from a checkout (with the data folder each
 * holds open), and Docker containers made from the Foundry image. Each says where it is, whether it runs, its goals
 * and its last activity, read from its database without writing to it.
 */
import type { AgentProvider } from '@foundry/core';
import { Database } from 'bun:sqlite';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { foundryHome, readHomeConfig } from '../data-dir.ts';
import { folderProvider, isFoundryFolder, parseInstallEnv, SOURCE_SERVICE_LABEL } from '../migrate.ts';
import { localProbe, type Probe } from './probe.ts';

/** the image every Foundry container is made from; a container only named like it is not one */
export const FOUNDRY_IMAGE = 'imlouiskhenghao/foundry';
export const CHECKOUT_ENTRY = 'apps/cli/src/main.ts';
/** where the image keeps each provider's data folder */
export const CONTAINER_DATA: Record<string, AgentProvider> = { '/app/data': 'claude', '/app/data-codex': 'codex', '/app/data-agy': 'agy' };

export interface FolderCounts {
  goals: number;
  events: number;
  /** the time of the last event */
  last: string | null;
}

export interface EarlierFolder {
  provider: AgentProvider;
  /** a folder of this computer; for Docker, the container's path */
  path: string;
  counts: FolderCounts | null;
  /** a MOVED.md says this folder went elsewhere already */
  moved: boolean;
  /** the folder chosen in Settings (~/.foundry/config.json): opened where it is, not copied */
  chosen: boolean;
}

export interface DockerMount {
  type: string;
  name: string | null;
  source: string;
  destination: string;
}

export interface DockerFacts {
  container: string;
  image: string;
  imageId: string;
  restart: string;
  mounts: DockerMount[];
  /** the compose project's folder, where its .env is */
  composeDir: string | null;
  /** the watchtower of the same compose project, stopped with it */
  watchtower: string | null;
}

export interface EarlierInstall {
  /** source:<checkout> or docker:<container> */
  id: string;
  kind: 'source' | 'docker';
  /** the checkout's folder, or the container's name */
  where: string;
  version: string | null;
  /** the installer's install.env names it */
  recorded: boolean;
  running: { pid: number | null; how: 'launchd' | 'systemd' | 'process' | 'container' } | null;
  /** the port its page is on (a container's published one) */
  port: number | null;
  /** its page, when it answers now */
  url: string | null;
  folders: EarlierFolder[];
  /** the goals in the folders not moved yet */
  goals: number;
  last: string | null;
  /** what it read from its environment: its service, its .env, a compose project's .env */
  env: Record<string, string>;
  docker: DockerFacts | null;
}

export interface Found {
  installs: EarlierInstall[];
  /** what could not be looked at, said plainly (Docker not running…) */
  notes: string[];
}

/** a data folder's goals and events, read without writing (another Foundry may hold it open) */
export function countFolder(dir: string): FolderCounts | null {
  const file = join(dir, 'engine.db');
  try {
    const db = new Database(file, { readonly: true });
    try {
      const n = (sql: string) => Number((db.query(sql).get() as { n: number | null } | null)?.n ?? 0);
      const last = (db.query('SELECT max(ts) AS t FROM events').get() as { t: string | null } | null)?.t ?? null;
      return { goals: n('SELECT count(*) AS n FROM goals'), events: n('SELECT count(*) AS n FROM events'), last };
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

/** `ps` output: pid and command line */
export function parsePs(text: string): { pid: number; command: string }[] {
  const out: { pid: number; command: string }[] = [];
  for (const line of text.split('\n')) {
    const m = /^\s*(\d+)\s+(.+)$/.exec(line);
    if (m) out.push({ pid: Number(m[1]), command: m[2]!.trim() });
  }
  return out;
}

/** a Foundry server run from a checkout: `bun [--watch] [path/]apps/cli/src/main.ts serve` */
export const isCheckoutServe = (command: string) => command.includes(CHECKOUT_ENTRY) && /\sserve(\s|$)/.test(command.slice(command.indexOf(CHECKOUT_ENTRY)));

/** the checkout a command runs from: the path written before the entry point, else the process's folder */
export function checkoutOf(command: string, cwd: string | null): string | null {
  const m = /(\S*)apps\/cli\/src\/main\.ts/.exec(command);
  if (!m) return null;
  const before = m[1]!.replace(/^['"]/, '');
  if (isAbsolute(before)) return resolve(before);
  return cwd ? resolve(cwd, before || '.') : null;
}

/** `lsof -F n` output: the names */
export const lsofNames = (text: string) => text.split('\n').filter((l) => l.startsWith('n')).map((l) => l.slice(1));

/** the port of a listening socket lsof names: `*:4111`, `127.0.0.1:4111`, `[::1]:4111` */
export function listenPort(names: string[]): number | null {
  for (const n of names) {
    const m = /:(\d+)$/.exec(n);
    if (m) return Number(m[1]);
  }
  return null;
}

/** a .env file: KEY=value lines, `export` allowed, quotes taken off */
export function parseDotenv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split('\n')) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(raw);
    if (!m || raw.trim().startsWith('#')) continue;
    let v = m[2]!;
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, '');
    out[m[1]!] = v;
  }
  return out;
}

/** a systemd unit's working folder, command and environment */
export function parseUnit(text: string): { dir: string | null; exec: string; env: Record<string, string> } {
  let dir: string | null = null;
  let exec = '';
  const env: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const [k, ...rest] = line.split('=');
    const v = rest.join('=').trim();
    if (k?.trim() === 'WorkingDirectory') dir = v;
    else if (k?.trim() === 'ExecStart') exec = v;
    else if (k?.trim() === 'Environment') {
      for (const pair of v.match(/"[^"]*"|\S+/g) ?? []) {
        const p = pair.replace(/^"|"$/g, '');
        const i = p.indexOf('=');
        if (i > 0) env[p.slice(0, i)] = p.slice(i + 1);
      }
    }
  }
  return { dir, exec, env };
}

/** what an earlier install read from its environment and a move may carry: never the address, the folder or the supervisor's own */
const NOT_CARRIED = new Set(['PATH', 'HOME', 'FOUNDRY_PORT', 'FOUNDRY_HOST', 'FOUNDRY_DATA_DIR', 'FOUNDRY_HOME', 'FOUNDRY_SUPERVISED', 'FOUNDRY_ROOT', 'FOUNDRY_APP_SHELL', 'FOUNDRY_DOCKER', 'FOUNDRY_REPOS', 'FOUNDRY_WATCHTOWER_URL', 'FOUNDRY_WATCHTOWER_TOKEN', 'FOUNDRY_HOST_DOCKER', 'FOUNDRY_CONTAINER', 'INVOCATION_ID']);
const carried = (env: Record<string, string>) => Object.fromEntries(Object.entries(env).filter(([k, v]) => v !== '' && !NOT_CARRIED.has(k) && /^(FOUNDRY_|HINDSIGHT_|CODEX_HOME$|CLAUDE_CONFIG_DIR$)/.test(k)));

const providerOf = (dir: string): AgentProvider => folderProvider(dir) ?? (dir.endsWith('-codex') ? 'codex' : dir.endsWith('-agy') ? 'agy' : 'claude');
const latest = (a: string | null, b: string | null) => (!a ? b : !b ? a : a > b ? a : b);

interface SourceSeen {
  recorded: boolean;
  /** pids running a Foundry from this checkout, with what each holds */
  procs: { pid: number; port: number | null; held: string[]; env: Record<string, string> }[];
  /** the checkout's service when it is loaded now */
  service: { how: 'launchd' | 'systemd'; pid: number | null } | null;
  /** what its service file sets, loaded or not */
  serviceEnv: Record<string, string>;
  port: number | null;
}

export async function findEarlierInstalls(opts: { probe?: Probe; exclude?: string[]; docker?: boolean } = {}): Promise<Found> {
  const probe = opts.probe ?? localProbe();
  const exclude = new Set((opts.exclude ?? []).map((p) => probe.real(resolve(p))));
  const notes: string[] = [];
  const installEnvFile = join(probe.env.XDG_CONFIG_HOME || join(probe.home, '.config'), 'foundry', 'install.env');
  const recorded = (() => {
    const t = probe.read(installEnvFile);
    return t ? parseInstallEnv(t) : null;
  })();
  const seen = new Map<string, SourceSeen>();
  const at = (dir: string): SourceSeen => {
    const key = probe.real(resolve(dir));
    let s = seen.get(key);
    if (!s) seen.set(key, (s = { recorded: false, procs: [], service: null, serviceEnv: {}, port: null }));
    return s;
  };

  if (recorded?.MODE === 'source' && recorded.DIR) {
    const s = at(recorded.DIR);
    s.recorded = true;
    if (Number(recorded.PORT) > 0) s.port = Number(recorded.PORT);
  }

  // the checkout's service, as the installer set it up
  if (probe.platform === 'darwin') {
    const plist = join(probe.home, 'Library', 'LaunchAgents', `${SOURCE_SERVICE_LABEL}.plist`);
    if (probe.exists(plist)) {
      const r = await probe.run(['plutil', '-convert', 'json', '-o', '-', plist], { timeoutMs: 5000 });
      try {
        const p = JSON.parse(r.stdout) as { WorkingDirectory?: string; ProgramArguments?: string[]; EnvironmentVariables?: Record<string, string> };
        if (p.WorkingDirectory && (p.ProgramArguments ?? []).join(' ').includes(CHECKOUT_ENTRY)) {
          const loaded = await probe.run(['launchctl', 'print', `gui/${probe.uid}/${SOURCE_SERVICE_LABEL}`], { timeoutMs: 5000 });
          const pid = loaded.code === 0 ? Number(/\bpid = (\d+)/.exec(loaded.stdout)?.[1] ?? 0) || null : null;
          const s = at(p.WorkingDirectory);
          if (loaded.code === 0) s.service = { how: 'launchd', pid };
          s.serviceEnv = p.EnvironmentVariables ?? {};
          const port = Number(s.serviceEnv.FOUNDRY_PORT ?? 0);
          if (port > 0) s.port ??= port;
        }
      } catch {}
    }
  } else {
    const unitFile = join(probe.env.XDG_CONFIG_HOME || join(probe.home, '.config'), 'systemd', 'user', 'foundry.service');
    const text = probe.read(unitFile);
    if (text) {
      const u = parseUnit(text);
      if (u.dir && u.exec.includes(CHECKOUT_ENTRY)) {
        const r = await probe.run(['systemctl', '--user', 'show', 'foundry.service', '-p', 'MainPID', '--value'], { timeoutMs: 5000 });
        const pid = Number(r.stdout.trim()) || null;
        const s = at(u.dir);
        if (pid) s.service = { how: 'systemd', pid };
        s.serviceEnv = u.env;
        if (Number(u.env.FOUNDRY_PORT) > 0) s.port ??= Number(u.env.FOUNDRY_PORT);
      }
    }
  }

  // the Foundries running from a checkout now: a service's, the installer's background one, one started by hand
  const ps = await probe.run(probe.platform === 'darwin' ? ['ps', '-axo', 'pid=,command='] : ['ps', '-eo', 'pid=,args='], { timeoutMs: 5000 });
  for (const { pid, command } of parsePs(ps.stdout)) {
    if (probe.self.includes(pid) || !isCheckoutServe(command)) continue;
    const facts = await processFacts(probe, pid);
    const checkout = checkoutOf(command, facts.cwd);
    if (!checkout || !probe.exists(join(checkout, CHECKOUT_ENTRY))) continue;
    const s = at(checkout);
    s.procs.push({ pid, port: facts.port, held: facts.held, env: facts.env });
  }

  const config = readHomeConfig(foundryHome(probe.env));
  const installs: EarlierInstall[] = [];
  for (const [checkout, s] of seen) {
    if (!probe.exists(join(checkout, CHECKOUT_ENTRY))) continue;
    const dirs = new Set<string>();
    for (const leaf of ['data', 'data-codex', 'data-agy']) if (isFoundryFolder(join(checkout, leaf))) dirs.add(probe.real(join(checkout, leaf)));
    for (const p of s.procs) for (const d of p.held) dirs.add(probe.real(d));
    const folders: EarlierFolder[] = [];
    for (const dir of dirs) {
      if (exclude.has(dir)) continue;
      const provider = providerOf(dir);
      const chosen = !!config.dataDirs[provider] && probe.real(resolve(config.dataDirs[provider]!)) === dir;
      folders.push({ provider, path: dir, counts: countFolder(dir), moved: probe.exists(join(dir, 'MOVED.md')), chosen });
    }
    if (!folders.length) continue;
    const proc = s.procs[0] ?? null;
    const running = s.service ? { pid: s.service.pid ?? proc?.pid ?? null, how: s.service.how } : proc ? { pid: proc.pid, how: 'process' as const } : null;
    const port = proc?.port ?? s.port ?? null;
    const url = port && running ? ((await probe.json(`http://127.0.0.1:${port}/api/health`)) ? `http://127.0.0.1:${port}` : null) : null;
    const dotenv = (() => {
      const t = probe.read(join(checkout, '.env'));
      return t ? parseDotenv(t) : {};
    })();
    const env = carried({ ...s.serviceEnv, ...dotenv, ...(proc?.env ?? {}) });
    const live = folders.filter((f) => !f.moved);
    installs.push({
      id: `source:${checkout}`,
      kind: 'source',
      where: checkout,
      version: (() => {
        try {
          return (JSON.parse(probe.read(join(checkout, 'package.json')) ?? '{}') as { version?: string }).version ?? null;
        } catch {
          return null;
        }
      })(),
      recorded: s.recorded,
      running,
      port,
      url,
      folders,
      goals: live.reduce((n, f) => n + (f.counts?.goals ?? 0), 0),
      last: live.reduce<string | null>((l, f) => latest(l, f.counts?.last ?? null), null),
      env,
      docker: null,
    });
  }

  if (opts.docker !== false) installs.push(...(await findContainers(probe, notes, recorded)));
  installs.sort((a, b) => Number(b.goals > 0) - Number(a.goals > 0) || Number(!!b.running) - Number(!!a.running) || (b.last ?? '').localeCompare(a.last ?? ''));
  return { installs, notes };
}

/** a running process's folder, the data folders it holds open, the port it listens on and (on Linux) its environment */
async function processFacts(probe: Probe, pid: number): Promise<{ cwd: string | null; held: string[]; port: number | null; env: Record<string, string> }> {
  const procDir = `/proc/${pid}`;
  if (probe.platform === 'linux' && probe.exists(procDir)) {
    const cwd = probe.real(`${procDir}/cwd`);
    const fds = await probe.run(['sh', '-c', `for f in ${procDir}/fd/*; do readlink "$f"; done`], { timeoutMs: 5000 });
    const held = fds.stdout.split('\n').filter((p) => p.endsWith('/engine.db')).map((p) => dirname(p));
    const environ = probe.read(`${procDir}/environ`) ?? '';
    const env = Object.fromEntries(environ.split('\0').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
    const lsof = await probe.run(['lsof', '-a', '-p', String(pid), '-iTCP', '-sTCP:LISTEN', '-Fn', '-P'], { timeoutMs: 5000 });
    return { cwd: cwd === `${procDir}/cwd` ? null : cwd, held: [...new Set(held)], port: lsof.code === 0 ? listenPort(lsofNames(lsof.stdout)) : null, env };
  }
  const files = await probe.run(['lsof', '-a', '-p', String(pid), '-Fn'], { timeoutMs: 5000 });
  const names = lsofNames(files.stdout);
  const cwdOut = await probe.run(['lsof', '-a', '-p', String(pid), '-d', 'cwd', '-Fn'], { timeoutMs: 5000 });
  const listen = await probe.run(['lsof', '-a', '-p', String(pid), '-iTCP', '-sTCP:LISTEN', '-Fn', '-P'], { timeoutMs: 5000 });
  return {
    cwd: lsofNames(cwdOut.stdout)[0] ?? null,
    held: [...new Set(names.filter((n) => n.endsWith('/engine.db')).map((n) => dirname(n)))],
    port: listenPort(lsofNames(listen.stdout)),
    env: {},
  };
}

/** `docker ps` lines: id, name, image */
export function parseDockerPs(text: string): { id: string; name: string; image: string }[] {
  return text
    .split('\n')
    .map((l) => l.split('\t'))
    .filter((p) => p.length >= 3 && p[0])
    .map(([id, name, image]) => ({ id: id!, name: name!, image: image! }));
}

/** a bind mount's source as this computer names it: Docker Desktop on a Mac reports /host_mnt/Users/… (found moving a real container) */
export const hostPath = (source: string) => source.replace(/^\/host_mnt(?=\/)/, '');

const isFoundryImage = (image: string) => new RegExp(`^(docker\\.io/)?${FOUNDRY_IMAGE.replace('/', '\\/')}([:@]|$)`).test(image);

/** one `docker inspect` entry as a move sees it; null when it is not a Foundry container */
export function containerFacts(c: any): { facts: DockerFacts; running: boolean; port: number | null; folders: { provider: AgentProvider; path: string }[] } | null {
  const mounts: DockerMount[] = (c?.Mounts ?? []).map((m: any) => ({ type: String(m.Type ?? ''), name: m.Name ?? null, source: hostPath(String(m.Source ?? '')), destination: String(m.Destination ?? '') }));
  const image = String(c?.Config?.Image ?? '');
  if (!isFoundryImage(image) && !mounts.some((m) => m.destination === '/app/data')) return null;
  const labels: Record<string, string> = c?.Config?.Labels ?? {};
  const binding = c?.NetworkSettings?.Ports?.['4111/tcp']?.[0]?.HostPort ?? c?.HostConfig?.PortBindings?.['4111/tcp']?.[0]?.HostPort;
  return {
    facts: {
      container: String(c?.Name ?? '').replace(/^\//, ''),
      image,
      imageId: String(c?.Image ?? image),
      restart: String(c?.HostConfig?.RestartPolicy?.Name || 'no'),
      mounts,
      composeDir: labels['com.docker.compose.project.working_dir'] ?? null,
      watchtower: null,
    },
    running: !!c?.State?.Running,
    port: binding ? Number(binding) : null,
    folders: mounts.filter((m) => m.destination in CONTAINER_DATA).map((m) => ({ provider: CONTAINER_DATA[m.destination]!, path: m.destination })),
  };
}

/** count a container's goals with the bun its image carries: in it while it runs, else beside its volumes; 'none' for a folder with no database */
export function containerCountScript(paths: string[]): string {
  return `const {Database}=require('bun:sqlite');const {existsSync}=require('fs');const o={};for(const p of ${JSON.stringify(paths)}){if(!existsSync(p+'/engine.db')){o[p]='none';continue}try{const d=new Database(p+'/engine.db',{readonly:true});const n=(q)=>Number(d.query(q).get().n??0);o[p]={goals:n('SELECT count(*) AS n FROM goals'),events:n('SELECT count(*) AS n FROM events'),last:d.query('SELECT max(ts) AS t FROM events').get().t??null};d.close()}catch(e){o[p]=null}}console.log(JSON.stringify(o))`;
}

export async function countContainer(probe: Probe, facts: DockerFacts, paths: string[], running: boolean): Promise<Record<string, FolderCounts | 'none' | null>> {
  const script = containerCountScript(paths);
  const argv = running ? ['docker', 'exec', facts.container, 'bun', '-e', script] : ['docker', 'run', '--rm', '--entrypoint', 'bun', '--volumes-from', facts.container, facts.imageId, '-e', script];
  const r = await probe.run(argv, { timeoutMs: 90_000 });
  try {
    return r.code === 0 ? JSON.parse(r.stdout.trim().split('\n').pop() ?? '{}') : {};
  } catch {
    return {};
  }
}

async function findContainers(probe: Probe, notes: string[], recorded: Record<string, string> | null): Promise<EarlierInstall[]> {
  const v = await probe.run(['docker', 'version', '--format', '{{.Server.Version}}'], { timeoutMs: 8000 });
  if (v.code === 127) return [];
  if (v.code !== 0) {
    if (recorded?.MODE === 'docker') notes.push('Foundry ran in Docker here, and Docker is not running: start Docker to move that container’s goals');
    return [];
  }
  const ps = await probe.run(['docker', 'ps', '-a', '--no-trunc', '--format', '{{.ID}}\t{{.Names}}\t{{.Image}}'], { timeoutMs: 10_000 });
  const candidates = parseDockerPs(ps.stdout).filter((c) => isFoundryImage(c.image) || c.name === 'foundry');
  if (!candidates.length) return [];
  const inspected = await probe.run(['docker', 'inspect', ...candidates.map((c) => c.id)], { timeoutMs: 10_000 });
  let list: any[] = [];
  try {
    list = JSON.parse(inspected.stdout);
  } catch {}
  const out: EarlierInstall[] = [];
  for (const c of list) {
    const seen = containerFacts(c);
    if (!seen || !seen.folders.length) continue;
    const { facts, running, port, folders } = seen;
    const project = c?.Config?.Labels?.['com.docker.compose.project'];
    if (project) {
      const wt = await probe.run(['docker', 'ps', '-a', '--filter', `label=com.docker.compose.project=${project}`, '--filter', 'label=com.docker.compose.service=watchtower', '--format', '{{.Names}}'], { timeoutMs: 10_000 });
      facts.watchtower = wt.stdout.trim().split('\n')[0] || null;
    }
    const counts = await countContainer(probe, facts, folders.map((f) => f.path), running);
    const composeDir = facts.composeDir ?? (recorded?.MODE === 'docker' ? recorded.DIR ?? null : null);
    const dotenv = composeDir ? parseDotenv(probe.read(join(composeDir, '.env')) ?? '') : {};
    // a volume the image mounts whether or not it was used (data-codex): no database, nothing to move
    const efolders: EarlierFolder[] = folders.filter((f) => counts[f.path] !== 'none').map((f) => ({ provider: f.provider, path: f.path, counts: (counts[f.path] as FolderCounts | null | undefined) ?? null, moved: false, chosen: false }));
    if (!efolders.length) continue;
    const url = running && port ? ((await probe.json(`http://127.0.0.1:${port}/api/health`)) ? `http://127.0.0.1:${port}` : null) : null;
    out.push({
      id: `docker:${facts.container}`,
      kind: 'docker',
      where: facts.container,
      version: c?.Config?.Labels?.['org.opencontainers.image.version'] ?? (/:([^:@/]+)$/.exec(facts.image)?.[1] ?? null),
      recorded: recorded?.MODE === 'docker',
      running: running ? { pid: Number(c?.State?.Pid) || null, how: 'container' } : null,
      port,
      url,
      folders: efolders,
      goals: efolders.reduce((n, f) => n + (f.counts?.goals ?? 0), 0),
      last: efolders.reduce<string | null>((l, f) => latest(l, f.counts?.last ?? null), null),
      env: carried(dotenv),
      docker: { ...facts, composeDir },
    });
  }
  return out;
}
