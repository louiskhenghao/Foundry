import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

export async function exec(cmd: string[], cwd: string, opts: { timeoutMs?: number; env?: Record<string, string> } = {}): Promise<ExecResult> {
  const proc = Bun.spawn(cmd, { cwd, stdout: 'pipe', stderr: 'pipe', env: { ...process.env, ...(opts.env ?? {}) } });
  let timer: ReturnType<typeof setTimeout> | undefined;
  if (opts.timeoutMs) timer = setTimeout(() => proc.kill('SIGKILL'), opts.timeoutMs);
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  if (timer) clearTimeout(timer);
  return { code, stdout, stderr };
}

export async function git(args: string[], cwd: string): Promise<ExecResult> {
  return exec(['git', ...args], cwd);
}

export async function gitOk(args: string[], cwd: string): Promise<string> {
  const r = await git(args, cwd);
  if (r.code !== 0) throw new Error(`git ${args.join(' ')} failed (${r.code}): ${r.stderr.trim() || r.stdout.trim()}`);
  return r.stdout.trim();
}

export const isGitRepo = async (path: string) => (await git(['rev-parse', '--is-inside-work-tree'], path)).code === 0 && (await git(['rev-parse', '--is-inside-work-tree'], path)).stdout.trim() === 'true';
export const currentBranch = (cwd: string) => gitOk(['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
export const headRef = (cwd: string) => gitOk(['rev-parse', 'HEAD'], cwd);
export const isDirty = async (cwd: string) => (await gitOk(['status', '--porcelain'], cwd)).length > 0;
export const branchExists = async (branch: string, cwd: string) => (await git(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], cwd)).code === 0;

/** Stage everything and commit if there is anything to commit. Returns the new HEAD. */
export async function commitAll(cwd: string, message: string): Promise<{ ref: string; committed: boolean }> {
  await gitOk(['add', '-A'], cwd);
  const staged = await git(['diff', '--cached', '--quiet'], cwd);
  if (staged.code === 0) return { ref: await headRef(cwd), committed: false };
  await gitOk([...(await gitIdent(cwd)), 'commit', '-q', '-m', withCoauthor(message)], cwd);
  return { ref: await headRef(cwd), committed: true };
}

/**
 * Who the engine's commits are written by (Settings → Git & delivery → commit author). Platforms that gate deploys on
 * the commit author (Vercel teams, CLA bots) need a real account, so by default the person's own git identity is the
 * author and Foundry is named as co-author in a trailer.
 */
export type CommitAuthorMode = 'you-coauthor' | 'you' | 'foundry';
export interface CommitIdentity {
  name: string;
  email: string;
  /** where it came from: the repository's or the global git config, the GitHub account gh is signed in to, or Foundry */
  source: 'git-config' | 'gh' | 'foundry';
}
export const FOUNDRY_IDENTITY: CommitIdentity = { name: 'foundry', email: 'foundry@local', source: 'foundry' };
export const FOUNDRY_COAUTHOR = 'Co-authored-by: Foundry <foundry@local>';
let authorMode: CommitAuthorMode = 'you-coauthor';
const identityCache = new Map<string, { at: number; id: CommitIdentity }>();
export function setCommitAuthorMode(mode: CommitAuthorMode): void {
  authorMode = mode;
  identityCache.clear();
}
export const commitAuthorMode = () => authorMode;

/** The identity commits in this repository (any of its worktrees) are written with. Cached per repository for ten minutes. */
export async function resolveCommitIdentity(cwd: string): Promise<CommitIdentity> {
  if (authorMode === 'foundry') return FOUNDRY_IDENTITY;
  const key = (await git(['rev-parse', '--path-format=absolute', '--git-common-dir'], cwd)).stdout.trim() || cwd;
  const hit = identityCache.get(key);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.id;
  // `git config` without a scope reads the repository's value first, then the global one
  const name = (await git(['config', 'user.name'], cwd)).stdout.trim();
  const email = (await git(['config', 'user.email'], cwd)).stdout.trim();
  let id: CommitIdentity = name && email ? { name, email, source: 'git-config' } : FOUNDRY_IDENTITY;
  if (id.source === 'foundry') {
    const gh = await exec(['gh', 'api', 'user', '--jq', '[.login, (.id|tostring), (.name // "")] | join("|")'], cwd, { timeoutMs: 8000 }).catch(() => null);
    const [login, ghId, ...rest] = gh?.code === 0 ? gh.stdout.trim().split('|') : [];
    const ghName = rest.join('|');
    if (login && ghId) id = { name: ghName || login, email: `${ghId}+${login}@users.noreply.github.com`, source: 'gh' };
  }
  identityCache.set(key, { at: Date.now(), id });
  return id;
}

/** `-c user.name=… -c user.email=…` for a commit, merge or cherry-pick run in `cwd` */
export async function gitIdent(cwd: string): Promise<string[]> {
  const id = await resolveCommitIdentity(cwd);
  return ['-c', `user.name=${id.name}`, '-c', `user.email=${id.email}`];
}

/** Add the Foundry co-author trailer when the setting asks for it (and the author is not Foundry already). */
export function withCoauthor(message: string, mode: CommitAuthorMode = authorMode): string {
  if (mode !== 'you-coauthor' || message.includes(FOUNDRY_COAUTHOR)) return message;
  const body = message.trimEnd();
  const lastPara = body.split(/\n\s*\n/).pop() ?? '';
  // join an existing trailer block (Task: … / Goal: …) instead of starting a new paragraph
  const isTrailers = body.includes('\n') && lastPara.split('\n').every((l) => /^[A-Za-z][\w-]*: /.test(l));
  return `${body}${isTrailers ? '\n' : '\n\n'}${FOUNDRY_COAUTHOR}`;
}

/** Commit whatever is staged (used after a squash merge / soft reset / resolved cherry-pick). */
export async function commitStaged(cwd: string, message: string, opts: { allowEmpty?: boolean } = {}): Promise<{ ref: string; committed: boolean }> {
  const staged = await git(['diff', '--cached', '--quiet'], cwd);
  if (staged.code === 0 && !opts.allowEmpty) return { ref: await headRef(cwd), committed: false };
  await gitOk([...(await gitIdent(cwd)), 'commit', '-q', ...(opts.allowEmpty ? ['--allow-empty'] : []), '-m', withCoauthor(message)], cwd);
  return { ref: await headRef(cwd), committed: true };
}

/** Does `ref` resolve to a commit in this repository? */
export const refExists = async (cwd: string, ref: string) => (await git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], cwd)).code === 0;

/** Abort whatever merge/cherry-pick is in progress and return to a clean HEAD. */
export async function abortInProgress(cwd: string): Promise<void> {
  await git(['cherry-pick', '--abort'], cwd);
  await git(['merge', '--abort'], cwd);
  await git(['reset', '--merge'], cwd);
  await git(['reset', '--hard', 'HEAD'], cwd);
  await git(['clean', '-fdq'], cwd);
}

export async function resetHard(cwd: string, ref: string): Promise<void> {
  await gitOk(['reset', '--hard', ref], cwd);
  await gitOk(['clean', '-fdq'], cwd);
}

export interface NumstatEntry {
  path: string;
  insertions: number;
  deletions: number;
}
export async function numstat(cwd: string, from: string, to = 'HEAD'): Promise<NumstatEntry[]> {
  const r = await git(['diff', '--numstat', from, to], cwd);
  if (r.code !== 0) return [];
  return r.stdout
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [a, d, ...p] = l.split('\t');
      return { path: p.join('\t'), insertions: a === '-' ? 0 : Number(a), deletions: d === '-' ? 0 : Number(d) };
    });
}

export async function diff(cwd: string, from: string, to = 'HEAD', maxBytes = 200_000): Promise<string> {
  const r = await git(['diff', from, to], cwd);
  const d = r.stdout;
  return d.length > maxBytes ? d.slice(0, maxBytes) + `\n... [diff truncated at ${maxBytes} bytes]` : d;
}

/** Create a worktree at `path` for `branch`. Creates the branch from `base` if it does not exist. */
export async function ensureWorktree(repo: string, path: string, branch: string, base: string): Promise<void> {
  if (existsSync(path) && (await git(['rev-parse', '--is-inside-work-tree'], path)).code === 0) return;
  mkdirSync(dirname(path), { recursive: true });
  await git(['worktree', 'prune'], repo);
  if (await branchExists(branch, repo)) await gitOk(['worktree', 'add', path, branch], repo);
  else await gitOk(['worktree', 'add', '-b', branch, path, base], repo);
}

/** A throw-away worktree at `ref` with a detached HEAD (replaces whatever was at `path`). */
export async function ensureDetachedWorktree(repo: string, path: string, ref: string): Promise<void> {
  if (existsSync(path)) await removeWorktree(repo, path);
  mkdirSync(dirname(path), { recursive: true });
  await gitOk(['worktree', 'add', '--detach', path, ref], repo);
}

export async function removeWorktree(repo: string, path: string, opts: { deleteBranch?: string } = {}): Promise<void> {
  await git(['worktree', 'remove', '--force', path], repo);
  await git(['worktree', 'prune'], repo);
  if (opts.deleteBranch) await git(['branch', '-D', opts.deleteBranch], repo);
}

export async function conflictedFiles(cwd: string): Promise<string[]> {
  const r = await git(['diff', '--name-only', '--diff-filter=U'], cwd);
  return r.stdout.split('\n').filter(Boolean);
}
