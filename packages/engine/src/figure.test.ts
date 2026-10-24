import { describe, expect, test } from 'bun:test';
import { FIGURE_PLAN, FIGURE_SESSION_MIN, attemptTimeoutMs, figureClarifySection, figureStyleOf } from './figure.ts';

describe('figure goals (ADR-0076)', () => {
  test("a figure task's session gets at least 45 minutes; other tasks keep the Settings cap", () => {
    const twenty = { attemptTimeoutMs: 20 * 60_000 };
    expect(attemptTimeoutMs(twenty, { scenario: 'figure' })).toBe(FIGURE_SESSION_MIN * 60_000);
    expect(attemptTimeoutMs(twenty, { scenario: 'frontend' })).toBe(20 * 60_000);
    expect(attemptTimeoutMs({ attemptTimeoutMs: 90 * 60_000 }, { scenario: 'figure' })).toBe(90 * 60_000);
  });
  test('the style in use is the pack when installed, else the first installed style, else none', () => {
    expect(figureStyleOf({ pack: 'colorfigures', installed: ['colorfigures', 'iso-glow'] })).toBe('colorfigures');
    expect(figureStyleOf({ pack: 'colorfigures', installed: ['iso-glow'] })).toBe('iso-glow');
    expect(figureStyleOf({ pack: 'none', installed: ['colorfigures'] })).toBe('colorfigures');
    expect(figureStyleOf({ pack: 'iso-glow', installed: [] })).toBeNull();
  });
  test('the Clarifier is told which style draws, when it may name the other, and never to plan a render check', () => {
    const both = figureClarifySection({ pack: 'colorfigures', installed: ['colorfigures', 'iso-glow'] });
    expect(both).toContain('The figure skill in use is Colorfigures');
    expect(both).toContain('Set `figurePack` to "iso-glow" only when');
    const one = figureClarifySection({ pack: 'colorfigures', installed: ['colorfigures'] });
    expect(one).toContain('It is the only style installed: leave `figurePack` out.');
    expect(figureClarifySection({ pack: 'colorfigures', installed: [] })).toContain('No figure skill is installed');
    expect(figureClarifySection(null)).toContain('No figure skill is installed');
    expect(both).toContain('plan no check for that');
    expect(FIGURE_PLAN).toContain('test -f figures/<name>.html');
    expect(both).toContain('committed in the repository, one self-contained file at `figures/<name>.html`');
  });
});
