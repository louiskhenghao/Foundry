import { join } from 'node:path';
import type { Check, Goal } from '@foundry/core';
import { listChecks } from '@foundry/core';
import type { Engine } from '../engine.ts';
import { ensureDetachedWorktree, removeWorktree } from '../git/git.ts';
import { runCommandCheck } from './command.ts';
import { baselineWorkspacePath } from '../workspace.ts';

/**
 * Which must command checks already fail on a given goal-branch commit, *before* a merge.
 *
 * A merge (automatic or manual) is judged against this baseline: a check that was already red on the goal
 * branch is not the merge's fault and must not keep a correctly resolved merge from landing — otherwise a goal
 * whose suite is red for an unrelated reason loops forever (work → merge "fails" → retry → …).
 * Computed in a throw-away `_baseline` worktree and cached per commit.
 */
export class BaselineChecks {
  private cache = new Map<string, Promise<Set<string>>>();
  constructor(private engine: Engine) {}

  /** ids of the must command checks failing at `ref` (an empty set when everything passes) */
  failing(goal: Goal, ref: string): Promise<Set<string>> {
    const key = `${goal.id}@${ref}`;
    let p = this.cache.get(key);
    if (!p) {
      p = this.compute(goal, ref).catch((err) => {
        this.cache.delete(key);
        this.engine.config.log(`[baseline] ${goal.id}@${ref.slice(0, 7)} failed: ${err}`);
        return new Set<string>();
      });
      this.cache.set(key, p);
      // keep the map small: only the last few commits per goal matter
      if (this.cache.size > 32) this.cache.delete(this.cache.keys().next().value!);
    }
    return p;
  }

  private async compute(goal: Goal, ref: string): Promise<Set<string>> {
    const { config, store } = this.engine;
    const must = listChecks(store.db, goal.id).filter((c) => c.spec.type === 'command' && c.tier === 'must');
    if (!must.length) return new Set();
    const path = baselineWorkspacePath(config.dataDir, goal);
    await ensureDetachedWorktree(goal.repoPath, path, ref);
    try {
      const failing = new Set<string>();
      for (const c of must) {
        const r = await runCommandCheck(c as Check, { cwd: path, outputDir: join(config.dataDir, 'check-output'), attemptId: `baseline-${ref.slice(0, 7)}` });
        if (r.status !== 'pass') failing.add(c.id);
      }
      if (failing.size) store.append({ type: 'engine.note', goalId: goal.id, payload: { level: 'info', message: `baseline at ${ref.slice(0, 7)}: ${failing.size} must check(s) already failing on the goal branch (${must.filter((c) => failing.has(c.id)).map((c) => c.name).join(', ')}); merges are judged on regressions only` } });
      return failing;
    } finally {
      await removeWorktree(goal.repoPath, path).catch(() => {});
    }
  }
}
