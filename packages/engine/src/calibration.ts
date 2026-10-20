/**
 * Estimate calibration (ADR-0056): the finished goals whose Brief estimated a cost and a time, what they came to, and
 * the factors a new goal's estimate is corrected by. The samples come from the goal's own folder when it has enough
 * finished goals, else from every folder's goals of the same nature, else there is no calibration.
 */
import { reportsDollars } from '@foundry/core';
import type { Goal } from '@foundry/core';
import { CALIBRATION_MIN_SAMPLES, calibrate, getBrief, isHistory, listGoals, natureKey, type Calibration, type EstimateSample } from '@foundry/core';
import { budgetStatus } from './budget.ts';
import type { Engine } from './engine.ts';

const FINISHED = new Set<Goal['state']>(['done', 'over_delivered']);
/** how many samples the person is shown */
const SHOWN = 10;

/** every finished goal with an approved, estimated Brief, as a sample; `except` leaves the goal being estimated out */
export function estimateSamples(engine: Engine, except: string | null = null): (EstimateSample & { repoPath: string; nature: 'code' | 'docs' | 'media' })[] {
  const out: (EstimateSample & { repoPath: string; nature: 'code' | 'docs' | 'media' })[] = [];
  for (const g of listGoals(engine.store.db)) {
    if (g.id === except || isHistory(g) || !FINISHED.has(g.state)) continue;
    const b = getBrief(engine.store.db, g.id);
    if (!b || !b.approved || b.skeleton || !(b.brief.timeEstimateMin > 0)) continue;
    const elapsedMin = budgetStatus(g).elapsedMin;
    out.push({
      goalId: g.id,
      title: g.title,
      at: g.updatedAt,
      estimateUsd: b.brief.costEstimateUsd,
      // a Codex goal reports no cost; a Claude goal that spent nothing measured is left without one too
      actualUsd: !reportsDollars(g.provider) || !(g.costUsd > 0) ? null : g.costUsd,
      estimateMin: b.brief.timeEstimateMin,
      actualMin: elapsedMin > 0 ? elapsedMin : null,
      repoPath: g.repoPath,
      nature: natureKey(g.nature),
    });
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

/** the calibration a goal's estimate is read with: its folder's goals, else its nature's, else none */
export function calibrationFor(engine: Engine, goal: Pick<Goal, 'id' | 'repoPath' | 'nature'>): Calibration {
  const all = estimateSamples(engine, goal.id);
  const folder = all.filter((s) => s.repoPath === goal.repoPath);
  const nature = natureKey(goal.nature);
  const ofNature = all.filter((s) => s.nature === nature);
  const pick = (samples: typeof all, scope: Calibration['scope']): Calibration | null => {
    const { cost, time } = calibrate(samples);
    if (!cost && !time) return null;
    return { scope, nature: scope === 'nature' ? nature : null, cost, time, samples: samples.slice(0, SHOWN).map(({ repoPath: _r, nature: _n, ...s }) => s) };
  };
  return (folder.length >= CALIBRATION_MIN_SAMPLES ? pick(folder, 'folder') : null) ?? (ofNature.length >= CALIBRATION_MIN_SAMPLES ? pick(ofNature, 'nature') : null) ?? { scope: 'none', nature: null, cost: null, time: null, samples: [] };
}
