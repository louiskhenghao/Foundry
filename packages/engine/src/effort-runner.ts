import type { Database } from 'bun:sqlite';
import type { Effort } from '@foundry/core';
import { getGoal } from '@foundry/core';
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
    const effort = spec.effort ?? (goalId ? getGoal(this.db(), goalId)?.effort : null) ?? this.fallback();
    return this.inner.run(effort ? { ...spec, effort } : spec);
  }
}
