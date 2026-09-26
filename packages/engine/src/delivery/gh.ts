import { exec as defaultExec, type ExecResult } from '../git/git.ts';

export interface GhAvailability {
  installed: boolean;
  version: string | null;
  authenticated: boolean;
  login: string | null;
}
export interface PrRef {
  number: number;
  url: string;
}
export interface PrView extends PrRef {
  state: 'OPEN' | 'MERGED' | 'CLOSED' | string;
  mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN' | string;
  mergeStateStatus: string | null;
  mergedAt: string | null;
  mergeCommit: string | null;
  /** `run` = a GitHub check run (Actions or an app); `status` = a commit status another service posted (e.g. a deploy
   * integration). `description` is the status text; `url` where to read more. */
  checks: { name: string; status: string; conclusion: string | null; kind?: 'run' | 'status'; description?: string | null; url?: string | null }[];
}
export type ChecksReduced = 'pending' | 'passing' | 'failing' | 'none';

/** Everything the pipeline needs from GitHub. `CliGh` shells out to `gh`; tests use a fake. */
export interface GhClient {
  available(): Promise<GhAvailability>;
  /** `gh auth login --web`: streams the one-time code / URL lines */
  login(onLine: (line: string) => void, signal?: AbortSignal): Promise<{ ok: boolean; output: string }>;
  orgs(): Promise<string[]>;
  repoExists(owner: string, name: string): Promise<boolean>;
  repoCreate(i: { owner: string; name: string; visibility: 'private' | 'public'; sourcePath: string; remote: string }): Promise<{ url: string }>;
  prFind(cwd: string, i: { repo: string; head: string; base: string }): Promise<PrRef | null>;
  prCreate(cwd: string, i: { repo: string; head: string; base: string; title: string; bodyFile: string }): Promise<PrRef>;
  prView(cwd: string, i: { repo: string; number: number }): Promise<PrView>;
  /** does the repository run any CI at all (workflows, or required status checks on the base)? null = could not tell */
  hasCi?(cwd: string, i: { repo: string; base: string }): Promise<boolean | null>;
  prMerge(cwd: string, i: { repo: string; number: number; method: 'squash' | 'merge' | 'rebase'; auto: boolean }): Promise<ExecResult>;
  /** retarget a stacked PR once the PR below it merged */
  prEdit(cwd: string, i: { repo: string; number: number; base: string }): Promise<ExecResult>;
  /** the most recent PR (any state) whose head is this branch */
  prFindAny(cwd: string, i: { repo: string; head: string }): Promise<(PrRef & { state: 'OPEN' | 'MERGED' | 'CLOSED' | string; base: string }) | null>;
  prReopen(cwd: string, i: { repo: string; number: number }): Promise<ExecResult>;
  failedLog(cwd: string, i: { repo: string; branch: string }): Promise<string | null>;
}

const FAILED = ['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE'];
/** the checks that fail, as the delivery records and shows them */
export function failingChecks(checks: PrView['checks']): { name: string; description: string | null; url: string | null; kind: 'run' | 'status' }[] {
  return checks.filter((c) => FAILED.includes((c.conclusion ?? c.status ?? '').toUpperCase())).map((c) => ({ name: c.name, description: c.description ?? null, url: c.url ?? null, kind: c.kind ?? 'run' }));
}
/** one line per failing check: "Vercel — Deployment was blocked (https://…)" */
export function describeFailing(f: { name: string; description: string | null; url: string | null }[]): string {
  return f.map((c) => `${c.name}${c.description ? ` — ${c.description}` : ''}${c.url ? ` (${c.url})` : ''}`).join('\n');
}

export function reduceChecks(checks: PrView['checks']): ChecksReduced {
  if (!checks.length) return 'none';
  const concl = (c: PrView['checks'][number]) => (c.conclusion ?? c.status ?? '').toUpperCase();
  if (checks.some((c) => ['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE'].includes(concl(c)))) return 'failing';
  if (checks.some((c) => ['IN_PROGRESS', 'QUEUED', 'PENDING', 'WAITING', 'REQUESTED', 'EXPECTED', ''].includes(concl(c)) || c.status?.toUpperCase() === 'IN_PROGRESS')) return 'pending';
  return 'passing';
}

export type CommandHook = (cmd: string[], cwd: string, r: ExecResult, ms: number) => void;

export class CliGh implements GhClient {
  private bin: string | null;
  constructor(private opts: { exec?: typeof defaultExec; which?: (b: string) => string | null; onCommand?: CommandHook; timeoutMs?: number } = {}) {
    this.bin = (opts.which ?? ((b) => Bun.which(b)))('gh');
  }
  private async run(args: string[], cwd: string, timeoutMs = this.opts.timeoutMs ?? 120_000): Promise<ExecResult> {
    if (!this.bin) return { code: 127, stdout: '', stderr: 'gh not installed' };
    const t0 = Date.now();
    const r = await (this.opts.exec ?? defaultExec)([this.bin, ...args], cwd, { timeoutMs, env: { GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1', NO_COLOR: '1', GH_PAGER: 'cat', CLICOLOR: '0' } });
    this.opts.onCommand?.(['gh', ...args], cwd, r, Date.now() - t0);
    return r;
  }
  async available(): Promise<GhAvailability> {
    if (!this.bin) return { installed: false, version: null, authenticated: false, login: null };
    const v = await this.run(['--version'], process.cwd(), 10_000);
    const version = v.stdout.match(/gh version (\S+)/)?.[1] ?? null;
    const a = await this.run(['auth', 'status', '-h', 'github.com'], process.cwd(), 20_000);
    if (a.code !== 0) return { installed: true, version, authenticated: false, login: null };
    const u = await this.run(['api', 'user', '--jq', '.login'], process.cwd(), 20_000);
    return { installed: true, version, authenticated: u.code === 0, login: u.stdout.trim() || null };
  }
  async login(onLine: (line: string) => void, signal?: AbortSignal): Promise<{ ok: boolean; output: string }> {
    if (!this.bin) return { ok: false, output: 'gh not installed' };
    const proc = Bun.spawn([this.bin, 'auth', 'login', '--web', '-h', 'github.com', '-p', 'https'], { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe', env: { ...process.env, GH_PROMPT_DISABLED: '1', NO_COLOR: '1' } });
    signal?.addEventListener('abort', () => proc.kill('SIGTERM'));
    const lines: string[] = [];
    const pump = async (s: ReadableStream<Uint8Array>) => {
      const reader = s.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split(/\r?\n/);
        buf = parts.pop() ?? '';
        for (const p of parts) {
          const clean = p.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').trim();
          if (clean) {
            lines.push(clean);
            onLine(clean);
          }
        }
      }
      if (buf.trim()) {
        lines.push(buf.trim());
        onLine(buf.trim());
      }
    };
    await Promise.all([pump(proc.stdout as ReadableStream<Uint8Array>), pump(proc.stderr as ReadableStream<Uint8Array>)]);
    const code = await proc.exited;
    return { ok: code === 0, output: lines.join('\n') };
  }
  async orgs(): Promise<string[]> {
    const me = await this.run(['api', 'user', '--jq', '.login'], process.cwd());
    const o = await this.run(['api', 'user/orgs', '--paginate', '--jq', '.[].login'], process.cwd());
    return [...new Set([me.stdout.trim(), ...o.stdout.split('\n').map((s) => s.trim())].filter(Boolean))];
  }
  async repoExists(owner: string, name: string): Promise<boolean> {
    return (await this.run(['repo', 'view', `${owner}/${name}`, '--json', 'name'], process.cwd())).code === 0;
  }
  async repoCreate(i: { owner: string; name: string; visibility: 'private' | 'public'; sourcePath: string; remote: string }): Promise<{ url: string }> {
    const r = await this.run(['repo', 'create', `${i.owner}/${i.name}`, `--${i.visibility}`, '--source', i.sourcePath, '--remote', i.remote], i.sourcePath, 180_000);
    if (r.code !== 0) throw new Error(`gh repo create failed: ${(r.stderr || r.stdout).trim().slice(0, 400)}`);
    const url = r.stdout.match(/https:\/\/github\.com\/\S+/)?.[0] ?? `https://github.com/${i.owner}/${i.name}`;
    return { url };
  }
  async prFind(cwd: string, i: { repo: string; head: string; base: string }): Promise<PrRef | null> {
    const r = await this.run(['pr', 'list', '-R', i.repo, '--head', i.head, '--base', i.base, '--state', 'open', '--json', 'number,url', '--limit', '1'], cwd);
    if (r.code !== 0) return null;
    try {
      const list = JSON.parse(r.stdout);
      return list[0] ? { number: list[0].number, url: list[0].url } : null;
    } catch {
      return null;
    }
  }
  async prCreate(cwd: string, i: { repo: string; head: string; base: string; title: string; bodyFile: string }): Promise<PrRef> {
    const r = await this.run(['pr', 'create', '-R', i.repo, '--base', i.base, '--head', i.head, '--title', i.title, '--body-file', i.bodyFile], cwd);
    if (r.code !== 0) throw new Error(`gh pr create failed: ${(r.stderr || r.stdout).trim().slice(0, 400)}`);
    const url = r.stdout.trim().split('\n').find((l) => l.startsWith('https://')) ?? '';
    const number = Number(url.match(/\/pull\/(\d+)/)?.[1] ?? 0);
    if (!number) {
      const found = await this.prFind(cwd, i);
      if (found) return found;
      throw new Error(`could not determine PR number from: ${r.stdout}`);
    }
    return { number, url };
  }
  async prView(cwd: string, i: { repo: string; number: number }): Promise<PrView> {
    const r = await this.run(['pr', 'view', String(i.number), '-R', i.repo, '--json', 'number,url,state,mergeable,mergeStateStatus,mergedAt,mergeCommit,statusCheckRollup'], cwd);
    if (r.code !== 0) throw new Error(`gh pr view failed: ${(r.stderr || r.stdout).trim().slice(0, 300)}`);
    const j = JSON.parse(r.stdout);
    const checks = (Array.isArray(j.statusCheckRollup) ? j.statusCheckRollup : []).map((c: any) => ({
      name: c.name ?? c.context ?? '?',
      status: c.status ?? c.state ?? '',
      conclusion: c.conclusion ?? c.state ?? null,
      kind: c.__typename === 'StatusContext' || (c.context && !c.name) ? ('status' as const) : ('run' as const),
      description: c.description ?? c.title ?? null,
      url: c.detailsUrl ?? c.targetUrl ?? null,
    }));
    return { number: j.number, url: j.url, state: j.state, mergeable: j.mergeable ?? 'UNKNOWN', mergeStateStatus: j.mergeStateStatus ?? null, mergedAt: j.mergedAt ?? null, mergeCommit: j.mergeCommit?.oid ?? null, checks };
  }
  async hasCi(cwd: string, i: { repo: string; base: string }): Promise<boolean | null> {
    const wf = await this.run(['api', `repos/${i.repo}/actions/workflows`, '--jq', '.total_count'], cwd);
    if (wf.code !== 0) return null;
    if (Number(wf.stdout.trim()) > 0) return true;
    // no workflows: required status checks (from another CI) still count
    const prot = await this.run(['api', `repos/${i.repo}/branches/${encodeURIComponent(i.base)}/protection/required_status_checks`, '--jq', '.contexts | length'], cwd);
    if (prot.code === 0) return Number(prot.stdout.trim()) > 0;
    return /404|not found|Branch not protected/i.test(prot.stderr + prot.stdout) ? false : null;
  }
  prMerge(cwd: string, i: { repo: string; number: number; method: 'squash' | 'merge' | 'rebase'; auto: boolean }): Promise<ExecResult> {
    return this.run(['pr', 'merge', String(i.number), '-R', i.repo, `--${i.method}`, ...(i.auto ? ['--auto'] : [])], cwd);
  }
  prEdit(cwd: string, i: { repo: string; number: number; base: string }): Promise<ExecResult> {
    return this.run(['pr', 'edit', String(i.number), '-R', i.repo, '--base', i.base], cwd);
  }
  async prFindAny(cwd: string, i: { repo: string; head: string }): Promise<(PrRef & { state: string; base: string }) | null> {
    const r = await this.run(['pr', 'list', '-R', i.repo, '--head', i.head, '--state', 'all', '--json', 'number,url,state,baseRefName', '--limit', '5'], cwd);
    if (r.code !== 0) return null;
    try {
      const list = JSON.parse(r.stdout) as { number: number; url: string; state: string; baseRefName: string }[];
      // newest first; a merged one wins over a stale closed duplicate
      const pick = list.find((p) => p.state === 'OPEN') ?? list.find((p) => p.state === 'MERGED') ?? list[0];
      return pick ? { number: pick.number, url: pick.url, state: pick.state, base: pick.baseRefName } : null;
    } catch {
      return null;
    }
  }
  prReopen(cwd: string, i: { repo: string; number: number }): Promise<ExecResult> {
    return this.run(['pr', 'reopen', String(i.number), '-R', i.repo], cwd);
  }
  async failedLog(cwd: string, i: { repo: string; branch: string }): Promise<string | null> {
    const l = await this.run(['run', 'list', '-R', i.repo, '--branch', i.branch, '--json', 'databaseId,conclusion,name', '--limit', '5'], cwd);
    if (l.code !== 0) return null;
    let runs: any[] = [];
    try {
      runs = JSON.parse(l.stdout);
    } catch {
      return null;
    }
    const failed = runs.find((r) => r.conclusion && r.conclusion !== 'success');
    if (!failed) return null;
    const v = await this.run(['run', 'view', String(failed.databaseId), '-R', i.repo, '--log-failed'], cwd, 120_000);
    return v.stdout || v.stderr || null;
  }
}
