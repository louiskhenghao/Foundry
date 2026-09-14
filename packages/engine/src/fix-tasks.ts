import type { Check, Goal, Task } from '@foundry/core';
import { IdPrefix, listChecks, listTasks, newId } from '@foundry/core';
import type { Engine } from './engine.ts';
import { goalScenario } from './skills/workflow.ts';

/** One fix task as the goal reviewer proposes it (also carried on a goal-review escalation for a later human retry). */
export interface FixSpec {
  title: string;
  spec: string;
  relevantFiles: string[];
}

/** The generic fix task when the reviewer proposed none: the failing checks with their reasons. */
export function genericFixSpec(failing: { name: string; summary: string }[]): FixSpec {
  return {
    title: 'Fix failing goal-level checks',
    spec: `The following goal-level checks fail on the merged result:\n${failing.map((f) => `- ${f.name}\n\`\`\`\n${f.summary.slice(0, 1200)}\n\`\`\``).join('\n')}\nMake them pass without weakening the checks.`,
    relevantFiles: [],
  };
}

/**
 * Spawn fix tasks that run after every existing task (the goal branch already holds their work). Each gets a copy of the
 * goal-level must command checks so its attempts self-verify; `hint` (the human's words on a retry) rides on every task.
 */
export function createFixTasks(engine: Engine, goal: Goal, specs: FixSpec[], hint: string | null = null, opts: { origin?: 'goal-review-fix' | 'feedback-fix'; checkpointOf?: string | null } = {}): string[] {
  const { store } = engine;
  const now = new Date().toISOString();
  const existing = listTasks(store.db, goal.id);
  const goalChecks = listChecks(store.db, goal.id).filter((c) => c.taskId === null);
  const ids: string[] = [];
  for (const s of specs) {
    const t: Task = {
      id: newId(IdPrefix.task),
      goalId: goal.id,
      title: s.title,
      spec: s.spec,
      kind: 'bug',
      scope: null,
      scenario: goalScenario(existing),
      area: null,
      tdd: 'inherit',
      dependsOn: existing.filter((x) => x.state === 'done' || x.state === 'skipped').map((x) => x.id),
      relevantFiles: s.relevantFiles,
      parallelizable: false,
      retryBudget: goal.budgets.attemptsPerTask,
      origin: opts.origin ?? 'goal-review-fix',
      milestone: null,
      milestoneVisits: 0,
      checkpointOf: opts.checkpointOf ?? null,
      state: 'pending',
      branch: null,
      worktreePath: null,
      baseRef: null,
      commitRef: null,
      commitMessage: null,
      hint,
      extraAttempts: 0,
      createdAt: now,
      updatedAt: now,
    };
    store.append({ type: 'task.created', goalId: goal.id, payload: { task: t } });
    // goal-level must command checks are re-run at the next review; give the fix task the same checks so its attempts self-verify
    for (const c of goalChecks.filter((x) => x.tier === 'must' && x.spec.type === 'command')) {
      const copy: Check = { ...c, id: newId(IdPrefix.check), taskId: t.id };
      store.append({ type: 'check.created', goalId: goal.id, payload: { check: copy } });
    }
    ids.push(t.id);
  }
  return ids;
}
