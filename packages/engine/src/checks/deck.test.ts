import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Check, Goal, Task } from '@foundry/core';
import { EventStore, openDatabase } from '@foundry/core';
import type { Engine } from '../engine.ts';
import { screenshotsDir } from '../workspace.ts';
import { DECK_CHECK_NAME, deckCheckLines, deckFiles, deckPreviews, deckReviewSection, deckShots, runDeckCheck } from './deck.ts';
import { listZip, readDeck, readZipEntry } from './zip.ts';
import { playwrightStatus } from './selfcheck.ts';

/** Foundry's check of a deck task's decks (ADR-0084): what it opens, what it counts, what it renders */
let home: string;
let cwd: string;
const events: { type: string; payload: unknown }[] = [];
const goal = { id: 'g_deck', workspaceDir: null } as unknown as Goal;
const engine = { store: { append: (e: { type: string; payload: unknown }) => events.push(e) }, config: { dataDir: '' } } as unknown as Engine;
const check: Check = { id: 'c1', goalId: goal.id, taskId: 't1', name: DECK_CHECK_NAME, tier: 'must', spec: { type: 'deck' } };
const task = (delivers: string[] = []) => ({ id: 't1', delivers } as unknown as Task);
const python = Bun.which('python3');
const browser = (await playwrightStatus()).browser;

/** a PPTX made with Python's zipfile: the parts a presentation must have, the slides given (text, a picture, or nothing) */
function makeDeck(path: string, slides: ('text' | 'pic' | 'empty')[], declared = slides.length): void {
  const parts: Record<string, string> = {
    '[Content_Types].xml': '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>',
    'ppt/presentation.xml': `<p:presentation><p:sldIdLst>${slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 1}"/>`).join('')}</p:sldIdLst></p:presentation>`,
    'docProps/app.xml': `<Properties><Slides>${declared}</Slides></Properties>`,
  };
  slides.forEach((kind, i) => {
    parts[`ppt/slides/slide${i + 1}.xml`] = kind === 'text' ? '<p:sld><p:sp><p:txBody><a:p><a:r><a:t>Hello slide</a:t></a:r></a:p></p:txBody></p:sp></p:sld>' : kind === 'pic' ? '<p:sld><p:pic><p:blipFill><a:blip r:embed="rId2"/></p:blipFill></p:pic></p:sld>' : '<p:sld><p:sp><p:txBody><a:p><a:r><a:t> </a:t></a:r></a:p></p:txBody></p:sp></p:sld>';
  });
  const script = `import json, sys, zipfile\nparts = json.loads(sys.argv[2])\nwith zipfile.ZipFile(sys.argv[1], 'w', zipfile.ZIP_DEFLATED) as z:\n    for name, body in parts.items():\n        z.writestr(name, body)\n`;
  const r = Bun.spawnSync([python!, '-I', '-c', script, path, JSON.stringify(parts)]);
  if (r.exitCode !== 0) throw new Error(r.stderr.toString());
}

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), 'foundry-deck-check-'));
  (engine.config as { dataDir: string }).dataDir = home;
  cwd = join(home, 'ws');
  mkdirSync(join(cwd, 'artifacts', 'decks'), { recursive: true });
});
afterAll(() => rmSync(home, { recursive: true, force: true }));

describe.skipIf(!python)('reading a deck as a zip', () => {
  test('lists the parts, inflates them and counts the slides with what each carries', () => {
    const p = join(cwd, 'artifacts', 'decks', 'intro.pptx');
    makeDeck(p, ['text', 'pic', 'empty']);
    const bytes = readFileSync(p);
    const entries = listZip(bytes);
    expect(entries.map((e) => e.name)).toContain('ppt/presentation.xml');
    expect(readZipEntry(bytes, entries.find((e) => e.name === 'docProps/app.xml')!).toString()).toContain('<Slides>3</Slides>');
    const deck = readDeck(bytes);
    expect(deck.declared).toBe(3);
    expect(deck.slides).toEqual([
      { n: 1, text: true, picture: false },
      { n: 2, text: false, picture: true },
      { n: 3, text: false, picture: false },
    ]);
    expect(() => readDeck(Buffer.from('not a zip at all'))).toThrow('not a zip archive');
  });
});

describe.skipIf(!python)('which decks a deck task delivered, and their previews', () => {
  test("the task's .pptx Deliverables when it names them, else the decks under artifacts/decks/, else any .pptx under artifacts/; the previews beside a deck or in its project's svg_final", () => {
    makeDeck(join(cwd, 'artifacts', 'decks', 'pitch.pptx'), ['text']);
    mkdirSync(join(cwd, 'artifacts', 'decks', 'pitch', 'exports'), { recursive: true });
    makeDeck(join(cwd, 'artifacts', 'decks', 'pitch', 'exports', 'pitch_20261102.pptx'), ['text']);
    mkdirSync(join(cwd, 'artifacts', 'decks', 'pitch', 'svg_final'), { recursive: true });
    for (const n of ['P02', 'P01', 'P10']) writeFileSync(join(cwd, 'artifacts', 'decks', 'pitch', 'svg_final', `${n}.svg`), `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720"><rect width="1280" height="720" fill="#eee"/><text x="40" y="80" font-size="40">${n}</text></svg>`);
    expect(deckFiles(cwd, task(['artifacts/decks/pitch.pptx'])).map((p) => p.slice(cwd.length + 1))).toEqual(['artifacts/decks/pitch.pptx']);
    expect(deckFiles(cwd, task(['../outside.pptx'])).map((p) => p.slice(cwd.length + 1))).toEqual(['artifacts/decks/intro.pptx', 'artifacts/decks/pitch.pptx']);
    expect(deckPreviews(join(cwd, 'artifacts', 'decks', 'pitch.pptx')).map((p) => p.slice(cwd.length + 1))).toEqual(['artifacts/decks/pitch/svg_final/P01.svg', 'artifacts/decks/pitch/svg_final/P02.svg', 'artifacts/decks/pitch/svg_final/P10.svg']);
    expect(deckPreviews(join(cwd, 'artifacts', 'decks', 'pitch', 'exports', 'pitch_20261102.pptx')).length).toBe(3);
    expect(deckPreviews(join(cwd, 'artifacts', 'decks', 'intro.pptx'))).toEqual([]);
  });
});

describe.skipIf(!python)('the deck check', () => {
  test('fails without opening anything when no deck was delivered, and records it', async () => {
    events.length = 0;
    const r = await runDeckCheck(engine, goal, task(['artifacts/decks/missing.pptx']), 'a1', check, join(home, 'empty-ws'));
    expect(r.status).toBe('fail');
    expect(r.summary).toContain('no deck was delivered: no .pptx under decks/');
    expect(events.map((e) => e.type)).toEqual(['deck.checked']);
  });

  test("counts the slides, refuses an empty slide, runs the skill's delivery check and renders the previews", async () => {
    events.length = 0;
    // a stand-in for the skill's scripts/pptx_delivery_check.py: refuses a deck whose name says so
    const skillDir = join(home, 'skill');
    mkdirSync(join(skillDir, 'scripts'), { recursive: true });
    writeFileSync(join(skillDir, 'scripts', 'pptx_delivery_check.py'), 'import json, sys\nbad = "refused" in sys.argv[1]\nprint(json.dumps({"status": "failed" if bad else "passed", "errors": [{"message": "a hidden slide"}] if bad else [], "advisories": []}))\nsys.exit(1 if bad else 0)\n');
    makeDeck(join(cwd, 'artifacts', 'decks', 'refused.pptx'), ['text', 'text']);
    const r = await runDeckCheck(engine, goal, task(['artifacts/decks/pitch.pptx', 'artifacts/decks/intro.pptx', 'artifacts/decks/refused.pptx']), 'a2', check, cwd, { python, skillDir });
    expect(r.status).toBe('fail');
    expect(r.summary).toContain('✓ artifacts/decks/pitch.pptx — 1 slide(s)');
    expect(r.summary).toContain('✗ artifacts/decks/intro.pptx — 3 slide(s)');
    expect(r.summary).toContain('slide 3 is empty');
    expect(r.summary).toContain('✗ artifacts/decks/refused.pptx');
    expect(r.summary).toContain("the skill's delivery check refused the deck (exit 1, failed): a hidden slide");
    const ev = events.at(-1)!.payload as { status: string; decks: { file: string; slides: number; previews: { file: string; shot: string | null }[]; errors: string[] }[] };
    expect(ev.status).toBe('fail');
    const pitch = ev.decks.find((d) => d.file === 'artifacts/decks/pitch.pptx')!;
    expect(pitch.errors).toEqual([]);
    expect(pitch.previews.map((p) => p.file)).toEqual(['artifacts/decks/pitch/svg_final/P01.svg', 'artifacts/decks/pitch/svg_final/P02.svg', 'artifacts/decks/pitch/svg_final/P10.svg']);
    if (browser) {
      expect(pitch.previews.every((p) => p.shot)).toBe(true);
      expect(existsSync(join(screenshotsDir(home, goal), pitch.previews[0]!.shot!))).toBe(true);
      expect(r.summary).toContain('3/3 preview(s) rendered');
    } else expect(r.summary).toContain('Chromium is not installed');
    // the deck that passes alone makes a passing check, with the delivery check named
    const ok = await runDeckCheck(engine, goal, task(['artifacts/decks/pitch.pptx']), 'a3', check, cwd, { python, skillDir });
    expect(ok.status).toBe('pass');
    expect(ok.summary).toContain("1 deck(s) opened, with their slides and the skill's delivery check passed.");
  }, 90_000);
});

describe("a milestone's evidence of a deck task", () => {
  test('lists the previews the deck check last rendered, one caption per slide', () => {
    const store = {
      listByGoalOfTypes: () => [
        { type: 'deck.checked', payload: { taskId: 't1', decks: [{ file: 'artifacts/decks/old.pptx', previews: [{ file: 'a.svg', shot: 'old.png' }] }] } },
        { type: 'deck.checked', payload: { taskId: 't1', decks: [{ file: 'artifacts/decks/pitch.pptx', previews: [{ file: 'a.svg', shot: 'p1.png' }, { file: 'b.svg', shot: null }, { file: 'c.svg', shot: 'p3.png' }] }] } },
      ],
    } as never;
    expect(deckShots(store, 'g1', 't1')).toEqual([
      { file: 'p1.png', caption: 'pitch.pptx — slide 1' },
      { file: 'p3.png', caption: 'pitch.pptx — slide 3' },
    ]);
    expect(deckShots(store, 'g1', 't9')).toEqual([]);
  });
});

describe("what the reviewers read of a deck task's checks", () => {
  test('the latest result of each deck check under the review section', () => {
    const store = new EventStore(openDatabase(':memory:'));
    const c: Check = { id: 'c_deck', goalId: 'g1', taskId: 't1', name: DECK_CHECK_NAME, tier: 'must', spec: { type: 'deck' } };
    store.append({ type: 'check.created', goalId: 'g1', payload: { check: c } });
    const result = (id: string, status: 'pass' | 'fail', summary: string, at: string) => ({ id, checkId: 'c_deck', goalId: 'g1', taskId: 't1', attemptId: 'a1', status, summary, rawRef: null, durationMs: 1, at });
    store.append({ type: 'check.finished', goalId: 'g1', payload: { result: result('r1', 'fail', 'no deck was delivered', '2026-11-02T00:00:01.000Z') } });
    store.append({ type: 'check.finished', goalId: 'g1', payload: { result: result('r2', 'pass', '1 deck(s) opened.\n✓ artifacts/decks/pitch.pptx — 12 slide(s)', '2026-11-02T00:00:02.000Z') } });
    const lines = deckCheckLines(store.db, 'g1');
    expect(lines).toEqual(['- t1: pass — 1 deck(s) opened.\n✓ artifacts/decks/pitch.pptx — 12 slide(s)']);
    expect(deckReviewSection('# Deck review', lines)).toContain("The deck checks' results (the previews' paths are in them; open the PNGs with the Read tool):\n- t1: pass");
    expect(deckReviewSection('# Deck review', [])).toBe('# Deck review');
  });
});
