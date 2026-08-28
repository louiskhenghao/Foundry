import type { Goal, Task } from '@foundry/core';
import { exec } from '../git/git.ts';
import type { ContextProvider } from './provider.ts';

/**
 * Dependency-free baseline: repo tree summary + ripgrep hits for task keywords.
 */
export class GrepContextProvider implements ContextProvider {
  readonly name = 'grep';
  async prepare() {}

  async overview(repoPath: string): Promise<string | null> {
    const files = await exec(['git', 'ls-files'], repoPath);
    if (files.code !== 0) return null;
    const list = files.stdout.split('\n').filter(Boolean);
    const dirs = new Map<string, number>();
    for (const f of list) {
      const top = f.includes('/') ? f.split('/').slice(0, 2).join('/') : f;
      dirs.set(top, (dirs.get(top) ?? 0) + 1);
    }
    const summary = [...dirs.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 40)
      .map(([d, n]) => `${d} (${n})`)
      .join('\n');
    return `${list.length} tracked files. Top-level layout:\n${summary}`;
  }

  async locate(goal: Goal, task: Task): Promise<string | null> {
    const cwd = task.worktreePath ?? goal.repoPath;
    const words = [...new Set((task.title + ' ' + task.spec).match(/[A-Za-z_][A-Za-z0-9_]{3,}/g) ?? [])]
      .filter((w) => !STOP.has(w.toLowerCase()))
      .slice(0, 8);
    if (!words.length) return null;
    const rg = Bun.which('rg');
    const pattern = words.join('|');
    const r = rg
      ? await exec([rg, '-l', '-i', '--max-count', '1', '-g', '!node_modules', '-g', '!dist', '-g', '!*.lock', pattern, '.'], cwd, { timeoutMs: 10_000 })
      : await exec(['git', 'grep', '-l', '-i', '-E', pattern], cwd, { timeoutMs: 10_000 });
    const hits = r.stdout.split('\n').filter(Boolean).slice(0, 25);
    if (!hits.length) return null;
    return `Files mentioning ${words.slice(0, 5).join(', ')}:\n${hits.map((h) => `- ${h.replace(/^\.\//, '')}`).join('\n')}`;
  }
}

const STOP = new Set(['this', 'that', 'with', 'from', 'into', 'when', 'then', 'should', 'must', 'have', 'make', 'file', 'files', 'code', 'test', 'tests', 'using', 'task', 'goal', 'implement', 'update', 'create', 'function', 'return', 'value', 'which', 'where', 'there', 'their', 'about', 'after', 'before']);
