import { exec } from '../git/git.ts';

export interface ClaudeAuthStatus {
  loggedIn: boolean;
  authMethod: string | null;
  apiProvider: string | null;
  email: string | null;
  orgName: string | null;
  subscriptionType: string | null;
  checkedAt: string;
  error: string | null;
}

export interface LoginSession {
  id: string;
  mode: 'claudeai' | 'console';
  startedAt: string;
  url: string | null;
  lines: string[];
  done: boolean;
  ok: boolean | null;
  error: string | null;
  finishedAt: string | null;
  /** the CLI is waiting for the code shown in the browser (headless machines, e.g. Docker) */
  needsCode: boolean;
}

const URL_RE = /https?:\/\/[^\s"'<>)\]]+/;
/** `claude auth login` falls back to "copy the code back" when it cannot open a browser and catch the callback */
const CODE_PROMPT = /paste[^\n]{0,40}code|enter[^\n]{0,40}code/i;
/** the CLI says this and waits again (it never repeats the prompt when there is no TTY) */
const CODE_REJECTED = /invalid code|code .{0,20}(expired|not valid)/i;

export async function claudeAuthStatus(claudeBin: string | null, run: typeof exec = exec): Promise<ClaudeAuthStatus> {
  const checkedAt = new Date().toISOString();
  if (!claudeBin) return { loggedIn: false, authMethod: null, apiProvider: null, email: null, orgName: null, subscriptionType: null, checkedAt, error: 'claude not installed' };
  const r = await run([claudeBin, 'auth', 'status', '--json'], process.cwd(), { timeoutMs: 20_000 }).catch((e) => ({ code: 1, stdout: '', stderr: String(e) }));
  try {
    const j = JSON.parse(r.stdout);
    return { loggedIn: !!j.loggedIn, authMethod: j.authMethod ?? null, apiProvider: j.apiProvider ?? null, email: j.email ?? null, orgName: j.orgName ?? null, subscriptionType: j.subscriptionType ?? null, checkedAt, error: null };
  } catch {
    const loggedIn = /logged in/i.test(r.stdout) && !/not logged in/i.test(r.stdout);
    return { loggedIn, authMethod: null, apiProvider: null, email: null, orgName: null, subscriptionType: null, checkedAt, error: loggedIn ? null : (r.stderr || r.stdout).trim().slice(0, 200) || 'could not read auth status' };
  }
}

/**
 * Drives `claude auth login` / `claude auth logout` for the UI. The CLI opens the browser itself
 * (the engine runs on the user's machine); we capture its output so the UI can show the URL too.
 */
export class ClaudeAuth {
  private cached: ClaudeAuthStatus | null = null;
  private current: LoginSession | null = null;
  private proc: ReturnType<typeof Bun.spawn> | null = null;
  private arm: ((ms: number) => void) | null = null;
  private listeners = new Set<(s: LoginSession) => void>();

  constructor(
    private opts: { claudeBin: string | null; timeoutMs?: number; codeTimeoutMs?: number; run?: typeof exec; log?: (m: string) => void },
  ) {}

  async status(force = false): Promise<ClaudeAuthStatus> {
    if (!force && this.cached && Date.now() - Date.parse(this.cached.checkedAt) < 60_000) return this.cached;
    this.cached = await claudeAuthStatus(this.opts.claudeBin, this.opts.run);
    return this.cached;
  }
  invalidate(): void {
    this.cached = null;
  }
  loginSession(): LoginSession | null {
    return this.current;
  }
  onLoginUpdate(l: (s: LoginSession) => void): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  private emit() {
    if (this.current) for (const l of this.listeners) l(this.current);
  }

  startLogin(input: { mode?: 'claudeai' | 'console'; email?: string } = {}): LoginSession {
    if (!this.opts.claudeBin) throw new Error('claude CLI not installed');
    if (this.current && !this.current.done) return this.current;
    const mode = input.mode ?? 'claudeai';
    const session: LoginSession = { id: `login_${Date.now().toString(36)}`, mode, startedAt: new Date().toISOString(), url: null, lines: [], done: false, ok: null, error: null, finishedAt: null, needsCode: false };
    this.current = session;
    const args = [this.opts.claudeBin, 'auth', 'login', mode === 'console' ? '--console' : '--claudeai', ...(input.email ? ['--email', input.email] : [])];
    let proc: ReturnType<typeof Bun.spawn>;
    try {
      // stdin stays open: on a machine without a browser the CLI asks for the code from the browser instead
      proc = Bun.spawn(args, { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe', env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' } });
    } catch (err) {
      session.done = true;
      session.ok = false;
      session.error = String(err);
      session.finishedAt = new Date().toISOString();
      return session;
    }
    this.proc = proc;
    let timer: ReturnType<typeof setTimeout>;
    const arm = (ms: number) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        try {
          proc.kill('SIGTERM');
        } catch {}
        session.error = session.error ?? 'login timed out';
      }, ms);
    };
    arm(this.opts.timeoutMs ?? 5 * 60_000);
    this.arm = arm;
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
        for (const line of parts) this.push(session, line);
        // the prompt carries no newline, so it lives in the leftover — and it comes back after a wrong code
        // a rejected code: put the field back so the user can paste it again instead of waiting for the timeout
        if (!session.needsCode && parts.some((l) => CODE_REJECTED.test(l))) {
          session.needsCode = true;
          arm(this.opts.codeTimeoutMs ?? 15 * 60_000);
          this.emit();
        }
        if (!session.needsCode && CODE_PROMPT.test(buf)) {
          session.needsCode = true;
          this.push(session, buf);
          buf = '';
          arm(this.opts.codeTimeoutMs ?? 15 * 60_000); // a human has to fetch the code from the browser
        }
      }
      if (buf.trim()) this.push(session, buf);
    };
    void Promise.all([pump(proc.stdout as ReadableStream<Uint8Array>), pump(proc.stderr as ReadableStream<Uint8Array>)])
      .then(() => proc.exited)
      .then(async (code) => {
        clearTimeout(timer);
        this.arm = null;
        session.needsCode = false;
        this.invalidate();
        const st = await this.status(true);
        session.done = true;
        session.ok = code === 0 && st.loggedIn;
        if (!session.ok && !session.error) session.error = code === 0 ? 'login finished but status is still logged out' : `claude auth login exited ${code}`;
        session.finishedAt = new Date().toISOString();
        this.proc = null;
        this.emit();
        this.opts.log?.(`[auth] login ${session.ok ? 'succeeded' : 'failed'}${session.error ? ': ' + session.error : ''}`);
      });
    this.emit();
    return session;
  }

  private push(session: LoginSession, line: string) {
    const clean = line.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').trim();
    if (!clean) return;
    session.lines.push(clean);
    if (session.lines.length > 200) session.lines.shift();
    if (!session.url) {
      const m = clean.match(URL_RE);
      if (m) session.url = m[0];
    }
    this.emit();
  }

  /**
   * Hand the CLI the code the user copied from the browser. Only possible while it is asking for one —
   * which happens when the machine running the engine has no browser (a container, a remote host).
   */
  submitCode(code: string): LoginSession {
    const session = this.current;
    if (!session || session.done) throw new Error('no sign-in is in progress');
    if (!session.needsCode) throw new Error('this sign-in is not waiting for a code');
    const trimmed = code.trim();
    if (!trimmed) throw new Error('the code is empty');
    const stdin = this.proc?.stdin as { write?: (s: string) => void; flush?: () => void } | undefined;
    if (!stdin?.write) throw new Error('the sign-in process is not accepting input');
    try {
      stdin.write(`${trimmed}\n`);
      stdin.flush?.();
    } catch (err) {
      // the CLI stopped reading (it gave up on the code): end the session so the UI offers a fresh sign-in
      session.needsCode = false;
      session.error = 'the sign-in process stopped accepting the code — start the sign-in again';
      this.cancelLogin();
      throw new Error(session.error);
    }
    session.needsCode = false;
    this.push(session, '(code submitted)');
    this.arm?.(this.opts.timeoutMs ?? 5 * 60_000);
    return session;
  }

  cancelLogin(): void {
    if (this.proc) {
      try {
        this.proc.kill('SIGTERM');
      } catch {}
    }
    if (this.current && !this.current.done) this.current.error = 'cancelled';
  }

  async logout(): Promise<ClaudeAuthStatus> {
    if (!this.opts.claudeBin) throw new Error('claude CLI not installed');
    const run = this.opts.run ?? exec;
    const r = await run([this.opts.claudeBin, 'auth', 'logout'], process.cwd(), { timeoutMs: 30_000 });
    this.invalidate();
    const st = await this.status(true);
    if (st.loggedIn && r.code !== 0) throw new Error(`logout failed: ${(r.stderr || r.stdout).trim().slice(0, 200)}`);
    this.opts.log?.('[auth] logged out');
    return st;
  }
}
