import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import type { Check, CheckResult, Goal, Task } from '@foundry/core';
import { IdPrefix, listCheckResultsByGoal, listChecks, listTasks, newId } from '@foundry/core';
import type { Database } from 'bun:sqlite';
import type { Engine } from '../engine.ts';
import type { EventStore } from '@foundry/core';
import { ARTIFACTS_DIR, screenshotsDir } from '../workspace.ts';
import { readDeck } from './zip.ts';

/** the PNGs the deck check last rendered of a task's decks' previews, as a milestone's evidence lists them */
export function deckShots(store: Pick<EventStore, 'listByGoalOfTypes'>, goalId: string, taskId: string): { file: string; caption: string }[] {
  const last = store
    .listByGoalOfTypes(goalId, ['deck.checked'])
    .filter((e) => (e.payload as { taskId: string }).taskId === taskId)
    .at(-1);
  if (!last) return [];
  const decks = (last.payload as { decks: { file: string; previews: { file: string; shot: string | null }[] }[] }).decks;
  return decks.flatMap((d) => d.previews.flatMap((p, i) => (p.shot ? [{ file: p.shot, caption: `${basename(d.file)} — slide ${i + 1}` }] : [])));
}

/**
 * The deck checks' latest results of a goal, or of one task: what a reviewer reads in place of a diff — how many slides
 * each deck has, whether the skill's delivery check passed, and the paths of the previews Foundry rendered.
 */
export function deckCheckLines(db: Database, goalId: string, taskId?: string): string[] {
  const titles = new Map(listTasks(db, goalId).map((t) => [t.id, t.title]));
  const results = listCheckResultsByGoal(db, goalId);
  return listChecks(db, goalId)
    .filter((c) => c.spec.type === 'deck' && (!taskId || c.taskId === taskId))
    .flatMap((c) => {
      const last = results.filter((r) => r.checkId === c.id).sort((a, b) => a.at.localeCompare(b.at)).at(-1);
      return last ? [`- ${c.taskId ? titles.get(c.taskId) ?? c.taskId : 'goal'}: ${last.status} — ${last.summary}`] : [];
    });
}

/** a reviewer's deck section with the checks' results under it; the section alone when no check has run yet */
export function deckReviewSection(base: string, lines: string[]): string {
  return lines.length ? `${base}\n\nThe deck checks' results (the previews' paths are in them; open the PNGs with the Read tool):\n${lines.join('\n')}` : base;
}

/** the name of the engine-made must check of a deck task: its decks open, have their slides and pass the skill's delivery check */
export const DECK_CHECK_NAME = 'Deck opens and has its slides';

/** the most previews rendered for one deck */
const MAX_PREVIEWS = 60;

/** the decks a task delivered: its `.pptx` Deliverables under the workspace, else the decks under artifacts/decks/, else any .pptx under artifacts/ (four levels deep, dot folders left out) */
export function deckFiles(cwd: string, task: Pick<Task, 'delivers'>): string[] {
  const named = (task.delivers ?? []).filter((p) => /\.pptx$/i.test(p) && !p.split('/').includes('..')).map((p) => join(cwd, p)).filter((p) => existsSync(p));
  if (named.length) return named;
  const found: string[] = [];
  const walk = (d: string, depth: number) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      const p = join(d, e.name);
      if (e.isDirectory()) {
        if (depth < 4) walk(p, depth + 1);
      } else if (e.isFile() && /\.pptx$/i.test(e.name)) found.push(p);
    }
  };
  const top = join(cwd, ARTIFACTS_DIR, 'decks');
  if (existsSync(top)) for (const e of readdirSync(top, { withFileTypes: true })) if (e.isFile() && /\.pptx$/i.test(e.name)) found.push(join(top, e.name));
  if (found.length) return found.sort();
  if (existsSync(join(cwd, ARTIFACTS_DIR))) walk(join(cwd, ARTIFACTS_DIR), 1);
  return found.sort();
}

/** the per-slide previews the skill left beside a deck: <deck's folder>/<deck name>/svg_final/*.svg, or the project's svg_final when the deck sits in its exports/ */
export function deckPreviews(deck: string): string[] {
  const name = basename(deck).replace(/\.pptx$/i, '');
  const dirs = [join(dirname(deck), name, 'svg_final'), ...(basename(dirname(deck)) === 'exports' ? [join(dirname(dirname(deck)), 'svg_final')] : [])];
  const dir = dirs.find((d) => existsSync(d));
  if (!dir) return [];
  return readdirSync(dir)
    .filter((f) => /\.svg$/i.test(f))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((f) => join(dir, f));
}

const slug = (p: string) => basename(p).replace(/\.pptx$/i, '').replace(/[^\w-]+/g, '-').slice(0, 40) || 'deck';

/** the delivery check's JSON report, when its output holds one */
function parseReport(out: string): { status?: string; errors?: unknown[]; advisories?: unknown[] } | null {
  const at = out.indexOf('{');
  if (at < 0) return null;
  try {
    return JSON.parse(out.slice(at)) as { status?: string; errors?: unknown[]; advisories?: unknown[] };
  } catch {
    return null;
  }
}

/** the skill's own delivery check on a deck: null when there is none to run; else what it refused the deck with (empty = passed) */
async function deliveryCheck(python: string | null, script: string | null, deck: string, timeoutMs: number): Promise<string[] | null> {
  if (!python || !script || !existsSync(script) || !existsSync(python)) return null;
  const proc = Bun.spawn([python, '-I', script, deck], { stdout: 'pipe', stderr: 'pipe', cwd: dirname(script) });
  const timer = setTimeout(() => proc.kill(), timeoutMs);
  try {
    const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    const code = await proc.exited;
    const report = parseReport(out);
    if (code === 0 && report?.status !== 'failed') return [];
    const said = (report?.errors ?? []).slice(0, 4).map((e: unknown) => (typeof e === 'string' ? e : ((e as { message?: string }).message ?? JSON.stringify(e)))).join(' | ');
    return [`the skill's delivery check refused the deck (exit ${code}${report?.status ? `, ${report.status}` : ''}): ${(said || `${out}\n${err}`.trim().split('\n').slice(-4).join(' | ')).slice(0, 600) || 'no output'}`];
  } finally {
    clearTimeout(timer);
  }
}

export interface DeckCheckOpts {
  /** the python of the deck skill's environment, for its delivery check; null = not made, so not run */
  python?: string | null;
  /** the deck skill's folder as installed; null = not installed */
  skillDir?: string | null;
}

/**
 * Open each deck a deck task delivered: read the PPTX (a zip), fail the task on a deck that is not one, has no slides or
 * has an empty slide (no text and no picture), run the deck skill's own delivery check on it when the skill's Python
 * environment is there, and render the per-slide previews the skill left beside it (svg_final/) to PNGs in the goal's
 * screenshots folder for the person and the reviewers. No LLM. The result is a normal CheckResult; a `deck.checked`
 * event carries the slide counts and the previews for the goal's page.
 */
export async function runDeckCheck(engine: Engine, goal: Goal, task: Task, attemptId: string | null, check: Check, cwd: string, opts: DeckCheckOpts = {}): Promise<CheckResult> {
  const { store, config } = engine;
  const t0 = Date.now();
  const decks = deckFiles(cwd, task);
  const seen: { file: string; slides: number; previews: { file: string; shot: string | null }[]; errors: string[] }[] = [];
  const notes: string[] = [];
  let status: CheckResult['status'] = 'error';
  let summary = '';
  const done = (): CheckResult => {
    store.append({ type: 'deck.checked', goalId: goal.id, payload: { taskId: task.id, attemptId, status: status === 'skipped' ? 'error' : status, decks: seen, summary } });
    return { id: newId(IdPrefix.checkResult), checkId: check.id, goalId: goal.id, taskId: task.id, attemptId, status, summary, rawRef: null, durationMs: Date.now() - t0, at: new Date().toISOString() };
  };
  if (!decks.length) {
    status = 'fail';
    summary = `no deck was delivered: no .pptx under ${ARTIFACTS_DIR}/decks/ (the task's \`delivers\` names where the deck goes)`;
    return done();
  }
  const script = opts.skillDir ? join(opts.skillDir, 'scripts', 'pptx_delivery_check.py') : null;
  let browser: import('playwright').Browser | null = null;
  const dir = screenshotsDir(config.dataDir, goal);
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-');
  try {
    for (const abs of decks) {
      const errors: string[] = [];
      let slides = 0;
      try {
        const contents = readDeck(readFileSync(abs));
        slides = contents.slides.length;
        if (!slides) errors.push('the deck has no slides');
        for (const s of contents.slides) if (!s.text && !s.picture) errors.push(`slide ${s.n} is empty (no text and no picture)`);
        if (contents.declared !== null && contents.declared !== slides) notes.push(`${relative(cwd, abs)}: docProps says ${contents.declared} slide(s), the package holds ${slides}`);
      } catch (err) {
        errors.push(`could not read the deck: ${String((err as Error).message ?? err).slice(0, 200)}`);
      }
      if (!errors.length) {
        const refused = await deliveryCheck(opts.python ?? null, script, abs, 120_000);
        if (refused?.length) errors.push(...refused);
      }
      const previews: { file: string; shot: string | null }[] = [];
      const svgs = deckPreviews(abs).slice(0, MAX_PREVIEWS);
      if (svgs.length) {
        if (!browser) {
          const pw = await import('playwright').catch(() => null);
          browser = pw ? await pw.chromium.launch().catch(() => null) : null;
          if (!browser) notes.push('the previews were not rendered: Chromium is not installed (Settings → Preview & self-check → Install Chromium)');
        }
        for (const [i, svg] of svgs.entries()) {
          let shot: string | null = null;
          if (browser) {
            const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
            try {
              await page.goto(`file://${svg}`, { waitUntil: 'load', timeout: 30_000 });
              await page.waitForTimeout(300);
              const box = await page.evaluate(() => {
                const r = document.documentElement.getBoundingClientRect();
                return { w: Math.ceil(r.width), h: Math.ceil(r.height) };
              });
              const name = `deck-${task.id}-${stamp}-${slug(abs)}-${String(i + 1).padStart(2, '0')}.png`;
              if (box.w > 0 && box.h > 0) await page.screenshot({ path: join(dir, name), clip: { x: 0, y: 0, width: Math.min(box.w, 4000), height: Math.min(box.h, 4000) } });
              else await page.screenshot({ path: join(dir, name), fullPage: true });
              shot = name;
            } catch (err) {
              notes.push(`${relative(cwd, svg)}: could not render (${String((err as Error).message ?? err).slice(0, 120)})`);
            } finally {
              await page.close().catch(() => {});
            }
          }
          previews.push({ file: relative(cwd, svg), shot });
        }
      } else notes.push(`${relative(cwd, abs)}: no per-slide previews beside it (the skill's svg_final/ folder): the reviewers have only the slide count`);
      seen.push({ file: relative(cwd, abs), slides, previews, errors });
    }
    const failed = seen.filter((s) => s.errors.length);
    status = failed.length ? 'fail' : 'pass';
    summary = seen
      .map((s) => `${s.errors.length ? '✗' : '✓'} ${s.file} — ${s.slides} slide(s)${s.previews.length ? `, ${s.previews.filter((p) => p.shot).length}/${s.previews.length} preview(s) rendered to ${dir}` : ''}${s.errors.length ? `\n  ${s.errors.join('\n  ')}` : ''}`)
      .join('\n');
    if (!failed.length) summary = `${seen.length} deck(s) opened, with their slides${opts.python && script && existsSync(script) && existsSync(opts.python) ? " and the skill's delivery check passed" : ''}.\n${summary}`;
    if (notes.length) summary += `\n${[...new Set(notes)].slice(0, 4).join('\n')}`;
  } catch (err) {
    status = 'error';
    summary = String((err as Error).message ?? err);
  } finally {
    await browser?.close().catch(() => {});
  }
  return done();
}
