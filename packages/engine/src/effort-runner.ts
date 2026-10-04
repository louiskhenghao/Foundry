import type { Database } from 'bun:sqlite';
import type { Effort } from '@foundry/core';
import { CODEX_MODEL_ACTIONS, natureKey, getGoal } from '@foundry/core';
import type { ClaudeRunner, RunHandle, RunSpec } from '@foundry/runner';

/**
 * Hands every session the effort level of its goal (Goal.effort, chosen at creation) or the Settings default, so one
 * knob covers attempts, reviews, clarify and merges alike. A spec that names its own effort keeps it.
 */
export class EffortRunner implements ClaudeRunner {
  constructor(
    private inner: ClaudeRunner,
    private db: () => Database,
    private fallback: () => Effort | null,
  ) {}
  active(): number {
    return this.inner.active();
  }
  setMaxConcurrent(n: number): void {
    this.inner.setMaxConcurrent?.(n);
  }
  killAll(): number {
    return (this.inner as { killAll?: () => number }).killAll?.() ?? 0;
  }
  run(spec: RunSpec): Promise<RunHandle> {
    const goalId = spec.meta?.goalId;
    const goal = goalId ? getGoal(this.db(), goalId) : null;
    let model = spec.model;
    let effort = spec.effort ?? goal?.effort ?? (spec.meta?.tier === 'probe' ? null : this.fallback());
    if (goal?.provider === 'codex' && goal.codexPreset) {
      const action = CODEX_MODEL_ACTIONS.find((a) => a === spec.meta?.modelAction) ?? 'housekeeping';
      const choice = goal.codexPreset.tables[natureKey(goal.nature)][action];
      effort = spec.effort ?? goal.effort ?? choice.effort;
      if (!spec.meta?.modelAction && spec.meta?.tier !== 'probe' && !spec.meta?.modelFallback) {
        model = choice.model;
        for (let i = 0; i < 4 && goal.modelSubstitutions[model]; i++) model = goal.modelSubstitutions[model]!;
      }
    } else if (goal?.provider === 'codex' && effort === 'max') effort = 'xhigh'; // retain pre-preset semantics
    const resolved = { ...spec, model, ...(effort ? { effort } : {}) };
    return this.inner.run(resolved);
  }
}
