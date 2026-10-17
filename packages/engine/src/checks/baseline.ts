import { join } from 'node:path';
import type { Check, Goal } from '@foundry/core';
import { listChecks } from '@foundry/core';
import type { Engine } from '../engine.ts';
import { ensureDetachedWorktree, removeWorktree } from '../git/git.ts';
import { runCommandCheck } from './command.ts';
import { artifactsForChecks, goalUsesArtifacts } from '../goal-artifacts.ts';
import { ARTIFACTS_DIR, baselineWorkspacePath, contentHash, goalWorkspacePath, listArtifacts } from '../workspace.ts';

/**
 * Which must command checks already fail on a given goal-branch commit, *before* a merge.
 *
 * A merge (automatic or manual) is judged against this baseline: a check that was already red on the goal
 * branch is not the merge's fault and must not keep a correctly resolved merge from landing — otherwise a goal
 * whose suite is red for an unrelated reason loops forever (work → merge "fails" → retry → …).
 * Computed in a throw-away `_baseline` worktree, given the artifacts (they never come through git) of the worktree the
 * merge happens in, so both sides of the comparison measure the same exports; cached per commit and per state of those
 * exports, and computed one at a time per goal (they share the goal's one `_baseline` worktree).
 */
export class BaselineChecks {
  private cache = new Map<string, Promise<Set<string>>>();
  /** the last computation of each goal: the next one waits for it */
  private running = new Map<string, Promise<unknown>>();
  constructor(private engine: Engine) {}

  /**
   * ids of the must command checks failing at `ref` (an empty set when everything passes), with the artifacts of
   * `artifactsFrom`: the worktree the merge happens in (a task's on a catch-up), the goal workspace by default
   */
  async failing(goal: Goal, ref: string, artifactsFrom?: string): Promise<Set<string>> {
    // nothing to measure: no export is read for it
    if (!this.mustChecks(goal).length) return new Set();
    const from = artifactsFrom ?? goalWorkspacePath(this.engine.config.dataDir, goal);
    // a re-export at the same commit is another baseline: the exports' state is part of the key
    const key = `${goal.id}@${ref}@${from}@${await this.exportsPrint(goal, from)}`;
    let p = this.cache.get(key);
    if (!p) {
      const before = this.running.get(goal.id) ?? Promise.resolve();
      p = before
        .catch(() => {})
        .then(() => this.compute(goal, ref, from))
        .catch((err) => {
          this.cache.delete(key);
          this.engine.config.log(`[baseline] ${goal.id}@${ref.slice(0, 7)} failed: ${err}`);
          // the person sees why every failing check now counts against the merge
          this.engine.store.append({ type: 'engine.note', goalId: goal.id, payload: { level: 'warn', message: `baseline at ${ref.slice(0, 7)} could not be measured (${String((err as Error)?.message ?? err).slice(0, 200)}): every failing must check counts as a regression of this merge` } });
          return new Set<string>();
        });
      this.running.set(goal.id, p);
      this.cache.set(key, p);
      // keep the map small: only the last few commits per goal matter
      if (this.cache.size > 32) this.cache.delete(this.cache.keys().next().value!);
    }
    return p;
  }

  /**
   * Names and contents of the exports a baseline measures, for a goal that keeps artifacts ('' otherwise). Sizes and
   * times are not enough: a re-export of the same size within one tick of the file system's clock, or a copy that kept
   * the old times, would reuse the baseline of what it replaced. Each file is digested on its own (contentHash, which
   * lets the server answer meanwhile), so no file's bytes can pass for another file's name.
   */
  private async exportsPrint(goal: Goal, ws: string): Promise<string> {
    if (!goalUsesArtifacts(this.engine, goal)) return '';
    const h = new Bun.CryptoHasher('blake2b256');
    for (const f of listArtifacts(ws)) h.update(`${f}\0${await contentHash(join(ws, ARTIFACTS_DIR, f)).catch(() => 'unreadable')}\n`);
    return h.digest('hex').slice(0, 24);
  }

  private mustChecks(goal: Goal): Check[] {
    return listChecks(this.engine.store.db, goal.id).filter((c) => c.spec.type === 'command' && c.tier === 'must') as Check[];
  }

  private async compute(goal: Goal, ref: string, from: string): Promise<Set<string>> {
    const { config, store } = this.engine;
    const must = this.mustChecks(goal);
    if (!must.length) return new Set();
    const path = baselineWorkspacePath(config.dataDir, goal);
    await ensureDetachedWorktree(goal.repoPath, path, ref);
    try {
      // artifacts never come through git: a check that measures an export sees the exports the merged side has
      await artifactsForChecks(this.engine, goal, from, path, `baseline at ${ref.slice(0, 7)}`, { strict: true });
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
