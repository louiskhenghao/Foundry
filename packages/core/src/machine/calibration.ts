/**
 * Estimate calibration (ADR-0056): how far earlier goals ran from their Brief's estimate, as a factor the next estimate
 * is corrected by. Pure: the engine collects the samples, this file reduces them.
 */

/** one finished goal: what its Brief estimated and what it came to (null = not measured, e.g. a Codex cost) */
export interface EstimateSample {
  goalId: string;
  title: string;
  at: string;
  estimateUsd: number;
  actualUsd: number | null;
  estimateMin: number;
  actualMin: number | null;
}

/** actual ÷ estimate over the samples: the median, how many it rests on, and whether they agree */
export interface CalibrationFactor {
  factor: number;
  samples: number;
  /** `loose` = the samples disagree by more than three to one between the lower and the upper quarter */
  spread: 'tight' | 'loose';
}

export interface Calibration {
  /** where the samples come from: this folder, every folder's goals of the same nature, or nowhere (too few) */
  scope: 'folder' | 'nature' | 'none';
  /** the nature the samples share when the scope is `nature` */
  nature: 'code' | 'docs' | 'media' | null;
  cost: CalibrationFactor | null;
  time: CalibrationFactor | null;
  /** the newest samples, for the person to see what the factor rests on */
  samples: EstimateSample[];
}

/** fewer samples than this say nothing */
export const CALIBRATION_MIN_SAMPLES = 3;
/** a ratio outside this range is a broken sample (a $0.01 estimate, a goal that stopped at once), not a lesson */
const RATIO_MIN = 0.05;
const RATIO_MAX = 20;

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
};
const quartile = (xs: number[], q: number): number => {
  const s = [...xs].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.round((s.length - 1) * q)));
  return s[i]!;
};

/** the factor over the ratios that are usable, or null with too few */
export function factorOf(ratios: number[], min = CALIBRATION_MIN_SAMPLES): CalibrationFactor | null {
  const ok = ratios.filter((r) => Number.isFinite(r) && r >= RATIO_MIN && r <= RATIO_MAX);
  if (ok.length < min) return null;
  const factor = Math.round(median(ok) * 100) / 100;
  const spread = ok.length >= 4 && quartile(ok, 0.75) / Math.max(quartile(ok, 0.25), 1e-9) > 3 ? 'loose' : 'tight';
  return { factor, samples: ok.length, spread };
}

/** the cost and time factors over a set of samples */
export function calibrate(samples: EstimateSample[], min = CALIBRATION_MIN_SAMPLES): { cost: CalibrationFactor | null; time: CalibrationFactor | null } {
  const cost = factorOf(samples.filter((s) => s.actualUsd != null && s.estimateUsd > 0).map((s) => s.actualUsd! / s.estimateUsd), min);
  const time = factorOf(samples.filter((s) => s.actualMin != null && s.estimateMin > 0).map((s) => s.actualMin! / s.estimateMin), min);
  return { cost, time };
}

/** the Brief's estimate corrected by the factors: cost to the half dollar, time to five minutes, never below the estimate's own rounding */
export function calibratedEstimate(est: { costEstimateUsd: number; timeEstimateMin: number }, c: Pick<Calibration, 'cost' | 'time'> | null): { costEstimateUsd: number; timeEstimateMin: number } {
  if (!c) return { costEstimateUsd: est.costEstimateUsd, timeEstimateMin: est.timeEstimateMin };
  const cost = c.cost ? Math.round((est.costEstimateUsd * c.cost.factor) / 0.5) * 0.5 : est.costEstimateUsd;
  const min = c.time ? Math.ceil((est.timeEstimateMin * c.time.factor) / 5) * 5 : est.timeEstimateMin;
  return { costEstimateUsd: Number(cost.toFixed(2)), timeEstimateMin: min };
}

const times = (f: CalibrationFactor) => `${f.factor.toFixed(1).replace(/\.0$/, '')}×`;
const NATURE_WORD = { code: 'code', docs: 'docs and research', media: 'media' } as const;

/**
 * One sentence for the Brief page and the chat: where the samples come from, the factors, and what the estimate
 * likely comes to. Null when there is nothing to say.
 */
export function describeCalibration(c: Calibration | null, est: { costEstimateUsd: number; timeEstimateMin: number }, costAvailable: boolean): { text: string; likely: { costEstimateUsd: number; timeEstimateMin: number } } | null {
  if (!c || c.scope === 'none' || (!c.time && !(costAvailable && c.cost))) return null;
  const where = c.scope === 'folder' ? 'Earlier goals in this folder' : `Earlier ${c.nature ? NATURE_WORD[c.nature] : ''} goals on this computer`;
  const parts: string[] = [];
  if (costAvailable && c.cost) parts.push(`${times(c.cost)} the estimated cost`);
  if (c.time) parts.push(`${times(c.time)} the estimated time`);
  const n = Math.max(c.cost?.samples ?? 0, c.time?.samples ?? 0);
  const loose = (costAvailable && c.cost?.spread === 'loose') || c.time?.spread === 'loose' ? ', with a wide spread' : '';
  const likely = calibratedEstimate(est, { cost: costAvailable ? c.cost : null, time: c.time });
  const likelyText = [costAvailable && c.cost ? `$${likely.costEstimateUsd}` : null, c.time ? `${likely.timeEstimateMin} min` : null].filter(Boolean).join(' and ');
  return { text: `${where} ran at ${parts.join(' and ')} (median of ${n} finished goal${n === 1 ? '' : 's'}${loose}): likely about ${likelyText}.`, likely };
}
