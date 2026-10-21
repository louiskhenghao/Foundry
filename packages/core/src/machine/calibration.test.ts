import { describe, expect, test } from 'bun:test';
import { calibrate, calibratedEstimate, describeCalibration, factorOf, type Calibration, type EstimateSample } from './calibration.ts';

const sample = (n: number, over: Partial<EstimateSample> = {}): EstimateSample => ({ goalId: `g${n}`, title: `goal ${n}`, at: `2026-10-${String(n).padStart(2, '0')}T00:00:00Z`, estimateUsd: 10, actualUsd: 15, estimateMin: 60, actualMin: 90, ...over });

describe('the factor over the samples', () => {
  test('the median of the usable ratios, rounded; fewer than three say nothing; broken ratios are left out', () => {
    expect(factorOf([1.5, 1.2, 2.0])).toEqual({ factor: 1.5, samples: 3, spread: 'tight' });
    expect(factorOf([1.5, 1.2, 2.0, 1.0])).toEqual({ factor: 1.35, samples: 4, spread: 'tight' });
    expect(factorOf([1.5, 1.2])).toBeNull();
    expect(factorOf([1.5, 1.2, 0.001, 400])).toBeNull();
    expect(factorOf([1.5, 1.2, 1.1, 0.001, 400])).toEqual({ factor: 1.2, samples: 3, spread: 'tight' });
  });
  test('samples that disagree by more than three to one between the quarters are a loose factor', () => {
    expect(factorOf([0.5, 0.6, 2.5, 3.0])!.spread).toBe('loose');
    expect(factorOf([1.0, 1.1, 1.2, 1.3])!.spread).toBe('tight');
  });
  test('cost and time are calibrated apart: a Codex goal has a time but no cost', () => {
    const c = calibrate([sample(1), sample(2, { actualUsd: null }), sample(3, { actualUsd: null }), sample(4, { actualUsd: null })]);
    expect(c.cost).toBeNull();
    expect(c.time).toEqual({ factor: 1.5, samples: 4, spread: 'tight' });
  });
});

describe('the corrected estimate and its sentence', () => {
  const cal: Calibration = { scope: 'folder', nature: null, cost: { factor: 1.6, samples: 5, spread: 'tight' }, time: { factor: 1.25, samples: 5, spread: 'tight' }, samples: [] };
  test('cost to the half dollar, time to five minutes; nothing changes without a factor', () => {
    expect(calibratedEstimate({ costEstimateUsd: 7.2, timeEstimateMin: 33 }, cal)).toEqual({ costEstimateUsd: 11.5, timeEstimateMin: 45 });
    expect(calibratedEstimate({ costEstimateUsd: 7.2, timeEstimateMin: 33 }, { cost: null, time: cal.time })).toEqual({ costEstimateUsd: 7.2, timeEstimateMin: 45 });
    expect(calibratedEstimate({ costEstimateUsd: 7.2, timeEstimateMin: 33 }, null)).toEqual({ costEstimateUsd: 7.2, timeEstimateMin: 33 });
  });
  test('the sentence names where the samples come from, the factors and what the estimate likely comes to', () => {
    expect(describeCalibration(cal, { costEstimateUsd: 7.2, timeEstimateMin: 33 }, true)).toEqual({ text: 'Earlier goals in this folder ran at 1.6× the estimated cost and 1.3× the estimated time (median of 5 finished goals): likely about $11.5 and 45 min.', likely: { costEstimateUsd: 11.5, timeEstimateMin: 45 } });
    // Codex: no dollars, even with a cost factor from Claude goals
    expect(describeCalibration(cal, { costEstimateUsd: 7.2, timeEstimateMin: 33 }, false)!.text).toBe('Earlier goals in this folder ran at 1.3× the estimated time (median of 5 finished goals): likely about 45 min.');
    expect(describeCalibration({ ...cal, scope: 'nature', nature: 'docs', cost: null, time: { factor: 2, samples: 4, spread: 'loose' } }, { costEstimateUsd: 1, timeEstimateMin: 10 }, true)!.text).toBe('Earlier docs and research goals on this computer ran at 2× the estimated time (median of 4 finished goals, with a wide spread): likely about 20 min.');
    expect(describeCalibration({ scope: 'none', nature: null, cost: null, time: null, samples: [] }, { costEstimateUsd: 1, timeEstimateMin: 10 }, true)).toBeNull();
    expect(describeCalibration(null, { costEstimateUsd: 1, timeEstimateMin: 10 }, true)).toBeNull();
  });
});
