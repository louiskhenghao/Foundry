import { describe, expect, test } from 'bun:test';
import { DECK_PLAN, deckClarifySection, deckSkillOf, deckWorkerConventions } from './deck.ts';
import { DECK_SESSION_MIN, FIGURE_SESSION_MIN, attemptTimeoutMs } from './figure.ts';

describe('deck goals (ADR-0084)', () => {
  test('the skill makes decks only when the pack names it and it is installed', () => {
    expect(deckSkillOf({ pack: 'ppt-master', installed: true, skillDir: '/s', venv: '/v', images: false })).toBe(true);
    expect(deckSkillOf({ pack: 'ppt-master', installed: false, skillDir: null, venv: null, images: false })).toBe(false);
    expect(deckSkillOf({ pack: 'none', installed: true, skillDir: '/s', venv: '/v', images: false })).toBe(false);
    expect(deckSkillOf(null)).toBe(false);
  });
  test("a deck task's session gets at least an hour; a figure task 45 minutes; others keep the Settings cap", () => {
    const twenty = { attemptTimeoutMs: 20 * 60_000 };
    expect(attemptTimeoutMs(twenty, { scenario: 'deck' })).toBe(DECK_SESSION_MIN * 60_000);
    expect(attemptTimeoutMs(twenty, { scenario: 'figure' })).toBe(FIGURE_SESSION_MIN * 60_000);
    expect(attemptTimeoutMs(twenty, { scenario: 'docs' })).toBe(20 * 60_000);
    expect(attemptTimeoutMs({ attemptTimeoutMs: 90 * 60_000 }, { scenario: 'deck' })).toBe(90 * 60_000);
  });
  test('the Clarifier is told the deck is one task, where it goes, that the Brief answers the confirmations, and about pictures', () => {
    const on = deckClarifySection({ pack: 'ppt-master', installed: true, skillDir: '/s', venv: '/v', images: true });
    expect(on).toContain('The deck skill in use is ppt-master');
    expect(on).toContain('artifacts/decks/<name>.pptx');
    expect(on).toContain('never split into slides');
    expect(on).toContain('answered by the Brief');
    expect(on).toContain('An image-generation key is set');
    expect(on).toContain('plan no check for that');
    const noKey = deckClarifySection({ pack: 'ppt-master', installed: true, skillDir: '/s', venv: null, images: false });
    expect(noKey).toContain('No image-generation key is set');
    expect(noKey).toContain('Its Python environment is not made yet');
    expect(deckClarifySection(null)).toContain('No deck skill is installed');
  });
  test('the worker is told the default route, the delegated confirmations, the project folder and the copy to the named path', () => {
    const c = deckWorkerConventions({ skillDir: '/home/x/.claude/skills/ppt-master', venv: '/data/python/ppt-master', images: false });
    expect(c).toContain('Generate PPTX — ordinary Default');
    expect(c).toContain('`SKILL_DIR` — is `/home/x/.claude/skills/ppt-master`');
    expect(c).toContain('explicitly delegated both confirmation stages');
    expect(c).toContain('--dir artifacts/decks');
    expect(c).toContain('/data/python/ppt-master');
    expect(c).toContain('No AI-generated pictures');
    expect(deckWorkerConventions({ skillDir: '/s', venv: null, images: true })).toContain('was not made');
    expect(deckWorkerConventions({ skillDir: '/s', venv: '/v', images: true })).toContain('export `IMAGE_BACKEND`');
    expect(DECK_PLAN).toContain('test -f artifacts/decks/<name>.pptx');
  });
});
