/**
 * What a deploy added to the project (ADR-0041, amended): a host's CLI may change the repository — Vercel adds `.vercel`
 * to .gitignore — and when the goal goes to GitHub those changes go with it. What must never be committed stays out:
 * the hosts' own folders (their link to the site and what they built), which .gitignore names instead; installed
 * packages, a build's output, and what Foundry's own install did to the package files. The rest is committed the way
 * the goal was delivered: onto the goal's branch while its pull request is open (or it was pushed without one), else
 * through a small pull request from the online base, merged right away when the goal's policy merges. A Local only goal
 * keeps nothing. Every command is in the deploy's activity; it never fails the deploy.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DeployProvider, Goal } from '@foundry/core';
import type { Engine } from '../engine.ts';
import { afterRevertMerged } from '../delivery/revert.ts';
import { repoSlug } from '../delivery/policy.ts';
import { commitStaged, ensureDetachedWorktree, exec, git, gitOk, removeWorktree, type ExecResult } from '../git/git.ts';
import { fetchBase } from '../git/sync.ts';
import { PROVIDER_LABEL } from './providers.ts';

/** the hosts' own folders: the link to the site, a local build, a cache — never the project's */
const HOST_FOLDERS = ['.vercel', '.netlify', '.wrangler'];
/** installed packages and the frameworks' build folders */
const BUILT = ['node_modules', '.next', '.nuxt', '.output', '.svelte-kit', '.astro', '.turbo', '.cache'];
/** what an install may write: the deploy's own install is no change of the project's */
const PACKAGE_FILES = new Set(['package.json', 'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lock', 'bun.lockb']);

/**
 * Of the paths a deploy changed (as `git status` names them, relative to the repository), the ones the repository
 * keeps, and the host folders .gitignore has to name because git saw them. `outputDirs`: where the build left its files.
 */
export function sortDeployChanges(paths: string[], outputDirs: string[]): { keep: string[]; ignore: string[] } {
  const keep: string[] = [];
  const ignore = new Set<string>();
  for (const p of paths) {
    const parts = p.replace(/\/$/, '').split('/');
    const host = parts.find((s) => HOST_FOLDERS.includes(s));
    if (host) ignore.add(host);
    else if (parts.some((s) => BUILT.includes(s)) || PACKAGE_FILES.has(parts.at(-1)!)) continue;
    else if (outputDirs.some((o) => o && o !== '.' && (p === o || p.startsWith(`${o}/`)))) continue;
    else keep.push(p);
  }
  return { keep, ignore: [...ignore] };
}

/** the paths `git status` lists in a folder (an untracked folder as `dir/`), renames by their new name */
async function changedPaths(dir: string): Promise<string[]> {
  // untrimmed: an entry's first column may be a space (` M .gitignore`)
  const r = await git(['status', '--porcelain=v1', '-z'], dir);
  if (r.code !== 0) throw new Error(`git status failed: ${r.stderr.trim()}`);
  const items = r.stdout.split('\0').filter(Boolean);
  const paths: string[] = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i]!;
    paths.push(it.slice(3));
    if (it[0] === 'R' || it[0] === 'C') i++;
  }
  return paths;
}

/** .gitignore names the host folders git saw, each once */
function ignoreFolders(dir: string, folders: string[]): void {
  const file = join(dir, '.gitignore');
  const was = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const lines = new Set(was.split('\n').map((l) => l.trim()));
  const add = folders.filter((f) => !lines.has(f) && !lines.has(`${f}/`) && !lines.has(`/${f}`));
  if (add.length) writeFileSync(file, `${was}${was && !was.endsWith('\n') ? '\n' : ''}${add.join('\n')}\n`);
}

export interface KeepTarget {
  provider: DeployProvider;
  /** where the build left its files, relative to the repository */
  outputDirs: string[];
}

/** Commit what the deploy in `dir` (a checkout of the deployed commit) added to the project, as the goal is delivered. */
export async function keepDeployFiles(engine: Engine, goal: Goal, dir: string, t: KeepTarget): Promise<void> {
  const label = PROVIDER_LABEL[t.provider];
  const say = (message: string, level: 'info' | 'warn' = 'info') => engine.store.append({ type: 'engine.note', goalId: goal.id, payload: { level, message: `deploy: ${message}` } });
  try {
    const d = goal.delivery;
    if (d.policy.mode === 'local') return;
    const sorted = sortDeployChanges(await changedPaths(dir), t.outputDirs);
    if (!sorted.keep.length && !sorted.ignore.length) return;
    ignoreFolders(dir, sorted.ignore);
    const files = [...new Set([...sorted.keep, ...(sorted.ignore.length ? ['.gitignore'] : [])])];
    const what = `${files.join(', ')}${sorted.ignore.length ? ` (${sorted.ignore.join(', ')} kept out of git)` : ''}`;
    // the goal's branch while it takes commits; a pull request of its own once the goal's work is on GitHub; else nothing
    const where = d.status === 'running' ? 'running' : onGoalBranch(goal) && (await sameCommit(dir, goal.repoPath, goal.branch)) ? 'branch' : d.outcome ? 'pr' : null;
    if (where === 'running' || !where) {
      say(`${label} changed ${what}; not committed: ${where ? "the goal's delivery is running, so deploy again once it has finished" : "the goal's work has not gone to GitHub"}`);
      return;
    }
    await gitOk(['add', '-A', '--', ...files], dir);
    const message = `chore(deploy): keep what the ${label} deploy added\n\n${label} changed ${files.join(', ')} while deploying "${goal.title}".${sorted.ignore.length ? ` Its own folder${sorted.ignore.length > 1 ? 's' : ''} (${sorted.ignore.join(', ')}) — the link to the site and what it built — ${sorted.ignore.length > 1 ? 'are' : 'is'} ignored, never committed.` : ''}`;
    const done = await (where === 'branch' ? toGoalBranch(engine, goal, dir, message, t) : throughPullRequest(engine, goal, dir, message, t));
    say(`${label} changed ${what}: ${done}`);
  } catch (err) {
    say(`what ${label} added to the project was not committed: ${String((err as Error)?.message ?? err).slice(0, 400)}`, 'warn');
  }
}

/** the goal's own branch still takes commits: its one pull request is open, or it was pushed without one */
function onGoalBranch(goal: Goal): boolean {
  const d = goal.delivery;
  const pr = d.prs.length === 1 && d.prs[0]!.taskId === null && d.prs[0]!.branch === goal.branch ? d.prs[0]! : null;
  return pr ? pr.state === 'open' : d.outcome === 'pushed' && d.prs.length === 0;
}
async function sameCommit(dir: string, repo: string, branch: string): Promise<boolean> {
  const head = (await git(['rev-parse', 'HEAD'], dir)).stdout.trim();
  return !!head && (await git(['rev-parse', '--verify', '-q', `refs/heads/${branch}`], repo)).stdout.trim() === head;
}

/** a runner that records each command in the deploy's activity */
function recorder(engine: Engine, goal: Goal, provider: DeployProvider) {
  return async (label: string, argv: string[], cwd: string): Promise<ExecResult> => {
    const t0 = Date.now();
    const r = await exec(argv, cwd, { timeoutMs: 180_000 });
    engine.store.append({ type: 'deploy.command', goalId: goal.id, payload: { provider, label, command: argv.join(' '), exitCode: r.code, durationMs: Date.now() - t0, outputTail: `${r.stdout}\n${r.stderr}`.trim().slice(-3_000) } });
    return r;
  };
}

/** onto the goal's branch, pushed: the open pull request takes it; the local branch follows where that is safe */
async function toGoalBranch(engine: Engine, goal: Goal, dir: string, message: string, t: KeepTarget): Promise<string> {
  const cmd = recorder(engine, goal, t.provider);
  const { remote } = goal.delivery.policy;
  const before = (await gitOk(['rev-parse', 'HEAD'], dir)).trim();
  const { ref, committed } = await commitStaged(dir, message);
  if (!committed) return 'nothing to commit';
  const push = await cmd('push what the deploy added', ['git', 'push', remote, `HEAD:refs/heads/${goal.branch}`], dir);
  if (push.code !== 0) throw new Error(`git push failed: ${(push.stderr || push.stdout).trim().slice(0, 300)}`);
  // the local goal branch moves too: in the folder that has it checked out when that is clean, else by its ref
  const holder = (await gitOk(['worktree', 'list', '--porcelain'], goal.repoPath))
    .split('\n\n')
    .find((w) => w.split('\n').includes(`branch refs/heads/${goal.branch}`))
    ?.match(/^worktree (.+)$/m)?.[1];
  const moved = holder ? await git(['merge', '--ff-only', '-q', ref], holder) : await git(['update-ref', `refs/heads/${goal.branch}`, ref, before], goal.repoPath);
  const pr = goal.delivery.prs[0];
  return `committed ${ref.slice(0, 7)} onto ${goal.branch} and pushed it to ${remote}${pr?.number ? `, into pull request #${pr.number}` : ''}${moved.code === 0 ? '' : ` (your local ${goal.branch} was left as it was)`}`;
}

/** a branch from the online base with the same change, pushed, and its pull request (merged when the policy merges) */
async function throughPullRequest(engine: Engine, goal: Goal, dir: string, message: string, t: KeepTarget): Promise<string> {
  const { config, gh } = engine;
  const cmd = recorder(engine, goal, t.provider);
  const { remote, mode, mergeMethod } = goal.delivery.policy;
  const repoPath = goal.repoPath;
  const base = goal.baseBranch;
  const patch = (await git(['diff', '--cached', '--binary', 'HEAD'], dir)).stdout;
  if (!patch.trim()) return 'nothing to commit';
  const s = await fetchBase(repoPath, base, { remote });
  if (!s.remoteRef) throw new Error(s.error ?? `${remote}/${base} is not known here`);
  const branch = `${goal.branch}-deploy-${Date.now().toString(36)}`;
  const ws = `${dir}.keep`;
  const patchFile = `${ws}.patch`;
  try {
    await ensureDetachedWorktree(repoPath, ws, s.remoteRef);
    await gitOk(['checkout', '-q', '-b', branch], ws);
    writeFileSync(patchFile, patch);
    const applied = await cmd('apply what the deploy added', ['git', 'apply', '--3way', '--index', patchFile], ws);
    if (applied.code !== 0) throw new Error(`it does not apply to ${remote}/${base}: ${(applied.stderr || applied.stdout).trim().slice(0, 300)}`);
    const { committed } = await commitStaged(ws, message);
    if (!committed) return `${remote}/${base} has it already`;
    const push = await cmd('push what the deploy added', ['git', 'push', '-u', remote, `refs/heads/${branch}:refs/heads/${branch}`], ws);
    if (push.code !== 0) throw new Error(`git push failed: ${(push.stderr || push.stdout).trim().slice(0, 300)}`);
    if (mode === 'push') return `pushed as ${branch} to ${remote}`;
    const a = await gh.available().catch(() => ({ installed: false, authenticated: false }));
    if (!a.installed || !a.authenticated) return `pushed as ${branch} to ${remote}; GitHub CLI (gh) is not ${a.installed ? 'logged in' : 'installed'}, so no pull request was opened`;
    const url = await git(['remote', 'get-url', remote], repoPath);
    const repo = repoSlug(url.stdout.trim());
    const deliveryDir = join(config.dataDir, 'delivery', goal.id);
    mkdirSync(deliveryDir, { recursive: true });
    const bodyFile = join(deliveryDir, `${branch.split('/').at(-1)}.md`);
    writeFileSync(bodyFile, `## Summary\n\n${message.split('\n\n').slice(1).join('\n\n')}\n\n## Merge Danger\n\n**Door:** two-way · reverting this pull request takes it back.\n\n**Blast Radius:** low · only what the deploy added.\n\n---\n_Opened by Foundry · goal \`${goal.id}\`_`);
    const title = `chore(deploy): keep what the ${PROVIDER_LABEL[t.provider]} deploy added`;
    const pr = await gh.prCreate(ws, { repo, head: branch, base, title, bodyFile });
    if (mode !== 'pr-automerge') return `pull request #${pr.number} opened (${pr.url})`;
    const m = await gh.prMerge(config.dataDir, { repo, number: pr.number, method: mergeMethod, auto: false });
    if (m.code === 0) return `pull request #${pr.number} merged with ${mergeMethod}; ${await afterRevertMerged(engine, goal, branch)}`;
    const auto = await gh.prMerge(config.dataDir, { repo, number: pr.number, method: mergeMethod, auto: true });
    return auto.code === 0 ? `pull request #${pr.number} opened, auto-merge armed (${pr.url})` : `pull request #${pr.number} opened but not merged: ${(m.stderr || m.stdout).trim().slice(0, 200)} (${pr.url})`;
  } finally {
    await removeWorktree(repoPath, ws, { deleteBranch: branch }).catch(() => {});
    rmSync(patchFile, { force: true });
  }
}
