import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import type { Check, CheckResult, Goal, Task } from '@foundry/core';
import { IdPrefix, listCheckResultsByGoal, listChecks, listTasks, newId } from '@foundry/core';
import type { Database } from 'bun:sqlite';
import type { Engine } from '../engine.ts';
import type { EventStore } from '@foundry/core';
import { ARTIFACTS_DIR, screenshotsDir } from '../workspace.ts';

/** the shots the figure check last took of a task's pages (the closed object, then a Colorfigures page's see-through), as a milestone's evidence lists them */
export function figureShots(store: Pick<EventStore, 'listByGoalOfTypes'>, goalId: string, taskId: string): { file: string; caption: string }[] {
  const last = store
    .listByGoalOfTypes(goalId, ['figure.checked'])
    .filter((e) => (e.payload as { taskId: string }).taskId === taskId)
    .at(-1);
  if (!last) return [];
  const pages = (last.payload as { pages: { file: string; screenshot: string | null; inside: string | null }[] }).pages;
  return pages.flatMap((p) => [...(p.screenshot ? [{ file: p.screenshot, caption: `${p.file} — as Foundry opened it` }] : []), ...(p.inside ? [{ file: p.inside, caption: `${p.file} — see-through` }] : [])]);
}

/**
 * The figure checks' latest results of a goal, or of one task: what a reviewer reads in place of a diff — whether each
 * page drew, and the paths of Foundry's screenshots of it (the goal's screenshots folder is added to the session).
 */
export function figureCheckLines(db: Database, goalId: string, taskId?: string): string[] {
  const titles = new Map(listTasks(db, goalId).map((t) => [t.id, t.title]));
  const results = listCheckResultsByGoal(db, goalId);
  return listChecks(db, goalId)
    .filter((c) => c.spec.type === 'figure' && (!taskId || c.taskId === taskId))
    .flatMap((c) => {
      const last = results.filter((r) => r.checkId === c.id).sort((a, b) => a.at.localeCompare(b.at)).at(-1);
      return last ? [`- ${c.taskId ? titles.get(c.taskId) ?? c.taskId : 'goal'}: ${last.status} — ${last.summary}`] : [];
    });
}

/** a reviewer's figure section with the checks' results under it; the section alone when no check has run yet */
export function figureReviewSection(base: string, lines: string[]): string {
  return lines.length ? `${base}\n\nThe figure checks' results (the screenshots' paths are in them; open the PNGs with the Read tool):\n${lines.join('\n')}` : base;
}

/** the name of the engine-made must check of a figure task: its pages open and draw */
export const FIGURE_CHECK_NAME = 'Figure pages render';

/** the figure pages a task delivered: its `.html` Deliverables under artifacts/, else every page under artifacts/ (two levels deep, dot folders left out) */
export function figurePages(cwd: string, task: Pick<Task, 'delivers'>): string[] {
  const dir = join(cwd, ARTIFACTS_DIR);
  const named = (task.delivers ?? []).filter((p) => /\.html?$/i.test(p) && p.startsWith(`${ARTIFACTS_DIR}/`)).map((p) => join(cwd, p)).filter((p) => existsSync(p));
  if (named.length) return named;
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (d: string, depth: number) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      const p = join(d, e.name);
      if (e.isDirectory()) {
        if (depth < 2) walk(p, depth + 1);
      } else if (e.isFile() && /\.html?$/i.test(e.name)) out.push(p);
    }
  };
  walk(dir, 1);
  return out.sort();
}

const slug = (p: string) => basename(p).replace(/\.html?$/i, '').replace(/[^\w-]+/g, '-').slice(0, 40) || 'figure';

/**
 * Open each page a figure task delivered in headless Chromium, over file://, and screenshot it: the task fails when a
 * page throws, logs an error, reports errors on `<html data-errors>` (Colorfigures' engine does) or drew nothing (no svg
 * or canvas). No LLM. A second shot with `?xr=1&labels=1` records a Colorfigures page's see-through. The result is a
 * normal CheckResult; a `figure.checked` event carries the shots for the goal's page.
 */
export async function runFigureCheck(engine: Engine, goal: Goal, task: Task, attemptId: string | null, check: Check, cwd: string): Promise<CheckResult> {
  const { store, config } = engine;
  const t0 = Date.now();
  const pages = figurePages(cwd, task);
  const shots: { file: string; screenshot: string | null; inside: string | null; errors: string[] }[] = [];
  let status: CheckResult['status'] = 'error';
  let summary = '';
  const done = (): CheckResult => {
    store.append({ type: 'figure.checked', goalId: goal.id, payload: { taskId: task.id, attemptId, status: status === 'skipped' ? 'error' : status, pages: shots, summary } });
    return { id: newId(IdPrefix.checkResult), checkId: check.id, goalId: goal.id, taskId: task.id, attemptId, status, summary, rawRef: null, durationMs: Date.now() - t0, at: new Date().toISOString() };
  };
  if (!pages.length) {
    status = 'fail';
    summary = `no figure page was delivered: no .html under ${ARTIFACTS_DIR}/ (the task's \`delivers\` names where the page goes)`;
    return done();
  }
  let browser: import('playwright').Browser | null = null;
  try {
    const pw = await import('playwright').catch((err) => {
      throw new Error(`Playwright is not installed (Settings → Preview & self-check): ${String((err as Error).message ?? err).slice(0, 100)}`);
    });
    browser = await pw.chromium.launch().catch((err) => {
      throw new Error(`Chromium could not start (Settings → Preview & self-check → Install Chromium): ${String((err as Error).message ?? err).slice(0, 160)}`);
    });
    const dir = screenshotsDir(config.dataDir, goal);
    mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-');
    for (const [i, abs] of pages.entries()) {
      const errors: string[] = [];
      const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 1 });
      try {
        page.on('console', (m) => {
          if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 300)}`);
        });
        page.on('pageerror', (e) => errors.push(`page error: ${String(e.message ?? e).slice(0, 300)}`));
        const url = `file://${abs}`;
        await page.goto(url, { waitUntil: 'load', timeout: 30_000 });
        await page.waitForTimeout(1500);
        const seen = await page.evaluate(() => ({
          drew: !!document.querySelector('svg, canvas'),
          dataErrors: document.documentElement.getAttribute('data-errors') ?? '',
          colorfigures: typeof (window as unknown as { mountFigure?: unknown }).mountFigure === 'function',
        }));
        if (!seen.drew) errors.push('the page drew nothing (no svg or canvas)');
        if (seen.dataErrors.trim()) errors.push(`data-errors: ${seen.dataErrors.slice(0, 300)}`);
        const name = `figure-${task.id}-${stamp}-${i + 1}-${slug(abs)}.png`;
        await page.screenshot({ path: join(dir, name), fullPage: false });
        let inside: string | null = null;
        if (seen.colorfigures) {
          await page.goto(`${url}?xr=1&labels=1`, { waitUntil: 'load', timeout: 30_000 });
          await page.waitForTimeout(1500);
          inside = name.replace(/\.png$/, '-inside.png');
          await page.screenshot({ path: join(dir, inside), fullPage: false });
        }
        shots.push({ file: relative(cwd, abs), screenshot: name, inside, errors });
      } catch (err) {
        errors.push(`could not open: ${String((err as Error).message ?? err).slice(0, 200)}`);
        shots.push({ file: relative(cwd, abs), screenshot: null, inside: null, errors });
      } finally {
        await page.close().catch(() => {});
      }
    }
    const failed = shots.filter((s) => s.errors.length);
    status = failed.length ? 'fail' : 'pass';
    summary = shots
      .map((s) => `${s.errors.length ? '✗' : '✓'} ${s.file}${s.screenshot ? ` — screenshot ${join(dir, s.screenshot)}${s.inside ? `, see-through ${join(dir, s.inside)}` : ''}` : ''}${s.errors.length ? `\n  ${s.errors.join('\n  ')}` : ''}`)
      .join('\n');
    if (!failed.length) summary = `${shots.length} page(s) opened headless and drew without script errors.\n${summary}`;
  } catch (err) {
    status = 'error';
    summary = String((err as Error).message ?? err);
  } finally {
    await browser?.close().catch(() => {});
  }
  return done();
}
