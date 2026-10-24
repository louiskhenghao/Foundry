import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Check, Goal, Task } from '@foundry/core';
import type { Engine } from '../engine.ts';
import { screenshotsDir } from '../workspace.ts';
import { FIGURE_CHECK_NAME, figurePages, runFigureCheck } from './figure.ts';
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
