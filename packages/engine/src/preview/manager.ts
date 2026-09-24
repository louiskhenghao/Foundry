import { createServer } from 'node:net';
import type { BriefRun, Goal } from '@foundry/core';
import { getBrief, getGoal } from '@foundry/core';
import type { Engine } from '../engine.ts';
import { goalWorkspacePath } from '../workspace.ts';
import { detectRun, previewBindHost } from './detect.ts';

export type PreviewStarter = 'human' | 'milestone' | 'integration';

export interface PreviewStatus {
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
  /** how the engine would start (or started) the result; null = nothing startable */
  run: BriefRun | null;
  source: 'brief' | 'detected' | null;
  /** why the last start failed or the process died, or null */
  error: string | null;
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

/**
 * One dev server per goal, started from the Brief's run section (or package.json detection) in the goal's progress folder,
 * on a port from Settings → Preview. Started by a person, at a milestone, or restarted after an integration; stopped when
 * nobody has opened it for `idleMinutes`, when the goal ends, or when the engine shuts down.
 */
export class PreviewManager {
  private live = new Map<string, Live>();
  private lastError = new Map<string, string>();
  private sweeper: ReturnType<typeof setInterval> | null = null;

  constructor(private engine: Engine) {}

  startSweeper(): void {
    if (!this.sweeper) this.sweeper = setInterval(() => void this.sweep(), 60_000);
  }
  stopSweeper(): void {
    if (this.sweeper) clearInterval(this.sweeper);
    this.sweeper = null;
  }

  /** the run section that applies: the Brief's when it names a command, else package.json detection */
  resolveRun(goal: Goal): { run: BriefRun; source: 'brief' | 'detected' } | null {
    const fromBrief = getBrief(this.engine.store.db, goal.id)?.brief.run;
    if (fromBrief?.command) return { run: fromBrief, source: 'brief' };
    const detected = detectRun(goalWorkspacePath(this.engine.config.dataDir, goal), { host: previewBindHost() });
    return detected ? { run: detected, source: 'detected' } : null;
  }

  status(goalId: string): PreviewStatus {
    const goal = getGoal(this.engine.store.db, goalId);
    const resolved = goal ? this.resolveRun(goal) : null;
    const l = this.live.get(goalId);
    return {
      running: !!l,
      ready: l?.ready ?? false,
      port: l?.port ?? null,
      url: l?.url ?? null,
      command: l?.command ?? null,
      startedAt: l?.startedAt ?? null,
      startedBy: l?.startedBy ?? null,
      lastVisitAt: l?.lastVisitAt ?? null,
      log: l?.log.slice(-40) ?? [],
      run: resolved?.run ?? null,
      source: resolved?.source ?? null,
      error: this.lastError.get(goalId) ?? null,
    };
  }

  /** the person opened the preview: keeps the idle timer from stopping it */
  touch(goalId: string): void {
    const l = this.live.get(goalId);
    if (l) l.lastVisitAt = new Date().toISOString();
  }

  async start(goal: Goal, by: PreviewStarter): Promise<PreviewStatus> {
    if (this.live.has(goal.id)) {
      this.touch(goal.id);
      return this.status(goal.id);
    }
    const { store, config } = this.engine;
    const resolved = this.resolveRun(goal);
    if (!resolved?.run.command) throw new PreviewError('nothing to run: the Brief has no run command and package.json has no dev/start script', 409);
    const ws = goalWorkspacePath(config.dataDir, goal);
    const port = await this.freePort();
    const command = resolved.run.command.replaceAll('{port}', String(port));
    const url = (resolved.run.url ?? 'http://localhost:{port}').replaceAll('{port}', String(port));
    const now = new Date().toISOString();
    const entry: Live = { proc: null as unknown as Live['proc'], port, url, command, startedAt: now, startedBy: by, lastVisitAt: now, ready: false, log: [], stopping: false };
    const channel = `preview-${goal.id}`;
    const push = (line: string) => {
      entry.log.push(line);
      if (entry.log.length > LOG_LINES) entry.log.splice(0, entry.log.length - LOG_LINES);
      this.engine.broadcast({ goalId: goal.id, taskId: null, attemptId: channel, event: { kind: 'text', text: line }, ts: new Date().toISOString() });
    };
    push(`$ ${command}  (port ${port})`);
    // in Docker, servers that read HOST (or HOSTNAME, Next's standalone server) listen on every interface too
    const host = previewBindHost();
    const bind = host ? { HOST: host, HOSTNAME: host } : {};
    entry.proc = Bun.spawn(['sh', '-lc', command], { cwd: ws, stdout: 'pipe', stderr: 'pipe', env: { ...process.env, ...this.engine.sessionEnvExtra(), PORT: String(port), ...bind, BROWSER: 'none', FORCE_COLOR: '0', NO_COLOR: '1' } });
    this.live.set(goal.id, entry);
    this.lastError.delete(goal.id);
    void pump(entry.proc.stdout as ReadableStream<Uint8Array>, push);
    void pump(entry.proc.stderr as ReadableStream<Uint8Array>, push);
    void entry.proc.exited.then((code) => {
      if (this.live.get(goal.id) !== entry) return;
      this.live.delete(goal.id);
      const reason = entry.stopping ? 'stopped' : `exited with code ${code}`;
      if (!entry.stopping) this.lastError.set(goal.id, reason);
      push(`[preview ${reason}]`);
      store.append({ type: 'preview.stopped', goalId: goal.id, payload: { reason } });
    });
    store.append({ type: 'preview.started', goalId: goal.id, payload: { port, url, command } });
    config.log(`[preview] ${goal.id}: ${command} → ${url} (${by})`);
    entry.ready = await waitForHttp(url, READY_TIMEOUT_MS, () => this.live.get(goal.id) === entry);
    if (!entry.ready && this.live.get(goal.id) === entry) push(`[preview] ${url} did not answer within ${READY_TIMEOUT_MS / 1000}s — the server may still be starting`);
    return this.status(goal.id);
  }

  async stop(goalId: string, reason: string): Promise<void> {
    const l = this.live.get(goalId);
    if (!l) return;
    l.stopping = true;
    // the dev server is a child of the shell: tell the whole family, then the shell
    await Bun.spawn(['pkill', '-TERM', '-P', String(l.proc.pid)], { stdout: 'ignore', stderr: 'ignore' }).exited.catch(() => 0);
    l.proc.kill();
    await Promise.race([l.proc.exited, new Promise((r) => setTimeout(r, 3000))]);
    if (this.live.get(goalId) === l) {
      this.live.delete(goalId);
      this.engine.store.append({ type: 'preview.stopped', goalId, payload: { reason } });
    }
    this.engine.config.log(`[preview] ${goalId}: stopped (${reason})`);
  }

  /** after an integration: a running preview picks up the new code */
  async restartIfRunning(goal: Goal): Promise<void> {
    if (!this.live.has(goal.id)) return;
    await this.stop(goal.id, 'restart after integration');
    await this.start(goal, 'integration').catch((err) => this.engine.config.log(`[preview] ${goal.id}: restart failed: ${String((err as Error).message ?? err)}`));
  }

  async stopAll(reason: string): Promise<void> {
    await Promise.all([...this.live.keys()].map((id) => this.stop(id, reason)));
  }

  private async sweep(): Promise<void> {
    const idleMs = this.engine.config.preview.idleMinutes * 60_000;
    const now = Date.now();
    for (const [goalId, l] of this.live) {
      const goal = getGoal(this.engine.store.db, goalId);
      const ended = !goal || ['done', 'over_delivered', 'failed', 'cancelled'].includes(goal.state);
      if (ended) await this.stop(goalId, 'goal ended');
      else if (goal.state !== 'awaiting_feedback' && now - Date.parse(l.lastVisitAt) > idleMs) await this.stop(goalId, `idle for ${this.engine.config.preview.idleMinutes} min`);
    }
  }

  private async freePort(): Promise<number> {
    const { portFrom, portTo } = this.engine.config.preview;
    const taken = new Set([...this.live.values()].map((l) => l.port));
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
