import { describe, expect, test } from 'bun:test';
import { ARTIFACT_NATURES, DEFAULT_SETTINGS, FigurePack, GoalNature, MEDIA_NATURES, natureKey } from '../index.ts';
import { ARTIFACT_SCENARIOS, TaskScenario } from './task.ts';
import { subjectsApply } from './subject.ts';

/** figure goals (ADR-0076): a nature judged by eye whose deliverables are pages under artifacts/ */
describe('the figure nature', () => {
  test('is a media and an artifact nature, and a scenario whose files are artifacts', () => {
    expect(GoalNature.options).toContain('figure');
    expect(MEDIA_NATURES).toContain('figure');
    expect(ARTIFACT_NATURES).toContain('figure');
    expect(TaskScenario.options).toContain('figure');
    expect(ARTIFACT_SCENARIOS).toContain('figure');
    expect(subjectsApply('figure')).toBe(true);
  });
  test('uses the Media model table', () => {
    expect(natureKey('figure')).toBe('media');
    expect(natureKey('image')).toBe('media');
    expect(natureKey('code')).toBe('code');
  });
  test('the Figure pack defaults to Colorfigures and the beta switch to off', () => {
    expect(FigurePack.options).toEqual(['colorfigures', 'iso-glow', 'none']);
    expect(DEFAULT_SETTINGS.workflow.figurePack).toBe('colorfigures');
    expect(DEFAULT_SETTINGS.beta.figure).toBe(false);
  });
});
