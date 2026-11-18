/**
 * Memory's own server (ADR-0109). With `memory.run` on, Foundry installs Hindsight into a Python environment it keeps
 * (ADR-0084) and runs it beside the engine: on this computer only (127.0.0.1), with a coding agent's sign-in as its LLM
 * — Claude Code, or Codex signed in for the server alone where only Codex is (a Codex refresh token is good once, so the
 * server never shares the CLI's). It starts with the engine and stops with it, and it dies with it however the engine
 * went: it reads its stdin, which closes when the engine is gone. Its database is pg0's embedded Postgres, which keeps
 * its files in ~/.pg0/instances/<name> (Hindsight has no setting that moves them); the name is this data folder's own,
 * so two Foundry installs on one computer never share a database, and a data folder that moves keeps its database.
 */
import { randomBytes } from 'node:crypto';
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { ClaudeAuth, type LoginSession } from '../auth/claude-auth.ts';
import { spawnStreaming, type SpawnResult } from '../skills/updaters.ts';
import type { MemoryServerLlm, MemoryServerPhase, MemoryServerView } from './types.ts';

export type { MemoryServerView };

/** the versions Foundry installs, tried together (a newer pin reinstalls the environment at the next start) */
export const HINDSIGHT_VERSION = '1.1.0';
/** the claude-code provider runs on the Claude Agent SDK, which Hindsight does not install itself */
export const AGENT_SDK_VERSION = '0.2.173';
export const PYTHON_VERSION = '3.12';
/** Hindsight's own port; the next free one above it when something else has it */
export const DEFAULT_PORT = 8888;
const PORT_SPAN = 20;
/** the first start downloads the models it embeds and ranks with (a few hundred MB) */
const START_TIMEOUT_MS = 15 * 60_000;
/** a server asked to stop shuts its database down first */
const STOP_GRACE_MS = 15_000;
/** crashes within this window, past this many, leave it stopped until the person tries again */
const CRASH_WINDOW_MS = 10 * 60_000;
const MAX_CRASHES = 3;
const LOG_MAX_BYTES = 10 * 1024 * 1024;
const TAIL = 40;
/** the line Foundry writes into the log before each start: the card shows what came after the last one */
const START_MARK = '--- Foundry starts Hindsight';
const MARKER = 'foundry-hindsight.json';

type ServerLlm = MemoryServerLlm;
type ServerPhase = MemoryServerPhase;

/** the server process as the class drives it (a fake one in tests); it writes its output to its log itself */
export interface ServerProcess {
  pid: number;
  exited: Promise<number | null>;
  kill(signal: 'SIGTERM' | 'SIGKILL'): void;
}

export interface ServerDeps {
  dataDir: string;
  log: (m: string) => void;
  /** whose sign-in the server's LLM uses: Claude Code when it is signed in, else Codex; null = neither is */
  llm: () => Promise<ServerLlm | null>;
  /** what the claude-code provider runs with: the config dir of the sign-in Foundry uses */
  claudeEnv: () => Record<string, string>;
  codexBin: () => string | null;
  /** test seams */
  uv?: () => string | null;
  run?: (argv: string[], cwd: string, onLine: (l: string) => void, opts: { timeoutMs?: number; env?: Record<string, string> }) => Promise<SpawnResult>;
  spawn?: (argv: string[], opts: { cwd: string; env: Record<string, string>; log: string }) => ServerProcess;
  /** the server's version when it answers at the address, else null */
  answers?: (url: string) => Promise<string | null>;
  portFree?: (port: number) => Promise<boolean>;
  codexSignedIn?: (codexHome: string) => Promise<boolean>;
  /** a process's command line, '' when it is gone */
  commandOf?: (pid: number) => Promise<string>;
  platform?: NodeJS.Platform;
  /** where pg0 keeps its instances (~/.pg0) */
  pg0Home?: string;
  startTimeoutMs?: number;
  pollMs?: number;
  backoffMs?: number;
  stopGraceMs?: number;
}

/**
 * The server never reads its stdin; Foundry holds the other end. When Foundry is gone, however it went, the stdin
 * closes and the server stops as it does on Ctrl-C, its database with it.
 */
export const LAUNCHER = `# Foundry starts Hindsight with this (ADR-0109): the server stops when Foundry is gone, however it went.
import os
import signal
import sys
import threading


# the raw descriptor: a thread blocked in Python's stdin object holds its lock, and the interpreter could not shut down
def _watch():
    try:
        while os.read(0, 4096):
            pass
    except OSError:
        pass
    os.kill(os.getpid(), signal.SIGTERM)


threading.Thread(target=_watch, daemon=True).start()
sys.argv = ["hindsight-api"]
from hindsight_api.main import main  # noqa: E402

sys.exit(main())
`;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const message = (err: unknown) => clip(String((err as Error)?.message ?? err), 300);
const lastLine = (tail: string) => tail.trim().split('\n').at(-1) ?? '';

export class HindsightServer {
  private phase: ServerPhase = 'off';
  private want = false;
  private proc: ServerProcess | null = null;
  private port: number | null = null;
  private llm: ServerLlm | null = null;
  private error: string | null = null;
  private tail: string[] = [];
  private crashes: number[] = [];
  /** a run belongs to one generation: stopping, or a new run, leaves an older one's later steps undone */
  private gen = 0;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<(url: string | null) => void>();
  private codexAuth: ClaudeAuth;

  constructor(private deps: ServerDeps) {
    this.codexAuth = new ClaudeAuth({ provider: 'codex', claudeBin: () => deps.codexBin(), codexHome: this.codexHome, log: deps.log });
    // signed in: the server starts at once
    this.codexAuth.onLoginUpdate((s) => {
      if (s.done && s.ok) this.retry();
    });
  }

  /** <dataDir>/hindsight: its port, its database's name, its launcher, its log, its own Codex sign-in */
  get home(): string {
    return join(this.deps.dataDir, 'hindsight');
  }
  /** <dataDir>/python/hindsight, beside the skills' environments (ADR-0084) */
  get venv(): string {
    return join(this.deps.dataDir, 'python', 'hindsight');
  }
  get codexHome(): string {
    return join(this.home, 'codex');
  }
  /** pg0's instance for this data folder, named once and kept in the folder */
  instance(): string {
    const file = join(this.home, 'instance');
    try {
      const name = readFileSync(file, 'utf8').trim();
      if (/^[a-z0-9-]{1,60}$/.test(name)) return name;
    } catch {}
    const name = `foundry-${randomBytes(4).toString('hex')}`;
    mkdirSync(this.home, { recursive: true });
    writeFileSync(file, `${name}\n`);
    return name;
  }
  private databaseDir(): string | null {
    let name: string;
    try {
      name = readFileSync(join(this.home, 'instance'), 'utf8').trim();
    } catch {
      return null;
    }
    return join(this.deps.pg0Home ?? join(homedir(), '.pg0'), 'instances', name);
  }

  /** the address Memory uses: only once the server answers */
  url(): string | null {
    return this.phase === 'running' && this.port ? `http://127.0.0.1:${this.port}` : null;
  }
  /** told when the address appears or goes */
  onUrl(cb: (url: string | null) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
  private emit(): void {
    const url = this.url();
    for (const cb of this.listeners) cb(url);
  }

  view(): MemoryServerView {
    return {
      phase: this.phase,
      url: this.url(),
      port: this.port,
      llm: this.llm,
      installed: this.installedVersion(),
      venv: this.venv,
      database: this.databaseDir(),
      error: this.error,
      lines: this.lines(),
      signIn: signInOf(this.codexAuth.loginSession()),
    };
  }

  /** the setting decides: on starts it (installing it first), off stops it; called again with the same answer, nothing changes */
  sync(want: boolean): void {
    this.want = want;
    if (!want) {
      if (this.phase !== 'off' || this.proc) void this.stop();
      return;
    }
    if (this.phase === 'off') void this.launch();
  }

  /** after a failure or a sign-in: start again, the count of crashes forgotten */
  retry(): void {
    if (!this.want || this.phase === 'installing' || this.phase === 'starting' || this.phase === 'running') return;
    this.crashes = [];
    void this.launch();
  }

  startSignIn(): LoginSession {
    mkdirSync(this.codexHome, { recursive: true });
    return this.codexAuth.startLogin();
  }
  cancelSignIn(): void {
    this.codexAuth.cancelLogin();
  }

  /** stop it (the engine stops, or the setting went off); bounded: a server that will not stop is killed */
  async stop(): Promise<void> {
    this.gen++;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
    this.codexAuth.cancelLogin();
    const proc = this.proc;
    this.proc = null;
    const wasUp = this.phase === 'running';
    this.phase = 'off';
    this.error = null;
    if (wasUp) this.emit();
    if (proc) await this.end(proc);
  }

  private set(phase: ServerPhase): void {
    const wasUp = this.phase === 'running';
    this.phase = phase;
    if (wasUp !== (phase === 'running')) this.emit();
  }
  private fail(error: string): void {
    this.error = error;
    this.deps.log(`[memory] the Hindsight server: ${error}`);
    this.set('failed');
  }
  /** the install's output while it installs; else the server's own log since its last start */
  private lines(): string[] {
    if (this.phase === 'installing' || !this.started) return [...this.tail];
    return logTail(this.logPath, TAIL);
  }
  private started = false;
  private get logPath(): string {
    return join(this.home, 'server.log');
  }
  private push(line: string): void {
    this.tail.push(clip(line, 400));
    if (this.tail.length > TAIL) this.tail.shift();
  }

  installedVersion(): string | null {
    try {
      const m = JSON.parse(readFileSync(join(this.venv, MARKER), 'utf8')) as { hindsight?: string; agentSdk?: string };
      return m.hindsight === HINDSIGHT_VERSION && m.agentSdk === AGENT_SDK_VERSION && existsSync(join(this.venv, 'bin', 'python')) ? m.hindsight : null;
    } catch {
      return null;
    }
  }

  private async launch(): Promise<void> {
    const gen = ++this.gen;
    const stale = () => gen !== this.gen || !this.want;
    this.error = null;
    try {
      if (!this.installedVersion()) {
        this.tail = [];
        this.set('installing');
        const ok = await this.install(stale);
        if (stale() || !ok) return;
      }
      // whose sign-in it runs on is read now (a CLI call): the card already says it is starting
      this.set('starting');
      const llm = await this.deps.llm();
      if (stale()) return;
      if (!llm) return this.fail('neither Claude Code nor Codex is signed in on this computer: sign one in (Settings → Accounts), then try again');
      this.llm = llm;
      // Codex: the server's own sign-in, never the CLI's (its refresh token is good once)
      const signedIn = llm === 'openai-codex' ? (this.deps.codexSignedIn ? await this.deps.codexSignedIn(this.codexHome) : (await this.codexAuth.status(true)).loggedIn) : true;
      if (!signedIn) {
        if (stale()) return;
        this.error = null;
        this.set('sign-in');
        return;
      }
      if (stale()) return;
      await this.start(gen);
    } catch (err) {
      if (!stale()) this.fail(message(err));
    }
  }

  /** uv makes the environment with the pinned Python and installs the pinned packages; about 2 GB, once */
  private async install(stale: () => boolean): Promise<boolean> {
    const uv = (this.deps.uv ?? (() => Bun.which('uv', { PATH: process.env.PATH ?? '' })))();
    if (!uv) {
      this.fail('uv is not installed: Setup installs it (foundry setup), then try again');
      return false;
    }
    const run = this.deps.run ?? spawnStreaming;
    const say = (l: string) => this.push(l);
    rmSync(this.venv, { recursive: true, force: true });
    mkdirSync(dirname(this.venv), { recursive: true });
    say(`making a Python ${PYTHON_VERSION} environment at ${this.venv}`);
    const made = await run([uv, 'venv', '--python', PYTHON_VERSION, this.venv], this.deps.dataDir, say, { timeoutMs: 10 * 60_000 });
    if (stale()) return false;
    if (made.code !== 0) {
      rmSync(this.venv, { recursive: true, force: true });
      this.fail(`uv venv failed (${made.code}): ${lastLine(made.tail)}`);
      return false;
    }
    // Linux: PyTorch's CPU build, not the CUDA one and its gigabytes of GPU libraries
    const torch = (this.deps.platform ?? process.platform) === 'linux' ? ['--torch-backend', 'cpu'] : [];
    say(`installing hindsight-api ${HINDSIGHT_VERSION} into it (about 2 GB the first time)`);
    const got = await run([uv, 'pip', 'install', '--python', join(this.venv, 'bin', 'python'), ...torch, `hindsight-api==${HINDSIGHT_VERSION}`, `claude-agent-sdk==${AGENT_SDK_VERSION}`], this.deps.dataDir, say, { timeoutMs: 45 * 60_000 });
    if (stale()) return false;
    if (got.code !== 0) {
      rmSync(this.venv, { recursive: true, force: true });
      this.fail(`uv pip install failed (${got.code}): ${lastLine(got.tail)}`);
      return false;
    }
    writeFileSync(join(this.venv, MARKER), JSON.stringify({ hindsight: HINDSIGHT_VERSION, agentSdk: AGENT_SDK_VERSION, python: PYTHON_VERSION }, null, 2));
    say(`Hindsight ${HINDSIGHT_VERSION} installed`);
    this.deps.log(`[memory] Hindsight ${HINDSIGHT_VERSION} installed at ${this.venv}`);
    return true;
  }

  private async start(gen: number): Promise<void> {
    this.set('starting');
    mkdirSync(this.home, { recursive: true });
    await this.endEarlier();
    if (gen !== this.gen || !this.want) return;
    const port = await this.choosePort();
    if (gen !== this.gen || !this.want) return;
    if (port === null) return this.fail(`no free port from ${DEFAULT_PORT} to ${DEFAULT_PORT + PORT_SPAN - 1}`);
    this.port = port;
    writeFileSync(join(this.home, 'port'), `${port}\n`);
    const launcher = join(this.home, 'launch.py');
    writeFileSync(launcher, LAUNCHER);
    const log = this.logPath;
    rotate(log);
    appendFileSync(log, `\n${START_MARK} ${HINDSIGHT_VERSION} on 127.0.0.1:${port} (${this.llm}) at ${new Date().toISOString()}\n`);
    const proc = (this.deps.spawn ?? spawnServer)([join(this.venv, 'bin', 'python'), launcher], { cwd: this.home, env: this.env(port), log });
    this.proc = proc;
    this.started = true;
    writeFileSync(join(this.home, 'server.pid'), `${proc.pid}\n`);
    void proc.exited.then((code) => this.exited(proc, code));
    this.deps.log(`[memory] starting the Hindsight server on 127.0.0.1:${port} (pid ${proc.pid}, ${this.llm})`);
    const url = `http://127.0.0.1:${port}`;
    const deadline = Date.now() + (this.deps.startTimeoutMs ?? START_TIMEOUT_MS);
    const answers = this.deps.answers ?? answersAt;
    while (this.proc === proc && gen === this.gen) {
      const version = await answers(url);
      if (this.proc !== proc || gen !== this.gen) return;
      if (version) {
        this.error = null;
        this.set('running');
        this.deps.log(`[memory] the Hindsight server answers at ${url} (${version})`);
        return;
      }
      if (Date.now() > deadline) {
        this.proc = null;
        this.fail(`it did not answer at ${url} within ${Math.round((this.deps.startTimeoutMs ?? START_TIMEOUT_MS) / 60_000)} min; its log: ${log}`);
        await this.end(proc);
        return;
      }
      await sleep(this.deps.pollMs ?? 1000);
    }
  }

  /** what the server runs with: this computer only, its own database, the sign-in's provider, nothing inherited of Hindsight's */
  private env(port: number): Record<string, string> {
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith('HINDSIGHT_')) env[k] = v;
    // a key in Foundry's environment would make Claude Code bill the API instead of the sign-in
    delete env.ANTHROPIC_API_KEY;
    return {
      ...env,
      ...(this.llm === 'openai-codex' ? { HINDSIGHT_API_LLM_CODEX_HOME: this.codexHome } : this.deps.claudeEnv()),
      HINDSIGHT_API_HOST: '127.0.0.1',
      HINDSIGHT_API_PORT: String(port),
      HINDSIGHT_API_DATABASE_URL: `pg0://${this.instance()}`,
      HINDSIGHT_API_LLM_PROVIDER: this.llm ?? 'claude-code',
      HINDSIGHT_API_WORKERS: '1',
      HINDSIGHT_API_WORKER_ID: 'foundry',
      PYTHONUNBUFFERED: '1',
      NO_COLOR: '1',
    };
  }

  /** the port it had last time (the address the coding agents' MCP servers point at), else 8888 or the next free one */
  private async choosePort(): Promise<number | null> {
    let kept: number | null = null;
    try {
      const n = Number(readFileSync(join(this.home, 'port'), 'utf8').trim());
      if (Number.isInteger(n) && n > 0 && n < 65536) kept = n;
    } catch {}
    const free = this.deps.portFree ?? portFree;
    const tried = new Set<number>();
    for (const p of [...(kept ? [kept] : []), ...Array.from({ length: PORT_SPAN }, (_, i) => DEFAULT_PORT + i)]) {
      if (tried.has(p)) continue;
      tried.add(p);
      if (await free(p)) return p;
    }
    return null;
  }

  /** a server this folder started before and that still runs (the engine was killed mid-stop, a dev server reloaded): stopped first */
  private async endEarlier(): Promise<void> {
    const file = join(this.home, 'server.pid');
    let pid: number;
    try {
      pid = Number(readFileSync(file, 'utf8').trim());
    } catch {
      return;
    }
    if (!Number.isInteger(pid) || pid <= 1) return;
    const command = await (this.deps.commandOf ?? commandOf)(pid);
    // only a process that runs this folder's launcher: a pid reused by something else is left alone
    if (!command.includes(join(this.home, 'launch.py'))) return;
    this.deps.log(`[memory] stopping the Hindsight server an earlier start left running (pid ${pid})`);
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      return;
    }
    const deadline = Date.now() + (this.deps.stopGraceMs ?? STOP_GRACE_MS);
    while (Date.now() < deadline) {
      if (!alive(pid)) return;
      await sleep(250);
    }
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {}
    }
  }

  private exited(proc: ServerProcess, code: number | null): void {
    if (this.proc !== proc) return;
    this.proc = null;
    if (!this.want) return this.set('off');
    const now = Date.now();
    this.crashes = [...this.crashes.filter((t) => now - t < CRASH_WINDOW_MS), now];
    const last = logTail(this.logPath, 1)[0] ?? '';
    if (this.crashes.length >= MAX_CRASHES) return this.fail(`it stopped ${this.crashes.length} times in ${CRASH_WINDOW_MS / 60_000} minutes (exit ${code})${last ? `: ${last}` : ''}`);
    this.error = `it stopped (exit ${code})${last ? `: ${clip(last, 200)}` : ''}; starting it again`;
    this.deps.log(`[memory] the Hindsight server ${this.error}`);
    this.set('starting');
    const gen = ++this.gen;
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      if (gen === this.gen && this.want && !this.proc) void this.launch();
    }, (this.deps.backoffMs ?? 5_000) * this.crashes.length);
    this.restartTimer.unref?.();
  }

  /** SIGTERM (it stops its database), then SIGKILL to its whole group past the grace */
  private async end(proc: ServerProcess): Promise<void> {
    proc.kill('SIGTERM');
    const grace = this.deps.stopGraceMs ?? STOP_GRACE_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const done = await Promise.race([proc.exited.then(() => true), new Promise<boolean>((r) => (timer = setTimeout(() => r(false), grace)))]);
    clearTimeout(timer);
    if (!done) {
      proc.kill('SIGKILL');
      await Promise.race([proc.exited, sleep(2_000)]);
    }
    try {
      if (readFileSync(join(this.home, 'server.pid'), 'utf8').trim() === String(proc.pid)) rmSync(join(this.home, 'server.pid'), { force: true });
    } catch {}
  }
}

const signInOf = (s: LoginSession | null): MemoryServerView['signIn'] => (s ? { url: s.url, deviceCode: s.deviceCode, done: s.done, ok: s.ok, error: s.error } : null);

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** the last lines of the log since Foundry last started the server (ANSI colours out) */
export function logTail(path: string, n: number): string[] {
  let text = '';
  try {
    const fd = openSync(path, 'r');
    try {
      const size = statSync(path).size;
      const len = Math.min(size, 64 * 1024);
      const buf = Buffer.alloc(len);
      readSync(fd, buf, 0, len, size - len);
      text = buf.toString('utf8');
    } finally {
      closeSync(fd);
    }
  } catch {
    return [];
  }
  const since = text.lastIndexOf(START_MARK);
  const lines = (since >= 0 ? text.slice(text.indexOf('\n', since) + 1) : text)
    .split('\n')
    .map((l) => l.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').replace(/\r/g, '').trimEnd())
    .filter(Boolean);
  return lines.slice(-n).map((l) => clip(l, 400));
}

/** the log is kept short: one old copy beside it */
function rotate(log: string): void {
  try {
    if (statSync(log).size > LOG_MAX_BYTES) renameSync(log, `${log}.1`);
  } catch {}
}

async function commandOf(pid: number): Promise<string> {
  if (process.platform === 'linux') {
    try {
      return readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').join(' ').trim();
    } catch {
      return '';
    }
  }
  try {
    const r = Bun.spawnSync(['ps', '-o', 'command=', '-p', String(pid)], { stdout: 'pipe', stderr: 'ignore' });
    return r.stdout.toString().trim();
  } catch {
    return '';
  }
}

/** Hindsight's version when it answers at the address */
async function answersAt(url: string): Promise<string | null> {
  try {
    const r = await fetch(`${url}/v1/version`, { signal: AbortSignal.timeout(2_000) });
    if (!r.ok) return null;
    const body = (await r.json().catch(() => ({}))) as { api_version?: string };
    return body.api_version ?? 'unknown';
  } catch {
    return null;
  }
}

/** nothing answers there, and the address can be had (a server listening on every address answers on 127.0.0.1 too) */
export async function portFree(port: number): Promise<boolean> {
  try {
    const socket = await Promise.race([Bun.connect({ hostname: '127.0.0.1', port, socket: { data() {} } }), sleep(1_000).then(() => null)]);
    if (socket) {
      socket.end();
      return false;
    }
  } catch {}
  try {
    const listener = Bun.listen({ hostname: '127.0.0.1', port, socket: { data() {} } });
    listener.stop(true);
    return true;
  } catch {
    return false;
  }
}

/**
 * The server in a process group of its own, writing to its log itself (no pipe Foundry must keep reading, and its last
 * words reach the log even when Foundry is gone); its stdin held open until it is to stop.
 */
function spawnServer(argv: string[], o: { cwd: string; env: Record<string, string>; log: string }): ServerProcess {
  const out = openSync(o.log, 'a');
  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn(argv, { cwd: o.cwd, env: o.env, stdin: 'pipe', stdout: out, stderr: out, detached: process.platform !== 'win32' });
  } finally {
    closeSync(out);
  }
  // held here for as long as the process runs: the pipe closing is what tells the server Foundry is gone
  const stdin = proc.stdin;
  return {
    pid: proc.pid,
    exited: proc.exited.then((c) => {
      void stdin;
      return c;
    }),
    kill(signal) {
      try {
        if (signal === 'SIGKILL' && process.platform !== 'win32') process.kill(-proc.pid, 'SIGKILL');
        else proc.kill(signal);
      } catch {
        try {
          proc.kill(signal);
        } catch {}
      }
    },
  };
}
