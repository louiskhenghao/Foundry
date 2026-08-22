import { existsSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { exec, git } from '../git/git.ts';

export interface RepoInspection {
  path: string;
  exists: boolean;
  isDir: boolean;
  isGitRepo: boolean;
  /** path is inside a repo rooted elsewhere */
  insideRepoAt: string | null;
  branch: string | null;
  dirty: boolean;
  hasCommits: boolean;
  remotes: { name: string; url: string }[];
  identity: { name: string; email: string } | null;
  commitCount: number;
  lastCommit: { sha: string; date: string; subject: string } | null;
  /** number of changed/untracked paths when dirty */
  dirtyCount: number;
}

export async function inspectRepo(path: string): Promise<RepoInspection> {
  const base: RepoInspection = { path, exists: existsSync(path), isDir: false, isGitRepo: false, insideRepoAt: null, branch: null, dirty: false, hasCommits: false, remotes: [], identity: null, commitCount: 0, lastCommit: null, dirtyCount: 0 };
  if (!base.exists) return base;
  try {
    base.isDir = statSync(path).isDirectory();
  } catch {
    return base;
  }
  if (!base.isDir) return base;
  const top = await git(['rev-parse', '--show-toplevel'], path);
  if (top.code === 0) {
    const root = top.stdout.trim();
    if (root === path.replace(/\/+$/, '') || root === (await exec(['pwd', '-P'], path)).stdout.trim()) base.isGitRepo = true;
    else base.insideRepoAt = root;
  }
  const name = (await git(['config', '--get', 'user.name'], path)).stdout.trim();
  const email = (await git(['config', '--get', 'user.email'], path)).stdout.trim();
  base.identity = name && email ? { name, email } : null;
  if (!base.isGitRepo) return base;
  base.branch = (await git(['rev-parse', '--abbrev-ref', 'HEAD'], path)).stdout.trim() || null;
  base.hasCommits = (await git(['rev-parse', '--verify', '-q', 'HEAD'], path)).code === 0;
  const status = (await git(['status', '--porcelain'], path)).stdout.split('\n').filter(Boolean);
  base.dirty = status.length > 0;
  base.dirtyCount = status.length;
  if (base.hasCommits) {
    base.commitCount = Number((await git(['rev-list', '--count', 'HEAD'], path)).stdout.trim()) || 0;
    const last = (await git(['log', '-1', '--format=%H%x09%cI%x09%s'], path)).stdout.trim();
    const [sha, date, ...subject] = last.split('\t');
    if (sha) base.lastCommit = { sha, date: date ?? '', subject: subject.join('\t') };
  }
  const rem = await git(['remote', '-v'], path);
  const seen = new Map<string, string>();
  for (const l of rem.stdout.split('\n')) {
    const m = l.match(/^(\S+)\s+(\S+)\s+\(fetch\)/);
    if (m) seen.set(m[1]!, m[2]!);
  }
  base.remotes = [...seen.entries()].map(([n, u]) => ({ name: n, url: u }));
  return base;
}

const DEFAULT_GITIGNORE = `node_modules/
dist/
build/
.env
.env.*
!.env.example
.DS_Store
*.log
coverage/
`;

export interface InitResult {
  branch: string;
  ref: string;
  filesCommitted: number;
  identity: 'user' | 'fallback';
  gitignoreWritten: boolean;
}

/** One-click `git init` + initial commit, authored as the user when git knows who they are. */
export async function initRepo(path: string, opts: { branch?: string } = {}): Promise<InitResult> {
  const info = await inspectRepo(path);
  if (!info.exists || !info.isDir) throw new Error(`${path} is not a directory`);
  if (info.isGitRepo) throw new Error(`${path} is already a git repository`);
  if (info.insideRepoAt) throw new Error(`${path} is inside the git repository at ${info.insideRepoAt}; create the goal on that repository instead`);
  const branch = opts.branch ?? 'main';
  const r = await git(['init', '-q', '-b', branch], path);
  if (r.code !== 0) throw new Error(`git init failed: ${r.stderr.trim()}`);
  let gitignoreWritten = false;
  if (!existsSync(join(path, '.gitignore'))) {
    writeFileSync(join(path, '.gitignore'), DEFAULT_GITIGNORE);
    gitignoreWritten = true;
  }
  await git(['add', '-A'], path);
  const filesCommitted = (await git(['diff', '--cached', '--name-only'], path)).stdout.split('\n').filter(Boolean).length;
  const ident = info.identity ? [] : ['-c', 'user.name=ai-engine', '-c', 'user.email=ai-engine@local'];
  const c = await git([...ident, 'commit', '-q', '--allow-empty', '-m', 'chore: initial commit'], path);
  if (c.code !== 0) throw new Error(`initial commit failed: ${c.stderr.trim()}`);
  const ref = (await git(['rev-parse', 'HEAD'], path)).stdout.trim();
  return { branch, ref, filesCommitted, identity: info.identity ? 'user' : 'fallback', gitignoreWritten };
}
