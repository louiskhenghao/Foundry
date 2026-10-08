import { cpSync, existsSync, mkdirSync, realpathSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { getGoal, listGoals, type Goal } from '@foundry/core';
import type { Engine } from '../engine.ts';
import { git } from '../git/git.ts';
import { ARTIFACTS_DIR, defaultWorkspaceDir, ensureGoalWorkspace, screenshotsDir } from '../workspace.ts';
import { TransferError } from './errors.ts';
import { releasePreviewEnv } from './pending-env.ts';

export interface MapResult {
  original: string;
  to: string;
  goals: string[];
  /** goals whose branch was restored from the bundle the Transfer file carried */
  restored: string[];
  /** preview variables that were waiting for this repository */
  previewEnv: string[];
}

/**
 * Map a repository the Imported Goals named on the other computer to a checkout here (ADR-0030): every goal that named
 * that path gets it, and a branch the base branch lacked is restored from its bundle. All or nothing: a branch that
 * cannot be restored leaves every goal unmapped.
 */
export async function mapRepo(engine: Engine, original: string, toIn: string, how: 'same-path' | 'chosen' = 'chosen'): Promise<MapResult> {
  const top = await git(['rev-parse', '--show-toplevel'], resolve(toIn)).catch(() => null);
  if (!top || top.code !== 0) throw new TransferError(`${toIn} is not a git checkout`, 422);
  // the person's own spelling of the folder, unless they named a folder inside the checkout
  const to = realpathSync(resolve(toIn)) === realpathSync(top.stdout.trim()) ? resolve(toIn) : top.stdout.trim();
  const goals = listGoals(engine.store.db).filter((g) => g.transfer && !g.transfer.repoMapped && g.transfer.original.repoPath === original);
  if (!goals.length) throw new TransferError(`no goal from another computer is waiting for ${original}`, 404);
  const heads = new Map<string, string>();
  for (const g of goals) {
    const head = await restoreBranch(engine, g, to);
    if (head) heads.set(g.id, head);
  }
  for (const g of goals) {
    engine.store.append({ type: 'goal.repo_mapped', goalId: g.id, payload: { from: original, to, how } });
    const head = heads.get(g.id);
    if (head) engine.store.append({ type: 'goal.branch_restored', goalId: g.id, payload: { branch: g.branch, head } });
  }
  return { original, to, goals: goals.map((g) => g.id), restored: [...heads.keys()], previewEnv: releasePreviewEnv(engine, original, to) };
}

/**
 * Restore the goal branch into the checkout from the bundle: the base commits it builds on are fetched from the
 * remote when the checkout lacks them; a branch of that name with other commits is never overwritten.
 */
async function restoreBranch(engine: Engine, g: Goal, repo: string): Promise<string | null> {
  if (!g.transfer?.bundle) return null;
  const bundle = join(engine.config.dataDir, g.transfer.bundle);
  if (!existsSync(bundle)) throw new TransferError(`the branch of "${g.title}" that came with the Transfer is missing (${g.transfer.bundle})`, 409);
  if ((await git(['bundle', 'verify', '-q', bundle], repo)).code !== 0) {
    const remote = g.delivery.policy.remote || 'origin';
    if ((await git(['remote', 'get-url', remote], repo)).code === 0) await git(['fetch', '-q', remote], repo);
    const again = await git(['bundle', 'verify', '-q', bundle], repo);
    if (again.code !== 0) throw new TransferError(`${repo} lacks the commits the branch of "${g.title}" builds on (${again.stderr.trim().split('\n')[0]}); pull its base branch there, then map it again`, 409);
  }
  const ref = `refs/heads/${g.branch}`;
  const listed = await git(['bundle', 'list-heads', bundle, ref], repo);
  const head = listed.stdout.trim().split(/\s+/)[0];
  if (listed.code !== 0 || !head) throw new TransferError(`the bundle of "${g.title}" holds no ${g.branch}`, 409);
  const here = await git(['rev-parse', '--verify', '--quiet', ref], repo);
  if (here.code === 0) {
    const current = here.stdout.trim();
    if (current === head) return head;
    if ((await git(['merge-base', '--is-ancestor', current, head], repo)).code !== 0) {
      throw new TransferError(`${repo} already has a branch ${g.branch} with other commits; rename or delete it there, then map the repository again`, 409);
    }
  }
  const r = await git(['fetch', '-q', bundle, `${ref}:${ref}`], repo);
  if (r.code !== 0) throw new TransferError(`could not restore ${g.branch} in ${repo}: ${r.stderr.trim()}`, 409);
  return head;
}

/**
 * Reattach an unfinished Imported Goal (ADR-0030): it gets a progress folder on this computer on its restored branch,
 * the files that travelled outside git go back in, and the engine takes it up again. Attempts the Transfer cut off were
 * already closed, so the next one is fresh. If the goal still runs on the other computer, the two now diverge.
 */
export async function reattachGoal(engine: Engine, goalId: string): Promise<Goal> {
  const g = getGoal(engine.store.db, goalId);
  if (!g) throw new TransferError(`goal ${goalId} not found`, 404);
  if (!g.transfer || g.transfer.reattachedAt) throw new TransferError('only a goal that came from another computer is Reattached, once', 409);
  if (!g.transfer.unfinished) throw new TransferError('this goal was finished on the other computer; start a Follow-up to carry it on', 409);
  if (!g.transfer.repoMapped) throw new TransferError('map its repository to a checkout here first', 409);
  if (g.transfer.bundle && !g.transfer.branchRestored) throw new TransferError('its branch is not restored yet: map the repository again', 409);
  const { dataDir, workspacesRoot } = engine.config;
  const workspaceDir = defaultWorkspaceDir(workspacesRoot, g);
  if (existsSync(workspaceDir)) throw new TransferError(`${workspaceDir} already exists; move it away, then Reattach`, 409);
  const placed = { ...g, workspaceDir };
  const ws = await ensureGoalWorkspace(dataDir, placed);
  if (g.transfer.artifacts && existsSync(join(dataDir, g.transfer.artifacts))) cpSync(join(dataDir, g.transfer.artifacts), join(ws, ARTIFACTS_DIR), { recursive: true, force: false, errorOnExist: false });
  const shotsHere = join(dataDir, 'screenshots', g.id);
  if (existsSync(shotsHere)) {
    mkdirSync(screenshotsDir(dataDir, placed), { recursive: true });
    cpSync(shotsHere, screenshotsDir(dataDir, placed), { recursive: true, force: false, errorOnExist: false });
    rmSync(shotsHere, { recursive: true, force: true });
  }
  engine.store.append({ type: 'goal.reattached', goalId, payload: { workspaceDir } });
  const back = getGoal(engine.store.db, goalId)!;
  // project skills are git-excluded: a goal past its Brief gets them installed in the new folder
  if (!['draft', 'clarifying', 'awaiting_brief_approval'].includes(back.state)) engine.startAutoskills(back, ws);
  engine.tick(goalId);
  return back;
}
