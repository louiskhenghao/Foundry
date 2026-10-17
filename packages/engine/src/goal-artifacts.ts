import { existsSync, lstatSync, readdirSync, statSync } from 'node:fs';
import { appendFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, join } from 'node:path';
import { ARTIFACT_NATURES, ARTIFACT_SCENARIOS, listAttempts, listTasks, type Goal, type Task } from '@foundry/core';
import type { Engine } from './engine.ts';
import { ARTIFACTS_DIR, contentHash, copyArtifactFiles, copyInto, copyUntrackedArtifacts, goalWorkspacePath, isStyleSample, listArtifacts, overlayBackupPath, overlayRoot, trackedArtifacts, writableInside } from './workspace.ts';

/** what a landing brought into the goal workspace, and what it could not copy */
export interface Landing {
  files: string[];
  failed: string[];
}

/**
 * Bring a landed task's artifacts into the goal workspace: they are git-excluded, so its commit cannot carry them. What
 * the task inherited and left as it was stays the goal's (copyArtifactFiles), and what git tracks came through the commit,
 * so a copy never puts the task's version over a merged one. A file that cannot be copied is reported and the others
 * still go: the caller keeps the task's worktree then, so nothing is lost. A task that worked in the goal workspace
 * wrote its files there itself: they are the ones changed since its first attempt started, less what other tasks'
 * landings brought meanwhile. The files are recorded as `task.artifacts_landed`, which is how a milestone of files
 * tells the task's own files from the goal's others; a task whose deliverables are files records an empty landing too,
 * so "it made nothing" is not mistaken for "not recorded". What an overlay of the task's exports left behind (an undo
 * that could not finish) is undone first, so the landing, and what it leaves alone, sees the goal's own files; an entry
 * still listed after that for a file the landing then wrote goes, so no later recovery takes the landed copy back.
 * Callers hold the goal workspace's lock.
 */
export async function landTaskArtifacts(engine: Engine, goal: Goal, task: Task, opts: { keepExisting?: boolean } = {}): Promise<Landing> {
  const goalWs = goalWorkspacePath(engine.config.dataDir, goal);
  const failed: string[] = [];
  let files: string[];
  if (task.worktreePath && task.worktreePath !== goalWs) {
    if (!existsSync(task.worktreePath)) return { files: [], failed };
    let backup: string | null = null;
    try {
      backup = overlayTaskDir(engine, goal, task.id);
      await undoOverlay(goalWs, backup);
    } catch (err) {
      engine.store.append({ type: 'engine.note', goalId: goal.id, payload: { level: 'warn', message: `the exports laid over the goal's for "${task.title}"'s merge could not all be put back before it landed (${String((err as Error)?.message ?? err).slice(0, 200)}); they stay listed and are tried again` } });
    }
    const [mine, theirs] = await Promise.all([trackedArtifacts(task.worktreePath), trackedArtifacts(goalWs)]);
    // `keepExisting`: only what the goal does not have yet (a resolution that kept the goal's source keeps its exports)
    const skip = new Set([...mine, ...theirs, ...(opts.keepExisting ? listArtifacts(goalWs) : [])]);
    files = await copyArtifactFiles(task.worktreePath, goalWs, { skip, onError: (f) => failed.push(f) });
    if (files.length) engine.config.log(`[artifacts] ${task.id}: ${files.length} file(s) copied to the goal workspace`);
    // left listed, a landed file whose bytes still match would be taken back by the next recovery: the person is told
    if (backup && files.length) await forgetOverlaid(backup, files).catch((err) => engine.store.append({ type: 'engine.note', goalId: goal.id, payload: { level: 'warn', message: `"${task.title}" landed its exports, but the list of what its merge laid over the goal's could not be updated (${String((err as Error)?.message ?? err).slice(0, 200)}): remove ${backup} before the next merge, or a recovery may put the goal's older copies back` } }));
  } else if (ARTIFACT_SCENARIOS.includes(task.scenario)) {
    files = changedInGoalWorkspace(engine, goal, task, goalWs);
  } else {
    return { files: [], failed };
  }
  if (files.length || failed.length || ARTIFACT_SCENARIOS.includes(task.scenario)) engine.store.append({ type: 'task.artifacts_landed', goalId: goal.id, payload: { taskId: task.id, files, ...(failed.length ? { failed } : {}) } });
  return { files, failed };
}

/** the artifacts a task that worked in the goal workspace changed there: since its first attempt started, less other tasks' landings meanwhile */
function changedInGoalWorkspace(engine: Engine, goal: Goal, task: Task, goalWs: string): string[] {
  const since = Math.min(...listAttempts(engine.store.db, task.id).map((a) => Date.parse(a.startedAt)).filter((n) => !Number.isNaN(n)), Number.POSITIVE_INFINITY);
  if (!Number.isFinite(since)) return [];
  const others = new Set(
    engine.store
      .listByGoalOfTypes(goal.id, ['task.artifacts_landed'])
      .filter((e) => (e.payload as { taskId: string }).taskId !== task.id && Date.parse(e.ts) >= since)
      .flatMap((e) => (e.payload as { files: string[] }).files),
  );
  return listArtifacts(goalWs).filter((f) => {
    if (isStyleSample(f) || others.has(f)) return false;
    try {
      return statSync(join(goalWs, ARTIFACTS_DIR, f)).mtimeMs >= since;
    } catch {
      return false;
    }
  });
}

/**
 * The files a task's landings brought into the goal workspace (relative to artifacts/), and those they could not copy
 * that are still outstanding. Null when none was recorded: a goal from before landings were, or a task with no
 * artifacts to land. The goal's landings are read in order: a failure is settled by any later landing that brought the
 * same file, this task's or another's (the goal workspace holds the newer copy then, and copying the old one again would
 * put it back over it), and a folder a landing could not read is settled once a later landing of this task brought
 * files from under it, or a retry of it read it through (`settled`). A failure recorded under a folder still outstanding
 * dates from that folder's failure: the task's copies there are that old. `newer`: the files under an outstanding folder
 * that a landing brought after it failed, which this task's copies must not replace.
 */
export function landedArtifacts(engine: Engine, goalId: string, taskId: string): { files: Set<string>; failed: string[]; newer: Set<string> } | null {
  const all = engine.store.listByGoalOfTypes(goalId, ['task.artifacts_landed']).map((e) => e.payload as { taskId: string; files: string[]; failed?: string[]; settled?: string[] });
  const mine = all.filter((p) => p.taskId === taskId);
  if (!mine.length) return null;
  // each outstanding failure with the landing that first recorded it: the task's copy dates from then
  const failed = new Map<string, number>();
  all.forEach((p, i) => {
    for (const f of p.files) failed.delete(f);
    if (p.taskId !== taskId) return;
    // read before the folders this landing settles go: a retry that narrows 'dir/' to 'dir/sub/' keeps its age
    const since = (f: string) => Math.min(i, ...[...failed].filter(([m]) => m.endsWith('/') && m !== f && under(m, f)).map(([, at]) => at));
    const added = (p.failed ?? []).map((f) => [f, since(f)] as const);
    for (const m of [...failed.keys()]) if (p.settled?.includes(m) || (m.endsWith('/') && p.files.some((f) => under(m, f)))) failed.delete(m);
    for (const [f, at] of added) if (!failed.has(f)) failed.set(f, at);
  });
  const newer = new Set<string>();
  for (const [m, at] of failed) if (m.endsWith('/')) for (const p of all.slice(at + 1)) for (const f of p.files) if (under(m, f)) newer.add(f);
  return { files: new Set(mine.flatMap((p) => p.files)), failed: [...failed.keys()], newer };
}

/** a file (relative to artifacts/) under a folder a landing could not read ('./' is artifacts/ itself) */
const under = (folder: string, f: string) => folder === './' || f.startsWith(folder);

/** what a task's landings could not copy that is still in its worktree (a file, or a folder ending in /): the worktree must not go while it holds them */
export function unlandedFiles(engine: Engine, goal: Goal, task: Task): string[] {
  const goalWs = goalWorkspacePath(engine.config.dataDir, goal);
  if (!task.worktreePath || task.worktreePath === goalWs || !existsSync(task.worktreePath)) return [];
  return (landedArtifacts(engine, goal.id, task.id)?.failed ?? []).filter((f) => existsSync(join(task.worktreePath!, ARTIFACTS_DIR, f)));
}

/**
 * Copy again what tasks' landings could not copy and their kept worktrees still hold, before the goal's files are
 * delivered: each retry is a landing of its own, recording what came over, what still did not, and the failures it read
 * through (`settled`: what they held came over, or nothing was left to copy because it came from the goal unchanged or
 * git carries it). A file another task landed after the failure stays as it landed. A retry that changes nothing records
 * nothing: each landing wakes the goal, whose tick would retry again.
 */
export async function retryUnlanded(engine: Engine, goal: Goal): Promise<void> {
  const goalWs = goalWorkspacePath(engine.config.dataDir, goal);
  for (const task of listTasks(engine.store.db, goal.id)) {
    const left = unlandedFiles(engine, goal, task);
    if (!left.length) continue;
    const from = task.worktreePath!;
    const newer = landedArtifacts(engine, goal.id, task.id)?.newer ?? new Set<string>();
    const wanted = (f: string) => !newer.has(f) && left.some((m) => (m.endsWith('/') ? under(m, f) : f === m));
    const [mine, theirs] = await Promise.all([trackedArtifacts(from), trackedArtifacts(goalWs)]);
    const skip = new Set([...mine, ...theirs, ...listArtifacts(from).filter((f) => !wanted(f))]);
    const failed: string[] = [];
    const files = await copyArtifactFiles(from, goalWs, { skip, onError: (f) => failed.push(f) });
    // an entry that did not fail again was read through: what it held came over, or there was nothing left to copy
    const settled = left.filter((m) => !failed.includes(m));
    if (!files.length && !settled.length && failed.every((f) => left.includes(f))) continue;
    engine.store.append({ type: 'task.artifacts_landed', goalId: goal.id, payload: { taskId: task.id, files, ...(failed.length ? { failed } : {}), ...(settled.length ? { settled } : {}) } });
    engine.config.log(`[artifacts] ${task.id}: ${files.length} file(s) copied again${failed.length ? `, ${failed.length} still not` : ''}`);
  }
}

/**
 * The model the CAD Viewer opens among `files` (relative to `root`): the assembly when one was exported (a STEP whose
 * name says assembly, or has asm, assy or stack as a word of its own), else the newest STEP; never a style sample.
 */
export function cadModelIn(root: string, files: string[]): string | null {
  const steps = files
    .filter((f) => /\.(step|stp)$/i.test(f) && !isStyleSample(f))
    .flatMap((f) => {
      try {
        return [{ f, at: statSync(join(root, f)).mtimeMs }];
      } catch {
        return [];
      }
    });
  const assemblies = steps.filter((s) => /assembl|(^|[_-])(asm|assy|stack)([_.-]|$)/i.test(basename(s.f)));
  return (assemblies.length ? assemblies : steps).sort((a, b) => b.at - a.at)[0]?.f ?? null;
}

/** whether Foundry keeps artifacts/ for this goal: a goal judged by its files, or one with a task whose deliverables are files */
export function goalUsesArtifacts(engine: Engine, goal: Goal): boolean {
  return ARTIFACT_NATURES.includes(goal.nature) || listTasks(engine.store.db, goal.id).some((t) => ARTIFACT_SCENARIOS.includes(t.scenario));
}

/**
 * Give a worktree that runs the goal's checks the artifacts of another (the goal workspace, a task's worktree), which
 * git never carries: only for a goal that keeps artifacts, and never over a file git tracks. A copy that fails is noted
 * and the checks run without it, except where `strict` says a missing export would make the result wrong (a baseline).
 */
export async function artifactsForChecks(engine: Engine, goal: Goal, fromWs: string, toWs: string, where: string, opts: { onlyChanged?: boolean; strict?: boolean } = {}): Promise<void> {
  if (!existsSync(fromWs) || !goalUsesArtifacts(engine, goal)) return;
  try {
    await copyUntrackedArtifacts(fromWs, toWs, opts);
  } catch (err) {
    // a baseline without the exports would excuse a real regression as "already failing": it fails instead
    if (opts.strict) throw err;
    engine.store.append({ type: 'engine.note', goalId: goal.id, payload: { level: 'warn', message: `${where}: the artifacts could not be copied (${String((err as Error)?.message ?? err)}); a check that measures an export may fail there` } });
  }
}

/** one line of an overlay's list: a file it wrote, whether the goal's copy was saved first, and the content it wrote */
type OverlayEntry = { f: string; saved: boolean; hash: string };

/** the folder of a goal's overlay backups, refused when it is a symbolic link: an undo removes folders under it */
function overlayDir(engine: Engine, goal: Goal): string {
  const dir = overlayRoot(engine.config.dataDir, goal);
  if (lstatSync(dir, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error(`${dir} is a symbolic link`);
  return dir;
}

/** a task's overlay backup folder, refused when it (or the folder of all backups) is not a real folder: an undo reads, writes and removes what is under it */
function overlayTaskDir(engine: Engine, goal: Goal, taskId: string): string {
  overlayDir(engine, goal);
  const dir = overlayBackupPath(engine.config.dataDir, goal, taskId);
  const st = lstatSync(dir, { throwIfNoEntry: false });
  if (st && !st.isDirectory()) throw new Error(`${dir} is not a folder`);
  return dir;
}

/** an overlay list, written beside itself and renamed over: never through whatever has the part's name (a planted link) */
async function writeList(backup: string, lines: string[]): Promise<void> {
  const part = join(backup, 'list.part');
  await rm(part, { force: true });
  await writeFile(part, lines.map((l) => `${l}\n`).join(''), { flag: 'wx' });
  await rename(part, join(backup, 'list'));
}

/** the entries of an overlay list for files a landing has since written for real go: no later undo takes those back */
async function forgetOverlaid(backup: string, landed: string[]): Promise<void> {
  let list: string;
  try {
    list = await readFile(join(backup, 'list'), 'utf8');
  } catch {
    return;
  }
  const done = new Set(landed);
  const left = list.split('\n').filter((l) => {
    try {
      return !!l && !done.has(JSON.parse(l).f);
    } catch {
      return false;
    }
  });
  if (left.length) return writeList(backup, left);
  // the list goes first: a removal cut short must not leave it for a recovery to replay
  await rm(join(backup, 'list'), { force: true });
  await rm(backup, { recursive: true, force: true });
}

/**
 * Lay a task's changed exports over the goal workspace's while its integration is checked there: they land only after
 * the merge, so a check that measures an export the task remade would read the goal's older one against the task's
 * newer source, a regression of nothing. What they cover is saved first, beside the progress folder, with a list of
 * what they write: `done(false)` puts the goal's files back (a merge that does not land must not leave the task's
 * exports behind), `done(true)` keeps them for the landing. A list left by a run cut short is undone before a new
 * overlay (and at engine start, recoverOverlays).
 */
export async function overlayTaskExports(engine: Engine, goal: Goal, task: Task): Promise<{ done: (keep: boolean) => Promise<void> }> {
  const goalWs = goalWorkspacePath(engine.config.dataDir, goal);
  const backup = overlayTaskDir(engine, goal, task.id);
  await undoOverlay(goalWs, backup);
  if (!task.worktreePath || task.worktreePath === goalWs || !existsSync(task.worktreePath) || !goalUsesArtifacts(engine, goal)) return { done: async () => {} };
  const from = task.worktreePath;
  const [mine, theirs] = await Promise.all([trackedArtifacts(from), trackedArtifacts(goalWs)]);
  await mkdir(backup, { recursive: true });
  await copyArtifactFiles(from, goalWs, {
    skip: new Set([...mine, ...theirs]),
    // a file that cannot be laid over, or saved first, is measured as the goal has it
    onError: () => {},
    before: async (f) => {
      const dest = join(goalWs, ARTIFACTS_DIR, f);
      const st = lstatSync(dest, { throwIfNoEntry: false });
      // only a plain file is saved and laid over: a link's target is not the goal's export to put back
      if (st && !st.isFile()) throw new Error(`${f} is not a plain file`);
      const saved = !!st;
      if (saved) await copyInto(dest, join(backup, 'files', f));
      const entry: OverlayEntry = { f, saved, hash: await contentHash(join(from, ARTIFACTS_DIR, f)) };
      await appendFile(join(backup, 'list'), `${JSON.stringify(entry)}\n`);
    },
  });
  return {
    done: async (keep) => {
      if (!keep) return undoOverlay(goalWs, backup);
      // the list goes first: a run cut short now must not later put the goal's older copies back over the landing
      await rm(join(backup, 'list'), { force: true });
      await rm(backup, { recursive: true, force: true });
    },
  };
}

/**
 * Put back what an overlay covered and take away what it added, from the list it left: only a regular file that still
 * holds what the overlay wrote (one written there since, by a landing or the person, stays theirs), never through a
 * symbolic link or outside artifacts/. A file that cannot be read or put back keeps its entry, and the list is rewritten
 * with only those, so the next try does not undo again what was done; a list that cannot be read keeps everything, and
 * only a list that is not there means there is nothing to undo.
 */
async function undoOverlay(goalWs: string, backup: string): Promise<void> {
  let list: string;
  try {
    list = await readFile(join(backup, 'list'), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') throw err;
    await rm(backup, { recursive: true, force: true });
    return;
  }
  const root = join(goalWs, ARTIFACTS_DIR);
  const left: OverlayEntry[] = [];
  for (const line of list.split('\n').filter(Boolean)) {
    let e: OverlayEntry;
    try {
      e = JSON.parse(line);
    } catch {
      // a line cut short by a crash: it was written before its copy, so nothing of it was laid over
      continue;
    }
    if (typeof e.f !== 'string' || !e.f || isAbsolute(e.f) || e.f.split('/').includes('..') || typeof e.hash !== 'string') continue;
    const dest = join(root, e.f);
    try {
      writableInside(root, dest);
      // gone since, or no longer a plain file (a link, a pipe): not what the overlay wrote
      if (!lstatSync(dest, { throwIfNoEntry: false })?.isFile()) continue;
      if ((await contentHash(dest)) !== e.hash) continue;
      if (e.saved) await copyInto(join(backup, 'files', e.f), dest);
      else await rm(dest, { force: true });
    } catch {
      left.push(e);
    }
  }
  if (left.length) {
    await writeList(backup, left.map((e) => JSON.stringify(e)));
    throw new Error(`could not put back ${left.slice(0, 3).map((e) => e.f).join(', ')}${left.length > 3 ? ', …' : ''}`);
  }
  await rm(backup, { recursive: true, force: true });
}

/**
 * Undo every overlay a run cut short (or an undo that could not finish) left for a goal: at engine start, before anything
 * is scheduled, before a merge attempt measures its baseline, before a cad task inherits the exports, before a manual
 * resolution copies them and before the delivery, so none of them reads exports that never landed. Says whether
 * everything was put back (true when there was nothing to undo); what was not is noted and tried again next time.
 */
export async function recoverOverlays(engine: Engine, goal: Goal): Promise<boolean> {
  const goalWs = goalWorkspacePath(engine.config.dataDir, goal);
  const note = (message: string) => engine.store.append({ type: 'engine.note', goalId: goal.id, payload: { level: 'warn', message } });
  let dir: string;
  let left: string[];
  try {
    dir = overlayDir(engine, goal);
    // only the folders an overlay made: a link among them is not followed
    left = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return true;
    note(`the overlay backups could not be read (${String((err as Error)?.message ?? err).slice(0, 200)}); none was put back`);
    return false;
  }
  let clean = true;
  for (const taskId of left) {
    await undoOverlay(goalWs, join(dir, taskId)).catch((err) => {
      clean = false;
      note(`the exports laid over the goal's for task ${taskId}'s merge could not all be put back (${String((err as Error)?.message ?? err).slice(0, 200)}); its list stays and is tried again`);
    });
  }
  return clean;
}
