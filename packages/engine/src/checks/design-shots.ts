/**
 * Screenshots of the result for the design comparison (ADR-0094): a frontend task of a goal that follows an attached
 * design is started from its own worktree (the preview's command detection: the package.json dev or start script with
 * the dev server's port flag), opened headless at the design's widths, shot full-page into the goal's screenshots
 * folder and stopped again — before its reviewer runs, so the reviewer judges the screens beside the design and not
 * the diff alone. The goal reviewer gets the same shots of the merged result. No LLM; nothing here fails a task: a
 * result that cannot be started is a note the reviewer reads.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Goal } from '@foundry/core';
import type { Engine } from '../engine.ts';
import { detectRun } from '../preview/detect.ts';
import { portFree } from '../preview/manager.ts';
import { killGroup } from '../proc.ts';
import { screenshotsDir } from '../workspace.ts';

/** the widths a design is compared at: the desktop most exports are drawn for, and a phone */
export const DESIGN_SHOT_WIDTHS: readonly number[] = [1440, 390];

export interface DesignShot {
  width: number;
  /** absolute path of the full-page screenshot */
  path: string;
}
export interface DesignShots {
  shots: DesignShot[];
  /** where the app answered, or null when nothing started */
  url: string | null;
  /** why there are no (or fewer) shots, for the reviewer; null when all went well */
  note: string | null;
}

const stampNow = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-');

/** a free port out of the way of previews and other worktrees, as the milestone scripts take theirs */
async function freeHighPort(): Promise<number | null> {
  for (let i = 0; i < 200; i++) {
    const p = 20_000 + Math.floor(Math.random() * 25_000);
    if (await portFree(p)) return p;
  }
  return null;
}

/** poll until the app answers at all (any HTTP status), or the time is up */
async function waitForApp(url: string, timeoutMs: number, alive: () => boolean): Promise<boolean> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (!alive()) return false;
    try {
      await fetch(url, { signal: AbortSignal.timeout(2_000) });
      return true;
    } catch {
      await Bun.sleep(500);
    }
  }
  return false;
}

/**
 * Start the app in `cwd`, screenshot it at every design width and stop it. `prefix` names the files
 * (`<prefix>-<stamp>-<width>.png`). Never throws: what went wrong is the `note`.
 */
export async function captureDesignShots(engine: Pick<Engine, 'config'>, goal: Pick<Goal, 'id' | 'workspaceDir'>, cwd: string, opts: { prefix: string; widths?: readonly number[]; startTimeoutMs?: number; log?: (line: string) => void }): Promise<DesignShots> {
  const log = opts.log ?? (() => {});
  const run = detectRun(cwd);
  if (!run?.command) return { shots: [], url: null, note: 'the result could not be started for a look: no dev or start script in package.json' };
  const port = await freeHighPort();
  if (!port) return { shots: [], url: null, note: 'no free port for a look at the result' };
  const url = (run.url ?? 'http://localhost:{port}').replace(/\{port\}/g, String(port));
  const command = `${run.install ? `${run.install} && ` : ''}${run.command.replace(/\{port\}/g, String(port))}`;
  log(`design shots: $ ${command} (PORT=${port})`);
  const proc = Bun.spawn(['sh', '-c', command], { cwd, env: { ...process.env, PORT: String(port), BROWSER: 'none', CI: '1', FORCE_COLOR: '0' }, stdin: 'ignore', stdout: 'ignore', stderr: 'pipe', detached: process.platform !== 'win32' });
  let exited = false;
  void proc.exited.then(() => (exited = true));
  const shots: DesignShot[] = [];
  let note: string | null = null;
  let browser: import('playwright').Browser | null = null;
  try {
    const up = await waitForApp(url, opts.startTimeoutMs ?? (run.install ? 180_000 : 60_000), () => !exited);
    if (!up) {
      const err = proc.stderr && typeof proc.stderr !== 'number' ? (await new Response(proc.stderr).text().catch(() => '')).slice(-400) : '';
      return { shots: [], url, note: `the result did not answer at ${url} ${exited ? 'before its process exited' : 'in time'}${err.trim() ? `: ${err.trim()}` : ''}` };
    }
    const pw = await import('playwright').catch((err) => {
      throw new Error(`Playwright is not installed (Settings → Preview & self-check): ${String((err as Error).message ?? err).slice(0, 100)}`);
    });
    browser = await pw.chromium.launch().catch((err) => {
      throw new Error(`Chromium could not start (Settings → Preview & self-check → Install Chromium): ${String((err as Error).message ?? err).slice(0, 160)}`);
    });
    const dir = screenshotsDir(engine.config.dataDir, goal);
    mkdirSync(dir, { recursive: true });
    const stamp = stampNow();
    for (const width of opts.widths ?? DESIGN_SHOT_WIDTHS) {
      const page = await browser.newPage({ viewport: { width, height: width < 700 ? 844 : 900 }, deviceScaleFactor: 1 });
      try {
        await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 }).catch(() => page.goto(url, { waitUntil: 'load', timeout: 30_000 }));
        await page.waitForTimeout(800);
        const path = join(dir, `${opts.prefix}-${stamp}-${width}.png`);
        await page.screenshot({ path, fullPage: true });
        shots.push({ width, path });
      } catch (err) {
        note = `${note ? `${note}; ` : ''}no shot at ${width}px: ${String((err as Error).message ?? err).slice(0, 160)}`;
      } finally {
        await page.close().catch(() => {});
      }
    }
    log(`design shots: ${shots.length} of ${(opts.widths ?? DESIGN_SHOT_WIDTHS).length} taken at ${url}`);
    return { shots, url, note };
  } catch (err) {
    return { shots, url, note: String((err as Error).message ?? err) };
  } finally {
    await browser?.close().catch(() => {});
    killGroup(proc);
  }
}

/**
 * The reviewer's section: the result's screens beside the design, and how to weigh what differs. '' without shots and
 * without a note (nothing was attempted).
 */
export function designComparisonSection(shots: DesignShots | null | undefined, opts: { forGoal?: boolean } = {}): string {
  if (!shots) return '';
  const what = opts.forGoal ? 'the merged result' : 'the result of this task';
  const lines = shots.shots.map((s) => `- ${s.width}px wide: ${s.path}`);
  const head = `# Design comparison\nFoundry started ${what} and photographed it${shots.url ? ` at ${shots.url}` : ''}:`;
  const rule = `Opening these screenshots is part of this review, not optional: before you judge any "Matches the design" item or anything about the look, open the 1440 shot and the design file beside it with the Read tool (it renders images), then the 390 shot, and compare page by page and section by section. A section, element or state the design shows that is missing, re-ordered or re-designed is a BLOCKER; the copy, colours, type and spacing as the design has them are the spec. A drift of a few pixels, a shade or an opacity is a NOTE, not a blocker. The phone width follows the Brief's assumptions, not the design, unless the design shows a phone. In your notes, one line per screenshot saying what you saw in it and in the design. A verdict on the design that did not open the screenshots is not a verdict: fail that item with "not compared" rather than pass it on the diff.`;
  if (!lines.length) return `${head}\n(no screenshot: ${shots.note ?? 'nothing was captured'}) Judge the design from the diff and the files instead, and say that you could not see the screens.`;
  return [head, ...lines, shots.note ? `(${shots.note})` : '', rule].filter(Boolean).join('\n');
}

/** the goal reviewer's section when a design reference file was committed as it is (ADR-0093): the port stays, the copy goes */
export function committedReferencesSection(paths: string[]): string {
  if (!paths.length) return '';
  return `# Design reference files found in the repository\nThese committed files are byte for byte one of the person's design reference files:\n${paths.map((p) => `- ${p}`).join('\n')}\nThe design is to be ported, never copied in: this is a BLOCKER until they are removed from the branch (the ported pages, styles and assets stay).`;
}
