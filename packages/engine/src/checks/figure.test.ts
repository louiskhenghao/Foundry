import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Check, Goal, Task } from '@foundry/core';
import { EventStore, openDatabase } from '@foundry/core';
import type { Engine } from '../engine.ts';
import { screenshotsDir } from '../workspace.ts';
import { FIGURE_CHECK_NAME, figureCheckLines, figurePages, figureReviewSection, figureShots, runFigureCheck } from './figure.ts';
import { playwrightStatus } from './selfcheck.ts';

/** Foundry's render check of a figure task's pages (ADR-0076): what it opens, and what it says */
let home: string;
let cwd: string;
const events: { type: string; payload: unknown }[] = [];
const goal = { id: 'g_fig', workspaceDir: null } as unknown as Goal;
const engine = { store: { append: (e: { type: string; payload: unknown }) => events.push(e) }, config: { dataDir: '' } } as unknown as Engine;
const check: Check = { id: 'c1', goalId: goal.id, taskId: 't1', name: FIGURE_CHECK_NAME, tier: 'must', spec: { type: 'figure' } };
const task = (delivers: string[] = []) => ({ id: 't1', delivers } as unknown as Task);
const page = (name: string, body: string) => {
  mkdirSync(join(cwd, 'artifacts'), { recursive: true });
  writeFileSync(join(cwd, 'artifacts', name), `<!doctype html><html><head><meta charset="utf-8"><title>${name}</title></head><body>${body}</body></html>`);
};
const browser = (await playwrightStatus()).browser;

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), 'foundry-figure-check-'));
  (engine.config as { dataDir: string }).dataDir = home;
  cwd = join(home, 'ws');
  mkdirSync(cwd, { recursive: true });
});
afterAll(() => rmSync(home, { recursive: true, force: true }));

describe('which pages a figure task delivered', () => {
  test("the task's .html Deliverables under artifacts/ when it names them, else every page under artifacts/ (dot folders left out)", () => {
    page('kettle.html', '<svg></svg>');
    page('draft.html', '<svg></svg>');
    mkdirSync(join(cwd, 'artifacts', '.history', 'v1'), { recursive: true });
    writeFileSync(join(cwd, 'artifacts', '.history', 'v1', 'old.html'), '<svg></svg>');
    mkdirSync(join(cwd, 'artifacts', 'more'), { recursive: true });
    writeFileSync(join(cwd, 'artifacts', 'more', 'lamp.htm'), '<svg></svg>');
    expect(figurePages(cwd, task(['artifacts/kettle.html', 'docs/artifacts/kettle.md'])).map((p) => p.slice(cwd.length + 1))).toEqual(['artifacts/kettle.html']);
    expect(figurePages(cwd, task()).map((p) => p.slice(cwd.length + 1))).toEqual(['artifacts/draft.html', 'artifacts/kettle.html', 'artifacts/more/lamp.htm']);
    // a Deliverable that is not there yet falls back to the scan, so a misnamed page is still looked at
    expect(figurePages(cwd, task(['artifacts/missing.html'])).length).toBe(3);
    rmSync(join(cwd, 'artifacts'), { recursive: true, force: true });
  });
});

describe('the figure check', () => {
  test('fails without opening a browser when no page was delivered, and records it', async () => {
    events.length = 0;
    const r = await runFigureCheck(engine, goal, task(['artifacts/kettle.html']), 'a1', check, cwd);
    expect(r.status).toBe('fail');
    expect(r.summary).toContain('no figure page was delivered');
    expect(r).toMatchObject({ checkId: 'c1', goalId: goal.id, taskId: 't1', attemptId: 'a1', rawRef: null });
    expect(events.map((e) => e.type)).toEqual(['figure.checked']);
    expect((events[0]!.payload as { pages: unknown[]; status: string }).pages).toEqual([]);
  });

  test.skipIf(!browser)('opens each page headless: one that draws passes with a screenshot, a Colorfigures page gets its see-through shot too, one that throws or draws nothing fails', async () => {
    events.length = 0;
    page('kettle.html', '<svg width="10" height="10"></svg><script>window.mountFigure = function () {}; document.documentElement.setAttribute("data-errors", "")</script>');
    page('broken.html', '<svg></svg><script>throw new Error("no such part")</script>');
    page('blank.html', '<p>nothing drawn</p>');
    const r = await runFigureCheck(engine, goal, task(['artifacts/kettle.html', 'artifacts/broken.html', 'artifacts/blank.html']), 'a2', check, cwd);
    expect(r.status).toBe('fail');
    expect(r.summary).toContain('✓ artifacts/kettle.html');
    expect(r.summary).toContain('✗ artifacts/broken.html');
    expect(r.summary).toContain('page error: no such part');
    expect(r.summary).toContain('✗ artifacts/blank.html');
    expect(r.summary).toContain('drew nothing');
    const ev = events.at(-1)!.payload as { status: string; pages: { file: string; screenshot: string | null; inside: string | null; errors: string[] }[] };
    expect(ev.status).toBe('fail');
    const kettle = ev.pages.find((p) => p.file === 'artifacts/kettle.html')!;
    expect(kettle.errors).toEqual([]);
    expect(kettle.screenshot).toMatch(/^figure-t1-.*-1-kettle\.png$/);
    expect(kettle.inside).toMatch(/-inside\.png$/);
    const dir = screenshotsDir(home, goal);
    expect(existsSync(join(dir, kettle.screenshot!))).toBe(true);
    expect(existsSync(join(dir, kettle.inside!))).toBe(true);
    expect(ev.pages.find((p) => p.file === 'artifacts/broken.html')!.inside).toBeNull();
    // the pages that pass alone make a passing check
    rmSync(join(cwd, 'artifacts', 'broken.html'));
    rmSync(join(cwd, 'artifacts', 'blank.html'));
    const ok = await runFigureCheck(engine, goal, task(['artifacts/kettle.html']), 'a3', check, cwd);
    expect(ok.status).toBe('pass');
    expect(ok.summary).toContain('1 page(s) opened headless and drew without script errors');
  }, 60_000);
});

describe("a milestone's evidence of a figure task", () => {
  test('lists the shots the figure check last took, the see-through after the closed object', () => {
    const store = {
      listByGoalOfTypes: () => [
        { type: 'figure.checked', payload: { taskId: 't1', pages: [{ file: 'artifacts/old.html', screenshot: 'old.png', inside: null }] } },
        { type: 'figure.checked', payload: { taskId: 't2', pages: [{ file: 'artifacts/other.html', screenshot: 'other.png', inside: null }] } },
        { type: 'figure.checked', payload: { taskId: 't1', pages: [{ file: 'artifacts/kettle.html', screenshot: 'k.png', inside: 'k-inside.png' }, { file: 'artifacts/lamp.html', screenshot: null, inside: null }] } },
      ],
    } as never;
    expect(figureShots(store, 'g1', 't1')).toEqual([
      { file: 'k.png', caption: 'artifacts/kettle.html — as Foundry opened it' },
      { file: 'k-inside.png', caption: 'artifacts/kettle.html — see-through' },
    ]);
    expect(figureShots(store, 'g1', 't3')).toEqual([]);
  });
});

describe("what the reviewers read of a figure task's checks", () => {
  test('the latest result of each figure check, with its screenshots, under the review section', () => {
    const store = new EventStore(openDatabase(':memory:'));
    const fig: Check = { id: 'c_fig', goalId: 'g1', taskId: 't1', name: FIGURE_CHECK_NAME, tier: 'must', spec: { type: 'figure' } };
    const cmd: Check = { id: 'c_cmd', goalId: 'g1', taskId: 't1', name: 'Delivers artifacts/kettle.html', tier: 'must', spec: { type: 'command', cmd: 'test -e artifacts/kettle.html', timeoutMs: 1000, expectExitCode: 0 } };
    store.append({ type: 'check.created', goalId: 'g1', payload: { check: fig } });
    store.append({ type: 'check.created', goalId: 'g1', payload: { check: cmd } });
    const result = (id: string, status: 'pass' | 'fail', summary: string, at: string) => ({ id, checkId: 'c_fig', goalId: 'g1', taskId: 't1', attemptId: 'a1', status, summary, rawRef: null, durationMs: 1, at });
    store.append({ type: 'check.finished', goalId: 'g1', payload: { result: result('r1', 'fail', 'no figure page was delivered', '2026-10-25T00:00:01.000Z') } });
    store.append({ type: 'check.finished', goalId: 'g1', payload: { result: result('r2', 'pass', '1 page(s) opened headless and drew without script errors.\n✓ artifacts/kettle.html — screenshot /shots/figure-1-kettle.png', '2026-10-25T00:00:02.000Z') } });
    const lines = figureCheckLines(store.db, 'g1');
    expect(lines).toEqual(['- t1: pass — 1 page(s) opened headless and drew without script errors.\n✓ artifacts/kettle.html — screenshot /shots/figure-1-kettle.png']);
    expect(figureCheckLines(store.db, 'g1', 't2')).toEqual([]);
    expect(figureReviewSection('# Figure review', lines)).toContain("The figure checks' results (the screenshots' paths are in them; open the PNGs with the Read tool):\n- t1: pass");
    expect(figureReviewSection('# Figure review', [])).toBe('# Figure review');
  });
});
