import type { Goal, Task, TaskDifficulty } from '@foundry/core';
import type { EngineConfig } from '../config.ts';

export type Tier = 'strong' | 'worker' | 'cheap';
/** every action whose model can be chosen in Settings → Models */
export type ModelRole = 'clarifier' | 'planner' | 'merger' | 'goalReviewer' | 'taskReviewer' | 'documenter' | 'feedback' | 'suggest' | 'styleSample';

/** which tier each role uses when Settings leaves it empty — the bindings every goal had before roles existed */
export const ROLE_DEFAULT_TIER: Record<ModelRole, Tier> = {
  clarifier: 'strong',
  planner: 'strong',
  merger: 'strong',
  goalReviewer: 'strong',
  taskReviewer: 'cheap',
  documenter: 'strong',
  feedback: 'cheap',
  suggest: 'strong',
  styleSample: 'worker',
};

const TIERS: readonly string[] = ['strong', 'worker', 'cheap'];

/**
 * A Settings value → the model to run: a tier name reads the goal's model for that tier (so fallbacks and per-goal
 * overrides still apply); anything else is a model id used as is. `tier` is set only when the model came from a tier —
 * the fallback runner rewrites that tier on the goal, which must not happen for a pinned id.
 */
export function resolveModel(goal: Pick<Goal, 'models'>, value: string | null | undefined, fallbackTier: Tier): { model: string; tier: Tier | null } {
  const v = value?.trim();
  if (!v) return { model: goal.models[fallbackTier], tier: fallbackTier };
  if (TIERS.includes(v)) return { model: goal.models[v as Tier], tier: v as Tier };
  return { model: v, tier: null };
}

/** the model a role's session runs on for this goal */
export function modelFor(config: Pick<EngineConfig, 'modelRoles'> & Partial<Pick<EngineConfig, 'goalReviewer'>>, goal: Pick<Goal, 'models'>, role: ModelRole): { model: string; tier: Tier | null } {
  // the goal reviewer's tier used to live in Settings → Reviews; an empty role row still honours it
  const def = role === 'goalReviewer' ? (config.goalReviewer ?? 'strong') : ROLE_DEFAULT_TIER[role];
  return resolveModel(goal, config.modelRoles[role], def);
}

/** RunSpec.meta for a resolved model: the tier rides along only when the model came from one */
export function metaFor(goalId: string, r: { tier: Tier | null }): Record<string, string> {
  return r.tier ? { goalId, tier: r.tier } : { goalId };
}

/**
 * The model a task attempt runs on. The task's difficulty picks the route (Settings → Models: routine / normal / hard);
 * the last attempt of a budget of two or more, and every attempt the human granted beyond the budget, run on the strong
 * tier — a stronger engineer before the task is handed back to a person.
 */
export function workerModelFor(
  config: Pick<EngineConfig, 'difficultyRoute' | 'escalateLastAttempt'>,
  goal: Pick<Goal, 'models'>,
  task: Pick<Task, 'difficulty' | 'retryBudget'>,
  attemptIndex: number,
): { model: string; tier: Tier | null; escalated: 'last-attempt' | 'human-retry' | null } {
  const routed = resolveModel(goal, config.difficultyRoute[(task.difficulty ?? 'normal') as TaskDifficulty], 'worker');
  const escalated = !config.escalateLastAttempt ? null : attemptIndex > task.retryBudget ? 'human-retry' : task.retryBudget >= 2 && attemptIndex === task.retryBudget ? 'last-attempt' : null;
  if (!escalated) return { ...routed, escalated: null };
  const strong = resolveModel(goal, 'strong', 'strong');
  // already running on the strong model: nothing to escalate to
  return strong.model === routed.model ? { ...routed, escalated: null } : { ...strong, escalated };
}
