/**
 * Where the Explainer of a Conversation reads the goal's code (ADR-0073): a detached worktree of its own at the goal
 * branch's tip, never the progress folder (whose shared hooks file and next worker commit a shell writing there would
 * spoil). The folder is the same every turn, so the session resumes in it; before each answer it is brought to the tip
 * again, with what a shell left behind discarded and the records folder kept. Once the goal's branch is gone (its work
 * merged and tidied) the base branch stands in, since it holds the goal's commits. Without a repository on this
 * computer there is no code to read, and the records alone are written into a folder of Foundry's own.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { repoHere, type Goal } from '@foundry/core';
import type { Engine } from '../engine.ts';
import { branchExists, ensureDetachedWorktree, git, gitOk, isGitRepo, removeWorktree } from '../git/git.ts';
import { internalWorkspaceDir, legacyWorkspaceRoot, type WorkspaceRef } from '../workspace.ts';

/** the records Foundry writes for the Explainer, inside its working folder and outside git's view */
export const RECORDS_DIR = '.foundry-goal';

/** the Explainer's worktree: under the goal's hidden `.foundry/` folder, beside its other worktrees */
export function conversationWorkspacePath(dataDir: string, goal: WorkspaceRef): string {
  const internal = internalWorkspaceDir(goal);
  return internal ? join(internal, 'conversation') : join(legacyWorkspaceRoot(dataDir, goal.id), '_conversation');
}
/** where the Explainer runs when the code is not on this computer: Foundry's own folder with the records only */
export const conversationHome = (dataDir: string, goalId: string) => join(dataDir, 'conversations', goalId);

export interface ConversationPlace {
  /** the session's working folder */
  cwd: string;
  /** there is code to read in it */
  code: boolean;
  where: 'goal-branch' | 'base' | 'none';
  /** the commit checked out */
  ref: string | null;
  /** what the folder holds, in the words the prompt uses */
  note: string;
}

/** the folder the next answer runs in, brought up to date: the code when it is here, the records alone otherwise */
export async function prepareConversationWorkspace(engine: Engine, goal: Goal): Promise<ConversationPlace> {
  const none = (why: string): ConversationPlace => {
    const cwd = conversationHome(engine.config.dataDir, goal.id);
    mkdirSync(cwd, { recursive: true });
    return { cwd, code: false, where: 'none', ref: null, note: why };
  };
  if (!repoHere(goal)) return none('the goal came from another computer and its repository is not mapped here, so there is no code to read, only the records');
  if (!(await isGitRepo(goal.repoPath).catch(() => false))) return none(`the repository ${goal.repoPath} is no longer on this computer, so there is no code to read, only the records`);
  const own = await branchExists(goal.branch, goal.repoPath).catch(() => false);
  const ref = own ? goal.branch : (await branchExists(goal.baseBranch, goal.repoPath).catch(() => false)) ? goal.baseBranch : null;
  if (!ref) return none(`neither the goal branch ${goal.branch} nor the base branch ${goal.baseBranch} exists in ${goal.repoPath}, so there is no code to read, only the records`);
  const sha = (await gitOk(['rev-parse', `refs/heads/${ref}`], goal.repoPath)).trim();
  const path = conversationWorkspacePath(engine.config.dataDir, goal);
  if (existsSync(path) && (await git(['rev-parse', '--is-inside-work-tree'], path)).code === 0) {
    // the same folder every turn (the session's cwd): to the tip again, what a shell left behind gone, the records kept
    await git(['reset', '--hard', '--quiet'], path);
    await git(['clean', '-fd', '--quiet', '-e', RECORDS_DIR], path);
    await gitOk(['checkout', '--detach', '--quiet', sha], path);
  } else {
    if (existsSync(path)) rmSync(path, { recursive: true, force: true });
    await ensureDetachedWorktree(goal.repoPath, path, sha);
  }
  excludeRecords(path);
  const short = sha.slice(0, 7);
  return own
    ? { cwd: path, code: true, where: 'goal-branch', ref: sha, note: `a read-only checkout of the goal's branch \`${goal.branch}\` at ${short}: the goal's work as it stands (what a task is still changing in its own folder arrives here when it lands)` }
    : { cwd: path, code: true, where: 'base', ref: sha, note: `a read-only checkout of \`${goal.baseBranch}\` at ${short}: the goal's own branch went when its work merged, so this is the repository with the goal's commits in it; \`git log --grep "Goal: ${goal.id}"\` lists them` };
}

/** the records folder is Foundry's, not the repository's: out of git status and git clean in that worktree */
function excludeRecords(path: string): void {
  try {
    const r = Bun.spawnSync(['git', 'rev-parse', '--git-path', 'info/exclude'], { cwd: path, stdout: 'pipe', stderr: 'ignore', timeout: 5000 });
    if (r.exitCode !== 0) return;
    const file = r.stdout.toString().trim();
    const abs = file.startsWith('/') ? file : join(path, file);
    const text = existsSync(abs) ? readFileSync(abs, 'utf8') : '';
    const pattern = `${RECORDS_DIR}/`;
    if (text.split('\n').includes(pattern)) return;
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, `${text}${text && !text.endsWith('\n') ? '\n' : ''}${pattern}\n`);
  } catch {
    // not a repository: nothing to exclude
  }
}

/** the Explainer's folders of a goal, removed: its worktree (and the repository's record of it) and the records-only home */
export async function removeConversationWorkspace(dataDir: string, goal: Goal): Promise<void> {
  const path = conversationWorkspacePath(dataDir, goal);
  if (existsSync(path) && repoHere(goal)) await removeWorktree(goal.repoPath, path).catch(() => {});
  rmSync(path, { recursive: true, force: true });
  rmSync(conversationHome(dataDir, goal.id), { recursive: true, force: true });
}
