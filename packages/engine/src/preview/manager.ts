import { createServer } from 'node:net';
import { hostname } from 'node:os';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { spawnStreaming } from '../skills/updaters.ts';
import type { BriefApp, BriefRun, Goal, PreviewPlace } from '@foundry/core';
import { getBrief, getGoal, repoHere } from '@foundry/core';
import type { Engine } from '../engine.ts';
import { ensureDetachedWorktree, git, gitOk } from '../git/git.ts';
import { goalWorkspacePath, previewWorkspacePath } from '../workspace.ts';
import { detectApps, detectRun, forPackageManager, packageManager, previewBindHost } from './detect.ts';
import { checkoutEnv, exampleKeys, fileKeys, keyUsage, PreviewEnvStore, redactor } from './env.ts';
import { envHint } from './env-hints.ts';
import { listeningPorts } from './listeners.ts';
import { envFiles, nativePort, rewriteLocalPorts } from './ports.ts';
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
  /** why Foundry stopped it last time, when not a person: idle, the goal ended, shutdown */
  stopped: string | null;
  /** the port it listens on when run by hand, when Foundry could tell; it keeps it when that port is free */
  nativePort: number | null;
  /** variables whose address of another app (or this one) was moved to the port that app got: names only, never values */
  rewrites: { key: string; from: number; to: number }[];
  /** its address on the person's tailnet (Tailscale), for opening it on another device; null = none */
  tailnetUrl: string | null;
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
  /** where the apps run: the goal's progress folder on the goal's branch, Foundry's preview folder, or the person's checkout */
  workspace: PreviewSource | null;
}

/** where a goal's preview runs */
export interface PreviewSource {
  /**
   * `goal`: the progress folder on the goal branch; `branch`: Foundry's preview folder, detached at `branch`;
   * `checkout`: the person's own checkout, as it is (Foundry never switches, resets or pulls it)
   */
  kind: 'goal' | 'branch' | 'checkout';
  path: string;
  branch: string;
  /** where a finished goal's preview was asked to run (Goal.previewPlace) */
  place: PreviewPlace;
  /** the branch the person's checkout is on; null = detached or not a repository */
  checkoutBranch: string | null;
  /** the preview folder is being created or brought to the branch's latest commit */
  preparing: boolean;
  /** why it runs from here when nobody picked it: the goal's folder was cleaned up after the merge */
  fallback: string | null;
}

/** a branch the preview can run from */
export interface PreviewSourceOption {
  /** null = the default (the goal branch while its folder exists, else the base branch) */
  ref: string;
  label: string;
  note: string;
  available: boolean;
}

const TERMINAL = ['done', 'over_delivered', 'failed', 'cancelled'];

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
  /** why it is being stopped (recorded on the event and shown on the card) */
  stopReason: string | null;
  warning: string | null;
  discovered: PreviewAppStatus['discovered'];
  /** every port the command's processes listen on, HTTP or not: kept from other previews */
  reserved: number[];
  /** per discovered port: true once it answered HTTP, else how many probes went unanswered */
  probes: Map<number, true | number>;
  discovery: ReturnType<typeof setInterval> | null;
  discovering: boolean;
  nativePort: number | null;
  rewrites: PreviewAppStatus['rewrites'];
  tailnetUrl: string | null;
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
  private lastStop = new Map<string, string>();
  readonly env: PreviewEnvStore;
  private sweeper: ReturnType<typeof setInterval> | null = null;
  readonly services: ServicesManager;
  /** preview folders being created or moved to their branch's latest commit, per goal */
  private preparing = new Map<string, Promise<void>>();

  constructor(private engine: Engine) {
    this.env = new PreviewEnvStore(engine.config.dataDir);
    this.services = new ServicesManager({
      inContainer: () => !!process.env.FOUNDRY_DOCKER,
      // the container's hostname is its id, which changes when an update recreates it
      hostDocker: () => (process.env.FOUNDRY_HOST_DOCKER ? { container: process.env.FOUNDRY_CONTAINER || 'foundry', dir: join(engine.config.dataDir, 'preview-compose'), id: hostname() } : null),
      portFree,
      log: (l) => engine.config.log(l),
    });
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
      workspace: goal ? this.sourceStatus(goal) : null,
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
      stopped: l ? null : (this.lastStop.get(id(goalId, key)) ?? null),
      nativePort: l?.nativePort ?? null,
      rewrites: l?.rewrites ?? [],
      tailnetUrl: l?.tailnetUrl ?? null,
    };
  }

  /** the person opened the preview: keeps the idle timer from stopping its apps */
  touch(goalId: string): void {
    const now = new Date().toISOString();
    for (const l of this.live.values()) if (l.goalId === goalId) l.lastVisitAt = now;
  }

  /**
   * Start one app (`appKey`) or every app that is not running yet, after bringing up the Docker services they need.
   * Every app gets the others' addresses as FOUNDRY_APP_<KEY>_URL, so ports are given out before any app starts. An
   * app keeps the port it uses when run by hand while that port is free, so the addresses its siblings' env files
   * name still reach it; when it gets another one, those addresses are rewritten to it in each app's environment.
   */
  async start(goal: Goal, by: PreviewStarter, appKey?: string): Promise<PreviewStatus> {
    if (!repoHere(goal)) throw new PreviewError('this goal came from another computer: map its repository to a checkout here first', 409);
    const resolved = this.resolveApps(goal);
    if (!resolved) throw new PreviewError('nothing to run: the Brief has no run command and package.json has no dev/start script', 409);
    const targets = resolved.apps.filter((a) => (!appKey || a.key === appKey) && !this.live.has(id(goal.id, a.key)));
    if (appKey && !resolved.apps.some((a) => a.key === appKey)) throw new PreviewError(`no app "${appKey}" in this goal's preview`, 404);
    this.touch(goal.id);
    if (!targets.length) return this.status(goal.id);
    await this.prepare(goal);
    const ws = this.workspace(goal);
    const services = await this.services.up(goal, ws).catch((err) => {
      this.engine.config.log(`[preview] ${goal.id}: services: ${String((err as Error).message ?? err)}`);
      return null;
    });
    const natives = new Map(resolved.apps.map((a) => [a.key, nativePort(ws, a)] as const));
    const ports = new Map<string, number>();
    for (const a of targets) {
      const native = natives.get(a.key);
      // in Docker only Settings → Preview's range is published to the host, so the usual port could not be opened
      const keep = native != null && !previewBindHost() && (await this.portAvailable(native, [...ports.values()]));
      ports.set(a.key, keep ? native : await this.freePort([...ports.values()]));
    }
    // usual port → the port the app runs on, for every app of the goal that runs elsewhere
    const moved = new Map<number, number>();
    for (const a of resolved.apps) {
      const native = natives.get(a.key);
      const port = this.live.get(id(goal.id, a.key))?.port ?? ports.get(a.key);
      if (native != null && port != null && port !== native) moved.set(native, port);
    }
    const urls: Record<string, string> = {};
    for (const a of resolved.apps) {
      const live = this.live.get(id(goal.id, a.key));
      const port = live?.port ?? ports.get(a.key);
      if (port != null) urls[appUrlVar(a.key)] = live?.url ?? (a.url ?? 'http://localhost:{port}').replaceAll('{port}', String(port));
    }
    const note = services?.error ? `[services] ${services.error}` : services && services.docker !== 'available' ? `[services] ${services.docker === 'in-container' ? 'Foundry runs in Docker without access to Docker' : 'docker is not installed'}; start them yourself: ${services.command}` : null;
    const installed = await this.installDependencies(goal, ws, targets);
    const entered = this.env.get(goal.repoPath).vars;
    await Promise.all(
      targets.map((a) => {
        const rewired = rewriteLocalPorts({ ...envFiles(ws, a.dir), ...entered }, moved);
        return this.startApp(goal, a, ws, ports.get(a.key)!, urls, by, [...(note ? [note] : []), ...installed.lines], installed.failed, { native: natives.get(a.key) ?? null, ...rewired });
      }),
    );
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
    // what each name is: the example file's comment, the files that read it, and a note for names many projects use
    const names = [...new Set([...Object.keys(vars), ...example.map((e) => e.key)])];
    const usedIn = keyUsage(ws, names);
    const notes = Object.fromEntries(
      names.map((k) => {
        const ex = example.find((e) => e.key === k);
        const hint = envHint(k);
        return [k, { comment: ex?.comment ?? null, example: ex?.example || null, file: ex?.file ?? null, usedIn: usedIn[k] ?? [], hint: hint?.text ?? null, generate: hint?.generate ?? null }];
      }),
    );
    return { repo: goal.repoPath, rev, keys: Object.keys(vars).sort(), checkout: { files: checkout.files, keys: Object.keys(checkout.vars).sort() }, example, missing, notes };
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

  private async startApp(goal: Goal, app: BriefApp, ws: string, port: number, urls: Record<string, string>, by: PreviewStarter, preface: string[], warning: string | null, wiring: { native: number | null; vars: Record<string, string>; changes: Live['rewrites'] }): Promise<void> {
    const { store, config } = this.engine;
    const key = id(goal.id, app.key);
    const command = forPackageManager(app.command!).replaceAll('{port}', String(port));
    const url = urls[appUrlVar(app.key)]!;
    const now = new Date().toISOString();
    const entry: Live = { goalId: goal.id, key: app.key, proc: null as unknown as Live['proc'], port, url, command, startedAt: now, startedBy: by, lastVisitAt: now, ready: false, log: [], stopping: false, stopReason: null, warning, discovered: [], reserved: [], probes: new Map(), discovery: null, discovering: false, nativePort: wiring.native, rewrites: wiring.changes, tailnetUrl: null };
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
    if (wiring.native != null && wiring.native !== port) push(`[preview] ${app.name} usually runs on port ${wiring.native}; here it runs on ${port}`);
    for (const c of wiring.changes) push(`[preview] ${c.key}: localhost:${c.from} → localhost:${c.to}`);
    push(`$ ${command}  (port ${port}${app.dir ? `, in ${app.dir}` : ''})`);
    // in Docker, servers that read HOST (or HOSTNAME, Next's standalone server) listen on every interface too
    const host = previewBindHost();
    const bind = host ? { HOST: host, HOSTNAME: host } : {};
    entry.proc = Bun.spawn(['sh', '-lc', command], { cwd: app.dir ? join(ws, app.dir) : ws, stdout: 'pipe', stderr: 'pipe', env: { ...env, ...wiring.vars, ...urls, PORT: String(port), ...bind, BROWSER: 'none', FORCE_COLOR: '0', NO_COLOR: '1' }, detached: true });
    this.live.set(key, entry);
    this.lastError.delete(key);
    this.lastStop.delete(key);
    void pump(entry.proc.stdout as ReadableStream<Uint8Array>, push);
    void pump(entry.proc.stderr as ReadableStream<Uint8Array>, push);
    void entry.proc.exited.then((code) => {
      if (entry.discovery) clearInterval(entry.discovery);
      if (this.live.get(key) !== entry) return;
      this.live.delete(key);
      const reason = entry.stopping ? (entry.stopReason ?? 'stopped') : `exited with code ${code}`;
      if (!entry.stopping) this.lastError.set(key, { reason, detail: failureTail(entry.log) });
      else if (entry.stopReason && entry.stopReason !== 'human') this.lastStop.set(key, entry.stopReason);
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
    // reachable from the person's phone over their tailnet, when they use Tailscale
    if (this.current(entry)) entry.tailnetUrl = await this.engine.tailnet.expose(port).catch(() => null);
    if (!this.current(entry) && entry.tailnetUrl) void this.engine.tailnet.unexpose(port);
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
    l.stopReason = reason;
    if (l.discovery) clearInterval(l.discovery);
    // the dev server is a grandchild of the shell (sh → npm → sh → vite): the shell leads its own process group, so
    // signal the whole group. No pkill needed (the Docker image has none).
    try {
      process.kill(-l.proc.pid, 'SIGTERM');
    } catch {
      /* the group is already gone */
    }
    l.proc.kill();
    if (l.tailnetUrl) void this.engine.tailnet.unexpose(l.port);
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
    return this.source(goal).path;
  }

  /**
   * Where the preview runs. While a goal is still being worked on, always its progress folder (the self-check and
   * milestones look at the goal's work). Once it is finished, the branch the person picked; by default the goal branch
   * while its folder exists, else the base branch, which holds the work once it merged and the folder was cleaned up.
   * A branch other than the goal's runs in the person's checkout when it is on that branch already (its dependencies
   * and env files are there), else in Foundry's preview folder; the person can pin either place.
   */
  source(goal: Goal): Omit<PreviewSource, 'preparing'> {
    const goalWs = goalWorkspacePath(this.engine.config.dataDir, goal);
    const alive = existsSync(goalWs);
    const base = goal.delivery.policy.baseBranch ?? goal.baseBranch;
    const place = goal.previewPlace ?? 'auto';
    const own = { kind: 'goal' as const, path: goalWs, branch: goal.branch, fallback: null, place, checkoutBranch: null };
    if (!TERMINAL.includes(goal.state)) return own;
    const checkoutBranch = currentBranch(goal.repoPath);
    if (place === 'checkout') return { kind: 'checkout', path: goal.repoPath, branch: checkoutBranch ?? 'HEAD', fallback: null, place, checkoutBranch };
    const ref = goal.previewRef ?? (alive ? goal.branch : base);
    if (ref === goal.branch && alive) return { ...own, checkoutBranch };
    const cleaned = goal.previewRef ? null : `the goal's folder was cleaned up${goal.delivery.outcome === 'merged' ? ' after the merge' : ''}, so the preview runs ${base}`;
    if (place === 'auto' && checkoutBranch === ref) return { kind: 'checkout', path: goal.repoPath, branch: ref, fallback: cleaned, place, checkoutBranch };
    return { kind: 'branch', path: previewWorkspacePath(this.engine.config.dataDir, goal), branch: ref, fallback: cleaned, place, checkoutBranch };
  }

  private sourceStatus(goal: Goal): PreviewSource {
    const s = this.source(goal);
    // the first look at a preview folder that does not exist yet creates it, so its apps can be detected
    if (s.kind === 'branch' && !existsSync(s.path) && !this.preparing.has(goal.id)) void this.prepare(goal).catch((err) => this.engine.config.log(`[preview] ${goal.id}: ${String((err as Error).message ?? err)}`));
    return { ...s, preparing: this.preparing.has(goal.id) };
  }

  /** the commit a branch name stands for: the local branch, else the remote's copy */
  private async resolveRef(repo: string, branch: string): Promise<string | null> {
    for (const ref of [`refs/heads/${branch}`, `refs/remotes/origin/${branch}`]) {
      const r = await git(['rev-parse', '--verify', '-q', `${ref}^{commit}`], repo);
      if (r.code === 0) return r.stdout.trim();
    }
    return null;
  }

  /**
   * Bring the preview folder to the latest commit of its branch: created as a detached worktree the first time, moved
   * (keeping untracked files such as node_modules) when no app of the goal runs. The progress folder and the person's
   * checkout need nothing (and the checkout is never moved).
   */
  prepare(goal: Goal): Promise<void> {
    const s = this.source(goal);
    if (s.kind !== 'branch') return Promise.resolve();
    const pending = this.preparing.get(goal.id);
    if (pending) return pending;
    const job = (async () => {
      const sha = await this.resolveRef(goal.repoPath, s.branch);
      if (!sha) throw new PreviewError(`branch ${s.branch} is not in the repository any more; pick another one`, 409);
      if (!existsSync(s.path)) return ensureDetachedWorktree(goal.repoPath, s.path, sha);
      if ([...this.live.values()].some((l) => l.goalId === goal.id)) return;
      await gitOk(['reset', '-q', '--hard', sha], s.path);
    })().finally(() => this.preparing.delete(goal.id));
    this.preparing.set(goal.id, job);
    return job;
  }

  /** the branches a finished goal's preview can run from: the goal branch, the base branch, then other local branches */
  async sources(goal: Goal): Promise<{ current: PreviewSource; options: PreviewSourceOption[]; selectable: boolean }> {
    const base = goal.delivery.policy.baseBranch ?? goal.baseBranch;
    const goalAlive = existsSync(goalWorkspacePath(this.engine.config.dataDir, goal));
    const goalSha = await this.resolveRef(goal.repoPath, goal.branch);
    const options: PreviewSourceOption[] = [
      { ref: goal.branch, label: goal.branch, note: goalAlive ? "the goal's folder" : goalSha ? 'the goal branch, in a preview folder' : 'deleted after the merge', available: goalAlive || !!goalSha },
      { ref: base, label: base, note: goal.delivery.outcome === 'merged' ? 'the base branch, with the merged work' : 'the base branch', available: !!(await this.resolveRef(goal.repoPath, base)) },
    ];
    const r = await git(['for-each-ref', '--sort=-committerdate', '--count=40', '--format=%(refname:short)', 'refs/heads/'], goal.repoPath);
    // other goals' and stacked delivery branches are not something to preview from here
    for (const b of r.stdout.split('\n').filter(Boolean)) {
      if (options.length >= 22) break;
      if (b === goal.branch || b === base || b.startsWith('goal/') || b.startsWith('task/')) continue;
      options.push({ ref: b, label: b, note: 'local branch', available: true });
    }
    return { current: this.sourceStatus(goal), options, selectable: TERMINAL.includes(goal.state) };
  }

  /**
   * Pick the branch a finished goal's preview runs from (null = the default, undefined = keep it) and, optionally, where
   * it runs; not while one of its apps runs.
   */
  async setSource(goal: Goal, ref: string | null | undefined, place?: PreviewPlace): Promise<PreviewSource> {
    if (!TERMINAL.includes(goal.state)) throw new PreviewError("while the goal is being worked on, the preview runs the goal's folder", 409);
    if ([...this.live.values()].some((l) => l.goalId === goal.id)) throw new PreviewError('stop the preview first, then pick another branch or place', 409);
    if (ref != null && !(await this.resolveRef(goal.repoPath, ref))) throw new PreviewError(`no branch ${ref} in the repository`, 404);
    if (place && place !== (goal.previewPlace ?? 'auto')) this.engine.store.append({ type: 'goal.preview_place_set', goalId: goal.id, payload: { place } });
    if (ref !== undefined && ref !== goal.previewRef) this.engine.store.append({ type: 'goal.preview_ref_set', goalId: goal.id, payload: { ref } });
    const next = getGoal(this.engine.store.db, goal.id)!;
    await this.prepare(next);
    return this.sourceStatus(next);
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
      // a preview a person started (often to look at a finished goal) is left to the idle rule; Foundry's own end with the goal
      if (!goal) await this.stopEntry(l, 'goal deleted');
      else if (ended && l.startedBy !== 'human') await this.stopEntry(l, 'goal ended');
      else if (goal.state !== 'awaiting_feedback' && now - Date.parse(l.lastVisitAt) > idleMs) await this.stopEntry(l, `idle for ${this.engine.config.preview.idleMinutes} min`);
    }
  }

  /** ports a running preview or its other servers took (a demo script's admin on PORT+1), never handed out again */
  private taken(reserved: number[]): Set<number> {
    return new Set([...[...this.live.values()].flatMap((l) => [l.port, ...l.reserved]), ...reserved]);
  }

  /** an app's usual port: free, held by no preview, and nothing (the person's own dev server on ::) answers there */
  private async portAvailable(port: number, reserved: number[]): Promise<boolean> {
    return !this.taken(reserved).has(port) && (await portFree(port)) && !(await answersLocal(port));
  }

  private async freePort(reserved: number[] = []): Promise<number> {
    const { portFrom, portTo } = this.engine.config.preview;
    const taken = this.taken(reserved);
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

/** the branch a checkout is on, or null when it is detached or not a repository */
function currentBranch(repo: string): string | null {
  try {
    const r = Bun.spawnSync(['git', 'symbolic-ref', '--short', '-q', 'HEAD'], { cwd: repo, stdout: 'pipe', stderr: 'ignore' });
    return r.exitCode === 0 ? r.stdout.toString().trim() || null : null;
  } catch {
    return null;
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
