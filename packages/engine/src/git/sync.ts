/**
 * Keeping a goal in step with upstream without ever touching the user's checkout:
 * `fetchBase` only updates remote-tracking refs; `startRef` decides where the goal branch should start;
 * `pullFastForward` is the one explicit, user-triggered action that moves the local base branch (ff-only).
 */
import { exec, git } from './git.ts';

export interface BaseSync {
  /** remote the base branch tracks (or `origin` when present); null = no remote */
  remote: string | null;
  base: string;
  localRef: string | null;
  /** tip of <remote>/<base> after the fetch (null when there is no remote or the fetch failed) */
  remoteRef: string | null;
  /** commits the local base has that the remote lacks (unpushed) */
  ahead: number;
  /** commits the remote has that the local base lacks */
  behind: number;
  fetched: boolean;
  error: string | null;
}

/** Which remote a branch should be compared with: its configured upstream, else `origin`, else the only remote. */
export async function remoteFor(repoPath: string, base: string): Promise<string | null> {
  const up = await git(['config', '--get', `branch.${base}.remote`], repoPath);
  if (up.code === 0 && up.stdout.trim()) return up.stdout.trim();
  const remotes = (await git(['remote'], repoPath)).stdout.split('\n').filter(Boolean);
  if (remotes.includes('origin')) return 'origin';
  return remotes.length === 1 ? remotes[0]! : null;
}

/** Fetch the base branch from its remote (remote-tracking ref only) and measure the gap. Never throws. */
export async function fetchBase(repoPath: string, base: string, opts: { remote?: string | null; timeoutMs?: number; fetch?: boolean } = {}): Promise<BaseSync> {
  const remote = opts.remote === undefined ? await remoteFor(repoPath, base) : opts.remote;
  const localRef = (await git(['rev-parse', '--verify', '-q', `refs/heads/${base}`], repoPath)).stdout.trim() || null;
  const out: BaseSync = { remote, base, localRef, remoteRef: null, ahead: 0, behind: 0, fetched: false, error: null };
  if (!remote) return out;
  if (opts.fetch !== false) {
    const f = await exec(['git', 'fetch', '-q', remote, base], repoPath, { timeoutMs: opts.timeoutMs ?? 60_000 });
    if (f.code !== 0) out.error = `git fetch ${remote} ${base} failed: ${(f.stderr || f.stdout).trim().slice(-200)}`;
    else out.fetched = true;
  }
  const remoteRef = (await git(['rev-parse', '--verify', '-q', `refs/remotes/${remote}/${base}`], repoPath)).stdout.trim() || null;
  out.remoteRef = remoteRef;
  if (localRef && remoteRef && localRef !== remoteRef) {
    const lr = await git(['rev-list', '--left-right', '--count', `${base}...${remote}/${base}`], repoPath);
    const [a, b] = lr.stdout.trim().split(/\s+/).map(Number);
    out.ahead = a ?? 0;
    out.behind = b ?? 0;
  }
  return out;
}

/** Where a new goal branch starts. `auto`: the remote tip when the local base is strictly behind it; otherwise the local base. */
export function startRef(s: BaseSync, mode: 'auto' | 'local' = 'auto'): { ref: string; from: 'local' | 'remote'; reason: string } {
  if (mode === 'local' || !s.remoteRef) return { ref: s.base, from: 'local', reason: !s.remote ? 'no remote' : !s.remoteRef ? (s.error ?? 'remote branch unknown') : 'policy: start from the local branch' };
  if (s.behind > 0 && s.ahead === 0) return { ref: `${s.remote}/${s.base}`, from: 'remote', reason: `local ${s.base} is ${s.behind} commit${s.behind === 1 ? '' : 's'} behind ${s.remote}/${s.base}` };
  if (s.behind > 0 && s.ahead > 0) return { ref: s.base, from: 'local', reason: `local ${s.base} and ${s.remote}/${s.base} have diverged (${s.ahead} ahead, ${s.behind} behind); starting from local, delivery will merge the remote` };
  if (s.ahead > 0) return { ref: s.base, from: 'local', reason: `local ${s.base} has ${s.ahead} unpushed commit${s.ahead === 1 ? '' : 's'}` };
  return { ref: s.base, from: 'local', reason: 'up to date with the remote' };
}

/**
 * Fast-forward the local base branch to its remote — the only operation that touches the user's checkout,
 * and only on request. Refuses when the branch is checked out with uncommitted changes or has diverged.
 */
export async function pullFastForward(repoPath: string, base: string): Promise<{ ok: boolean; detail: string; before: string | null; after: string | null }> {
  const s = await fetchBase(repoPath, base);
  if (!s.remote || !s.remoteRef) return { ok: false, detail: s.error ?? `no remote for ${base}`, before: s.localRef, after: s.localRef };
  if (s.behind === 0) return { ok: true, detail: s.ahead ? `already up to date (${s.ahead} unpushed commit${s.ahead === 1 ? '' : 's'})` : 'already up to date', before: s.localRef, after: s.localRef };
  if (s.ahead > 0) return { ok: false, detail: `${base} has diverged from ${s.remote}/${base} (${s.ahead} ahead, ${s.behind} behind) — merge or rebase it yourself`, before: s.localRef, after: s.localRef };
  const current = (await git(['rev-parse', '--abbrev-ref', 'HEAD'], repoPath)).stdout.trim();
  if (current === base) {
    const dirty = (await git(['status', '--porcelain'], repoPath)).stdout.trim();
    if (dirty) return { ok: false, detail: `${base} is checked out with uncommitted changes — commit or stash them first`, before: s.localRef, after: s.localRef };
    const r = await git(['merge', '--ff-only', `${s.remote}/${base}`], repoPath);
    if (r.code !== 0) return { ok: false, detail: (r.stderr || r.stdout).trim().slice(-200), before: s.localRef, after: s.localRef };
  } else {
    // not checked out: move the branch ref (fast-forward only)
    const r = await git(['fetch', '-q', s.remote, `${base}:${base}`], repoPath);
    if (r.code !== 0) return { ok: false, detail: (r.stderr || r.stdout).trim().slice(-200), before: s.localRef, after: s.localRef };
  }
  return { ok: true, detail: `fast-forwarded ${base} by ${s.behind} commit${s.behind === 1 ? '' : 's'}`, before: s.localRef, after: s.remoteRef };
}
