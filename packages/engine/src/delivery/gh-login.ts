import type { GhClient } from './gh.ts';

/** what the GitHub sign-in shows while it runs: gh's one-time code and the page to enter it on, then the outcome */
export interface GhLoginSession {
  id: string;
  startedAt: string;
  /** the one-time code gh prints, to enter on `url` */
  code: string | null;
  url: string | null;
  lines: string[];
  done: boolean;
  ok: boolean;
  /** the GitHub account signed in, when it worked */
  login: string | null;
  error: string | null;
}

const CODE_RE = /one-time code:\s*([A-Z0-9]{4}-[A-Z0-9]{4})/i;
const URL_RE = /https:\/\/\S+/;
const TIMEOUT_MS = 15 * 60_000;

/**
 * `gh auth login --web` from a page: GitHub's device flow needs no terminal, so the code and the address gh prints are
 * shown for the person to copy, and gh finishes by itself once they approve on GitHub. One sign-in at a time; a new
 * start while one runs returns that one. It stops after 15 minutes or on cancel.
 */
export class GhLogin {
  private session: GhLoginSession | null = null;
  private abort: AbortController | null = null;

  constructor(
    private gh: () => GhClient,
    private onLine: (line: string) => void = () => {},
  ) {}

  current(): GhLoginSession | null {
    return this.session;
  }

  start(): GhLoginSession {
    if (this.session && !this.session.done) return this.session;
    const s: GhLoginSession = { id: crypto.randomUUID(), startedAt: new Date().toISOString(), code: null, url: null, lines: [], done: false, ok: false, login: null, error: null };
    this.session = s;
    const abort = new AbortController();
    this.abort = abort;
    const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
    const gh = this.gh();
    void gh
      .login((line) => {
        s.lines = [...s.lines, line].slice(-50);
        s.code ??= CODE_RE.exec(line)?.[1] ?? null;
        if (!s.url && /url|browser/i.test(line)) s.url = URL_RE.exec(line)?.[0] ?? null;
        this.onLine(line);
      }, abort.signal)
      .then(async (r) => {
        const a = await gh.available().catch(() => null);
        s.ok = r.ok && !!a?.authenticated;
        s.login = s.ok ? (a?.login ?? null) : null;
        s.error = s.ok ? null : abort.signal.aborted ? 'stopped before GitHub was approved' : r.output.split('\n').slice(-3).join(' ') || 'gh auth login did not finish';
      })
      .catch((e) => {
        s.error = String((e as Error)?.message ?? e);
      })
      .finally(() => {
        clearTimeout(timer);
        s.done = true;
        if (this.abort === abort) this.abort = null;
      });
    return s;
  }

  cancel(): void {
    this.abort?.abort();
  }
}
