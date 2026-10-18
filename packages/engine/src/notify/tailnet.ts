import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { exec as defaultExec } from '../git/git.ts';

/** the Mac app's command-line entry point, for installs that never put `tailscale` on PATH */
const MAC_APP = '/Applications/Tailscale.app/Contents/MacOS/Tailscale';
const HOST_TTL_MS = 60_000;

type Exec = typeof defaultExec;

/**
 * The command line for one Tailscale CLI call. The Mac app's binary started straight from a process launchd runs
 * (Foundry as a service) decides it is being opened as the app and answers "The Tailscale GUI failed to start", so no
 * tailnet name is found and every link falls back to localhost. Started through a shell — as the `tailscale` script
 * the app installs on PATH does — it acts as the command-line tool.
 */
/** the local port a serve target points at: `http://127.0.0.1:3000`, `localhost:5432`, `3000` */
function localPort(target: string | null): number | null {
  if (!target) return null;
  const m = /(?:^|:)(\d+)\/?$/.exec(target.trim());
  return m ? Number(m[1]) : null;
}

/** the two loopback addresses a local server may listen on: IPv4, or only IPv6 (Node ≥ 17 binds `localhost` to ::1 alone) */
export type Loopback = '127.0.0.1' | '[::1]';
const LOOPBACKS: readonly Loopback[] = ['127.0.0.1', '[::1]'];

/** does something accept a TCP connection at this loopback address and port? (one second, no data sent) */
export function tcpListens(host: Loopback, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: host.replace(/^\[|\]$/g, ''), port });
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.setTimeout(1000, () => done(false));
  });
}

/** the loopback address a serve target names, when it names one: `http://127.0.0.1:3000` → 127.0.0.1, `http://[::1]:3000` → [::1], `localhost:3000` → null (either) */
function loopbackOf(target: string): Loopback | null {
  const m = /^(?:https?:\/\/)?(127\.0\.0\.1|\[::1\]|localhost)(?::\d+)?\/?$/.exec(target.trim());
  return m ? (m[1] === 'localhost' ? null : (m[1] as Loopback)) : null;
}

export function cliArgv(bin: string, args: string[]): string[] {
  return /\.app\/Contents\/MacOS\//.test(bin) ? ['/bin/sh', '-c', 'exec "$0" "$@"', bin, ...args] : [bin, ...args];
}

/**
 * This computer on the person's tailnet, so links in notifications and the UI open on their phone: the machine's
 * MagicDNS name (from `tailscale status`, or the name Settings gives), and HTTPS addresses for local ports through
 * `tailscale serve`. A port the person already serves is reused as it is; ports Foundry serves itself (previews) are
 * taken down again when they stop. With Tailscale off, missing or not signed in, every answer is null.
 */
export class Tailnet {
  private bin: string | null;
  private cached: { at: number; host: string | null } | null = null;
  /** ports this instance added to `tailscale serve`, removed again by `unexpose` */
  private served = new Set<number>();

  constructor(
    private opts: { mode: () => 'auto' | 'off'; host: () => string | null; log: (line: string) => void; exec?: Exec; bin?: string | null; stateFile?: string; /** test seam: which loopback addresses a port answers on */ listens?: (host: Loopback, port: number) => Promise<boolean> },
  ) {
    this.bin = opts.bin !== undefined ? opts.bin : (Bun.which('tailscale') ?? (existsSync(MAC_APP) ? MAC_APP : null));
  }

  /** the ports served by an earlier run that did not stop cleanly (a crash, a kill): still on the tailnet, pointing at ports nothing may own */
  private leftover(): number[] {
    try {
      return this.opts.stateFile && existsSync(this.opts.stateFile) ? (JSON.parse(readFileSync(this.opts.stateFile, 'utf8')) as number[]).filter(Number.isInteger) : [];
    } catch {
      return [];
    }
  }

  private save(): void {
    if (!this.opts.stateFile) return;
    try {
      writeFileSync(this.opts.stateFile, JSON.stringify([...this.served]));
    } catch {
      /* only a crash recovery is lost */
    }
  }

  /** take down what an earlier run served and never removed (call once at start) */
  async cleanUp(): Promise<void> {
    const ports = this.leftover();
    if (!ports.length || !this.bin) return;
    for (const p of ports) await this.run(['serve', `--https=${p}`, 'off']).catch(() => {});
    this.save();
    this.opts.log(`[tailnet] took down ${ports.length} serve(s) left by an earlier run: ${ports.join(', ')}`);
  }

  private run(args: string[]) {
    return (this.opts.exec ?? defaultExec)(cliArgv(this.bin!, args), process.cwd(), { timeoutMs: 15_000 });
  }

  /** the machine's tailnet name (`mac.tailnet-123.ts.net`), or null */
  async host(): Promise<string | null> {
    if (this.opts.mode() === 'off') return null;
    const manual = this.opts.host()?.trim().replace(/^https?:\/\//, '').replace(/[/:].*$/, '');
    if (manual) return manual;
    if (!this.bin) return null;
    if (this.cached && Date.now() - this.cached.at < HOST_TTL_MS) return this.cached.host;
    let host: string | null = null;
    try {
      const r = await this.run(['status', '--json']);
      const s = JSON.parse(r.stdout) as { BackendState?: string; Self?: { DNSName?: string } };
      if (r.code === 0 && s.BackendState === 'Running') host = s.Self?.DNSName?.replace(/\.$/, '') || null;
    } catch {
      host = null;
    }
    this.cached = { at: Date.now(), host };
    return host;
  }

  /**
   * The loopback address a local server listens on: 127.0.0.1 when it answers there, else [::1] when it answers there
   * (Node ≥ 17 binds `localhost` to ::1 alone, so Vite and Next often listen on IPv6 only, and a proxy to 127.0.0.1
   * answers 502); 127.0.0.1 while nothing listens yet.
   */
  async loopback(port: number): Promise<Loopback> {
    const listens = this.opts.listens ?? tcpListens;
    for (const host of LOOPBACKS) if (await listens(host, port).catch(() => false)) return host;
    return '127.0.0.1';
  }

  /**
   * An address on the tailnet for a local port: the HTTPS address the person already serves it at, else one Foundry
   * serves (`tailscale serve --bg --https=<port>`), pointed at the loopback address the server really listens on. A
   * serve that points at the loopback address nothing listens on while the other answers (the server moved to IPv6,
   * or an earlier Foundry served it blindly) is pointed right and becomes Foundry's. With a name from Settings and no
   * Tailscale command, plain http://<name>:<port>, which works when the server listens on every interface. null = not
   * reachable that way.
   */
  async expose(port: number): Promise<string | null> {
    const host = await this.host();
    if (!host) return null;
    if (!this.bin) return `http://${host}:${port}`;
    const target = await this.loopback(port);
    const existing = await this.servedAt(port);
    if (existing && (existing.loopback === null || existing.loopback === target || !(await (this.opts.listens ?? tcpListens)(target, port).catch(() => false)))) return existing.url;
    if (existing) this.opts.log(`[tailnet] port ${port} is served to ${existing.loopback}, where nothing listens; pointing it at ${target}`);
    const r = await this.run(['serve', '--bg', `--https=${port}`, `http://${target}:${port}`]).catch((err) => ({ code: 1, stdout: '', stderr: String(err) }));
    if (r.code !== 0) {
      this.opts.log(`[tailnet] could not serve port ${port}: ${(r.stderr || r.stdout).trim().slice(0, 200)}`);
      return null;
    }
    this.served.add(port);
    this.save();
    return `https://${host}:${port}`;
  }

  /** take down a port Foundry served itself; ports the person served stay */
  async unexpose(port: number): Promise<void> {
    if (!this.served.delete(port) || !this.bin) return;
    this.save();
    await this.run(['serve', `--https=${port}`, 'off']).catch(() => {});
  }

  async unexposeAll(): Promise<void> {
    await Promise.all([...this.served].map((p) => this.unexpose(p)));
  }

  /**
   * Everything `tailscale serve` serves on this computer, for the Ports page: the tailnet port it listens on, the local
   * address it forwards to, and whether this Foundry added it. Listed whatever Tailscale links are set to (they only
   * decide what Foundry adds); empty when Tailscale is missing or not signed in.
   */
  async serves(): Promise<{ port: number; target: string | null; targetPort: number | null; url: string | null; ours: boolean }[]> {
    if (!this.bin) return [];
    try {
      const r = await this.run(['serve', 'status', '--json']);
      if (r.code !== 0) return [];
      const cfg = JSON.parse(r.stdout || '{}') as { TCP?: Record<string, { HTTPS?: boolean; TCPForward?: string }>; Web?: Record<string, { Handlers?: Record<string, { Proxy?: string }> }> };
      const out = new Map<number, { port: number; target: string | null; targetPort: number | null; url: string | null; ours: boolean }>();
      for (const [hostPort, web] of Object.entries(cfg.Web ?? {})) {
        const port = Number(hostPort.split(':').pop());
        if (!Number.isInteger(port)) continue;
        const target = web.Handlers?.['/']?.Proxy ?? Object.values(web.Handlers ?? {})[0]?.Proxy ?? null;
        out.set(port, { port, target, targetPort: localPort(target), url: `https://${hostPort.replace(/:443$/, '')}`, ours: this.served.has(port) });
      }
      for (const [p, tcp] of Object.entries(cfg.TCP ?? {})) {
        const port = Number(p);
        if (!Number.isInteger(port) || out.has(port)) continue;
        out.set(port, { port, target: tcp.TCPForward ?? null, targetPort: localPort(tcp.TCPForward ?? null), url: null, ours: this.served.has(port) });
      }
      return [...out.values()].sort((a, b) => a.port - b.port);
    } catch {
      return [];
    }
  }

  /** stop serving one tailnet port, Foundry's or the person's (the Ports page asks the person first for theirs) */
  async stopServe(port: number): Promise<void> {
    if (!this.bin) throw new Error('tailscale is not installed here');
    const r = await this.run(['serve', `--https=${port}`, 'off']);
    if (r.code !== 0) {
      // a TCP forward is turned off with its own flag
      const t = await this.run(['serve', `--tcp=${port}`, 'off']);
      if (t.code !== 0) throw new Error(`tailscale serve could not stop port ${port}: ${(r.stderr || r.stdout).trim().slice(0, 200)}`);
    }
    if (this.served.delete(port)) this.save();
  }

  /** the HTTPS address `tailscale serve` already proxies to this local port, with the loopback address it names (null = `localhost`, either), or null */
  private async servedAt(port: number): Promise<{ url: string; loopback: Loopback | null } | null> {
    try {
      const r = await this.run(['serve', 'status', '--json']);
      const web = (JSON.parse(r.stdout || '{}') as { Web?: Record<string, { Handlers?: Record<string, { Proxy?: string }> }> }).Web ?? {};
      for (const [hostPort, cfg] of Object.entries(web)) {
        const proxy = cfg.Handlers?.['/']?.Proxy ?? '';
        if (localPort(proxy) === port && /^(https?:\/\/)?(127\.0\.0\.1|\[::1\]|localhost):/.test(proxy.trim())) return { url: `https://${hostPort.replace(/:443$/, '')}`, loopback: loopbackOf(proxy) };
      }
    } catch {
      /* no serve config yet */
    }
    return null;
  }
}
