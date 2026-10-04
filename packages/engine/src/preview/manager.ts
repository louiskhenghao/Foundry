import { createServer } from 'node:net';
import { join } from 'node:path';
import type { BriefApp, BriefRun, Goal } from '@foundry/core';
import { getBrief, getGoal } from '@foundry/core';
import type { Engine } from '../engine.ts';
import { goalWorkspacePath } from '../workspace.ts';
import { detectApps, detectRun, previewBindHost } from './detect.ts';
import { ServicesManager } from './services.ts';

export type PreviewStarter = 'human' | 'milestone' | 'integration';

/** one app of the goal's preview */
export interface PreviewAppStatus {
  key: string;
  name: string;
  /** folder relative to the progress folder; '' = its root */
  dir: string;
  running: boolean;
  /** the port answered an HTTP request */
  ready: boolean;
  port: number | null;
  url: string | null;
  command: string | null;
  startedAt: string | null;
  startedBy: PreviewStarter | null;
  lastVisitAt: string | null;
  /** last lines of the dev server's output */
  log: string[];
  /** the live-log channel of this app's output */
  channel: string;
  run: BriefApp;
  /** why the last start failed or the process died, or null */
  error: string | null;
}

/**
 * The goal's preview. The top-level fields describe its primary app (the first one, the one a person looks at first),
 * which is what milestones, the self-check and single-app goals use; `apps` has every app.
 */
export interface PreviewStatus {
  running: boolean;
  ready: boolean;
  port: number | null;
  url: string | null;
  command: string | null;
  startedAt: string | null;
  startedBy: PreviewStarter | null;
  lastVisitAt: string | null;
  log: string[];
  /** how the engine would start (or started) the primary app; null = nothing startable */
  run: BriefRun | null;
  source: 'brief' | 'detected' | null;
  error: string | null;
  apps: PreviewAppStatus[];
}

export class PreviewError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 404 | 409 = 400,
  ) {
    super(message);
  }
}

interface Live {
  goalId: string;
  key: string;
  proc: ReturnType<typeof Bun.spawn>;
  port: number;
  url: string;
  command: string;
  startedAt: string;
  startedBy: PreviewStarter;
  lastVisitAt: string;
  ready: boolean;
  log: string[];
  stopping: boolean;
}

const LOG_LINES = 200;
const READY_TIMEOUT_MS = 90_000;
const id = (goalId: string, key: string) => `${goalId}/${key}`;
/** FOUNDRY_APP_<KEY>_URL: how one app finds another (a web app its API) */
export const appUrlVar = (key: string) => `FOUNDRY_APP_${key.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_URL`;

/**
 * The goal's apps, each its own dev server in its folder of the goal's progress folder, on ports from Settings → Preview:
 * one app for most repositories, several for a monorepo (from the Brief's apps, else package.json workspaces). Before
 * apps start, the Docker services they need are brought up (see ServicesManager). Started by a person (one app or all),
 * at a milestone, or restarted after an integration; an app stops when nobody has opened the preview for `idleMinutes`,
 * when the goal ends, or when the engine shuts down.
 */
export class PreviewManager {
  private live = new Map<string, Live>();
  private lastError = new Map<string, string>();
  private sweeper: ReturnType<typeof setInterval> | null = null;
  readonly services: ServicesManager;

  constructor(private engine: Engine) {
    this.services = new ServicesManager({ inContainer: () => !!process.env.FOUNDRY_DOCKER, portFree, log: (l) => engine.config.log(l) });
  }

  startSweeper(): void {
    if (!this.sweeper) this.sweeper = setInterval(() => void this.sweep(), 60_000);
  }
  stopSweeper(): void {
    if (this.sweeper) clearInterval(this.sweeper);
    this.sweeper = null;
  }

  /** the apps that apply: the Brief's apps, else its run command, else package.json workspaces, else the root package.json */
  resolveApps(goal: Goal): { apps: BriefApp[]; source: 'brief' | 'detected' } | null {
    const brief = getBrief(this.engine.store.db, goal.id)?.brief;
    const startable = (apps: BriefApp[]) => apps.filter((a) => a.command);
    if (brief?.apps?.length && startable(brief.apps).length) return { apps: startable(brief.apps), source: 'brief' };
    if (brief?.run?.command) return { apps: [{ key: 'app', name: 'App', dir: '', ...brief.run }], source: 'brief' };
    const ws = this.workspace(goal);
    const host = previewBindHost();
    const apps = detectApps(ws, { host });
    if (apps.length) return { apps, source: 'detected' };
    const run = detectRun(ws, { host });
    return run ? { apps: [{ key: 'app', name: 'App', dir: '', ...run }], source: 'detected' } : null;
  }

  /** the primary app's run section (single-app view, kept for callers that start one thing) */
  resolveRun(goal: Goal): { run: BriefRun; source: 'brief' | 'detected' } | null {
    const r = this.resolveApps(goal);
    if (!r) return null;
    const { key: _k, name: _n, dir: _d, ...run } = r.apps[0]!;
    return { run, source: r.source };
  }

  status(goalId: string): PreviewStatus {
    const goal = getGoal(this.engine.store.db, goalId);
    const resolved = goal ? this.resolveApps(goal) : null;
    // apps still running from an earlier resolution (the Brief changed) stay visible until stopped
    const keys = [...(resolved?.apps.map((a) => a.key) ?? []), ...[...this.live.values()].filter((l) => l.goalId === goalId).map((l) => l.key)];
    const apps = [...new Set(keys)].map((key) => this.appStatus(goalId, key, resolved?.apps.find((a) => a.key === key) ?? null));
    const primary = apps[0];
    const { key: _k, name: _n, dir: _d, ...run } = primary?.run ?? ({} as BriefApp);
    return {
      running: apps.some((a) => a.running),
      ready: primary?.ready ?? false,
      port: primary?.port ?? null,
      url: primary?.url ?? null,
      command: primary?.command ?? null,
      startedAt: primary?.startedAt ?? null,
      startedBy: primary?.startedBy ?? null,
      lastVisitAt: primary?.lastVisitAt ?? null,
      log: primary?.log ?? [],
      run: primary ? (run as BriefRun) : null,
      source: resolved?.source ?? null,
      error: primary?.error ?? null,
      apps,
    };
  }

  private appStatus(goalId: string, key: string, run: BriefApp | null): PreviewAppStatus {
    const l = this.live.get(id(goalId, key));
    return {
      key,
      name: run?.name ?? key,
      dir: run?.dir ?? '',
      running: !!l,
      ready: l?.ready ?? false,
      port: l?.port ?? null,
      url: l?.url ?? null,
      command: l?.command ?? null,
      startedAt: l?.startedAt ?? null,
      startedBy: l?.startedBy ?? null,
      lastVisitAt: l?.lastVisitAt ?? null,
      log: l?.log.slice(-40) ?? [],
      channel: `preview-${goalId}-${key}`,
      run: run ?? { key, name: key, dir: '', install: null, command: l?.command ?? null, url: l?.url ?? null, platform: 'none' },
      error: this.lastError.get(id(goalId, key)) ?? null,
    };
  }

  /** the person opened the preview: keeps the idle timer from stopping its apps */
  touch(goalId: string): void {
    const now = new Date().toISOString();
    for (const l of this.live.values()) if (l.goalId === goalId) l.lastVisitAt = now;
  }

  /**
   * Start one app (`appKey`) or every app that is not running yet, after bringing up the Docker services they need.
   * Every app gets the others' addresses as FOUNDRY_APP_<KEY>_URL, so ports are given out before any app starts.
   */
  async start(goal: Goal, by: PreviewStarter, appKey?: string): Promise<PreviewStatus> {
    const resolved = this.resolveApps(goal);
    if (!resolved) throw new PreviewError('nothing to run: the Brief has no run command and package.json has no dev/start script', 409);
    const targets = resolved.apps.filter((a) => (!appKey || a.key === appKey) && !this.live.has(id(goal.id, a.key)));
    if (appKey && !resolved.apps.some((a) => a.key === appKey)) throw new PreviewError(`no app "${appKey}" in this goal's preview`, 404);
    this.touch(goal.id);
    if (!targets.length) return this.status(goal.id);
    const ws = this.workspace(goal);
    const services = await this.services.up(goal, ws).catch((err) => {
      this.engine.config.log(`[preview] ${goal.id}: services: ${String((err as Error).message ?? err)}`);
      return null;
    });
    const ports = new Map<string, number>();
    for (const a of targets) ports.set(a.key, await this.freePort([...ports.values()]));
    const urls: Record<string, string> = {};
    for (const a of resolved.apps) {
      const live = this.live.get(id(goal.id, a.key));
      const port = live?.port ?? ports.get(a.key);
      if (port != null) urls[appUrlVar(a.key)] = live?.url ?? (a.url ?? 'http://localhost:{port}').replaceAll('{port}', String(port));
    }
    const note = services?.error ? `[services] ${services.error}` : services && services.docker !== 'available' ? `[services] ${services.docker === 'in-container' ? 'Foundry runs in Docker without access to Docker' : 'docker is not installed'}; start them yourself: ${services.command}` : null;
    await Promise.all(targets.map((a) => this.startApp(goal, a, ws, ports.get(a.key)!, urls, by, note)));
    return this.status(goal.id);
  }

  private async startApp(goal: Goal, app: BriefApp, ws: string, port: number, urls: Record<string, string>, by: PreviewStarter, note: string | null): Promise<void> {
    const { store, config } = this.engine;
    const key = id(goal.id, app.key);
    const command = app.command!.replaceAll('{port}', String(port));
    const url = urls[appUrlVar(app.key)]!;
    const now = new Date().toISOString();
    const entry: Live = { goalId: goal.id, key: app.key, proc: null as unknown as Live['proc'], port, url, command, startedAt: now, startedBy: by, lastVisitAt: now, ready: false, log: [], stopping: false };
    const channel = `preview-${goal.id}-${app.key}`;
    const push = (line: string) => {
      entry.log.push(line);
      if (entry.log.length > LOG_LINES) entry.log.splice(0, entry.log.length - LOG_LINES);
      this.engine.broadcast({ goalId: goal.id, taskId: null, attemptId: channel, event: { kind: 'text', text: line }, ts: new Date().toISOString() });
    };
    if (note) push(note);
    push(`$ ${command}  (port ${port}${app.dir ? `, in ${app.dir}` : ''})`);
    // in Docker, servers that read HOST (or HOSTNAME, Next's standalone server) listen on every interface too
    const host = previewBindHost();
    const bind = host ? { HOST: host, HOSTNAME: host } : {};
    entry.proc = Bun.spawn(['sh', '-lc', command], { cwd: app.dir ? join(ws, app.dir) : ws, stdout: 'pipe', stderr: 'pipe', env: { ...process.env, ...this.engine.sessionEnvExtra(), ...urls, PORT: String(port), ...bind, BROWSER: 'none', FORCE_COLOR: '0', NO_COLOR: '1' }, detached: true });
    this.live.set(key, entry);
    this.lastError.delete(key);
    void pump(entry.proc.stdout as ReadableStream<Uint8Array>, push);
    void pump(entry.proc.stderr as ReadableStream<Uint8Array>, push);
    void entry.proc.exited.then((code) => {
      if (this.live.get(key) !== entry) return;
      this.live.delete(key);
      const reason = entry.stopping ? 'stopped' : `exited with code ${code}`;
      if (!entry.stopping) this.lastError.set(key, reason);
      push(`[preview ${reason}]`);
      store.append({ type: 'preview.stopped', goalId: goal.id, payload: { reason, app: app.key } });
    });
    store.append({ type: 'preview.started', goalId: goal.id, payload: { port, url, command, app: app.key } });
    config.log(`[preview] ${goal.id}/${app.key}: ${command} → ${url} (${by})`);
    entry.ready = await waitForHttp(url, READY_TIMEOUT_MS, () => this.live.get(key) === entry);
    if (!entry.ready && this.live.get(key) === entry) push(`[preview] ${url} did not answer within ${READY_TIMEOUT_MS / 1000}s — the server may still be starting`);
  }

  /** stop one app, or every app of the goal; Docker services keep running */
  async stop(goalId: string, reason: string, appKey?: string): Promise<void> {
    const entries = [...this.live.values()].filter((l) => l.goalId === goalId && (!appKey || l.key === appKey));
    await Promise.all(entries.map((l) => this.stopEntry(l, reason)));
  }

  private async stopEntry(l: Live, reason: string): Promise<void> {
    const key = id(l.goalId, l.key);
    l.stopping = true;
    // the dev server is a grandchild of the shell (sh → npm → sh → vite): the shell leads its own process group, so
    // signal the whole group. No pkill needed (the Docker image has none).
    try {
      process.kill(-l.proc.pid, 'SIGTERM');
    } catch {
      /* the group is already gone */
    }
    l.proc.kill();
    await Promise.race([l.proc.exited, new Promise((r) => setTimeout(r, 3000))]);
    if (this.live.get(key) === l) {
      this.live.delete(key);
      this.engine.store.append({ type: 'preview.stopped', goalId: l.goalId, payload: { reason, app: l.key } });
    }
    this.engine.config.log(`[preview] ${key}: stopped (${reason})`);
  }

  /** after an integration: the running apps pick up the new code */
  async restartIfRunning(goal: Goal): Promise<void> {
    const running = [...this.live.values()].filter((l) => l.goalId === goal.id).map((l) => l.key);
    if (!running.length) return;
    await this.stop(goal.id, 'restart after integration');
    for (const key of running) await this.start(goal, 'integration', key).catch((err) => this.engine.config.log(`[preview] ${goal.id}/${key}: restart failed: ${String((err as Error).message ?? err)}`));
  }

  async stopAll(reason: string): Promise<void> {
    await Promise.all([...this.live.values()].map((l) => this.stopEntry(l, reason)));
  }

  private workspace(goal: Goal): string {
    return goalWorkspacePath(this.engine.config.dataDir, goal);
  }

  /** the goal's Docker services; null = no compose file with dependency services */
  servicesStatus(goal: Goal) {
    return this.services.status(goal, this.workspace(goal));
  }
  servicesUp(goal: Goal, names?: string[]) {
    return this.services.up(goal, this.workspace(goal), names);
  }
  servicesStop(goal: Goal, names?: string[]) {
    return this.services.stop(goal, this.workspace(goal), names);
  }

  private async sweep(): Promise<void> {
    const idleMs = this.engine.config.preview.idleMinutes * 60_000;
    const now = Date.now();
    for (const l of [...this.live.values()]) {
      const goal = getGoal(this.engine.store.db, l.goalId);
      const ended = !goal || ['done', 'over_delivered', 'failed', 'cancelled'].includes(goal.state);
      if (ended) await this.stopEntry(l, 'goal ended');
      else if (goal.state !== 'awaiting_feedback' && now - Date.parse(l.lastVisitAt) > idleMs) await this.stopEntry(l, `idle for ${this.engine.config.preview.idleMinutes} min`);
    }
  }

  private async freePort(reserved: number[] = []): Promise<number> {
    const { portFrom, portTo } = this.engine.config.preview;
    const taken = new Set([...[...this.live.values()].map((l) => l.port), ...reserved]);
    for (let p = Math.min(portFrom, portTo); p <= Math.max(portFrom, portTo); p++) {
      if (taken.has(p)) continue;
      if (await portFree(p)) return p;
    }
    throw new PreviewError(`no free port between ${portFrom} and ${portTo} (Settings → Preview)`, 409);
  }
}

async function pump(stream: ReadableStream<Uint8Array>, onLine: (l: string) => void): Promise<void> {
  const reader = stream.getReader();
  const dec = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i: number;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).replace(/\r$/, '');
        buf = buf.slice(i + 1);
        if (line.trim()) onLine(line);
      }
    }
    if (buf.trim()) onLine(buf);
  } catch {
    /* stream closed with the process */
  }
}

function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.once('error', () => resolve(false));
    srv.listen(port, '127.0.0.1', () => srv.close(() => resolve(true)));
  });
}

async function waitForHttp(url: string, timeoutMs: number, stillWanted: () => boolean): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs && stillWanted()) {
    try {
      await fetch(url, { signal: AbortSignal.timeout(2000), redirect: 'manual' });
      return true; // any HTTP answer means the server is up
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  return false;
}
