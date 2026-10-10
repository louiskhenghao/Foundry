import { homedir } from 'node:os';
import { getGoal, isHistory, listGoals, listTasks, type Goal, type Task } from '@foundry/core';
import type { Engine } from '../engine.ts';
import { runInGroup } from '../proc.ts';
import { composeProject } from '../preview/services.ts';
import { goalWorkspacePath } from '../workspace.ts';
import { listSockets, processInfo, type ProcessInfo, type Run, type Socket } from './scan.ts';

/**
 * The Ports page: every TCP port in use on this computer, said in words — Foundry's own (its server, previews,
 * VS Code (web), what a task's session started, the Docker services it runs for a repository), what `tailscale serve`
 * forwards, Docker containers, other processes, and ports whose holder cannot be seen — with a way to stop and release
 * the ones that can be.
 */
export type PortCategory = 'foundry' | 'tailscale' | 'docker' | 'process' | 'unknown';
export type PortKind = 'server' | 'preview' | 'editor' | 'task' | 'service' | 'serve-self' | 'serve-foundry' | 'serve-person' | 'container' | 'process' | 'unknown';

export interface PortRow {
  /** stable for the same holder of the same port: what a release names */
  id: string;
  port: number;
  /** where it listens (`*`, `127.0.0.1`, a tailnet address…), each once */
  addresses: string[];
  category: PortCategory;
  kind: PortKind;
  /** one line: what holds it */
  label: string;
  /** more: the goal and app, the forwarded address, the working directory… */
  detail: string | null;
  goalId: string | null;
  taskId: string | null;
  pid: number | null;
  process: string | null;
  cwd: string | null;
  container: string | null;
  /** a tailnet address for it, when Tailscale serves it */
  url: string | null;
  /** shown by default: Foundry's, Tailscale's, Docker's, a usual dev port, the preview range, a process in a project */
  relevant: boolean;
  release: { allowed: boolean; confirm: string | null; reason: string | null };
}

export interface PortsView {
  rows: PortRow[];
  /** Foundry runs in its Docker image: the host's ports cannot be seen from here */
  inContainer: boolean;
  scannedAt: string;
}

/** ports dev servers, databases and tools usually take */
const DEV_PORTS = new Set([1313, 3000, 3001, 3002, 3003, 3333, 4000, 4173, 4200, 4321, 5000, 5001, 5173, 5174, 5432, 5555, 6006, 6379, 7000, 8000, 8001, 8008, 8080, 8081, 8443, 8787, 8888, 9000, 9001, 9229, 19000, 19001, 19002, 19006, 24678, 27017, 3306]);

export interface PortsDeps {
  run?: Run;
  platform?: NodeJS.Platform;
  /** `docker ps --format '{{json .}}'` output, '' without Docker */
  dockerPs?: () => Promise<string>;
  /** this process's user id, for "your own process" */
  uid?: number;
  kill?: (pid: number, signal: NodeJS.Signals) => void;
  alive?: (pid: number) => boolean;
  /** what tailscale serves, and stopping one (the engine's Tailnet by default) */
  serves?: Engine['tailnet']['serves'];
  stopServe?: (port: number) => Promise<void>;
  /** `docker stop` */
  dockerStop?: (container: string) => Promise<void>;
  /** the Host the page was opened at: a serve the person is looking through is never offered */
  viaHost?: string | null;
}

interface Container {
  id: string;
  name: string;
  ports: number[];
  project: string | null;
  workingDir: string | null;
}

/** one `docker ps --format '{{json .}}'` line per container: its name, published host ports and compose labels */
export function parseDockerPs(out: string): Container[] {
  const rows: Container[] = [];
  for (const line of out.split('\n')) {
    if (!line.trim()) continue;
    try {
      const c = JSON.parse(line) as { ID?: string; Names?: string; Ports?: string; Labels?: string };
      const labels = new Map((c.Labels ?? '').split(',').map((kv) => [kv.slice(0, kv.indexOf('=')), kv.slice(kv.indexOf('=') + 1)] as const));
      const ports = [...new Set([...(c.Ports ?? '').matchAll(/:(\d+)->\d+\/tcp/g)].map((m) => Number(m[1])))];
      rows.push({ id: c.ID ?? '', name: c.Names ?? c.ID ?? 'container', ports, project: labels.get('com.docker.compose.project') ?? null, workingDir: labels.get('com.docker.compose.project.working_dir') ?? null });
    } catch {
      /* not a container line */
    }
  }
  return rows;
}

const defaultDockerPs = async () => {
  if (!Bun.which('docker')) return '';
  const r = await runInGroup(['docker', 'ps', '--format', '{{json .}}'], { cwd: '/', timeoutMs: 5_000 }).catch(() => null);
  return r && r.code === 0 ? r.stdout : '';
};

const inside = (path: string | null, dir: string | null | undefined) => !!path && !!dir && (path === dir || path.startsWith(dir.replace(/\/+$/, '') + '/'));

/** the goal and task whose folders hold a working directory: a task's own worktree, else the goal's progress folder */
function ownerOf(cwd: string | null, places: { goal: Goal; ws: string; tasks: Task[] }[]): { goal: Goal; task: Task | null } | null {
  if (!cwd) return null;
  for (const p of places) {
    const task = p.tasks.find((t) => inside(cwd, t.worktreePath));
    if (task) return { goal: p.goal, task };
  }
  for (const p of places) {
    if (!inside(cwd, p.ws)) continue;
    // the progress folder is shared: name the task only when exactly one task works in it now
    const working = p.tasks.filter((t) => !t.worktreePath && ['running', 'observing', 'merging'].includes(t.state));
    return { goal: p.goal, task: working.length === 1 ? working[0]! : null };
  }
  return null;
}

export async function listPorts(engine: Engine, deps: PortsDeps = {}): Promise<PortsView> {
  const { config } = engine;
  const inContainer = !!process.env.FOUNDRY_DOCKER;
  const [sockets, serves, dockerOut] = await Promise.all([listSockets({ run: deps.run, platform: deps.platform }), (deps.serves ?? (() => engine.tailnet.serves()))().catch(() => []), (deps.dockerPs ?? defaultDockerPs)().catch(() => '')]);
  const containers = parseDockerPs(dockerOut);
  const info = await processInfo(sockets.flatMap((s) => (s.pid ? [s.pid] : [])), { run: deps.run, platform: deps.platform });
  const myUid = deps.uid ?? process.getuid?.() ?? -1;
  const goals = listGoals(engine.store.db).filter((g) => !isHistory(g));
  const places = goals.map((goal) => ({ goal, ws: goalWorkspacePath(config.dataDir, goal), tasks: listTasks(engine.store.db, goal.id) }));
  const roots = [...new Set(goals.flatMap((g) => [g.repoPath, g.repoPath.replace(/\/[^/]+\/?$/, '')]))].filter((r) => r.length > 1);
  const home = homedir();
  const previews = engine.preview.livePorts();
  const editorPort = engine.codeServer.status().port;
  const goalTitle = (id: string) => getGoal(engine.store.db, id)?.title ?? id;
  const appName = (goalId: string, key: string) => {
    const goal = getGoal(engine.store.db, goalId);
    return (goal && engine.preview.resolveApps(goal)?.apps.find((a) => a.key === key)?.name) || key;
  };
  const projects = new Map(goals.map((g) => [composeProject(g.repoPath), g]));
  const { portFrom, portTo } = config.preview;

  // one row per port and holder: tcp4 and tcp6 sockets of the same process are one listener
  const grouped = new Map<string, { socket: Socket; addresses: Set<string> }>();
  for (const s of sockets) {
    const key = `${s.port}:${s.pid ?? '?'}`;
    const g = grouped.get(key);
    if (g) g.addresses.add(s.address);
    else grouped.set(key, { socket: s, addresses: new Set([s.address]) });
  }

  const rows: PortRow[] = [];
  const add = (r: Omit<PortRow, 'relevant' | 'id' | 'addresses'> & { addresses?: string[] }) => {
    const relevant = r.category !== 'process' && r.category !== 'unknown' ? true : DEV_PORTS.has(r.port) || (r.port >= portFrom && r.port <= portTo) || roots.some((root) => inside(r.cwd, root)) || (inside(r.cwd, home) && !inside(r.cwd, `${home}/Library`) && !r.cwd!.slice(home.length + 1).startsWith('.'));
    rows.push({ ...r, addresses: r.addresses ?? [], relevant, id: `${r.kind}:${r.port}:${r.pid ?? r.container ?? ''}` });
  };
  const servedPorts = new Map(serves.map((s) => [s.port, s]));
  const containerPorts = new Map(containers.flatMap((c) => c.ports.map((p) => [p, c] as const)));

  for (const { socket: s, addresses } of grouped.values()) {
    const p: ProcessInfo | undefined = s.pid ? info.get(s.pid) : undefined;
    const base = { port: s.port, addresses: [...addresses], pid: s.pid, process: p?.command ?? s.process, cwd: p?.cwd ?? null, container: null, url: null, goalId: null, taskId: null };
    const isTailscale = /tailscale/i.test(s.process ?? '') || /tailscale/i.test(p?.command ?? '');
    const isDocker = /docker|vpnkit|com\.docker/i.test(s.process ?? '') || /com\.docker|vpnkit/i.test(p?.command ?? '');
    if (s.port === config.port && !isTailscale) {
      add({ ...base, category: 'foundry', kind: 'server', label: 'Foundry', detail: 'this Foundry server', release: { allowed: false, confirm: null, reason: 'Foundry itself' } });
      continue;
    }
    if (editorPort === s.port) {
      add({ ...base, category: 'foundry', kind: 'editor', label: 'VS Code (web)', detail: 'code-server for Open ▾ → VS Code (web)', release: { allowed: true, confirm: null, reason: null } });
      continue;
    }
    const preview = previews.find((v) => v.port === s.port || v.others.includes(s.port));
    if (preview) {
      const name = appName(preview.goalId, preview.key);
      add({ ...base, goalId: preview.goalId, category: 'foundry', kind: 'preview', label: `Preview · ${name}`, detail: `${goalTitle(preview.goalId)}${preview.port === s.port ? '' : ` · another server of ${name}`}`, release: { allowed: true, confirm: null, reason: null } });
      continue;
    }
    // Tailscale's own sockets on a served port are the serve's row; its other ports are its internals
    if (isTailscale && servedPorts.has(s.port)) continue;
    if (isDocker && containerPorts.has(s.port)) continue;
    const owner = ownerOf(base.cwd, places);
    if (owner && s.pid) {
      add({ ...base, goalId: owner.goal.id, taskId: owner.task?.id ?? null, category: 'foundry', kind: 'task', label: owner.task ? `Task · ${owner.task.title}` : 'Started in a goal folder', detail: owner.goal.title, release: { allowed: true, confirm: `Stop ${base.process ?? `process ${s.pid}`} on port ${s.port}? ${owner.task ? `"${owner.task.title}" may be using it: its attempt can fail.` : 'Something working in this goal may be using it.'}`, reason: null } });
      continue;
    }
    if (!s.pid) {
      add({ ...base, category: 'unknown', kind: 'unknown', label: 'Unknown holder', detail: 'held by a process this user cannot see (root or another user): sudo lsof -nP -iTCP:' + s.port + ' -sTCP:LISTEN', release: { allowed: false, confirm: null, reason: 'the holder cannot be seen without sudo' } });
      continue;
    }
    const mine = p?.uid != null && p.uid === myUid;
    add({
      ...base,
      category: 'process',
      kind: 'process',
      label: shortName(base.process) ?? `process ${s.pid}`,
      detail: base.cwd && base.cwd !== '/' ? base.cwd : null,
      release: mine ? { allowed: true, confirm: `Stop ${shortName(base.process) ?? 'this process'} (pid ${s.pid})${base.cwd && base.cwd !== '/' ? ` in ${base.cwd}` : ''}? It gets SIGTERM, then SIGKILL if it is still there after a few seconds.`, reason: null } : { allowed: false, confirm: null, reason: p?.uid === 0 ? 'a system process' : "another user's process" },
    });
  }

  for (const s of serves) {
    // the serve that carries this Foundry, or the one this page was opened through: stopping it cuts the person off
    const through = !!deps.viaHost && !!s.url && URL.parse(s.url)?.host === deps.viaHost.replace(/:443$/, '');
    const self = s.targetPort === config.port || through;
    const kind: PortKind = self ? 'serve-self' : s.ours ? 'serve-foundry' : 'serve-person';
    add({
      port: s.port,
      category: 'tailscale',
      kind,
      label: self ? 'Tailscale serve → Foundry' : s.ours ? 'Tailscale serve (by Foundry)' : 'Tailscale serve (yours)',
      detail: `forwards ${s.target ?? '?'} to your tailnet`,
      goalId: null,
      taskId: null,
      pid: null,
      process: 'tailscale serve',
      cwd: null,
      container: null,
      url: s.url,
      release: self ? { allowed: false, confirm: null, reason: 'it carries Foundry to your other devices' } : { allowed: true, confirm: s.ours ? null : `Stop serving port ${s.port} on your tailnet (it forwards ${s.target ?? 'a local address'})? You added it yourself.`, reason: null },
    });
  }

  for (const c of containers) {
    const repoGoal = c.project ? projects.get(c.project) : undefined;
    const owner = repoGoal ? null : ownerOf(c.workingDir, places);
    for (const port of c.ports) {
      const base = { port, pid: null, process: 'docker', cwd: c.workingDir, container: c.name, url: null };
      if (repoGoal) add({ ...base, goalId: null, taskId: null, category: 'foundry', kind: 'service', label: `Service · ${c.name}`, detail: `Docker service Foundry runs for ${repoGoal.repoPath.split('/').pop()}`, release: { allowed: true, confirm: `Stop the Docker service ${c.name}? Its container and data are kept; the next preview start brings it back.`, reason: null } });
      else if (owner) add({ ...base, goalId: owner.goal.id, taskId: owner.task?.id ?? null, category: 'foundry', kind: 'task', label: `Task container · ${c.name}`, detail: owner.task ? `${owner.goal.title} · ${owner.task.title}` : owner.goal.title, release: { allowed: true, confirm: `Stop the container ${c.name}? ${owner.task ? `"${owner.task.title}" may be using it.` : 'Something in this goal may be using it.'} The whole container stops, not only this port.`, reason: null } });
      else add({ ...base, goalId: null, taskId: null, category: 'docker', kind: 'container', label: `Docker · ${c.name}`, detail: c.project ? `compose project ${c.project}` : null, release: { allowed: true, confirm: `Stop the container ${c.name}? The whole container stops, not only port ${port}.`, reason: null } });
    }
  }

  const order: Record<PortCategory, number> = { foundry: 0, tailscale: 1, docker: 2, process: 3, unknown: 4 };
  rows.sort((a, b) => order[a.category] - order[b.category] || a.port - b.port);
  return { rows, inContainer, scannedAt: new Date().toISOString() };
}

/** a command's last path part: `/Applications/Docker.app/…/com.docker.backend` → `com.docker.backend` */
function shortName(command: string | null): string | null {
  if (!command) return null;
  const first = command.includes('.app/') ? command.slice(command.lastIndexOf('/') + 1) : command.split(' ')[0]!.split('/').pop()!;
  return first || command;
}

export class PortError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 = 409,
  ) {
    super(message);
  }
}

/**
 * Stop what holds one row's port. The row is looked up again first, so a port that changed hands since the page
 * loaded is never released by mistake. Goal-related releases are noted on the goal.
 */
export async function releasePort(engine: Engine, id: string, deps: PortsDeps = {}): Promise<{ released: PortRow }> {
  const row = (await listPorts(engine, deps)).rows.find((r) => r.id === id);
  if (!row) throw new PortError('that port is no longer held the way the page showed it; refresh and try again', 404);
  if (!row.release.allowed) throw new PortError(`port ${row.port} cannot be released here: ${row.release.reason ?? 'not allowed'}`);
  const kill = deps.kill ?? ((pid, sig) => process.kill(pid, sig));
  const alive = deps.alive ?? ((pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  });
  switch (row.kind) {
    case 'preview': {
      const app = engine.preview.livePorts().find((v) => v.port === row.port || v.others.includes(row.port));
      if (app) await engine.preview.stop(app.goalId, 'human', app.key);
      break;
    }
    case 'editor':
      await engine.codeServer.stop();
      break;
    case 'serve-foundry':
    case 'serve-person':
      await (deps.stopServe ?? ((p: number) => engine.tailnet.stopServe(p)))(row.port);
      break;
    case 'service':
    case 'container':
    case 'task':
      if (row.container) {
        await (deps.dockerStop ?? dockerStop)(row.container);
        break;
      }
      await stopProcess(row.pid!, kill, alive);
      break;
    case 'process':
      await stopProcess(row.pid!, kill, alive);
      break;
    default:
      throw new PortError(`port ${row.port} cannot be released here`);
  }
  const what = `${row.label}${row.detail && row.kind !== 'preview' ? ` (${row.detail})` : ''} on port ${row.port}`;
  if (row.goalId) engine.store.append({ type: 'engine.note', goalId: row.goalId, payload: { level: 'info', message: `you stopped ${what} on the Ports page` } });
  engine.config.log(`[ports] released ${what}`);
  return { released: row };
}

async function dockerStop(container: string): Promise<void> {
  const r = await runInGroup(['docker', 'stop', container], { cwd: '/', timeoutMs: 60_000 });
  if (r.code !== 0) throw new PortError(`docker stop ${container} failed: ${(r.stderr || r.stdout).trim().slice(0, 200)}`);
}

/** SIGTERM, then SIGKILL when it is still there after three seconds */
async function stopProcess(pid: number, kill: (pid: number, sig: NodeJS.Signals) => void, alive: (pid: number) => boolean): Promise<void> {
  try {
    kill(pid, 'SIGTERM');
  } catch {
    return; // already gone
  }
  for (let i = 0; i < 30 && alive(pid); i++) await new Promise((r) => setTimeout(r, 100));
  if (alive(pid)) {
    try {
      kill(pid, 'SIGKILL');
    } catch {}
  }
}
