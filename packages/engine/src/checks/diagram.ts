import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import type { Check, CheckResult, Goal, Task } from '@foundry/core';
import { IdPrefix, listCheckResultsByGoal, listChecks, listTasks, newId } from '@foundry/core';
import type { Database } from 'bun:sqlite';
import type { Engine } from '../engine.ts';
import type { EventStore } from '@foundry/core';
import { ARTIFACTS_DIR, screenshotsDir } from '../workspace.ts';

/** the shot the diagram check last took of each of a task's pages, as a milestone's evidence lists them */
export function diagramShots(store: Pick<EventStore, 'listByGoalOfTypes'>, goalId: string, taskId: string): { file: string; caption: string }[] {
  const last = store
    .listByGoalOfTypes(goalId, ['diagram.checked'])
    .filter((e) => (e.payload as { taskId: string }).taskId === taskId)
    .at(-1);
  if (!last) return [];
  const pages = (last.payload as { pages: { file: string; screenshot: string | null }[] }).pages;
  return pages.flatMap((p) => (p.screenshot ? [{ file: p.screenshot, caption: `${p.file} — as Foundry opened it` }] : []));
}

/**
 * The diagram checks' latest results of a goal, or of one task: what a reviewer reads in place of a diff — whether each
 * page drew and passed the skill's self-check, and the paths of Foundry's screenshots of it.
 */
export function diagramCheckLines(db: Database, goalId: string, taskId?: string): string[] {
  const titles = new Map(listTasks(db, goalId).map((t) => [t.id, t.title]));
  const results = listCheckResultsByGoal(db, goalId);
  return listChecks(db, goalId)
    .filter((c) => c.spec.type === 'diagram' && (!taskId || c.taskId === taskId))
    .flatMap((c) => {
      const last = results.filter((r) => r.checkId === c.id).sort((a, b) => a.at.localeCompare(b.at)).at(-1);
      return last ? [`- ${c.taskId ? titles.get(c.taskId) ?? c.taskId : 'goal'}: ${last.status} — ${last.summary}`] : [];
    });
}

/** a reviewer's diagram section with the checks' results under it; the section alone when no check has run yet */
export function diagramReviewSection(base: string, lines: string[]): string {
  return lines.length ? `${base}\n\nThe diagram checks' results (the screenshots' paths are in them; open the PNGs with the Read tool):\n${lines.join('\n')}` : base;
}

/** the name of the engine-made must check of a diagram task: its pages open, draw and pass the skill's self-check */
export const DIAGRAM_CHECK_NAME = 'Diagram pages render';

/** where a diagram's pages are looked for when the task names none: the repository's diagram folders, then the worker's artifacts */
const PAGE_DIRS = ['docs/diagrams', 'diagrams', ARTIFACTS_DIR];
/** where Foundry's own PNG render of each diagram goes: under artifacts/, so it lands in the goal workspace and the output folder */
const PNG_DIR = `${ARTIFACTS_DIR}/diagrams`;

/** the diagram pages a task delivered: its `.html` Deliverables (committed, or under artifacts/), else every page under docs/diagrams/, diagrams/ or artifacts/ (two levels deep, dot folders left out) */
export function diagramPages(cwd: string, task: Pick<Task, 'delivers'>): string[] {
  const named = (task.delivers ?? []).filter((p) => /\.html?$/i.test(p) && !p.split('/').includes('..')).map((p) => join(cwd, p)).filter((p) => existsSync(p));
  if (named.length) return named;
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
  for (const dir of PAGE_DIRS) if (existsSync(join(cwd, dir))) walk(join(cwd, dir), 1);
  return out.sort();
}

const slug = (p: string) => basename(p).replace(/\.html?$/i, '').replace(/[^\w-]+/g, '-').slice(0, 40) || 'diagram';

/** a console error that is only a web font the page could not fetch (no network here): noted, never a failure */
const FONT_ONLY = /fonts\.googleapis\.com|fonts\.gstatic\.com|net::ERR_(INTERNET_DISCONNECTED|NAME_NOT_RESOLVED|CONNECTION|ADDRESS_UNREACHABLE)/;

/** run the skill's own self-check on a page: null when there is none to run; else the lines it refused the page with (empty = passed) */
async function selfCheck(script: string | null, page: string, timeoutMs: number): Promise<string[] | null> {
  if (!script || !existsSync(script)) return null;
  const python = Bun.which('python3') ?? Bun.which('python');
  if (!python) return null;
  const proc = Bun.spawn([python, '-I', script, page], { stdout: 'pipe', stderr: 'pipe', cwd: dirname(page) });
  const timer = setTimeout(() => proc.kill(), timeoutMs);
  try {
    const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    const code = await proc.exited;
    if (code === 0) return [];
    const lines = `${out}\n${err}`.split('\n').map((l) => l.trim()).filter(Boolean);
    return [`self-check refused the page (exit ${code}): ${lines.slice(-6).join(' | ').slice(0, 600) || 'no output'}`];
  } finally {
    clearTimeout(timer);
  }
}

export interface DiagramCheckOpts {
  /** the diagram skill's scripts/self_check.py as installed for the goal's coding agent; null = not installed, so not run */
  selfCheck?: string | null;
}

/**
 * Open each page a diagram task delivered in headless Chromium, over file://, screenshot it and render its SVG to a PNG
 * under artifacts/diagrams/: the task fails when a page throws, logs an error (a web font it could not fetch is only noted),
 * has no `<svg>`, or the diagram skill's own self-check refuses it. No LLM. The result is a normal CheckResult; a
 * `diagram.checked` event carries the shots for the goal's page.
 */
export async function runDiagramCheck(engine: Engine, goal: Goal, task: Task, attemptId: string | null, check: Check, cwd: string, opts: DiagramCheckOpts = {}): Promise<CheckResult> {
  const { store, config } = engine;
  const t0 = Date.now();
  const pages = diagramPages(cwd, task);
  const shots: { file: string; screenshot: string | null; png: string | null; errors: string[] }[] = [];
  const notes: string[] = [];
  let status: CheckResult['status'] = 'error';
  let summary = '';
  const done = (): CheckResult => {
    store.append({ type: 'diagram.checked', goalId: goal.id, payload: { taskId: task.id, attemptId, status: status === 'skipped' ? 'error' : status, pages: shots, summary } });
    return { id: newId(IdPrefix.checkResult), checkId: check.id, goalId: goal.id, taskId: task.id, attemptId, status, summary, rawRef: null, durationMs: Date.now() - t0, at: new Date().toISOString() };
  };
  if (!pages.length) {
    status = 'fail';
    summary = `no diagram page was delivered: no .html under ${PAGE_DIRS.join('/, ')}/ (the task's \`delivers\` names where the page goes)`;
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
    mkdirSync(join(cwd, PNG_DIR), { recursive: true });
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-');
    for (const [i, abs] of pages.entries()) {
      const errors: string[] = [];
      // 2× pixels: the PNG is for slides and link cards, as the skill's own exporter makes it
      const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
      try {
        page.on('console', (m) => {
          if (m.type() !== 'error') return;
          const text = m.text().slice(0, 300);
          if (FONT_ONLY.test(text)) notes.push(`${relative(cwd, abs)}: a web font could not be fetched (${text.slice(0, 120)})`);
          else errors.push(`console: ${text}`);
        });
        page.on('pageerror', (e) => errors.push(`page error: ${String(e.message ?? e).slice(0, 300)}`));
        await page.goto(`file://${abs}`, { waitUntil: 'load', timeout: 30_000 });
        // the fonts, when they come; the drawing is there without them
        await Promise.race([page.evaluate(() => (document as unknown as { fonts?: { ready: Promise<unknown> } }).fonts?.ready).catch(() => {}), new Promise((r) => setTimeout(r, 4_000))]);
        await page.waitForTimeout(500);
        const seen = await page.evaluate(() => {
          const svg = document.querySelector('svg');
          const box = svg?.viewBox?.baseVal;
          return { drew: !!svg, viewBox: box ? { w: box.width, h: box.height } : null };
        });
        if (!seen.drew) errors.push('the page has no svg');
        else if (seen.viewBox && !(seen.viewBox.w > 0 && seen.viewBox.h > 0)) errors.push(`the svg's viewBox is empty (${seen.viewBox.w}×${seen.viewBox.h})`);
        const name = `diagram-${task.id}-${stamp}-${i + 1}-${slug(abs)}.png`;
        await page.screenshot({ path: join(dir, name), fullPage: false });
        let png: string | null = null;
        if (seen.drew) {
          const rel = `${PNG_DIR}/${slug(abs)}.png`;
          await page.locator('svg').first().screenshot({ path: join(cwd, rel) });
          png = rel;
        }
        const refused = await selfCheck(opts.selfCheck ?? null, abs, 60_000);
        if (refused?.length) errors.push(...refused);
        shots.push({ file: relative(cwd, abs), screenshot: name, png, errors });
      } catch (err) {
        errors.push(`could not open: ${String((err as Error).message ?? err).slice(0, 200)}`);
        shots.push({ file: relative(cwd, abs), screenshot: null, png: null, errors });
      } finally {
        await page.close().catch(() => {});
      }
    }
    const failed = shots.filter((s) => s.errors.length);
    status = failed.length ? 'fail' : 'pass';
    summary = shots
      .map((s) => `${s.errors.length ? '✗' : '✓'} ${s.file}${s.screenshot ? ` — screenshot ${join(dir, s.screenshot)}` : ''}${s.png ? `, PNG ${s.png}` : ''}${s.errors.length ? `\n  ${s.errors.join('\n  ')}` : ''}`)
      .join('\n');
    if (!failed.length) summary = `${shots.length} page(s) opened headless, drew without script errors${opts.selfCheck && existsSync(opts.selfCheck) ? " and passed the skill's self-check" : ''}.\n${summary}`;
    if (notes.length) summary += `\n${[...new Set(notes)].slice(0, 3).join('\n')}`;
  } catch (err) {
    status = 'error';
    summary = String((err as Error).message ?? err);
  } finally {
    await browser?.close().catch(() => {});
  }
  return done();
}
