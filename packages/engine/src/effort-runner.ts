import type { Database } from 'bun:sqlite';
import type { Effort } from '@foundry/core';
import { CODEX_MODEL_ACTIONS, natureKey, getGoal } from '@foundry/core';
import type { ClaudeRunner, RunHandle, RunSpec } from '@foundry/runner';
import { nearestEffort } from './models/discover.ts';

/**
 * Hands every session the effort level of its goal (Goal.effort, chosen at creation) or the Settings default, so one
 * knob covers attempts, reviews, clarify and merges alike. A spec that names its own effort keeps it.
 */
export class EffortRunner implements ClaudeRunner {
  /** the levels already noted as not taken, so the log says it once */
  private said = new Set<string>();
  constructor(
    private inner: ClaudeRunner,
    private db: () => Database,
    private fallback: () => Effort | null,
    /** the levels this coding agent's binary takes (ADR-0085); null or empty = not known, every level goes through as asked */
    private levels: () => readonly string[] | null = () => null,
    private note: (message: string) => void = () => {},
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
    // a level this binary does not take (renamed or dropped by a newer CLI) runs as its nearest neighbour, said once (ADR-0085)
    if (effort && goal?.provider !== 'codex') {
      const known = this.levels();
      if (known?.length && !known.includes(effort)) {
        const sub = nearestEffort(effort, known);
        if (!this.said.has(effort)) {
          this.said.add(effort);
          this.note(`[effort] ${effort} is not a level this coding agent takes (${known.join(', ')}): sessions asking for it run with ${sub}`);
        }
        effort = sub;
      }
    }
    const resolved = { ...spec, model, ...(effort ? { effort } : {}) };
    return this.inner.run(resolved);
  }
}
