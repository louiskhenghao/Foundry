import { describe, expect, test } from 'bun:test';
import { ARTIFACT_NATURES, DEFAULT_SETTINGS, DiagramPack, GoalNature, MEDIA_NATURES, natureKey } from '../index.ts';
import { ARTIFACT_SCENARIOS, TaskScenario } from './task.ts';
import { subjectsApply } from './subject.ts';
import { CheckSpec } from './check.ts';
import { TemplateNature } from './template.ts';

/** diagram goals (ADR-0083): a nature judged by eye whose pages are committed and whose PNG renders are artifacts */
describe('the diagram nature', () => {
  test('is a media and an artifact nature, and a scenario whose files are artifacts; a diagram depicts no Subject', () => {
    expect(GoalNature.options).toContain('diagram');
    expect(MEDIA_NATURES).toContain('diagram');
    expect(ARTIFACT_NATURES).toContain('diagram');
    expect(TaskScenario.options).toContain('diagram');
    expect(ARTIFACT_SCENARIOS).toContain('diagram');
    expect(TemplateNature.options).toContain('diagram');
    expect(subjectsApply('diagram')).toBe(false);
  });
  test('uses the Media model table', () => {
    expect(natureKey('diagram')).toBe('media');
  });
  test('the Diagram pack defaults to diagram-design and the beta switch to off', () => {
    expect(DiagramPack.options).toEqual(['diagram-design', 'none']);
    expect(DEFAULT_SETTINGS.workflow.diagramPack).toBe('diagram-design');
    expect(DEFAULT_SETTINGS.beta.diagram).toBe(false);
  });
  test('a diagram check is a check kind of its own', () => {
    expect(CheckSpec.parse({ type: 'diagram' })).toEqual({ type: 'diagram' });
  });
});
