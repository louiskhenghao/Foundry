import { HIGH_EFFORT_SESSION_SCALE, PRESET_SESSION_SCALE, effectivePresets, type Goal } from '@foundry/core';
import type { EngineConfig } from './config.ts';
import { tableFor } from './models/roles.ts';

type ScaleConfig = Pick<EngineConfig, 'provider' | 'modelPresets' | 'naturePreset' | 'effort'>;
type ScaleGoal = Pick<Goal, 'nature' | 'modelPreset' | 'effort'> & Partial<Pick<Goal, 'provider' | 'sessionLimits'>>;

/**
 * How far a goal's sessions may go past their own dollar caps. A number the goal was made with multiplies every cap;
 * `auto` follows its model preset (Max ×3, Production ×2, Balanced and Economy ×1; a custom preset counts as the one it
 * was made from) and, on top, ×1.5 for an effort that thinks the longest (xhigh, max). Only Claude reports dollars, so
 * only its caps move: Codex and Antigravity sessions are bounded by time and turns.
 */
export function sessionScale(config: ScaleConfig, goal: ScaleGoal): number {
  if ((goal.provider ?? config.provider) !== 'claude') return 1;
  const set = goal.sessionLimits ?? 'auto';
  if (set !== 'auto') return set;
  const { presetId } = tableFor(config, goal);
  const basedOn = effectivePresets(config.modelPresets)[presetId]?.basedOn ?? null;
  const byPreset = PRESET_SESSION_SCALE[presetId] ?? (basedOn ? PRESET_SESSION_SCALE[basedOn] : undefined) ?? 1;
  const effort = goal.effort ?? config.effort;
  return byPreset * (effort === 'xhigh' || effort === 'max' ? HIGH_EFFORT_SESSION_SCALE : 1);
}

/** a session's dollar cap for this goal: its base cap times the goal's session scale, to the cent */
export function sessionCap(config: ScaleConfig, goal: ScaleGoal, base: number): number {
  return Math.round(base * sessionScale(config, goal) * 100) / 100;
}

/** a cap kept within what the goal has left to spend (null: no dollar budget), never below `floor` */
export function capWithin(cap: number, remaining: number | null | undefined, floor: number): number {
  return Math.max(floor, remaining == null ? cap : Math.min(cap, remaining));
}
