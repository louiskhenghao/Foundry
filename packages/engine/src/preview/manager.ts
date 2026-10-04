import { createServer } from 'node:net';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { spawnStreaming } from '../skills/updaters.ts';
import type { BriefApp, BriefRun, Goal } from '@foundry/core';
import { getBrief, getGoal } from '@foundry/core';
import type { Engine } from '../engine.ts';
import { goalWorkspacePath } from '../workspace.ts';
import { detectApps, detectRun, packageManager, previewBindHost } from './detect.ts';
import { checkoutEnv, exampleKeys, fileKeys, PreviewEnvStore, redactor } from './env.ts';
import { listeningPorts } from './listeners.ts';
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
  /** the last lines the app printed before it failed */
  errorDetail: string[];
  /** something to know while it runs: it did not answer in time, its dependencies failed to install */
  warning: string | null;
  /** other servers its command started (a demo script, `turbo dev`), found from the ports its processes listen on */
  discovered: { port: number; url: string; name: string; dir: string | null }[];
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
  /** where the apps run: the goal's progress folder on the goal's branch, not the person's checkout */
  workspace: { path: string; branch: string } | null;
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
  warning: string | null;
  discovered: PreviewAppStatus['discovered'];
  /** every port the command's processes listen on, HTTP or not: kept from other previews */
  reserved: number[];
  /** per discovered port: true once it answered HTTP, else how many probes went unanswered */
  probes: Map<number, true | number>;
  discovery: ReturnType<typeof setInterval> | null;
  discovering: boolean;
}

const LOG_LINES = 200;
const READY_TIMEOUT_MS = 90_000;
const DISCOVERY_MS = 10_000;
const PROBE_TRIES = 6;
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
  private lastError = new Map<string, { reason: string; detail: string[] }>();
  readonly env: PreviewEnvStore;
  private sweeper: ReturnType<typeof setInterval> | null = null;
  readonly services: ServicesManager;

  constructor(private engine: Engine) {
    this.env = new PreviewEnvStore(engine.config.dataDir);
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
      workspace: goal ? { path: this.workspace(goal), branch: goal.branch } : null,
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
      error: this.lastError.get(id(goalId, key))?.reason ?? null,
      errorDetail: this.lastError.get(id(goalId, key))?.detail ?? [],
      warning: l?.warning ?? null,
      discovered: l?.discovered ?? [],
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
    const installed = await this.installDependencies(goal, ws, targets);
    await Promise.all(targets.map((a) => this.startApp(goal, a, ws, ports.get(a.key)!, urls, by, [...(note ? [note] : []), ...installed.lines], installed.failed)));
    return this.status(goal.id);
  }

  /**
   * A fresh progress folder may have no node_modules yet (nothing installed them, or a task changed the manifest and
   * removed them), and a dev server then fails at once. Before apps start, run each app's install command, or the
   * repository's package-manager install, wherever a package.json has no node_modules beside it or at the root.
   * Output streams to the apps' logs; the returned tail is kept at the top of each app's log.
   */
  private async installDependencies(goal: Goal, ws: string, apps: BriefApp[]): Promise<{ lines: string[]; failed: string | null }> {
    const steps = installSteps(ws, apps);
    const lines: string[] = [];
    let failed: string | null = null;
    const say = (line: string) => {
      lines.push(line);
      for (const a of apps) this.engine.broadcast({ goalId: goal.id, taskId: null, attemptId: `preview-${goal.id}-${a.key}`, event: { kind: 'text', text: line }, ts: new Date().toISOString() });
    };
    for (const step of steps) {
      say(`$ ${step.command}${step.dir ? `  (in ${step.dir})` : ''}  — installing dependencies first`);
      const r = await spawnStreaming(['sh', '-lc', step.command], join(ws, step.dir), say, { timeoutMs: 10 * 60_000 }).catch((e) => ({ code: 1, error: String(e) }) as { code: number });
      say(r.code === 0 ? '[install done]' : `[install failed: exit ${r.code}] the app may not start; fix the install command in the Brief's How to run it`);
      if (r.code !== 0) failed = `installing dependencies failed: \`${step.command}\` exited ${r.code} — see the output`;
      this.engine.config.log(`[preview] ${goal.id}: ${step.command} exited ${r.code}`);
    }
    return { lines: lines.slice(-40), failed };
  }

  /**
   * The environment for an app's processes: Foundry's own environment and session keys, then the variables entered
   * (or imported) for the repository. Foundry's own variables (PORT, app addresses, HOST) are added by the caller and
   * win. Installs do not get the entered variables: a NODE_ENV=production there would skip devDependencies.
   */
  private processEnv(goal: Goal): Record<string, string> {
    return { ...(process.env as Record<string, string>), ...this.engine.sessionEnvExtra(), ...this.env.get(goal.repoPath).vars };
  }

  /**
   * A function hiding the repository's entered values in text that leaves the preview: its output, failure lines,
   * self-check reports. Never throws: an unreadable variables file means there is nothing it could know to hide.
   */
  redactorFor(goal: Goal): (text: string) => string {
    try {
      return redactor(Object.values(this.env.get(goal.repoPath).vars));
    } catch {
      return (t) => t;
    }
  }
  redact(goal: Goal, text: string): string {
    return this.redactorFor(goal)(text);
  }

  /**
   * What the Environment panel shows: the names of the entered variables (never their values), the checkout's
   * untracked env files that could be imported, and keys example files mention that nothing provides yet.
   */
  envView(goal: Goal) {
    const ws = this.workspace(goal);
    const dirs = [...new Set((this.resolveApps(goal)?.apps ?? []).map((a) => a.dir).filter(Boolean))];
    const { rev, vars } = this.env.get(goal.repoPath);
    const checkout = checkoutEnv(goal.repoPath, dirs);
    const example = exampleKeys(ws, dirs);
    const tracked = fileKeys(ws, dirs);
    const inherited = { ...(process.env as Record<string, string>), ...this.engine.sessionEnvExtra() };
    const own = new Set(['PORT', ...(previewBindHost() ? ['HOST', 'HOSTNAME'] : [])]);
    const provided = (k: string) => k in vars || tracked.has(k) || k in inherited || own.has(k) || k.startsWith('FOUNDRY_APP_');
    // keys without an example value have no default, so they come first; example files list optional keys too
    const missing = example.filter((e) => !provided(e.key)).sort((a, b) => Number(!!a.example.trim()) - Number(!!b.example.trim())).map((e) => e.key);
    return { repo: goal.repoPath, rev, keys: Object.keys(vars).sort(), checkout: { files: checkout.files, keys: Object.keys(checkout.vars).sort() }, example, missing };
  }

  /** replace the entered set; null keeps a key's stored value */
  setEnv(goal: Goal, vars: Record<string, string | null>, rev: number) {
    this.env.set(goal.repoPath, vars, rev);
    return this.envView(goal);
  }

  /** copy the checkout's untracked env files into the entered set, keeping keys already entered */
  importCheckoutEnv(goal: Goal) {
    const dirs = [...new Set((this.resolveApps(goal)?.apps ?? []).map((a) => a.dir).filter(Boolean))];
    const added = this.env.merge(goal.repoPath, checkoutEnv(goal.repoPath, dirs).vars);
    return { added, view: this.envView(goal) };
  }

  private async startApp(goal: Goal, app: BriefApp, ws: string, port: number, urls: Record<string, string>, by: PreviewStarter, preface: string[], warning: string | null): Promise<void> {
    const { store, config } = this.engine;
    const key = id(goal.id, app.key);
    const command = app.command!.replaceAll('{port}', String(port));
    const url = urls[appUrlVar(app.key)]!;
    const now = new Date().toISOString();
    const entry: Live = { goalId: goal.id, key: app.key, proc: null as unknown as Live['proc'], port, url, command, startedAt: now, startedBy: by, lastVisitAt: now, ready: false, log: [], stopping: false, warning, discovered: [], reserved: [], probes: new Map(), discovery: null, discovering: false };
    const channel = `preview-${goal.id}-${app.key}`;
    const env = this.processEnv(goal);
    const redact = this.redactorFor(goal);
    const push = (raw: string) => {
      const line = redact(raw);
      entry.log.push(line);
      if (entry.log.length > LOG_LINES) entry.log.splice(0, entry.log.length - LOG_LINES);
      this.engine.broadcast({ goalId: goal.id, taskId: null, attemptId: channel, event: { kind: 'text', text: line }, ts: new Date().toISOString() });
    };
    for (const line of preface) push(line);
    push(`$ ${command}  (port ${port}${app.dir ? `, in ${app.dir}` : ''})`);
    // in Docker, servers that read HOST (or HOSTNAME, Next's standalone server) listen on every interface too
    const host = previewBindHost();
    const bind = host ? { HOST: host, HOSTNAME: host } : {};
    entry.proc = Bun.spawn(['sh', '-lc', command], { cwd: app.dir ? join(ws, app.dir) : ws, stdout: 'pipe', stderr: 'pipe', env: { ...env, ...urls, PORT: String(port), ...bind, BROWSER: 'none', FORCE_COLOR: '0', NO_COLOR: '1' }, detached: true });
    this.live.set(key, entry);
    this.lastError.delete(key);
    void pump(entry.proc.stdout as ReadableStream<Uint8Array>, push);
    void pump(entry.proc.stderr as ReadableStream<Uint8Array>, push);
    void entry.proc.exited.then((code) => {
      if (entry.discovery) clearInterval(entry.discovery);
      if (this.live.get(key) !== entry) return;
      this.live.delete(key);
      const reason = entry.stopping ? 'stopped' : `exited with code ${code}`;
      if (!entry.stopping) this.lastError.set(key, { reason, detail: failureTail(entry.log) });
      push(`[preview ${reason}]`);
      store.append({ type: 'preview.stopped', goalId: goal.id, payload: { reason, app: app.key } });
    });
    store.append({ type: 'preview.started', goalId: goal.id, payload: { port, url, command, app: app.key } });
    config.log(`[preview] ${goal.id}/${app.key}: ${command} → ${url} (${by})`);
    // look for the command's other servers from the start: one that ignores PORT is found before readiness gives up
    setTimeout(() => {
      if (!this.current(entry)) return;
      void this.discover(entry, ws);
      entry.discovery = setInterval(() => void this.discover(entry, ws), DISCOVERY_MS);
    }, 3_000);
    entry.ready = await waitForHttp(url, READY_TIMEOUT_MS, () => this.current(entry));
    if (!entry.ready && this.current(entry)) {
      entry.warning = `${url} did not answer within ${READY_TIMEOUT_MS / 1000} s; it may still be starting, or the command ignores PORT ({port} in the Brief's How to run it)`;
      push(`[preview] ${entry.warning}`);
    }
  }

  /** the entry is still the live, not-stopping process of its app */
  private current(entry: Live): boolean {
    return !entry.stopping && this.live.get(id(entry.goalId, entry.key)) === entry;
  }

  /**
   * The other servers an app's command started, from the ports its process tree listens on. Every such port is kept
   * from other previews; only those that answer HTTP are listed (not a debugger's or a dev server's internal port).
   * An app that missed the readiness window but answers now is marked ready.
   */
  private async discover(entry: Live, ws: string): Promise<void> {
    if (entry.discovering) return;
    entry.discovering = true;
    try {
      const found = (await listeningPorts(entry.proc.pid)).filter((l) => l.port !== entry.port);
      // probe a port until it answers, then never again (dev servers log every request); give up after a few tries
      const http = await Promise.all(
        found.map(async (l) => {
          const known = entry.probes.get(l.port);
          if (known === true || (known ?? 0) >= PROBE_TRIES) return known === true;
          const ok = await answersLocal(l.port);
          entry.probes.set(l.port, ok || ((known as number | undefined) ?? 0) + 1);
          return ok;
        }),
      );
      const late = !entry.ready ? await answers(entry.url) : false;
      if (!this.current(entry)) {
        if (entry.discovery) clearInterval(entry.discovery);
        return;
      }
      entry.reserved = found.map((l) => l.port);
      entry.discovered = found.filter((_, i) => http[i]).map((l) => ({ port: l.port, url: `http://localhost:${l.port}`, ...serverName(ws, l.cwd) }));
      if (late) {
        entry.ready = true;
        entry.warning = null;
      }
    } finally {
      entry.discovering = false;
    }
  }

  /** stop one app, or every app of the goal; Docker services keep running */
  async stop(goalId: string, reason: string, appKey?: string): Promise<void> {
    const entries = [...this.live.values()].filter((l) => l.goalId === goalId && (!appKey || l.key === appKey));
    await Promise.all(entries.map((l) => this.stopEntry(l, reason)));
  }

  private async stopEntry(l: Live, reason: string): Promise<void> {
    const key = id(l.goalId, l.key);
    l.stopping = true;
    if (l.discovery) clearInterval(l.discovery);
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
    // ports a running preview's other servers took (a demo script's admin on PORT+1) are not handed out again
    const taken = new Set([...[...this.live.values()].flatMap((l) => [l.port, ...l.reserved]), ...reserved]);
    for (let p = Math.min(portFrom, portTo); p <= Math.max(portFrom, portTo); p++) {
      if (taken.has(p)) continue;
      if (await portFree(p)) return p;
    }
    throw new PreviewError(`no free port between ${portFrom} and ${portTo} (Settings → Preview)`, 409);
  }
}

/**
 * The installs a set of apps needs before starting: each app's own install command where its folder has a package.json
 * but no node_modules (neither beside it nor at the root, where workspaces hoist them); without any app install command,
 * the repository's package-manager install when the root has a package.json and no node_modules. Folders without a
 * package.json are left alone: their install command, if any, is the person's to run.
 */
export function installSteps(ws: string, apps: BriefApp[]): { dir: string; command: string }[] {
  const missing = (dir: string) => existsSync(join(ws, dir, 'package.json')) && !existsSync(join(ws, dir, 'node_modules')) && !existsSync(join(ws, 'node_modules'));
  const steps = new Map<string, { dir: string; command: string }>();
  for (const a of apps) if (a.install && missing(a.dir)) steps.set(`${a.dir}\0${a.install}`, { dir: a.dir, command: a.install });
  if (!steps.size && !apps.some((a) => a.install) && missing('')) steps.set('root', { dir: '', command: `${packageManager(ws)} install` });
  return [...steps.values()];
}

/** lines that restate the command or the exit code: Foundry's markers and npm, pnpm, yarn and bun's run banners */
const NOISE = [
  /^\[(preview|install|services)\b/,
  /^\$ /,
  /^> /,
  /^\s*ELIFECYCLE\b/,
  /^yarn run v\d/,
  /^error Command failed with exit code \d+/,
  /^info Visit https:\/\/yarnpkg\.com/,
  /^error: script ".*" exited with code \d+/,
  /^npm (error|ERR!) (code \d+|path |command |workspace |location |Lifecycle script|A complete log)/,
];

/** the last lines worth showing when an app failed: its own output, not the run banners around it */
export function failureTail(log: string[], max = 8): string[] {
  return log.filter((l) => l.trim() && !NOISE.some((re) => re.test(l))).slice(-max);
}

/** a discovered server's name: the package in the folder it runs in (`@acme/admin` → admin), else the folder */
export function serverName(ws: string, cwd: string | null): { name: string; dir: string | null } {
  if (!cwd) return { name: 'server', dir: null };
  // lsof and /proc report resolved paths (/private/var/… on macOS), so compare against the resolved workspace
  const real = (p: string) => {
    try {
      return realpathSync(p);
    } catch {
      return p;
    }
  };
  const rel = relative(real(ws), real(cwd));
  const dir = rel.startsWith('..') ? null : rel;
  let pkg: string | null = null;
  try {
    const name = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8')).name;
    pkg = typeof name === 'string' ? name.replace(/^@[^/]+\//, '') : null;
  } catch {}
  return { name: pkg || basename(cwd) || 'server', dir };
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

/** does a server answer HTTP on this port, over IPv4 or IPv6 (Node ≥ 17 may bind `localhost` to ::1 only)? */
async function answersLocal(port: number): Promise<boolean> {
  return (await answers(`http://127.0.0.1:${port}`)) || answers(`http://[::1]:${port}`);
}

/** one HTTP request: does anything answer there? */
async function answers(url: string): Promise<boolean> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(1500), redirect: 'manual' });
    return true;
  } catch {
    return false;
  }
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
