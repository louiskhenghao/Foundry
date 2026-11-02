import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Check, Goal, Task } from '@foundry/core';
import { EventStore, openDatabase } from '@foundry/core';
import type { Engine } from '../engine.ts';
import { screenshotsDir } from '../workspace.ts';
import { DIAGRAM_CHECK_NAME, diagramCheckLines, diagramPages, diagramReviewSection, diagramShots, runDiagramCheck } from './diagram.ts';
import { playwrightStatus } from './selfcheck.ts';

/** Foundry's render check of a diagram task's pages (ADR-0083): what it opens, what it renders, and what it says */
let home: string;
let cwd: string;
const events: { type: string; payload: unknown }[] = [];
const goal = { id: 'g_dia', workspaceDir: null } as unknown as Goal;
const engine = { store: { append: (e: { type: string; payload: unknown }) => events.push(e) }, config: { dataDir: '' } } as unknown as Engine;
const check: Check = { id: 'c1', goalId: goal.id, taskId: 't1', name: DIAGRAM_CHECK_NAME, tier: 'must', spec: { type: 'diagram' } };
const task = (delivers: string[] = []) => ({ id: 't1', delivers } as unknown as Task);
const page = (rel: string, body: string) => {
  mkdirSync(join(cwd, rel, '..'), { recursive: true });
  writeFileSync(join(cwd, rel), `<!doctype html><html><head><meta charset="utf-8"><title>${rel}</title></head><body>${body}</body></html>`);
};
const browser = (await playwrightStatus()).browser;
const python = !!(Bun.which('python3') ?? Bun.which('python'));

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), 'foundry-diagram-check-'));
  (engine.config as { dataDir: string }).dataDir = home;
  cwd = join(home, 'ws');
  mkdirSync(cwd, { recursive: true });
});
afterAll(() => rmSync(home, { recursive: true, force: true }));

describe('which pages a diagram task delivered', () => {
  test("the task's .html Deliverables when it names them (anywhere inside the workspace), else every page under docs/diagrams/, diagrams/ or artifacts/", () => {
    page('docs/diagrams/arch.html', '<svg></svg>');
    page('docs/diagrams/style-guide.html', '<svg></svg>');
    page('artifacts/draft.html', '<svg></svg>');
    mkdirSync(join(cwd, 'artifacts', '.history', 'v1'), { recursive: true });
    writeFileSync(join(cwd, 'artifacts', '.history', 'v1', 'old.html'), '<svg></svg>');
    expect(diagramPages(cwd, task(['docs/diagrams/arch.html', 'docs/diagrams/arch.svg'])).map((p) => p.slice(cwd.length + 1))).toEqual(['docs/diagrams/arch.html']);
    expect(diagramPages(cwd, task(['../outside.html'])).map((p) => p.slice(cwd.length + 1))).toEqual(['artifacts/draft.html', 'docs/diagrams/arch.html', 'docs/diagrams/style-guide.html']);
    expect(diagramPages(cwd, task(['docs/diagrams/missing.html'])).length).toBe(3);
    rmSync(join(cwd, 'docs'), { recursive: true, force: true });
    rmSync(join(cwd, 'artifacts'), { recursive: true, force: true });
    expect(diagramPages(cwd, task())).toEqual([]);
  });
});

describe('the diagram check', () => {
  test('fails without opening a browser when no page was delivered, and records it', async () => {
    events.length = 0;
    const r = await runDiagramCheck(engine, goal, task(['docs/diagrams/arch.html']), 'a1', check, cwd);
    expect(r.status).toBe('fail');
    expect(r.summary).toContain('no diagram page was delivered');
    expect(r).toMatchObject({ checkId: 'c1', goalId: goal.id, taskId: 't1', attemptId: 'a1', rawRef: null });
    expect(events.map((e) => e.type)).toEqual(['diagram.checked']);
    expect((events[0]!.payload as { pages: unknown[] }).pages).toEqual([]);
  });

  test.skipIf(!browser)("opens each page headless: one with an svg passes with a screenshot and a PNG under artifacts/diagrams/, one that throws or has no svg fails; the skill's self-check refuses a page it dislikes", async () => {
    events.length = 0;
    page('docs/diagrams/arch.html', '<svg viewBox="0 0 960 600" width="960" height="600"><rect x="8" y="8" width="200" height="80" fill="#f5f5f5" stroke="#2d3142"/></svg>');
    page('docs/diagrams/broken.html', '<svg viewBox="0 0 10 10"></svg><script>throw new Error("no such node")</script>');
    page('docs/diagrams/blank.html', '<p>nothing drawn</p>');
    // a stand-in for the skill's scripts/self_check.py: refuses a page that says so
    const script = join(home, 'self_check.py');
    writeFileSync(script, 'import sys\nt = open(sys.argv[1], encoding="utf-8").read()\nif "REFUSE" in t:\n    print("FAIL: accent on five nodes")\n    sys.exit(1)\nprint("ok")\n');
    page('docs/diagrams/loud.html', '<svg viewBox="0 0 10 10"></svg><!-- REFUSE -->');
    const r = await runDiagramCheck(engine, goal, task(['docs/diagrams/arch.html', 'docs/diagrams/broken.html', 'docs/diagrams/blank.html', 'docs/diagrams/loud.html']), 'a2', check, cwd, { selfCheck: python ? script : null });
    expect(r.status).toBe('fail');
    expect(r.summary).toContain('✓ docs/diagrams/arch.html');
    expect(r.summary).toContain('PNG artifacts/diagrams/arch.png');
    expect(r.summary).toContain('✗ docs/diagrams/broken.html');
    expect(r.summary).toContain('page error: no such node');
    expect(r.summary).toContain('✗ docs/diagrams/blank.html');
    expect(r.summary).toContain('has no svg');
    if (python) expect(r.summary).toContain('self-check refused the page (exit 1): FAIL: accent on five nodes');
    const ev = events.at(-1)!.payload as { status: string; pages: { file: string; screenshot: string | null; png: string | null; errors: string[] }[] };
    expect(ev.status).toBe('fail');
    const arch = ev.pages.find((p) => p.file === 'docs/diagrams/arch.html')!;
    expect(arch.errors).toEqual([]);
    expect(arch.screenshot).toMatch(/^diagram-t1-.*-1-arch\.png$/);
    expect(arch.png).toBe('artifacts/diagrams/arch.png');
    expect(existsSync(join(screenshotsDir(home, goal), arch.screenshot!))).toBe(true);
    expect(existsSync(join(cwd, 'artifacts', 'diagrams', 'arch.png'))).toBe(true);
    expect(ev.pages.find((p) => p.file === 'docs/diagrams/blank.html')!.png).toBeNull();
    // the pages that pass alone make a passing check
    const ok = await runDiagramCheck(engine, goal, task(['docs/diagrams/arch.html']), 'a3', check, cwd, { selfCheck: python ? script : null });
    expect(ok.status).toBe('pass');
    expect(ok.summary).toContain(`1 page(s) opened headless, drew without script errors${python ? " and passed the skill's self-check" : ''}.`);
  }, 90_000);
});

describe("a milestone's evidence of a diagram task", () => {
  test('lists the shots the diagram check last took', () => {
    const store = {
      listByGoalOfTypes: () => [
        { type: 'diagram.checked', payload: { taskId: 't1', pages: [{ file: 'docs/diagrams/old.html', screenshot: 'old.png', png: null }] } },
        { type: 'diagram.checked', payload: { taskId: 't1', pages: [{ file: 'docs/diagrams/arch.html', screenshot: 'a.png', png: 'artifacts/diagrams/arch.png' }, { file: 'docs/diagrams/flow.html', screenshot: null, png: null }] } },
      ],
    } as never;
    expect(diagramShots(store, 'g1', 't1')).toEqual([{ file: 'a.png', caption: 'docs/diagrams/arch.html — as Foundry opened it' }]);
    expect(diagramShots(store, 'g1', 't3')).toEqual([]);
  });
});

describe("what the reviewers read of a diagram task's checks", () => {
  test('the latest result of each diagram check under the review section', () => {
    const store = new EventStore(openDatabase(':memory:'));
    const dia: Check = { id: 'c_dia', goalId: 'g1', taskId: 't1', name: DIAGRAM_CHECK_NAME, tier: 'must', spec: { type: 'diagram' } };
    store.append({ type: 'check.created', goalId: 'g1', payload: { check: dia } });
    const result = (id: string, status: 'pass' | 'fail', summary: string, at: string) => ({ id, checkId: 'c_dia', goalId: 'g1', taskId: 't1', attemptId: 'a1', status, summary, rawRef: null, durationMs: 1, at });
    store.append({ type: 'check.finished', goalId: 'g1', payload: { result: result('r1', 'fail', 'no diagram page was delivered', '2026-11-02T00:00:01.000Z') } });
    store.append({ type: 'check.finished', goalId: 'g1', payload: { result: result('r2', 'pass', '1 page(s) opened headless.\n✓ docs/diagrams/arch.html — screenshot /shots/diagram-1-arch.png', '2026-11-02T00:00:02.000Z') } });
    const lines = diagramCheckLines(store.db, 'g1');
    expect(lines).toEqual(['- t1: pass — 1 page(s) opened headless.\n✓ docs/diagrams/arch.html — screenshot /shots/diagram-1-arch.png']);
    expect(diagramCheckLines(store.db, 'g1', 't2')).toEqual([]);
    expect(diagramReviewSection('# Diagram review', lines)).toContain("The diagram checks' results (the screenshots' paths are in them; open the PNGs with the Read tool):\n- t1: pass");
    expect(diagramReviewSection('# Diagram review', [])).toBe('# Diagram review');
  });
});
