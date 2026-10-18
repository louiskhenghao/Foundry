import { constants, cpSync, existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, type Dirent } from 'node:fs';
import { copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import type { Goal, Task } from '@foundry/core';
import { ensureWorktree, git, headRef, removeWorktree } from './git/git.ts';
import { copyProjectSkills } from './skills/autoskills.ts';

/** Where media tasks generate their files, workspace-relative. Kept out of git; delivered to the goal's output folder at done. */
export const ARTIFACTS_DIR = 'artifacts';
/** under artifacts/: the Brief's style sample images, there to choose a look by (never a deliverable of a task) */
export const SAMPLES_DIR = 'samples';
/** a path relative to artifacts/ that is one of the Brief's style samples */
export const isStyleSample = (rel: string) => rel.startsWith(`${SAMPLES_DIR}/`);

/** in a task worktree's artifacts/: what it inherited from the goal workspace, by content hash (see inheritArtifacts) */
const INHERITED = '.inherited.json';
/** a copy in progress (written beside its destination, then renamed over it): never an artifact itself */
const PART = '.foundry-part-';
/** what Finder and Windows leave in a folder someone opened (an AppleDouble ._ sidecar on exFAT or a share): never a file a goal made */
const OS_CLUTTER = /^(\.DS_Store|\._.*|Thumbs\.db|desktop\.ini)$/i;
const hashOf = async (file: string) => String(Bun.hash(await readFile(file)));

/**
 * Every file under a workspace's artifacts/, as paths relative to that folder (the inherited-files marker and copies
 * in progress are not). No symbolic link is followed: one can point anywhere, or at its own folder. A folder that
 * cannot be read is left out, not the whole listing, and `onSkip` hears of it (and of an artifacts/ that is a link).
 */
export function listArtifacts(ws: string, opts: { onSkip?: (rel: string, err: unknown) => void } = {}): string[] {
  const root = join(ws, ARTIFACTS_DIR);
  let top;
  try {
    top = lstatSync(root);
  } catch {
    return [];
  }
  if (!top.isDirectory()) {
    if (top.isSymbolicLink()) opts.onSkip?.(`${ARTIFACTS_DIR}/`, new Error(`${ARTIFACTS_DIR}/ is a symbolic link`));
    return [];
  }
  const files: string[] = [];
  const walk = (dir: string) => {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      opts.onSkip?.(`${relative(root, dir) || '.'}/`, err);
      return;
    }
    for (const e of entries) {
      if (e.isDirectory()) walk(join(dir, e.name));
      else if (e.isFile() && e.name !== INHERITED && !e.name.startsWith(PART) && !OS_CLUTTER.test(e.name)) files.push(relative(root, join(dir, e.name)));
    }
  };
  walk(root);
  return files.sort();
}

/**
 * Merge one workspace's artifacts into another's (task worktree → goal workspace after integrate: the squash merge
 * cannot carry them, they are git-excluded), saying which files it copied (paths relative to artifacts/). Existing
 * files are overwritten — parallel media tasks write disjoint names by convention (their manifests declare them). What
 * the source inherited and left untouched (a cad task's starting exports) stays where it is, so a task that finishes
 * later never puts an older copy over a newer export. `skip`: files left where they are;
 * `inherited`: copy what the source inherited and left as it was too, so the destination mirrors its artifacts; `before`:
 * called with each file about to be written (a file it fails for is not copied);
 * `onError`: a file that cannot be copied (or a folder the listing could not read) is reported and the others still go
 * (without it, the first error throws). Each file is written beside its destination and renamed over it (copyInto).
 * The copies run off the event loop: a model or a clip of hundreds of MB is not cloned where the disk cannot (Linux),
 * and a server copying it must keep answering.
 */
export async function copyArtifactFiles(fromWs: string, toWs: string, opts: { skip?: ReadonlySet<string>; inherited?: boolean; onError?: (f: string, err: unknown) => void; before?: (f: string) => Promise<void> } = {}): Promise<string[]> {
  let inherited: Record<string, string> = {};
  if (!opts.inherited) {
    try {
      inherited = JSON.parse(await readFile(join(fromWs, ARTIFACTS_DIR, INHERITED), 'utf8'));
    } catch {}
  }
  const root = join(toWs, ARTIFACTS_DIR);
  const failed = (f: string, err: unknown) => {
    if (!opts.onError) throw err;
    opts.onError(f, err);
  };
  const copied: string[] = [];
  for (const f of listArtifacts(fromWs, { onSkip: failed })) {
    if (opts.skip?.has(f)) continue;
    try {
      const src = join(fromWs, ARTIFACTS_DIR, f);
      if (inherited[f] && inherited[f] === (await hashOf(src))) continue;
      const dest = join(root, f);
      writableInside(root, dest);
      await opts.before?.(f);
      await copyInto(src, dest);
      copied.push(f);
    } catch (err) {
      failed(f, err);
    }
  }
  return copied;
}

/**
 * Copy a file beside its destination, then rename it over: a copy cut short (a full disk) leaves the old file, and no
 * link (symbolic or hard) at the destination is written through.
 */
export async function copyInto(src: string, dest: string): Promise<void> {
  await mkdir(dirname(dest), { recursive: true });
  const part = join(dirname(dest), `${PART}${process.pid}-${(partSeq++).toString(36)}-${basename(dest)}`);
  try {
    await copyFile(src, part, constants.COPYFILE_EXCL | constants.COPYFILE_FICLONE);
    await rename(part, dest);
  } catch (err) {
    await rm(part, { force: true });
    throw err;
  }
}
let partSeq = 0;

/** Refuse a destination that a symbolic link would carry outside `root`: the artifacts folder itself a link, or a link on the way. */
export function writableInside(root: string, dest: string): void {
  if (existsSync(root) && lstatSync(root).isSymbolicLink()) throw new Error(`${ARTIFACTS_DIR}/ is a symbolic link`);
  let dir = dirname(dest);
  while (!existsSync(dir) && dir.length > root.length) dir = dirname(dir);
  if (existsSync(dir)) {
    const real = realpathSync(dir);
    const top = existsSync(root) ? realpathSync(root) : null;
    if (top && real !== top && !real.startsWith(top + sep)) throw new Error(`${relative(root, dest)} would be written through a symbolic link`);
  }
}

/** the files under a worktree's artifacts/ that git tracks (relative to artifacts/): they come through git, never by copy */
export async function trackedArtifacts(ws: string): Promise<Set<string>> {
  const r = await git(['ls-files', '-z', '--', ARTIFACTS_DIR], ws).catch(() => null);
  if (!r || r.code !== 0) return new Set();
  return new Set(r.stdout.split('\0').map((p) => p.trim()).filter(Boolean).map((p) => relative(ARTIFACTS_DIR, p)));
}

/**
 * Artifacts into a worktree that runs checks, leaving alone what git tracks on either side (a repository's own
 * artifacts/ folder comes through git). `onlyChanged`: of a task worktree, only what the task changed or added (layered
 * over the goal's); otherwise everything, inherited files included.
 */
export async function copyUntrackedArtifacts(fromWs: string, toWs: string, opts: { onlyChanged?: boolean } = {}): Promise<string[]> {
  const [from, to] = await Promise.all([trackedArtifacts(fromWs), trackedArtifacts(toWs)]);
  return copyArtifactFiles(fromWs, toWs, { skip: new Set([...from, ...to]), inherited: !opts.onlyChanged });
}

/**
 * Give a task worktree the goal workspace's artifacts to build on, remembering them so that only what the task changes
 * or adds comes back. Like every artifact copy it writes beside the destination and renames over it, so a link left in
 * a reused worktree is replaced, never written through.
 */
export async function inheritArtifacts(goalWs: string, taskWs: string): Promise<number> {
  const root = join(taskWs, ARTIFACTS_DIR);
  // a reused worktree whose artifacts/ is itself a link gets nothing: every write would land where the link points
  if (lstatSync(root, { throwIfNoEntry: false })?.isSymbolicLink()) return 0;
  // a file that cannot come (a folder of the reused worktree that is a link, a copy cut short) is not inherited
  const copied = await copyArtifactFiles(goalWs, taskWs, { inherited: true, onError: () => {} });
  const marker: Record<string, string> = {};
  for (const f of copied) {
    try {
      marker[f] = await hashOf(join(root, f));
    } catch {
      // a copy that cannot be remembered would come back as the task's own work: it goes, like a copy that failed
      await rm(join(root, f), { force: true }).catch(() => {});
    }
  }
  const n = Object.keys(marker).length;
  if (n) {
    // whatever already has the part's name (a link planted there) goes first, and the part is only ever created anew
    const part = join(root, `${PART}${process.pid}-${(partSeq++).toString(36)}-${INHERITED}`);
    await rm(part, { force: true });
    await writeFile(part, JSON.stringify(marker), { flag: 'wx' });
    await rename(part, join(root, INHERITED));
  }
  return n;
}

/**
 * A file's content digest, read as a stream that lets the event loop run every few chunks: an export can be hundreds
 * of MB, and the server reading it must keep answering.
 */
export async function contentHash(file: string): Promise<string> {
  const h = new Bun.CryptoHasher('blake2b256');
  const reader = Bun.file(file).stream().getReader();
  let n = 0;
  for (let r = await reader.read(); !r.done; r = await reader.read()) {
    h.update(r.value);
    // the first chunk too: a stream read never yields by itself, and a run of small files must not hold the loop either
    if (n++ % 16 === 0) await new Promise((resolve) => setImmediate(resolve));
  }
  return h.digest('hex');
}

/**
 * `artifacts/samples/` holds the Brief's style sample images; the chosen one is the reference image the worker prompt tells
 * every task to open, so it must exist in each task worktree, not only in the goal workspace where it was generated.
 */
export function copyStyleSamples(fromWs: string, toWs: string): number {
  const src = join(fromWs, ARTIFACTS_DIR, SAMPLES_DIR);
  if (!existsSync(src)) return 0;
  const dest = join(toWs, ARTIFACTS_DIR, SAMPLES_DIR);
  mkdirSync(dest, { recursive: true });
  let n = 0;
  for (const f of readdirSync(src)) {
    if (existsSync(join(dest, f))) continue;
    cpSync(join(src, f), join(dest, f));
    n++;
  }
  return n;
}

/** what the path helpers need of a goal: its id (legacy layout) and its progress folder (current layout) */
export type WorkspaceRef = Pick<Goal, 'id' | 'workspaceDir'>;

/** `<dataDir>/worktrees/<goalId>`: the layout goals had before progress folders; still read for goals created then */
export const legacyWorkspaceRoot = (dataDir: string, goalId: string) => join(dataDir, 'worktrees', goalId);

/**
 * The engine's own folders of a goal live beside its progress folder, hidden: `<root>/.foundry/<folder>/` holds its
 * worktrees (tasks, delivery, resolve, baseline, preview, milestone, docs), the overlay backups, review diffs and
 * screenshots. Never inside it — docs generation and merges run `git add -A` in the goal worktree and would sweep nested
 * worktrees up.
 */
export function internalWorkspaceDir(goal: WorkspaceRef): string | null {
  return goal.workspaceDir ? join(dirname(goal.workspaceDir), '.foundry', basename(goal.workspaceDir)) : null;
}

/** Where reviewers' too-long diffs are saved to be read on demand: beside the progress folder, outside every worktree. */
export function reviewDiffDir(dataDir: string, goal: WorkspaceRef): string {
  return join(internalWorkspaceDir(goal) ?? join(dataDir, 'review'), 'review');
}

/** The goal worktree on the goal branch — the progress folder a person opens. */
export function goalWorkspacePath(dataDir: string, goal: WorkspaceRef): string {
  return goal.workspaceDir ?? join(legacyWorkspaceRoot(dataDir, goal.id), '_goal');
}
/** Scratch worktree where delivery builds the stacked per-task branches. */
export function deliveryWorkspacePath(dataDir: string, goal: WorkspaceRef): string {
  const internal = internalWorkspaceDir(goal);
  return internal ? join(internal, 'delivery') : join(legacyWorkspaceRoot(dataDir, goal.id), '_delivery');
}
/** detached worktree where a human resolves one task's conflicted integration by hand (one per task) */
export function resolveWorkspacePath(dataDir: string, goal: WorkspaceRef, taskId: string): string {
  const internal = internalWorkspaceDir(goal);
  return internal ? join(internal, 'resolve', taskId) : join(legacyWorkspaceRoot(dataDir, goal.id), '_resolve', taskId);
}
/** the goal's exports as a manual resolution of one task copied them for its checks and its baseline (artifacts/ inside) */
export const resolveExportsPath = (dataDir: string, goal: WorkspaceRef, taskId: string) => `${resolveWorkspacePath(dataDir, goal, taskId)}.goal-exports`;
/** detached worktree where a finished goal's preview runs another branch (its own folder may be gone after the merge) */
export function previewWorkspacePath(dataDir: string, goal: WorkspaceRef): string {
  const internal = internalWorkspaceDir(goal);
  return internal ? join(internal, 'preview') : join(legacyWorkspaceRoot(dataDir, goal.id), '_preview');
}
/** detached worktree at the goal branch's tip where milestone scripts are recorded, out of the way of tasks working in the goal's folder; kept between runs so its dependencies stay installed */
export function milestoneWorkspacePath(dataDir: string, goal: WorkspaceRef): string {
  const internal = internalWorkspaceDir(goal);
  return internal ? join(internal, 'milestone') : join(legacyWorkspaceRoot(dataDir, goal.id), '_milestone');
}
/** worktree where docs are written once the goal's work merged and its progress folder was cleaned up */
export function docsWorkspacePath(dataDir: string, goal: WorkspaceRef): string {
  const internal = internalWorkspaceDir(goal);
  return internal ? join(internal, 'docs') : join(legacyWorkspaceRoot(dataDir, goal.id), '_docs');
}
/**
 * where integrations' export overlays keep what they covered, one folder per task with the list of what it wrote, until
 * the merge is judged: beside the progress folder, so neither git nor a clean of the goal worktree can reach it
 */
export function overlayRoot(dataDir: string, goal: WorkspaceRef): string {
  const internal = internalWorkspaceDir(goal);
  return internal ? join(internal, 'overlay') : join(legacyWorkspaceRoot(dataDir, goal.id), '_overlay');
}
/** one task's overlay backup: the goal's copies it covered (files/) and the list of what it wrote */
export const overlayBackupPath = (dataDir: string, goal: WorkspaceRef, taskId: string) => join(overlayRoot(dataDir, goal), taskId);
/** throw-away worktree at a base commit where the baseline must checks run */
export function baselineWorkspacePath(dataDir: string, goal: WorkspaceRef): string {
  const internal = internalWorkspaceDir(goal);
  return internal ? join(internal, 'baseline') : join(legacyWorkspaceRoot(dataDir, goal.id), '_baseline');
}
/** where the self-check's screenshots of a goal go (beside the progress folder; legacy goals under dataDir) */
export function screenshotsDir(dataDir: string, goal: WorkspaceRef): string {
  const internal = internalWorkspaceDir(goal);
  return internal ? join(internal, 'screenshots') : join(dataDir, 'screenshots', goal.id);
}
export function taskWorkspacePath(dataDir: string, goal: WorkspaceRef, taskId: string): string {
  const internal = internalWorkspaceDir(goal);
  return internal ? join(internal, 'tasks', taskId) : join(legacyWorkspaceRoot(dataDir, goal.id), taskId);
}

/** characters no file system accepts in a name, plus control characters */
const UNSAFE = /[\\/:*?"<>|\u0000-\u001f]/g;
/** sentence breaks (ASCII and full-width): the folder is named after the title up to the first one */
const SENTENCE_BREAK = /[,，.。;；:：!！?？(（\[【\n]/;
/**
 * `<title up to its first sentence break, ≤40 chars>-<last 6 chars of the goal id>`: readable to a person — the title
 * stays in its own language, a slug would delete every Chinese character — and unique per goal. Fixed at creation.
 */
export function workspaceFolderName(title: string, goalId: string): string {
  const head = title.split(SENTENCE_BREAK)[0] ?? '';
  const clean = head.replace(UNSAFE, '').replace(/\s+/g, ' ').trim().slice(0, 40).trim().replace(/\.+$/, '');
  return `${clean || 'goal'}-${goalId.slice(-6)}`;
}
/**
 * Where a new goal's progress folder goes: `<root>/<repo-name>/<folder>` under Settings → engine.workspacesRoot, or with
 * no root set, next to the repository as `<repo-name>-foundry/<folder>` — a place a person finds without knowing Foundry.
 */
export function defaultWorkspaceDir(root: string | null, goal: { id: string; title: string; repoPath: string }): string {
  const repo = resolve(goal.repoPath);
  const base = root ? join(resolve(root), basename(repo)) : join(dirname(repo), `${basename(repo)}-foundry`);
  return join(base, workspaceFolderName(goal.title, goal.id));
}

/**
 * `goal/<id>-<n>-<slug>`: the n-th branch of a stacked delivery. A sibling of the goal branch, not a
 * child (`goal/<id>/…` cannot exist while `goal/<id>` does — git refs are files).
 */
export const stackBranchName = (goalBranch: string, index: number, slug: string) => `${goalBranch}-${index}-${slug}`;
export const isStackBranch = (goalBranch: string, branch: string) => /^-\d+-/.test(branch.slice(goalBranch.length)) && branch.startsWith(goalBranch);
export async function listStackBranches(repo: string, goalBranch: string): Promise<string[]> {
  const r = await git(['for-each-ref', '--format=%(refname:short)', `refs/heads/${goalBranch}-*`], repo);
  return r.code === 0 ? r.stdout.split('\n').filter((b) => isStackBranch(goalBranch, b)) : [];
}
export const taskBranch = (taskId: string) => `task/${taskId}`;

/** The goal worktree on `goal/<id>`; `startRef` (e.g. `origin/main`) only matters the first time, when the branch is created. */
export async function ensureGoalWorkspace(dataDir: string, goal: Goal, opts: { startRef?: string } = {}): Promise<string> {
  const path = goalWorkspacePath(dataDir, goal);
  await ensureWorktree(goal.repoPath, path, goal.branch, opts.startRef ?? goal.baseBranch);
  return path;
}

/** Create a task worktree branched from the goal branch's current HEAD. */
export async function ensureTaskWorkspace(dataDir: string, goal: Goal, task: Task): Promise<{ path: string; branch: string }> {
  const goalPath = goalWorkspacePath(dataDir, goal);
  const base = await headRef(goalPath);
  const path = taskWorkspacePath(dataDir, goal, task.id);
  const branch = taskBranch(task.id);
  await ensureWorktree(goal.repoPath, path, branch, base);
  // project skills and the Brief's style samples are git-excluded, so a fresh checkout lacks them: copy them over from the goal workspace
  copyProjectSkills(goalPath, path, goal.provider);
  copyStyleSamples(goalPath, path);
  // a cad task builds on what earlier tasks exported (a drawing or an assembly needs their STEP): artifacts are git-excluded too
  if (task.scenario === 'cad') await inheritArtifacts(goalPath, path);
  return { path, branch };
}

export async function dropTaskWorkspace(goal: Goal, task: Task): Promise<void> {
  if (!task.worktreePath) return;
  await removeWorktree(goal.repoPath, task.worktreePath, { deleteBranch: task.branch ?? undefined });
}
