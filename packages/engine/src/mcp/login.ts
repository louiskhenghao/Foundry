import type { McpLoginSession } from './types.ts';

const URL_RE = /https?:\/\/[^\s"'<>)\]\x1b\x07]+/;
/** the CLI asks for the address the browser was redirected to ("Or paste the redirect URL here:") */
const PASTE_PROMPT = /paste|redirect(ed)? url|callback url/i;
/** the CLI refuses an OAuth sign-in without a terminal */
const NO_TERMINAL = /isn't a terminal|not a terminal|interactive terminal/i;
/** terminal control sequences: hyperlinks and titles (OSC), colours and cursor moves (CSI), carriage returns */
const CONTROL = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-9;?]*[ -/]*[@-~]|\r/g;

/** a running `claude mcp login`: its output arrives through onData, write() types into it */
export interface LoginProcess {
  write(s: string): void;
  exited: Promise<number>;
  kill(): void;
}
export type LoginSpawn = (argv: string[], onData: (text: string) => void) => LoginProcess;

/** In a pseudo-terminal: the CLI only completes an OAuth sign-in when its input is a terminal. */
const terminalSpawn: LoginSpawn = (argv, onData) => {
  const dec = new TextDecoder();
  // wide, so a long authorization link is not wrapped across lines
  const proc = Bun.spawn(argv, { env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' }, terminal: { cols: 1000, rows: 50, data: (_t: unknown, d: Uint8Array) => onData(dec.decode(d, { stream: true })) } } as any) as unknown as { terminal: { write(s: string): void }; exited: Promise<number>; kill(): void };
  return { write: (s) => proc.terminal.write(s), exited: proc.exited, kill: () => proc.kill() };
};

/** how to run a sign-in by hand; a name with spaces (a connector) is quoted */
export const loginCommand = (name: string) => `claude mcp login ${/^[\w.-]+$/.test(name) ? name : JSON.stringify(name)}`;

/**
 * Drives `claude mcp login <name>` for the MCP tab, one at a time, in a pseudo-terminal. A claude.ai connector only
 * needs its authorization link (the CLI prints it and exits). Another HTTP server prints its sign-in link, opens a
 * browser on this machine when there is one, and waits: for that browser's callback, or for the address the browser
 * ended on to be pasted back.
 */
export class McpLogin {
  private current: McpLoginSession | null = null;
  private proc: LoginProcess | null = null;
  constructor(private o: { claudeBin: () => string | null; headless: () => boolean; spawn?: LoginSpawn; timeoutMs?: number; log: (m: string) => void }) {}

  session(): McpLoginSession | null {
    return this.current;
  }

  start(name: string, connector: boolean): McpLoginSession {
    const claude = this.o.claudeBin();
    if (!claude) throw new Error('claude not found on PATH');
    if (this.current && !this.current.done) throw new Error(`a sign-in for ${this.current.name} is still open — finish or cancel it first`);
    const s: McpLoginSession = { id: `mcplogin_${Date.now().toString(36)}`, name, connector, url: null, lines: [], needsCode: false, command: loginCommand(name), done: false, ok: null, error: null, startedAt: new Date().toISOString(), finishedAt: null };
    this.current = s;
    const argv = [claude, 'mcp', 'login', name, ...(connector || this.o.headless() ? ['--no-browser'] : [])];
    let buf = '';
    const onData = (text: string) => {
      buf += text.replace(CONTROL, '');
      const parts = buf.split('\n');
      buf = parts.pop() ?? '';
      for (const l of parts) this.push(s, l);
      // the prompt has no newline: it waits in the leftover
      if (!s.needsCode && !connector && PASTE_PROMPT.test(buf)) {
        this.push(s, buf);
        buf = '';
        s.needsCode = true;
      }
    };
    let proc: LoginProcess;
    try {
      proc = (this.o.spawn ?? terminalSpawn)(argv, onData);
    } catch (e) {
      return this.finish(s, false, `${String(e)} — run ${s.command} in a terminal instead`);
    }
    this.proc = proc;
    const timer = setTimeout(() => {
      s.error ??= 'the sign-in timed out';
      proc.kill();
    }, this.o.timeoutMs ?? 15 * 60_000);
    void proc.exited.then((code) => {
      clearTimeout(timer);
      if (buf.trim()) this.push(s, buf);
      this.proc = null;
      const needsTerminal = s.lines.some((l) => NO_TERMINAL.test(l));
      // a connector "succeeds" by printing its link: the user authorizes on claude.ai
      const ok = code === 0 && (!connector || !!s.url) && !needsTerminal;
      const error = s.error ?? (needsTerminal ? `this sign-in needs a terminal: run ${s.command}` : code !== 0 ? `claude mcp login exited ${code} — you can run ${s.command} in a terminal instead` : connector && !s.url ? 'the CLI printed no authorization link' : null);
      this.finish(s, ok, error);
    });
    return s;
  }

  /** hand the CLI the address the browser landed on after authorizing */
  submit(redirected: string): McpLoginSession {
    const s = this.current;
    if (!s || s.done) throw new Error('no MCP sign-in is in progress');
    if (!s.needsCode || !this.proc) throw new Error('this sign-in is not waiting for an address');
    const v = redirected.trim();
    if (!v) throw new Error('paste the address the browser ended on');
    // Enter in a terminal is a carriage return
    this.proc.write(`${v}\r`);
    s.needsCode = false;
    this.push(s, '(address submitted)');
    return s;
  }

  cancel(): void {
    if (this.current && !this.current.done) this.current.error = 'cancelled';
    this.proc?.kill();
  }

  private push(s: McpLoginSession, line: string) {
    const clean = line.trim();
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
