import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { excludeLocally } from './exclude.ts';
import type { Goal, Task } from '@foundry/core';
import { exec } from '../git/git.ts';
import type { ContextProvider } from './provider.ts';

/**
 * graphify-backed context: AST-only graph build (`graphify update`, no LLM) and token-budgeted
 * `graphify query` traversals. Falls back to the wrapped provider when graphify is unavailable
 * or the repo has no graph yet.
 */
export class GraphifyContextProvider implements ContextProvider {
  readonly name = 'graphify';
  private bin = Bun.which('graphify');
  constructor(
    private fallback: ContextProvider,
    private opts: { buildTimeoutMs?: number; queryBudget?: number; log?: (m: string) => void } = {},
  ) {}

  private graphPath(repo: string) {
    return join(repo, 'graphify-out', 'graph.json');
  }
  available(repo: string): boolean {
    return !!this.bin && existsSync(this.graphPath(repo));
  }

  async prepare(repoPath: string): Promise<void> {
    await this.fallback.prepare(repoPath);
    if (!this.bin) return;
    if (existsSync(this.graphPath(repoPath))) return;
    this.opts.log?.(`[graphify] building AST graph for ${repoPath}`);
    const r = await exec([this.bin, 'update', repoPath, '--no-cluster'], repoPath, { timeoutMs: this.opts.buildTimeoutMs ?? 180_000 });
    if (r.code !== 0) this.opts.log?.(`[graphify] update failed (${r.code}): ${(r.stderr || r.stdout).slice(-400)}`);
    await excludeLocally(repoPath, 'graphify-out/');
  }

  async query(repoPath: string, question: string, budget = this.opts.queryBudget ?? 1500): Promise<string | null> {
    if (!this.available(repoPath)) return null;
    const r = await exec([this.bin!, 'query', question, '--budget', String(budget), '--graph', this.graphPath(repoPath)], repoPath, { timeoutMs: 30_000 });
    const out = r.stdout.trim();
    return r.code === 0 && out.length > 40 ? out : null;
  }

  async overview(repoPath: string): Promise<string | null> {
    const base = await this.fallback.overview(repoPath);
    const g = await this.query(repoPath, 'What are the main modules, entry points and how do they depend on each other?', 1200);
    return [base, g ? `Code graph (graphify):\n${g}` : null].filter(Boolean).join('\n\n') || null;
  }

  async locate(goal: Goal, task: Task): Promise<string | null> {
    return this.locateIn(goal, task);
  }

  private async locateIn(goal: Goal, task: Task): Promise<string | null> {
    const repo = goal.repoPath; // graph lives in the user's repo, not in the worktree
    const g = await this.query(repo, `${task.title}. ${task.spec.slice(0, 300)}`, this.opts.queryBudget ?? 1500);
    const base = await this.fallback.locate(goal, task);
    return [g ? `Relevant code graph (graphify):\n${g}` : null, base].filter(Boolean).join('\n\n') || null;
  }
}
