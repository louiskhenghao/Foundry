import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { exec } from '../git/git.ts';

/**
 * Add a pattern to the repo's local, uncommitted ignore list (.git/info/exclude) so tool
 * output (e.g. graphify-out/) never makes the user's repo look dirty or leak into commits.
 */
export async function excludeLocally(repoPath: string, pattern: string): Promise<void> {
  const r = await exec(['git', 'rev-parse', '--git-common-dir'], repoPath);
  if (r.code !== 0) return;
  const gitDir = r.stdout.trim().startsWith('/') ? r.stdout.trim() : join(repoPath, r.stdout.trim());
  const file = join(gitDir, 'info', 'exclude');
  mkdirSync(dirname(file), { recursive: true });
  const current = existsSync(file) ? readFileSync(file, 'utf8') : '';
  if (current.split('\n').some((l) => l.trim() === pattern)) return;
  appendFileSync(file, `${current.endsWith('\n') || !current ? '' : '\n'}# added by foundry\n${pattern}\n`);
}
