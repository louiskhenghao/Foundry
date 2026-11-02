import { describe, expect, test } from 'bun:test';
import { DIAGRAM_PLAN, DIAGRAM_WORKER_CONVENTIONS, diagramClarifySection, diagramSkillOf, diagramTasksNote } from './diagram.ts';

describe('diagram goals (ADR-0083)', () => {
  test('the skill draws only when the pack names it and it is installed', () => {
    expect(diagramSkillOf({ pack: 'diagram-design', installed: true })).toBe(true);
    expect(diagramSkillOf({ pack: 'diagram-design', installed: false })).toBe(false);
    expect(diagramSkillOf({ pack: 'none', installed: true })).toBe(false);
    expect(diagramSkillOf(null)).toBe(false);
  });
  test('the Clarifier is told what the skill draws, where the page and SVG go, and never to plan a render check', () => {
    const on = diagramClarifySection({ pack: 'diagram-design', installed: true });
    expect(on).toContain('The diagram skill in use is diagram-design');
    expect(on).toContain('docs/diagrams/<name>.html');
    expect(on).toContain('docs/diagrams/<name>.svg');
    expect(on).toContain('plan no check for that');
    expect(on).toContain('empty `styleOptions`');
    expect(diagramClarifySection({ pack: 'diagram-design', installed: false })).toContain('No diagram skill is installed');
    expect(diagramClarifySection(null)).toContain('No diagram skill is installed');
  });
  test('other goals hear about diagram tasks only while the skill is there', () => {
    expect(diagramTasksNote({ pack: 'diagram-design', installed: true })).toContain('scenario `diagram`');
    expect(diagramTasksNote({ pack: 'diagram-design', installed: false })).toBe('');
    expect(diagramTasksNote(null)).toBe('');
  });
  test('the planner and the worker are held to the committed page, the SVG beside it and no PNG of their own', () => {
    expect(DIAGRAM_PLAN).toContain('test -f docs/diagrams/<name>.html && grep');
    expect(DIAGRAM_PLAN).toContain('docs/diagrams/style-guide.md');
    expect(DIAGRAM_WORKER_CONVENTIONS).toContain('scripts/export_svg.py');
    expect(DIAGRAM_WORKER_CONVENTIONS).toContain('Make no PNG');
    expect(DIAGRAM_WORKER_CONVENTIONS).toContain('Never edit the installed skill');
  });
});
