import { mkdirSync, mkdtempSync, renameSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { Goal, Task } from '@foundry/core';
import type { Engine } from '../engine.ts';
import { boundarySettings } from '../guards/boundary.ts';
import type { PreviewAppStatus } from '../preview/manager.ts';
import { metaFor, modelFor } from '../models/roles.ts';
import { screenshotsDir } from '../workspace.ts';

export const WALK_MAX_BUDGET_USD = 0.5;
const VIEWPORT = { width: 1280, height: 800 };
const STEP_TIMEOUT_MS = 6_000;

/** one step of a milestone walkthrough, the way a person would try the result */
export const WalkStep = z.object({
  action: z.enum(['goto', 'click', 'fill', 'press', 'wait', 'shot']),
  /** goto: a path or URL; click: the visible text or accessible name; fill: the field's label or placeholder */
  target: z.string().default(''),
  /** click: the element's role when known (button, link, tab, menuitem, checkbox…) */
  role: z.string().nullable().default(null),
  /** fill: the text to type; press: the key (Enter, Escape…); wait: milliseconds */
  value: z.string().default(''),
  /** shot: what the screenshot shows, one line for the person looking */
  caption: z.string().default(''),
});
export const WalkPlan = z.object({ steps: z.array(WalkStep).max(16), summary: z.string() });
export type WalkPlan = z.infer<typeof WalkPlan>;

export interface MilestoneEvidence {
  taskId: string;
  /** file names under the goal's screenshots folder */
  video: string | null;
  shots: { file: string; caption: string }[];
  summary: string;
  error: string | null;
  /** the preview app walked through */
  app?: string | null;
  /** the app ran its mock command (fake data) because the real one could not be shown */
  mock?: boolean;
}

/**
 * The app a milestone is about: the one whose folder holds most of the task's files (a monorepo's shop, not its
 * admin), else the first app. Null when the preview has none.
 */
export function pickApp(task: Pick<Task, 'relevantFiles'>, apps: PreviewAppStatus[]): PreviewAppStatus | null {
  const score = (a: PreviewAppStatus) => (a.dir ? (task.relevantFiles ?? []).filter((f) => f === a.dir || f.startsWith(`${a.dir.replace(/\/+$/, '')}/`)).length : 0);
  return [...apps].sort((a, b) => score(b) - score(a))[0] ?? null;
}

/** what a page that shows nothing of the milestone says: an HTTP error, an error page, or nothing at all */
const ERROR_TEXT = /\b(404|500|502|503)\b|could not be found|page not found|not found|internal server error|application error|bad gateway|ECONNREFUSED|cannot GET|unhandled runtime error/i;
export function pageProblem(status: number | null, text: string): string | null {
  if (status != null && status >= 400) return `HTTP ${status}`;
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return 'a blank page';
  if (t.length < 500 && ERROR_TEXT.test(t)) return `an error page ("${t.slice(0, 60)}")`;
  return null;
}

const capturing = new Set<string>();

/**
 * Show a person what a milestone looks like without them running anything: a cheap session plans a short walkthrough
 * from what the milestone asks to look at and the page's controls, then Playwright follows it in the preview, recording
 * a video and taking a screenshot at each point worth seeing. A step that cannot be done is skipped; when nothing can be
 * recorded, one screenshot of the page is kept. The result is a `milestone.evidence` event: the milestone card shows it
 * and the notification channels get it. Never throws.
 */
export async function captureMilestone(engine: Engine, goal: Goal, task: Task): Promise<MilestoneEvidence | null> {
  if (capturing.has(goal.id)) return null;
  capturing.add(goal.id);
  const { store, config } = engine;
  const evidence: MilestoneEvidence = { taskId: task.id, video: null, shots: [], summary: '', error: null };
  const dir = screenshotsDir(config.dataDir, goal);
  const stamp = `${new Date().toISOString().replace(/[:.]/g, '-')}-${task.id}`;
  const hide = engine.preview.redactorFor(goal);
  const videoDir = mkdtempSync(join(tmpdir(), 'foundry-walk-'));
  let mocked: string | null = null;
  try {
    mkdirSync(dir, { recursive: true });
    // keys the app needs that only the person's checkout has: taken before the apps start
    const imported = engine.preview.importMissingEnv(goal);
    if (imported.length) store.append({ type: 'engine.note', goalId: goal.id, payload: { level: 'info', message: `milestone walkthrough: took ${imported.length} environment variable(s) the app needs from your checkout's env files (${imported.join(', ')})` } });
    const preview = await engine.preview.start(goal, 'milestone');
    let app = pickApp(task, preview.apps);
    if (!app) throw new Error('the preview has no app to look at');
    const pw = await import('playwright').catch(() => {
      throw new Error('Playwright is not installed (Settings → Preview & self-check)');
    });
    const browser = await pw.chromium.launch().catch(() => {
      throw new Error("Chromium is not installed (Settings → Preview & self-check → Install Chromium)");
    });
    try {
      // the real app first; when it does not answer, or shows only error pages, the same app against fake data
      const toMock = async (): Promise<PreviewAppStatus | null> => {
        const m = await engine.preview.startMock(goal, app!.key).catch(() => null);
        if (m) mocked = m.key;
        return m?.ready && m.url ? m : null;
      };
      let walk: Walk | null = null;
      if (app.ready && app.url) walk = await walkApp(engine, browser, goal, task, app, preview.apps, `${stamp}-`, videoDir, hide);
      if (!walk || walk.allBroken) {
        const m = await toMock();
        if (m) {
          if (walk) discard(dir, walk);
          app = m;
          walk = await walkApp(engine, browser, goal, task, m, preview.apps, `${stamp}-mock-`, videoDir, hide);
          walk.mock = true;
        }
      }
      if (!walk) throw new Error(`the preview of ${app.name}${app.url ? ` at ${app.url}` : ''} did not answer${app.error ? `: ${app.error}` : ''}${mocked ? '' : '. A dev:mock script that serves it against fake data would let Foundry show it anyway'}`);
      evidence.app = app.key;
      evidence.shots = walk.shots;
      evidence.video = walk.video;
      evidence.summary = walk.mock ? `With mock data, because the real app could not be shown: ${walk.summary}` : walk.summary;
      if (walk.mock) evidence.mock = true;
      const left = walk.broken.length ? `${walk.broken.length} screenshot(s) showed ${[...new Set(walk.broken)].slice(0, 2).join(', ')} and were left out` : null;
      const tail = walk.allBroken ? `: the preview is not showing the milestone${walk.mock || mocked ? '' : ' (a dev:mock script that serves the app against fake data would let Foundry show it anyway)'}` : '';
      evidence.error = [walk.planError, left ? `${left}${tail}` : null].filter(Boolean).join('; ') || null;
    } finally {
      await browser.close().catch(() => {});
    }
  } catch (err) {
    evidence.error = hide(String((err as Error).message ?? err)).slice(0, 300);
  } finally {
    if (mocked) await engine.preview.stopMock(goal, mocked).catch(() => {});
    rmSync(videoDir, { recursive: true, force: true });
    capturing.delete(goal.id);
  }
  store.append({ type: 'milestone.evidence', goalId: goal.id, payload: evidence });
  config.log(`[milestone] ${goal.id}: ${evidence.shots.length} screenshot(s)${evidence.video ? ' and a video' : ''}${evidence.error ? ` (${evidence.error})` : ''}`);
  return evidence;
}

interface Walk {
  shots: { file: string; caption: string }[];
  video: string | null;
  summary: string;
  planError: string | null;
  /** why each left-out screenshot showed nothing of the milestone */
  broken: string[];
  /** every screenshot was an error page: nothing of the milestone was seen */
  allBroken: boolean;
  mock?: boolean;
}

type Browser = import('playwright').Browser;

/**
 * One walkthrough of one app: plan it from the page, follow it with a recording, and screenshot where the plan asks.
 * A screenshot of an error page (an HTTP error, a "could not be found", a blank page) shows nothing of the milestone:
 * it is left out and counted.
 */
async function walkApp(engine: Engine, browser: Browser, goal: Goal, task: Task, app: PreviewAppStatus, apps: PreviewAppStatus[], prefix: string, videoDir: string, hide: (t: string) => string): Promise<Walk> {
  const dir = screenshotsDir(engine.config.dataDir, goal);
  const url = app.url!;
  const out: Walk = { shots: [], video: null, summary: '', planError: null, broken: [], allBroken: false };
  // what can be done on the page, for the plan
  const look = await browser.newPage({ viewport: VIEWPORT });
  await look.goto(url, { waitUntil: 'networkidle', timeout: 30_000 }).catch(() => {});
  const controls = await look.evaluate(outlineControls).catch(() => [] as string[]);
  const title = await look.title().catch(() => '');
  await look.close();
  const others = apps.filter((a) => a.key !== app.key && a.ready && a.url).map((a) => ({ name: a.name, dir: a.dir, url: a.url! }));
  const plan = await planWalk(engine, goal, task, { name: app.name, dir: app.dir, url }, others, title, controls).catch((err) => {
    out.planError = `no walkthrough planned: ${String((err as Error).message ?? err).slice(0, 200)}`;
    return { steps: [], summary: '' } as WalkPlan;
  });
  out.summary = hide(plan.summary);
  const ctx = await browser.newContext({ viewport: VIEWPORT, recordVideo: { dir: videoDir, size: VIEWPORT } });
  const page = await ctx.newPage();
  // the status of the page's last navigation: a 404 route is an error page whatever it renders
  let status: number | null = null;
  page.on('response', (r) => {
    if (r.request().isNavigationRequest() && r.frame() === page.mainFrame()) status = r.status();
  });
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(800);
  const shoot = async (caption: string) => {
    const file = `${prefix}${String(out.shots.length + out.broken.length + 1).padStart(2, '0')}.png`;
    await page.screenshot({ path: join(dir, file) });
    const problem = pageProblem(status, await page.evaluate(() => document.body?.innerText ?? '').catch(() => ''));
    if (problem) {
      out.broken.push(`${problem} at ${new URL(page.url()).pathname}`);
      try {
        unlinkSync(join(dir, file));
      } catch {}
      return;
    }
    out.shots.push({ file, caption: hide(caption).slice(0, 200) });
  };
  for (const step of plan.steps) {
    try {
      await runStep(page, url, step);
      if (step.action === 'shot') await shoot(step.caption || step.target);
    } catch {
      // a control that is not there or a page that changed: the walkthrough goes on
    }
  }
  if (!out.shots.length && !out.broken.length) await shoot(task.milestone ?? task.title);
  out.allBroken = !out.shots.length && out.broken.length > 0;
  const video = page.video();
  await ctx.close();
  const recorded = video ? await video.path().catch(() => null) : null;
  // a recording of error pages shows nothing either
  if (recorded && plan.steps.length && !out.allBroken) {
    out.video = `${prefix}walk.webm`;
    renameSync(recorded, join(dir, out.video));
  }
  return out;
}

/** a walkthrough replaced by another (the mock run): its files go */
function discard(dir: string, walk: Walk): void {
  for (const f of [...walk.shots.map((s) => s.file), ...(walk.video ? [walk.video] : [])]) {
    try {
      unlinkSync(join(dir, f));
    } catch {}
  }
}

/** the page's visible controls, one line each, for the planning session (runs in the browser) */
function outlineControls(): string[] {
  const out: string[] = [];
  const els = document.querySelectorAll('a[href], button, input, textarea, select, [role=button], [role=link], [role=tab], [role=menuitem], [role=checkbox], h1, h2, h3');
  for (const el of Array.from(els)) {
    const box = (el as HTMLElement).getBoundingClientRect();
    if (!box.width || !box.height) continue;
    const tag = el.tagName.toLowerCase();
    const label = (el.getAttribute('aria-label') || (el as HTMLInputElement).placeholder || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    const extra = tag === 'a' ? ` → ${el.getAttribute('href')}` : tag === 'input' ? ` (${(el as HTMLInputElement).type})` : '';
    if (label || extra) out.push(`${el.getAttribute('role') || tag}: ${label}${extra}`);
    if (out.length >= 80) break;
  }
  return out;
}

type Page = import('playwright').Page;

async function runStep(page: Page, base: string, step: z.infer<typeof WalkStep>): Promise<void> {
  const t = { timeout: STEP_TIMEOUT_MS };
  switch (step.action) {
    case 'goto':
      await page.goto(new URL(step.target || '/', base).toString(), { waitUntil: 'networkidle', timeout: 20_000 });
      break;
    case 'click': {
      const byRole = step.role ? page.getByRole(step.role as Parameters<Page['getByRole']>[0], { name: step.target }) : null;
      await (byRole ?? page.getByText(step.target)).first().click(t);
      await page.waitForLoadState('networkidle', t).catch(() => {});
      break;
    }
    case 'fill':
      await page.getByLabel(step.target).or(page.getByPlaceholder(step.target)).first().fill(step.value, t);
      break;
    case 'press':
      await page.keyboard.press(step.value || 'Enter');
      await page.waitForLoadState('networkidle', t).catch(() => {});
      break;
    case 'wait':
      await page.waitForTimeout(Math.min(Number(step.value) || 1000, 4000));
      break;
    case 'shot':
      await page.waitForTimeout(400);
      break;
  }
}

type AppRef = { name: string; dir: string; url: string };

async function planWalk(engine: Engine, goal: Goal, task: Task, app: AppRef, others: AppRef[], title: string, controls: string[]): Promise<WalkPlan> {
  const { config } = engine;
  const where = (a: AppRef) => `${a.name}${a.dir ? ` (${a.dir})` : ''}: ${a.url}`;
  const prompt = [
    `# What to show\nThe milestone "${task.title}" of the goal "${goal.title}" landed. The person would check:\n${task.milestone ?? task.spec.slice(0, 600)}`,
    `# The running app\n${where(app)}${title ? ` — "${title}"` : ''}\nPaths in \`goto\` are on this app. Controls on its first page:\n${controls.length ? controls.map((c) => `- ${c}`).join('\n') : '(none found)'}${others.length ? `\n\nThe goal's other apps also run (\`goto\` a full URL to use one):\n${others.map((o) => `- ${where(o)}`).join('\n')}` : ''}`,
    `# Your job\nPlan a short walkthrough (at most 12 steps) that a person would do in a browser to see this milestone working, so a recording can show it instead of them. Use only what the page offers: click controls by their visible text (role when known), fill fields by label or placeholder with realistic sample values, go to paths you know exist. Put a \`shot\` step, with a one-line caption, at each moment worth seeing; end with one. Never sign in with real credentials, delete data, pay, or send messages. \`summary\`: one sentence on what the walkthrough shows. You cannot browse; answer with the plan only.`,
  ].join('\n\n');
  const model = modelFor(config, goal, 'feedback');
  const handle = await engine.runner.run({
    prompt,
    cwd: screenshotsDir(config.dataDir, goal),
    model: model.model,
    meta: metaFor(goal.id, model),
    permissionMode: 'dontAsk',
    allowedTools: [],
    jsonSchema: zodToJsonSchema(WalkPlan, { $refStrategy: 'none' }),
    settings: boundarySettings(config.hooksDir),
    settingSources: config.settingSources,
    maxTurns: 3,
    maxBudgetUsd: WALK_MAX_BUDGET_USD,
    timeoutMs: 3 * 60_000,
    transcriptPath: join(config.dataDir, 'transcripts', `walkthrough-${goal.id}-${Date.now()}.jsonl`),
    label: `milestone walkthrough ${goal.title}`,
  });
  for await (const _ of handle.events) {
    /* the plan is the result; nothing to show live */
  }
  const r = await handle.result;
  engine.store.append({ type: 'goal.cost_added', goalId: goal.id, payload: { costUsd: r.costUsd, source: 'walkthrough' } });
  engine.recordSessionUsage(r, { goalId: goal.id, kind: 'walkthrough', model: model.model });
  if (r.isError || r.structuredOutput == null) throw new Error(`the session returned no plan${r.errorMessage ? ` (${r.errorMessage.slice(0, 120)})` : ''}`);
  const plan = WalkPlan.safeParse(r.structuredOutput);
  if (!plan.success) throw new Error('the session returned a plan Foundry could not read');
  return plan.data;
}
