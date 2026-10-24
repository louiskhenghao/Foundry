import { describe, expect, test } from 'bun:test';
import { verdictSummary } from './reviewer.ts';

describe('the summary a verdict leaves on its check result (ADR-0076)', () => {
  test('a pass, a fail, and the scores line when the rubric scored axes', () => {
    expect(verdictSummary({ pass: true, blockers: [] })).toBe('Reviewer: no blockers.');
    expect(verdictSummary({ pass: false, blockers: ['text overlaps at 4.2s', 'dead beat at 9s'] })).toBe('text overlaps at 4.2s\ndead beat at 9s');
    expect(verdictSummary({ pass: true, blockers: [], scores: { hook: 9, sound: 8, motion: 8 } })).toBe('Reviewer: no blockers.\nScores: hook 9 · motion 8 · sound 8');
    expect(verdictSummary({ pass: true, blockers: [], scores: {} })).toBe('Reviewer: no blockers.');
  });
});
