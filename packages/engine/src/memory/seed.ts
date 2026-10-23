import { git } from '../git/git.ts';
import type { MemoryDocument } from './types.ts';

/** one commit of the repository's recent history, as the seeding writes it */
export interface SeedCommit {
  sha: string;
  author: string;
  /** ISO 8601 */
  date: string;
  message: string;
  files: string[];
}

/**
 * The newest `n` commits of a repository: message, author, date and the files each touched (none for a merge). What
 * seeds a folder's bank the first time Memory is used there (ADR-0072), as Hindsight's own integration seeds one from
 * commit messages. A folder that is not a repository, or a failing git, gives none.
 */
export async function recentCommits(repoPath: string, n: number): Promise<SeedCommit[]> {
  if (n <= 0) return [];
  // record separator before each commit, unit separators between its fields; the file names follow the last one
  const r = await git(['log', '-n', String(n), '--name-only', '--format=%x1e%H%x1f%an%x1f%aI%x1f%B%x1f'], repoPath).catch(() => null);
  if (!r || r.code !== 0) return [];
  return r.stdout
    .split('\x1e')
    .filter((chunk) => chunk.trim())
    .flatMap((chunk) => {
      const [sha, author, date, body, rest] = chunk.split('\x1f');
      if (!sha || !date) return [];
      const files = (rest ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
      return [{ sha: sha.trim(), author: (author ?? '').trim(), date: date.trim(), message: (body ?? '').trim(), files }];
    });
}

/** the document one commit becomes: keyed by its hash, so seeding twice writes it once */
export function seedDocument(c: SeedCommit): MemoryDocument {
  const lines = [`Commit ${c.sha.slice(0, 10)} by ${c.author || 'unknown'} on ${c.date}`, '', c.message || '(no message)'];
  if (c.files.length) lines.push('', 'Files changed:', ...c.files.slice(0, 40).map((f) => `- ${f}`), ...(c.files.length > 40 ? [`- … and ${c.files.length - 40} more`] : []));
  return {
    content: lines.join('\n'),
    context: "a commit of this repository's history, seeded by Foundry when Memory was first used for the folder",
    documentId: `git:${c.sha}`,
    tags: ['source:git'],
    metadata: { sha: c.sha },
  };
}
