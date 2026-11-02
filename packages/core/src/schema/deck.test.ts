import { describe, expect, test } from 'bun:test';
import { ARTIFACT_NATURES, DEFAULT_SETTINGS, DeckPack, GoalNature, MEDIA_NATURES, natureKey } from '../index.ts';
import { ARTIFACT_SCENARIOS, TaskScenario } from './task.ts';
import { subjectsApply } from './subject.ts';
import { CheckSpec } from './check.ts';
import { TemplateNature } from './template.ts';

/** deck goals (ADR-0084): a nature judged by eye whose decks are committed in the repository with their previews, so no output folder */
describe('the deck nature', () => {
  test('is a media nature but not an artifact nature, and a scenario shown as a milestone of files; a deck depicts no Subject', () => {
    expect(GoalNature.options).toContain('deck');
    expect(MEDIA_NATURES).toContain('deck');
    expect(ARTIFACT_NATURES).not.toContain('deck');
    expect(TaskScenario.options).toContain('deck');
    expect(ARTIFACT_SCENARIOS).toContain('deck');
    expect(TemplateNature.options).toContain('deck');
    expect(subjectsApply('deck')).toBe(false);
  });
  test('uses the Media model table', () => {
    expect(natureKey('deck')).toBe('media');
  });
  test('the Deck pack defaults to ppt-master and the beta switch to off', () => {
    expect(DeckPack.options).toEqual(['ppt-master', 'none']);
    expect(DEFAULT_SETTINGS.workflow.deckPack).toBe('ppt-master');
    expect(DEFAULT_SETTINGS.beta.deck).toBe(false);
  });
  test('a deck check is a check kind of its own', () => {
    expect(CheckSpec.parse({ type: 'deck' })).toEqual({ type: 'deck' });
  });
});
