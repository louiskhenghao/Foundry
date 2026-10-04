import type { Goal, ModelAction, ModelNature, ModelPreset, PresetTable, Task } from '@foundry/core';
import { BUILTIN_PRESETS, DEFAULT_NATURE_PRESETS, effectivePresets, natureKey } from '@foundry/core';
import type { EngineConfig } from '../config.ts';

type PresetConfig = Pick<EngineConfig, 'modelPresets' | 'naturePreset'> & Partial<Pick<EngineConfig, 'provider' | 'codexModel'>>;
type GoalRef = Pick<Goal, 'nature' | 'modelPreset'> & Partial<Pick<Goal, 'modelSubstitutions' | 'provider' | 'models' | 'codexPreset'>>;

/**
 * The model table a goal runs on: its own preset (chosen on the New goal form) or the one Settings picks for its nature,
 * read from the presets in effect at this moment — so an edit in Settings reaches goals in flight at their next session.
 * A preset that no longer exists falls back to the nature's preset, then to the shipped default.
 */
export function tableFor(config: PresetConfig, goal: GoalRef): { table: PresetTable; presetId: string; nature: ModelNature } {
  const nature = natureKey(goal.nature);
  if ((goal.provider ?? config.provider) === 'codex') {
    const subs = goal.modelSubstitutions ?? {};
    const table = Object.fromEntries(Object.keys(BUILTIN_PRESETS.production!.tables[nature]).map((action) => {
      let model = goal.codexPreset?.tables[nature][action as ModelAction].model ?? goal.models?.worker ?? config.codexModel ?? 'codex-default';
      for (let i = 0; i < 4 && subs[model]; i++) model = subs[model]!;
      return [action, model];
    })) as PresetTable;
    return { table, presetId: goal.modelPreset ?? 'codex', nature };
  }
  const presets = effectivePresets(config.modelPresets);
  const candidates = [goal.modelPreset, config.naturePreset[nature], DEFAULT_NATURE_PRESETS[nature]].filter((x): x is string => !!x);
  const presetId = candidates.find((id) => presets[id]) ?? 'production';
  const raw = (presets[presetId] ?? BUILTIN_PRESETS.production!).tables[nature];
  const subs = goal.modelSubstitutions ?? {};
  if (!Object.keys(subs).length) return { table: raw, presetId, nature };
  // follow replacements recorded for this goal (a dead model and whatever replaced it), at most a few hops
  const sub = (m: string) => {
    let cur = m;
    for (let i = 0; i < 4 && subs[cur]; i++) cur = subs[cur]!;
    return cur;
  };
  const table = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, sub(v)])) as PresetTable;
  return { table, presetId, nature };
}

/** the model an action's session runs on for this goal */
export function modelFor(config: PresetConfig, goal: GoalRef, action: Exclude<ModelAction, 'simple' | 'standard' | 'complex'>): { model: string; action?: ModelAction } {
  return { model: tableFor(config, goal).table[action], ...((goal.provider ?? config.provider) === 'codex' ? { action } : {}) };
}

/** RunSpec.meta: presets name models directly, so no tier rides along (a fallback never rewrites a goal tier) */
export function metaFor(goalId: string, r?: { action?: ModelAction }): Record<string, string> {
  return { goalId, ...(r?.action ? { modelAction: r.action } : {}) };
}

/**
 * The model a task attempt runs on: the task's difficulty picks the Simple / Standard / Complex row; the last attempt of
 * a budget of two or more, and every attempt the human granted beyond the budget, run on the Complex row.
 */
export function workerModelFor(
  config: PresetConfig & Pick<EngineConfig, 'escalateLastAttempt'>,
  goal: GoalRef,
  task: Pick<Task, 'difficulty' | 'retryBudget'>,
  attemptIndex: number,
): { model: string; action?: ModelAction; escalated: 'last-attempt' | 'human-retry' | null } {
  const { table } = tableFor(config, goal);
  const routed = table[task.difficulty ?? 'standard'];
  const escalated = !config.escalateLastAttempt ? null : attemptIndex > task.retryBudget ? 'human-retry' : task.retryBudget >= 2 && attemptIndex === task.retryBudget ? 'last-attempt' : null;
  const action = task.difficulty ?? 'standard';
  const codex = (goal.provider ?? config.provider) === 'codex';
  const choices = goal.codexPreset?.tables[natureKey(goal.nature)];
  const sameEffort = choices?.complex.effort === choices?.[action].effort;
  if (!escalated || (table.complex === routed && sameEffort)) return { model: routed, escalated: null, ...(codex ? { action } : {}) };
  return { model: table.complex, escalated, ...(codex ? { action: 'complex' as const } : {}) };
}

export type { ModelPreset };
