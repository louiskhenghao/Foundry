/**
 * A server of the person's own (ADR-0090): the whole project, as its compose file runs it — or a lone Dockerfile wrapped
 * in a compose file Foundry writes — copied over SSH and started there with `docker compose up`. Any backend goes: a
 * worker, an API, a database beside the app; what the compose file names, the server runs. The server is reached with
 * the SSH key from Settings, written to a file only while the commands run, and never handed to a coding session.
 *
 * There is no preview on a server: every deploy is production, confirmed each time. The address is the server's public
 * address from Settings, else the host and the first port the compose file publishes; a project that publishes none
 * runs with nothing to open.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DeployServer, ReadinessItem } from '@foundry/core';
import type { ExecResult } from '../git/git.ts';
import type { DeployStep } from './providers.ts';

/** the compose files, in the order compose itself looks for them */
export const COMPOSE_FILES = ['compose.yaml', 'compose.yml', 'docker-compose.yml', 'docker-compose.yaml'];
/** the compose file Foundry writes into the checkout for a repository with a Dockerfile and no compose file */
export const GENERATED_COMPOSE = 'compose.foundry.yaml';

export interface ServerApp {
  /** the project's own compose file, or a Dockerfile Foundry wraps in one */
  kind: 'compose' | 'dockerfile';
  /** the compose file the deploy runs, relative to the repository */
  file: string;
  services: string[];
  /** the first port the project publishes on the server, if any */
  port: number | null;
}
export type ServerDeployability = { ok: true; app: ServerApp; notes: string[] } | { ok: false; reason: string };

type Compose = { services?: Record<string, { ports?: unknown; image?: unknown; build?: unknown }> };

/** the host port a compose `ports` entry publishes: `8080:80`, `127.0.0.1:8080:80`, `8080`, `8080-8090:80-90`, `8080/tcp`, or the long form */
export function publishedPort(entry: unknown): number | null {
  if (typeof entry === 'number') return Number.isInteger(entry) ? entry : null;
  if (entry && typeof entry === 'object') {
    const p = (entry as { published?: unknown }).published;
    return typeof p === 'number' ? p : typeof p === 'string' ? publishedPort(p) : null;
  }
  if (typeof entry !== 'string') return null;
  const parts = entry.replace(/\/(tcp|udp)$/i, '').split(':');
  // ip:host:container, host:container, container (published as itself)
  const host = parts.length >= 3 ? parts[parts.length - 2]! : parts[0]!;
  const n = Number(host.split('-')[0]);
  return Number.isInteger(n) && n > 0 ? n : null;
}

const read = (p: string) => {
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return '';
  }
};

/** What a repository is for a server: its compose file (which services, which port), or its Dockerfile; else why nothing goes. */
export function serverDeployability(root: string): ServerDeployability {
  const compose = COMPOSE_FILES.find((f) => existsSync(join(root, f)));
  if (compose) {
    let doc: Compose;
    try {
      doc = (Bun.YAML.parse(read(join(root, compose))) ?? {}) as Compose;
    } catch (err) {
      return { ok: false, reason: `${compose} could not be read as YAML: ${String((err as Error)?.message ?? err).split('\n')[0]}` };
    }
    const services = Object.keys(doc.services ?? {});
    if (!services.length) return { ok: false, reason: `${compose} names no services: nothing for the server to run` };
    let port: number | null = null;
    for (const svc of Object.values(doc.services ?? {})) {
      const ports = Array.isArray(svc?.ports) ? svc.ports : [];
      port = ports.map(publishedPort).find((p): p is number => p != null) ?? null;
      if (port != null) break;
    }
    const notes: string[] = [];
    if (port == null) notes.push('No service publishes a port (`ports:`): the project runs on the server with no address to open, unless the server has a public address in Settings.');
    const built = Object.entries(doc.services ?? {}).filter(([, s]) => s?.build).map(([n]) => n);
    const pulled = services.filter((n) => !built.includes(n));
    if (pulled.length) notes.push(`${pulled.join(', ')} ${pulled.length > 1 ? 'are' : 'is'} pulled as ${pulled.length > 1 ? 'images' : 'an image'} on the server; ${built.length ? `${built.join(', ')} ${built.length > 1 ? 'are' : 'is'} built there from the repository` : 'nothing is built from the repository'}.`);
    return { ok: true, app: { kind: 'compose', file: compose, services, port }, notes };
  }
  if (existsSync(join(root, 'Dockerfile'))) {
    const m = read(join(root, 'Dockerfile')).match(/^\s*EXPOSE\s+(\d+)/im);
    if (!m) return { ok: false, reason: 'the Dockerfile exposes no port: add `EXPOSE <port>` to it, or a compose file with `ports:`, so Foundry knows which port to publish on the server' };
    const port = Number(m[1]);
    return { ok: true, app: { kind: 'dockerfile', file: GENERATED_COMPOSE, services: ['app'], port }, notes: [`No compose file: Foundry writes ${GENERATED_COMPOSE} with one service built from the Dockerfile, publishing port ${port}.`] };
  }
  return { ok: false, reason: 'no compose file (compose.yaml, docker-compose.yml) and no Dockerfile: a server runs the project with docker compose, so add one that builds and starts it' };
}

/** the compose file Foundry writes for a lone Dockerfile: one service built from it, its port published, restarted with the server */
export function generatedCompose(port: number): string {
  return `# written by Foundry (Deploy): the repository has a Dockerfile and no compose file, so this runs it as one service\nservices:\n  app:\n    build: .\n    ports:\n      - "${port}:${port}"\n    restart: unless-stopped\n`;
}

/** a string as one word of a POSIX shell command */
export const shellQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** the folder of this repository's project on the server: `~` is left to the remote shell, anything else is quoted */
export function remoteDir(server: Pick<DeployServer, 'dir'>, name: string): string {
  const dir = `${server.dir.replace(/\/+$/, '')}/${name}`;
  return dir.startsWith('~') ? dir : shellQuote(dir);
}

/**
 * How the server is reached: key from a file, no password prompt (nobody is there to answer), a new host's key accepted
 * and kept in Foundry's own known_hosts under the data folder, a changed one refused.
 */
export function sshArgv(server: Pick<DeployServer, 'host' | 'port' | 'user'>, keyFile: string, knownHosts: string, bin: string[] = ['ssh']): string[] {
  return [...bin, '-i', keyFile, '-p', String(server.port), '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new', '-o', `UserKnownHostsFile=${knownHosts}`, '-o', 'ConnectTimeout=20', '-o', 'LogLevel=ERROR', `${server.user}@${server.host}`];
}

export interface ServerPlanInput {
  server: DeployServer;
  /** the project's name on the server (the deploy folder's) */
  name: string;
  /** the checkout the files are copied from */
  checkout: string;
  keyFile: string;
  knownHosts: string;
  /** the compose file to run, relative to the checkout */
  file: string;
  /** how ssh is run; tests point it at a stand-in */
  ssh?: string[];
}

/** The commands a server deploy runs, in order: the folder made, the files copied, the project started. */
export function serverSteps(i: ServerPlanInput): DeployStep[] {
  const ssh = sshArgv(i.server, i.keyFile, i.knownHosts, i.ssh);
  const remote = remoteDir(i.server, i.name);
  const at = (label: string, argv: string[]): DeployStep => ({ label, argv, env: {}, cwd: i.checkout });
  // the checkout as a tar stream over the same connection: no rsync needed on either side; installed packages and the
  // hosts' folders stay out, and what is already on the server is written over, never deleted (a bind-mounted data
  // folder beside the code survives a deploy)
  const copy = `tar -czf - --exclude=.git --exclude=node_modules --exclude=.vercel --exclude=.netlify --exclude=.wrangler -C ${shellQuote(i.checkout)} . | ${ssh.map(shellQuote).join(' ')} ${shellQuote(`tar -xzf - -C ${remote}`)}`;
  return [
    at('make the folder on the server', [...ssh, `mkdir -p ${remote}`]),
    at('copy the project over', ['sh', '-c', copy]),
    at('start it with docker compose', [...ssh, `cd ${remote} && docker compose -p ${shellQuote(i.name)} -f ${shellQuote(i.file)} up -d --build --remove-orphans`]),
  ];
}

/** the address a server deploy ends with: the server's public address, else the host and the first published port, else none */
export function serverAddress(server: Pick<DeployServer, 'host' | 'publicUrl'>, app: Pick<ServerApp, 'port'>): string | null {
  if (server.publicUrl) return server.publicUrl.replace(/\/+$/, '');
  return app.port != null ? `http://${server.host}:${app.port}` : null;
}

/** the last line of a command's output that says something */
const lastLine = (r: ExecResult) =>
  `${r.stdout}\n${r.stderr}`
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .at(-1) ?? '';

/** what ssh's own error means, in words the person can act on */
function sshFailure(server: Pick<DeployServer, 'host' | 'port' | 'user'>, r: ExecResult): { detail: string; fix: ReadinessItem['fix'] } {
  const out = `${r.stdout}\n${r.stderr}`;
  if (/Permission denied/i.test(out)) return { detail: `${server.host} refused the key for ${server.user}: ${lastLine(r)}`, fix: { command: `# on the server, as ${server.user}: add the key's public half\nmkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys` } };
  if (/Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED/i.test(out)) return { detail: `${server.host}'s host key changed since Foundry last saw it: ${lastLine(r)}`, fix: { settings: 'git' } };
  if (/Could not resolve hostname/i.test(out)) return { detail: `${server.host} is not a name this computer resolves: ${lastLine(r)}`, fix: { settings: 'git' } };
  return { detail: `could not reach ${server.user}@${server.host}:${server.port}: ${lastLine(r) || `nothing answered (exit ${r.code})`}`, fix: { settings: 'git' } };
}

export interface ReadinessDeps {
  keyFile: string | null;
  knownHosts: string;
  ssh?: string[];
  run: (argv: string[], cwd: string, opts: { timeoutMs: number }) => Promise<ExecResult>;
}

/**
 * Whether a deploy to this server can start: the key is in Settings, the server answers over SSH with that key, docker
 * compose runs there for this user, and the deploy folder can be written. Each item says what it found; what could
 * not be tried says why.
 */
export async function serverReadiness(server: DeployServer, deps: ReadinessDeps): Promise<ReadinessItem[]> {
  const items: ReadinessItem[] = [];
  const hasKey = !!server.privateKey && !!deps.keyFile;
  items.push({ id: 'key', label: 'SSH key in Settings', ok: hasKey, detail: hasKey ? `a key for ${server.user}@${server.host}` : `the server ${server.name} has no SSH private key yet`, fix: hasKey ? null : { settings: 'git' } });
  const notTried = (id: string, label: string, why: string): ReadinessItem => ({ id, label, ok: false, detail: `not tried: ${why}`, fix: null });
  if (!hasKey) return [...items, notTried('reach', 'Reachable over SSH', 'no key'), notTried('docker', 'docker compose on the server', 'no key'), notTried('folder', 'Deploy folder writable', 'no key')];
  const ssh = sshArgv(server, deps.keyFile!, deps.knownHosts, deps.ssh);
  const run = (cmd: string) => deps.run([...ssh, cmd], process.cwd(), { timeoutMs: 45_000 });
  const reach = await run('echo foundry-ok');
  if (reach.code !== 0 || !reach.stdout.includes('foundry-ok')) {
    const f = sshFailure(server, reach);
    return [...items, { id: 'reach', label: 'Reachable over SSH', ok: false, detail: f.detail, fix: f.fix }, notTried('docker', 'docker compose on the server', 'the server could not be reached'), notTried('folder', 'Deploy folder writable', 'the server could not be reached')];
  }
  items.push({ id: 'reach', label: 'Reachable over SSH', ok: true, detail: `${server.user}@${server.host}:${server.port} answered`, fix: null });
  const docker = await run("docker compose version && docker info --format '{{.ServerVersion}}'");
  if (docker.code !== 0) {
    const out = `${docker.stdout}\n${docker.stderr}`;
    const socket = /permission denied.*docker daemon socket|Got permission denied/i.test(out);
    items.push({
      id: 'docker',
      label: 'docker compose on the server',
      ok: false,
      detail: socket ? `${server.user} may not use Docker there: ${lastLine(docker)}` : /not found/i.test(out) ? `Docker is not installed on ${server.host}: ${lastLine(docker)}` : `docker compose failed there: ${lastLine(docker)}`,
      fix: socket ? { command: `sudo usermod -aG docker ${server.user}` } : { url: 'https://docs.docker.com/engine/install/' },
    });
  } else {
    const version = docker.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
    items.push({ id: 'docker', label: 'docker compose on the server', ok: true, detail: version.join(', '), fix: null });
  }
  const dir = server.dir.startsWith('~') ? server.dir : shellQuote(server.dir);
  const folder = await run(`mkdir -p ${dir} && test -w ${dir} && echo writable`);
  const writable = folder.code === 0 && folder.stdout.includes('writable');
  items.push({ id: 'folder', label: 'Deploy folder writable', ok: writable, detail: writable ? `${server.dir} on the server` : `${server.dir} could not be made or written as ${server.user}: ${lastLine(folder)}`, fix: writable ? null : { settings: 'git' } });
  return items;
}
