import { existsSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** stopped when nobody opened a folder in it for this long */
const IDLE_MS = 2 * 60 * 60_000;
const READY_MS = 30_000;
/** the documented standalone install: a release unpacked under ~/.local, no root, the same on macOS and Linux */
export const CODE_SERVER_INSTALL = 'curl -fsSL https://code-server.dev/install.sh | sh -s -- --method=standalone';

export interface CodeServerDeps {
  dataDir: string;
  /** an address on the person's tailnet for a local port, or null (Tailnet.expose) */
  expose: (port: number) => Promise<string | null>;
  unexpose: (port: number) => Promise<void>;
  log: (line: string) => void;
  /** the binary; undefined = find it on PATH or in ~/.local/bin */
  bin?: string | null;
}

/**
 * VS Code in the browser (code-server) for reading and editing a repository or a goal's folder from any device,
 * a phone included. Started on first use, listening on loopback only, without a password, and reached from other
 * devices through the person's tailnet; stopped after two idle hours or when the engine stops.
 */
export class CodeServer {
  private proc: ReturnType<typeof Bun.spawn> | null = null;
  private port: number | null = null;
  private tailnetUrl: string | null = null;
  private lastOpen = 0;
  private starting: Promise<void> | null = null;
  private sweeper: ReturnType<typeof setInterval> | null = null;

  constructor(private deps: CodeServerDeps) {}

  binary(): string | null {
    if (this.deps.bin !== undefined) return this.deps.bin;
    const local = join(homedir(), '.local', 'bin', 'code-server');
    return Bun.which('code-server') ?? (existsSync(local) ? local : null);
  }

  status(): { installed: boolean; running: boolean; port: number | null } {
    return { installed: !!this.binary(), running: !!this.proc, port: this.port };
  }

  /** the addresses that open `folder` in the editor, here and on the tailnet; starts the editor when it is not running */
  async open(folder: string): Promise<{ url: string; tailnetUrl: string | null }> {
    await this.start();
    this.lastOpen = Date.now();
    const q = `/?folder=${encodeURIComponent(folder)}`;
    return { url: `http://localhost:${this.port}${q}`, tailnetUrl: this.tailnetUrl ? `${this.tailnetUrl.replace(/\/+$/, '')}${q}` : null };
  }

  private start(): Promise<void> {
    if (this.proc) return Promise.resolve();
    if (this.starting) return this.starting;
    this.starting = (async () => {
      const bin = this.binary();
      if (!bin) throw new Error('code-server is not installed — install it in Settings → Tools');
      const port = await freePort();
      const dir = join(this.deps.dataDir, 'code-server');
      mkdirSync(dir, { recursive: true });
      const proc = Bun.spawn([bin, '--bind-addr', `127.0.0.1:${port}`, '--auth', 'none', '--disable-telemetry', '--disable-update-check', '--disable-workspace-trust', '--user-data-dir', join(dir, 'user'), '--extensions-dir', join(dir, 'extensions')], { stdout: 'ignore', stderr: 'pipe', env: { ...process.env, PORT: String(port) } });
      if (!(await answers(`http://127.0.0.1:${port}/healthz`, READY_MS))) {
        proc.kill();
        throw new Error(`code-server did not start on port ${port}`);
      }
      this.proc = proc;
      this.port = port;
      this.tailnetUrl = await this.deps.expose(port).catch(() => null);
      this.deps.log(`[code-server] started on 127.0.0.1:${port}${this.tailnetUrl ? `, ${this.tailnetUrl}` : ''}`);
      void proc.exited.then(() => {
        if (this.proc !== proc) return;
        this.proc = null;
        this.deps.log('[code-server] exited');
        void this.release();
      });
      if (!this.sweeper) this.sweeper = setInterval(() => void (this.proc && Date.now() - this.lastOpen > IDLE_MS && this.stop()), 10 * 60_000);
    })().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  async stop(): Promise<void> {
    const proc = this.proc;
    this.proc = null;
    proc?.kill();
    await this.release();
  }

  dispose(): Promise<void> {
    if (this.sweeper) clearInterval(this.sweeper);
    this.sweeper = null;
    return this.stop();
  }

  private async release(): Promise<void> {
    if (this.port != null) await this.deps.unexpose(this.port).catch(() => {});
    this.port = null;
    this.tailnetUrl = null;
  }
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => resolve(port));
    });
  });
}

async function answers(url: string, ms: number): Promise<boolean> {
  for (const t0 = Date.now(); Date.now() - t0 < ms; ) {
    try {
      await fetch(url, { signal: AbortSignal.timeout(1000) });
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  return false;
}
