import { describe, expect, test } from 'bun:test';
import { verdictSummary } from './reviewer.ts';

describe('the summary a verdict leaves on its check result (ADR-0077)', () => {
  test('a pass, a fail, and the scores line when the rubric scored axes', () => {
    expect(verdictSummary({ pass: true, blockers: [] })).toBe('Reviewer: no blockers.');
    expect(verdictSummary({ pass: false, blockers: ['text overlaps at 4.2s', 'dead beat at 9s'] })).toBe('text overlaps at 4.2s\ndead beat at 9s');
    expect(verdictSummary({ pass: true, blockers: [], scores: { hook: 9, sound: 8, motion: 8 } })).toBe('Reviewer: no blockers.\nScores: hook 9 · motion 8 · sound 8');
    expect(verdictSummary({ pass: true, blockers: [], scores: {} })).toBe('Reviewer: no blockers.');
  });
});

import { scoresFromNotes, withScoresFromNotes } from './reviewer.ts';

describe('scores a reviewer left in its notes instead of the field', () => {
  test('a table or a colon list is read back; prose numbers are not; fewer than three axes is nothing', () => {
    const table = '**Scores**\n| Axis | Score |\n|---|---|\n| hook | 9 |\n| readability | 8 |\n| motion | 8 |\n| variety | 9 |\n| composition | 8 |\n| brand | 9 |\n| sound | 8 |\nCuts sit on the grid.';
    expect(scoresFromNotes(table)).toEqual({ hook: 9, readability: 8, motion: 8, variety: 9, composition: 8, brand: 9, sound: 8 });
    expect(scoresFromNotes('hook: 7, readability: 9, motion: 8/10, sound: 6')).toEqual({ hook: 7, readability: 9, motion: 8, sound: 6 });
    expect(scoresFromNotes('The motion blur over 2 frames reads well; the hook lands in 1.5 s; sound sits on the grid.')).toBeUndefined();
    expect(scoresFromNotes('hook: 9, sound: 8')).toBeUndefined();
    expect(scoresFromNotes(undefined)).toBeUndefined();
  });
  test('the field wins when the reviewer filled it', () => {
    expect(withScoresFromNotes({ pass: true, blockers: [], notes: 'hook: 3, sound: 3, motion: 3', scores: { hook: 9 } }).scores).toEqual({ hook: 9 });
    expect(withScoresFromNotes({ pass: true, blockers: [], notes: 'hook: 9, readability: 8, sound: 8' }).scores).toEqual({ hook: 9, readability: 8, sound: 8 });
  });
});
