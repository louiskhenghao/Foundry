/**
 * A server of the person's own (ADR-0091): the whole project, as its compose file runs it — or a lone Dockerfile wrapped
 * in a compose file Foundry writes — copied over SSH and started there with `docker compose up`. Any backend goes: a
 * worker, an API, a database beside the app; what the compose file names, the server runs. The server is reached with
 * the SSH key from Settings, written to a file only while the commands run, and never handed to a coding session.
 *
 * What Foundry does on the server is bounded: it writes under `<deploy folder>/<project name>` only (a folder that
 * already holds something else is never written over), and starts, replaces and removes the containers of this compose
 * project only. The compose file is reviewed before it runs: one that would reach outside its project (a privileged
 * container, the host's network, the Docker socket, a bind mount elsewhere on the disk) is refused with the reasons,
 * unless the server's settings allow it. Nothing is installed or configured on the server: what it lacks (Docker, a
 * reverse proxy, a certificate) is said with the command or the page, and the person does it.
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
/** the file that marks a folder on the server as Foundry's: a folder without it that holds files is never written over */
export const MARKER = '.foundry-deploy';

/** What a compose file would do on the server: what is refused unless allowed, and the facts the confirmation states. */
export interface ComposeReview {
  /** what would reach outside the project, in words with the service's name; the deploy refuses these unless the server allows them */
  dangers: string[];
  /** every host port the file publishes */
  ports: number[];
  /** services built from the repository, and services pulled as images */
  built: string[];
  pulled: string[];
  /** named volumes (data that stays between deploys), and bind mounts inside the project folder */
  volumes: string[];
  binds: string[];
}

export interface ServerApp {
  /** the project's own compose file, or a Dockerfile Foundry wraps in one */
  kind: 'compose' | 'dockerfile';
  /** the compose file the deploy runs, relative to the repository */
  file: string;
  services: string[];
  /** the first port the project publishes on the server, if any */
  port: number | null;
  review: ComposeReview;
}
export type ServerDeployability = { ok: true; app: ServerApp; notes: string[] } | { ok: false; reason: string };

type Service = Record<string, unknown> & { ports?: unknown; image?: unknown; build?: unknown; volumes?: unknown };
type Compose = { services?: Record<string, Service>; volumes?: Record<string, { driver_opts?: Record<string, unknown> } | null> };

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

const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
/** a volume entry's source and whether it is a bind mount: `./data:/app/data`, `/etc/x:/x`, `db:/var/lib/pg`, or the long form */
function volumeSource(entry: unknown): { source: string; bind: boolean } | null {
  if (typeof entry === 'string') {
    const [src, dst] = entry.split(':');
    if (!dst) return null; // an anonymous volume: `/data`
    const bind = /^(\.|\/|~|\$)/.test(src!);
    return { source: src!, bind };
  }
  if (entry && typeof entry === 'object') {
    const e = entry as { type?: unknown; source?: unknown };
    if (typeof e.source !== 'string') return null;
    return { source: e.source, bind: e.type === 'bind' || /^(\.|\/|~|\$)/.test(e.source) };
  }
  return null;
}
/** a bind mount's source stays inside the project folder: `./x`, `x/y`; not `/`, `~`, `..` or a variable */
const insideProject = (src: string) => !/^(\/|~|\$)/.test(src) && !/(^|\/)\.\.(\/|$)/.test(src);

/** Read the compose file for what it would reach on the server, and the facts of what it runs. */
export function reviewCompose(doc: Compose): ComposeReview {
  const r: ComposeReview = { dangers: [], ports: [], built: [], pulled: [], volumes: [], binds: [] };
  const seen = new Set<string>();
  for (const [name, svc] of Object.entries(doc.services ?? {})) {
    if (!svc) continue;
    (svc.build ? r.built : r.pulled).push(name);
    for (const p of list(svc.ports).map(publishedPort)) if (p != null && !r.ports.includes(p)) r.ports.push(p);
    if (svc.privileged === true) r.dangers.push(`${name} runs privileged: the container would have the server's own powers`);
    if (svc.network_mode === 'host') r.dangers.push(`${name} uses the host's network (network_mode: host): every port of the server, not the project's`);
    for (const k of ['pid', 'ipc', 'userns_mode', 'cgroup'] as const) if (svc[k] === 'host') r.dangers.push(`${name} shares the host's ${k === 'userns_mode' ? 'user namespace' : k} (${k}: host)`);
    if (list(svc.cap_add).length) r.dangers.push(`${name} adds capabilities (cap_add: ${list(svc.cap_add).join(', ')})`);
    if (list(svc.security_opt).some((o) => /unconfined|no-new-privileges[:=]false/i.test(String(o)))) r.dangers.push(`${name} turns a security profile off (security_opt)`);
    if (list(svc.devices).length) r.dangers.push(`${name} opens the server's devices (devices: ${list(svc.devices).map(String).join(', ')})`);
    for (const v of list(svc.volumes).map(volumeSource)) {
      if (!v) continue;
      if (!v.bind) {
        if (!seen.has(v.source)) r.volumes.push(v.source);
        seen.add(v.source);
      } else if (/docker\.sock/.test(v.source)) r.dangers.push(`${name} mounts the Docker socket (${v.source}): the container would control every container on the server`);
      else if (insideProject(v.source)) r.binds.push(v.source);
      else r.dangers.push(`${name} bind-mounts ${v.source}, outside the project folder`);
    }
  }
  for (const [name, vol] of Object.entries(doc.volumes ?? {})) {
    const device = vol?.driver_opts?.device;
    if (typeof device === 'string' && !insideProject(device)) r.dangers.push(`volume ${name} binds ${device}, outside the project folder`);
  }
  return r;
}

const read = (p: string) => {
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return '';
  }
};

/** What a repository is for a server: its compose file (which services, which port, what it reaches), or its Dockerfile; else why nothing goes. */
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
    const review = reviewCompose(doc);
    const port = review.ports[0] ?? null;
    const notes: string[] = [];
    if (port == null) notes.push('No service publishes a port (`ports:`): the project runs on the server with no address to open, unless the server has a public address in Settings.');
    if (review.pulled.length) notes.push(`${review.pulled.join(', ')} ${review.pulled.length > 1 ? 'are' : 'is'} pulled as ${review.pulled.length > 1 ? 'images' : 'an image'} on the server; ${review.built.length ? `${review.built.join(', ')} ${review.built.length > 1 ? 'are' : 'is'} built there from the repository` : 'nothing is built from the repository'}.`);
    return { ok: true, app: { kind: 'compose', file: compose, services, port, review }, notes };
  }
  if (existsSync(join(root, 'Dockerfile'))) {
    const m = read(join(root, 'Dockerfile')).match(/^\s*EXPOSE\s+(\d+)/im);
    if (!m) return { ok: false, reason: 'the Dockerfile exposes no port: add `EXPOSE <port>` to it, or a compose file with `ports:`, so Foundry knows which port to publish on the server' };
    const port = Number(m[1]);
    return { ok: true, app: { kind: 'dockerfile', file: GENERATED_COMPOSE, services: ['app'], port, review: { dangers: [], ports: [port], built: ['app'], pulled: [], volumes: [], binds: [] } }, notes: [`No compose file: Foundry writes ${GENERATED_COMPOSE} with one service built from the Dockerfile, publishing port ${port}.`] };
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
/** the deploy folder itself, the same way */
const baseDir = (server: Pick<DeployServer, 'dir'>) => (server.dir.startsWith('~') ? server.dir : shellQuote(server.dir));

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

/** the first step's remote script: the project folder made (or found as Foundry's); one that holds anything else stops the deploy, exit 3 */
export function folderScript(remote: string): string {
  return `p=${remote}; if [ -d "$p" ] && [ ! -e "$p/${MARKER}" ] && [ -n "$(ls -A "$p" 2>/dev/null)" ]; then echo "FOUNDRY: $p already holds files that are not a Foundry deploy: pick another deploy folder for this server in Settings, or empty it yourself" >&2; exit 3; fi; mkdir -p "$p" && touch "$p/${MARKER}"`;
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
    at('make the folder on the server', [...ssh, folderScript(remote)]),
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

/** the listeners `ss -ltnp` (or `netstat -ltnp`) prints: the port and, when the user may see it, the program's name */
export function parseListeners(out: string): { port: number; program: string | null }[] {
  const found: { port: number; program: string | null }[] = [];
  for (const line of out.split('\n')) {
    // the local address is the first token that ends in a port: 0.0.0.0:80, [::]:443, *:22, 127.0.0.1:5432
    const local = line.split(/\s+/).find((t) => /^(\*|\[[^\]]*\]|[0-9a-fA-F.:]+|[a-z0-9.-]+):\d{1,5}$/.test(t) && !/^\d{1,5}$/.test(t));
    if (!local) continue;
    const port = Number(local.slice(local.lastIndexOf(':') + 1));
    if (!port || found.some((f) => f.port === port)) continue;
    const program = line.match(/users:\(\("([^"]+)"/)?.[1] ?? line.match(/\s\d+\/([^\s/]+)/)?.[1] ?? null;
    found.push({ port, program });
  }
  return found;
}

export interface ReadinessDeps {
  keyFile: string | null;
  knownHosts: string;
  ssh?: string[];
  run: (argv: string[], cwd: string, opts: { timeoutMs: number }) => Promise<ExecResult>;
  /** the project a deploy would start, when the check is about one: its name on the server and the ports it publishes */
  project?: { name: string; ports: number[] } | null;
  /** how the public address is looked at from here (a test stands in for the network) */
  probe?: (url: string) => Promise<{ status: number; headers: Headers } | { error: string }>;
}

/** one look at the public address: what answered, or the error's code */
export async function probeAddress(url: string): Promise<{ status: number; headers: Headers } | { error: string }> {
  try {
    const r = await fetch(url, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(10_000) });
    void r.body?.cancel().catch(() => {});
    return { status: r.status, headers: r.headers };
  } catch (err) {
    const e = err as Error & { code?: string; cause?: { code?: string; message?: string } };
    return { error: e.cause?.code ?? e.code ?? e.name ?? String(e.message ?? e) };
  }
}

/**
 * Whether a deploy to this server can start: the key is in Settings, the server answers over SSH with that key, docker
 * compose runs there for this user, the project folder can be made (and is Foundry's, or empty), the ports the project
 * publishes are free (or this project's own). Told but never blocking: what listens on 80/443 in front, and whether
 * the public address answers with a valid certificate. Each item says what it found; what could not be tried says why.
 */
export async function serverReadiness(server: DeployServer, deps: ReadinessDeps): Promise<ReadinessItem[]> {
  const items: ReadinessItem[] = [];
  const hasKey = !!server.privateKey && !!deps.keyFile;
  items.push({ id: 'key', label: 'SSH key in Settings', ok: hasKey, severity: 'error', detail: hasKey ? `a key for ${server.user}@${server.host}` : `the server ${server.name} has no SSH private key yet`, fix: hasKey ? null : { settings: 'git' } });
  const notTried = (id: string, label: string, why: string, severity: ReadinessItem['severity'] = 'error'): ReadinessItem => ({ id, label, ok: false, severity, detail: `not tried: ${why}`, fix: null });
  const rest = (why: string) => [notTried('reach', 'Reachable over SSH', why), notTried('docker', 'docker compose on the server', why), notTried('folder', 'Deploy folder writable', why), ...(deps.project?.ports.length ? [notTried('ports', 'Published ports free', why)] : []), notTried('front', 'Something in front on 80/443', why, 'warn'), ...(server.publicUrl ? [notTried('public', 'Public address answers', why, 'warn')] : [])];
  if (!hasKey) return [...items, ...rest('no key')];
  const ssh = sshArgv(server, deps.keyFile!, deps.knownHosts, deps.ssh);
  const run = (cmd: string) => deps.run([...ssh, cmd], process.cwd(), { timeoutMs: 45_000 });
  const reach = await run('echo foundry-ok');
  if (reach.code !== 0 || !reach.stdout.includes('foundry-ok')) {
    const f = sshFailure(server, reach);
    return [...items, { id: 'reach', label: 'Reachable over SSH', ok: false, severity: 'error', detail: f.detail, fix: f.fix }, ...rest('the server could not be reached').slice(1)];
  }
  items.push({ id: 'reach', label: 'Reachable over SSH', ok: true, severity: 'error', detail: `${server.user}@${server.host}:${server.port} answered`, fix: null });
  const docker = await run("docker compose version && docker info --format '{{.ServerVersion}}'");
  if (docker.code !== 0) {
    const out = `${docker.stdout}\n${docker.stderr}`;
    const socket = /permission denied.*docker daemon socket|Got permission denied/i.test(out);
    items.push({
      id: 'docker',
      label: 'docker compose on the server',
      ok: false,
      severity: 'error',
      detail: socket ? `${server.user} may not use Docker there: ${lastLine(docker)}` : /not found/i.test(out) ? `Docker is not installed on ${server.host}: ${lastLine(docker)}` : `docker compose failed there: ${lastLine(docker)}`,
      // Foundry installs nothing on the server: the command is the person's to run, and it changes who may use Docker / what is installed
      fix: socket ? { command: `# on the server: lets ${server.user} use Docker (a member of the docker group can act as root through it); log out and in afterwards\nsudo usermod -aG docker ${server.user}` } : { url: 'https://docs.docker.com/engine/install/' },
    });
  } else {
    const version = docker.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
    items.push({ id: 'docker', label: 'docker compose on the server', ok: true, severity: 'error', detail: version.join(', '), fix: null });
  }
  const remote = deps.project ? remoteDir(server, deps.project.name) : null;
  const folder = await run(`d=${baseDir(server)}; mkdir -p "$d" && test -w "$d" && echo writable${remote ? `; p=${remote}; if [ -e "$p/${MARKER}" ]; then echo project=ours; elif [ -d "$p" ] && [ -n "$(ls -A "$p" 2>/dev/null)" ]; then echo project=foreign; else echo project=new; fi` : ''}`);
  const writable = folder.code === 0 && folder.stdout.includes('writable');
  const foreign = folder.stdout.includes('project=foreign');
  items.push({
    id: 'folder',
    label: 'Deploy folder writable',
    ok: writable && !foreign,
    severity: 'error',
    detail: !writable ? `${server.dir} could not be made or written as ${server.user}: ${lastLine(folder)}` : foreign ? `${server.dir}/${deps.project!.name} already holds files that are not a Foundry deploy: Foundry never writes over them — pick another deploy folder for this server, or empty it yourself` : folder.stdout.includes('project=ours') ? `${server.dir} on the server; the project's folder is Foundry's from an earlier deploy` : `${server.dir} on the server; the project's folder will be made`,
    fix: writable && !foreign ? null : { settings: 'git' },
  });
  // what listens on the server: the project's ports (free, this project's own, or someone else's) and the front door
  const listen = await run(`(ss -ltnpH 2>/dev/null || ss -ltnp 2>/dev/null || netstat -ltnp 2>/dev/null); echo '::ours::'; ${deps.project ? `docker ps --filter label=com.docker.compose.project=${shellQuote(deps.project.name)} --format '{{.Ports}}' 2>/dev/null` : 'true'}`);
  const [listOut = '', oursOut = ''] = listen.stdout.split('::ours::');
  const listeners = parseListeners(listOut);
  if (deps.project?.ports.length) {
    const taken = deps.project.ports.flatMap((p) => {
      if (new RegExp(`:${p}->`).test(oursOut)) return [];
      const l = listeners.find((x) => x.port === p);
      return l ? [`${p} (${l.program ?? 'another program'})`] : [];
    });
    items.push({
      id: 'ports',
      label: 'Published ports free',
      ok: !taken.length,
      severity: 'error',
      detail: taken.length ? `already in use on the server: ${taken.join(', ')} — change the published port in the compose file, or stop what holds it; docker compose would fail to bind it` : deps.project.ports.map((p) => (new RegExp(`:${p}->`).test(oursOut) ? `${p} (this project's own, from an earlier deploy)` : `${p} free`)).join(', '),
      fix: null,
    });
  }
  const front = listeners.filter((l) => l.port === 80 || l.port === 443);
  items.push({
    id: 'front',
    label: 'Something in front on 80/443',
    ok: front.length > 0,
    severity: 'warn',
    detail: front.length ? front.map((l) => `${l.program ?? 'a program'} listens on ${l.port}`).join(', ') : `nothing listens on 80 or 443: visitors reach the project on its own port only${deps.project?.ports[0] ? ` (http://${server.host}:${deps.project.ports[0]})` : ''}. For a domain with https, put a reverse proxy in front (Caddy gets certificates itself; nginx with certbot) or proxy it through Cloudflare — Foundry does not set one up`,
    fix: front.length ? null : { url: 'https://caddyserver.com/docs/quick-starts/reverse-proxy' },
  });
  if (server.publicUrl) {
    const probe = deps.probe ?? probeAddress;
    const r = await probe(server.publicUrl);
    if ('status' in r) {
      const cf = r.headers.get('cf-ray') || /cloudflare/i.test(r.headers.get('server') ?? '');
      items.push({ id: 'public', label: 'Public address answers', ok: true, severity: 'warn', detail: `${server.publicUrl} answers (HTTP ${r.status}${cf ? ', behind Cloudflare' : r.headers.get('server') ? `, ${r.headers.get('server')}` : ''})`, fix: null });
    } else {
      const code = r.error;
      const detail = /ENOTFOUND|EAI_AGAIN/.test(code)
        ? `${server.publicUrl} does not resolve: add a DNS record for it pointing at ${server.host} (or at Cloudflare, proxied to it)`
        : /CERT|certificate|ALTNAME|SELF_SIGNED|UNABLE_TO_VERIFY|ERR_TLS/i.test(code)
          ? `${server.publicUrl} answers with a certificate the browser would refuse (${code}): get one (Caddy or certbot on the server, or Cloudflare in front)`
          : /ECONNREFUSED|TimeoutError|ETIMEDOUT|ECONNRESET|EHOSTUNREACH/.test(code)
            ? `nothing answers at ${server.publicUrl} yet (${code}): once a reverse proxy on the server, or Cloudflare, forwards it to the project's port, check again`
            : `${server.publicUrl} could not be reached from here: ${code}`;
      items.push({ id: 'public', label: 'Public address answers', ok: false, severity: 'warn', detail, fix: { url: 'https://caddyserver.com/docs/quick-starts/reverse-proxy' } });
    }
  }
  return items;
}
