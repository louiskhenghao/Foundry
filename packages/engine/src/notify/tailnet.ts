import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { exec as defaultExec } from '../git/git.ts';

/** the Mac app's command-line entry point, for installs that never put `tailscale` on PATH */
const MAC_APP = '/Applications/Tailscale.app/Contents/MacOS/Tailscale';
const HOST_TTL_MS = 60_000;

type Exec = typeof defaultExec;

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
    private opts: { mode: () => 'auto' | 'off'; host: () => string | null; log: (line: string) => void; exec?: Exec; bin?: string | null; stateFile?: string },
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
    return (this.opts.exec ?? defaultExec)([this.bin!, ...args], process.cwd(), { timeoutMs: 15_000 });
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
   * An address on the tailnet for a local port: the HTTPS address the person already serves it at, else one Foundry
   * serves (`tailscale serve --bg --https=<port>`). With a name from Settings and no Tailscale command, plain
   * http://<name>:<port>, which works when the server listens on every interface. null = not reachable that way.
   */
  async expose(port: number): Promise<string | null> {
    const host = await this.host();
    if (!host) return null;
    if (!this.bin) return `http://${host}:${port}`;
    const existing = await this.servedAt(port);
    if (existing) return existing;
    const r = await this.run(['serve', '--bg', `--https=${port}`, `http://127.0.0.1:${port}`]).catch((err) => ({ code: 1, stdout: '', stderr: String(err) }));
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

  /** the HTTPS address `tailscale serve` already proxies to this local port, or null */
  private async servedAt(port: number): Promise<string | null> {
    try {
      const r = await this.run(['serve', 'status', '--json']);
      const web = (JSON.parse(r.stdout || '{}') as { Web?: Record<string, { Handlers?: Record<string, { Proxy?: string }> }> }).Web ?? {};
      for (const [hostPort, cfg] of Object.entries(web)) {
        const proxy = cfg.Handlers?.['/']?.Proxy ?? '';
        if (new RegExp(`^(https?://)?(127\\.0\\.0\\.1|localhost):${port}/?$`).test(proxy)) return `https://${hostPort.replace(/:443$/, '')}`;
      }
    } catch {
      /* no serve config yet */
    }
    return null;
  }
}
