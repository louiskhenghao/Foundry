import type { McpLoginSession } from './types.ts';

const URL_RE = /https?:\/\/[^\s"'<>)\]]+/;
/** `claude mcp login --no-browser` asks for the URL the browser was redirected to */
const PASTE_PROMPT = /paste|redirect(ed)? url|callback url/i;

type Spawned = { stdout: ReadableStream<Uint8Array>; stderr: ReadableStream<Uint8Array>; stdin: { write(s: string): unknown; flush?(): unknown }; exited: Promise<number>; kill(sig?: string): void };
export type LoginSpawn = (argv: string[]) => Spawned;

const defaultSpawn: LoginSpawn = (argv) => Bun.spawn(argv, { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe', env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' } }) as unknown as Spawned;

/**
 * Drives `claude mcp login <name>` for the MCP tab, one at a time. A claude.ai connector only needs its authorization
 * link (the CLI prints it and exits); another HTTP server opens a browser on this machine, or, without one (headless,
 * Docker), waits for the redirected URL to be pasted back.
 */
export class McpLogin {
  private current: McpLoginSession | null = null;
  private proc: Spawned | null = null;
  constructor(private o: { claudeBin: () => string | null; headless: () => boolean; spawn?: LoginSpawn; timeoutMs?: number; log: (m: string) => void }) {}

  session(): McpLoginSession | null {
    return this.current;
  }

  start(name: string, connector: boolean): McpLoginSession {
    const claude = this.o.claudeBin();
    if (!claude) throw new Error('claude not found on PATH');
    if (this.current && !this.current.done) throw new Error(`a sign-in for ${this.current.name} is still open — finish or cancel it first`);
    const s: McpLoginSession = { id: `mcplogin_${Date.now().toString(36)}`, name, connector, url: null, lines: [], needsCode: false, done: false, ok: null, error: null, startedAt: new Date().toISOString(), finishedAt: null };
    this.current = s;
    const argv = [claude, 'mcp', 'login', name, ...(connector || this.o.headless() ? ['--no-browser'] : [])];
    let proc: Spawned;
    try {
      proc = (this.o.spawn ?? defaultSpawn)(argv);
    } catch (e) {
      return this.finish(s, false, String(e));
    }
    this.proc = proc;
    const timer = setTimeout(() => {
      s.error ??= 'the sign-in timed out';
      proc.kill('SIGTERM');
    }, this.o.timeoutMs ?? 15 * 60_000);
    const pump = async (stream: ReadableStream<Uint8Array>) => {
      const reader = stream.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split(/\r?\n/);
        buf = parts.pop() ?? '';
        for (const l of parts) this.push(s, l);
        // the prompt has no newline: it waits in the leftover
        if (!s.needsCode && !connector && PASTE_PROMPT.test(buf)) {
          this.push(s, buf);
          buf = '';
          s.needsCode = true;
        }
      }
      if (buf.trim()) this.push(s, buf);
    };
    void Promise.all([pump(proc.stdout), pump(proc.stderr)])
      .then(() => proc.exited)
      .then((code) => {
        clearTimeout(timer);
        this.proc = null;
        // a connector "succeeds" by printing its link: the user authorizes on claude.ai
        this.finish(s, code === 0 && (!connector || !!s.url), s.error ?? (code === 0 ? (connector && !s.url ? 'the CLI printed no authorization link' : null) : `claude mcp login exited ${code}`));
      });
    return s;
  }

  /** hand the CLI the URL the browser landed on after authorizing */
  submit(redirected: string): McpLoginSession {
    const s = this.current;
    if (!s || s.done) throw new Error('no MCP sign-in is in progress');
    if (!s.needsCode || !this.proc) throw new Error('this sign-in is not waiting for a URL');
    const v = redirected.trim();
    if (!v) throw new Error('paste the address the browser ended on');
    this.proc.stdin.write(`${v}\n`);
    this.proc.stdin.flush?.();
    s.needsCode = false;
    this.push(s, '(address submitted)');
    return s;
  }

  cancel(): void {
    if (this.current && !this.current.done) this.current.error = 'cancelled';
    this.proc?.kill('SIGTERM');
  }

  private push(s: McpLoginSession, line: string) {
    const clean = line.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').trim();
    if (!clean) return;
    s.lines.push(clean);
    if (s.lines.length > 100) s.lines.shift();
    s.url ??= clean.match(URL_RE)?.[0] ?? null;
  }

  private finish(s: McpLoginSession, ok: boolean, error: string | null): McpLoginSession {
    s.done = true;
    s.ok = ok;
    s.error = ok ? null : error;
    s.needsCode = false;
    s.finishedAt = new Date().toISOString();
    this.o.log(`[mcp] login ${s.name} ${ok ? 'ok' : `failed: ${error}`}`);
    return s;
  }
}
