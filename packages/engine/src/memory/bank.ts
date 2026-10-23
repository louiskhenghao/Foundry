import { basename, dirname } from 'node:path';
import { git } from '../git/git.ts';

/** the prefix Hindsight's own coding-agent integration gives a repository's bank */
export const BANK_PREFIX = 'coding-agent::';

/**
 * The bank of a repository folder, named as Hindsight's coding-agent integration names it — `coding-agent::` and the
 * name of the main worktree's folder — so the person's own sessions there and Foundry's share one bank (ADR-0071). A
 * goal's worktrees resolve to the same folder. Null when the folder is not a git repository: there is no bank for it.
 */
export async function bankIdFor(repoPath: string): Promise<string | null> {
  const r = await git(['rev-parse', '--path-format=absolute', '--git-common-dir'], repoPath).catch(() => null);
  if (!r || r.code !== 0) return null;
  const common = r.stdout.trim();
  if (!common) return null;
  // a working repository's common dir is its .git folder; a bare one is the repository itself
  const root = basename(common) === '.git' ? dirname(common) : common;
  const name = basename(root);
  return name ? `${BANK_PREFIX}${name}` : null;
}
