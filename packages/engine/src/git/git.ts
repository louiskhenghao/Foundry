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
  await gitOk([...GIT_IDENT, 'commit', '-q', '-m', message], cwd);
  return { ref: await headRef(cwd), committed: true };
}

export const GIT_IDENT = ['-c', 'user.name=ai-engine', '-c', 'user.email=ai-engine@local'];

/** Commit whatever is staged (used after a squash merge / soft reset / resolved cherry-pick). */
export async function commitStaged(cwd: string, message: string, opts: { allowEmpty?: boolean } = {}): Promise<{ ref: string; committed: boolean }> {
  const staged = await git(['diff', '--cached', '--quiet'], cwd);
  if (staged.code === 0 && !opts.allowEmpty) return { ref: await headRef(cwd), committed: false };
  await gitOk([...GIT_IDENT, 'commit', '-q', ...(opts.allowEmpty ? ['--allow-empty'] : []), '-m', message], cwd);
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
