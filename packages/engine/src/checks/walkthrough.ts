import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { getGoal, getTask, listAttempts, type Goal, type Task } from '@foundry/core';
import type { Engine } from '../engine.ts';
import { boundarySettings } from '../guards/boundary.ts';
import { CAD_VIEWER_KEY, type PreviewAppStatus } from '../preview/manager.ts';
import { metaFor, modelFor } from '../models/roles.ts';
import { ARTIFACTS_DIR, goalWorkspacePath, listArtifacts, screenshotsDir } from '../workspace.ts';
import { runMilestoneScript, type ScriptDeps } from './milestone-script.ts';

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
  /** the milestone's Playwright script, when a script recorded it */
  script?: string | null;
  /** pass: it showed the milestone; fail: the script failed or nothing could be shown; unverified: only fake data could be shown */
  status?: 'pass' | 'fail' | 'unverified';
  /** one video per scripted test */
  clips?: { file: string; caption: string }[];
  /** text a script attached: an API's responses */
  outputs?: { file: string; caption: string }[];
  /** the script runner's output */
  log?: string | null;
  /** the walkthrough Foundry planned, replayed as it is on a rerun */
  steps?: z.infer<typeof WalkStep>[];
  /** recorded by the final walkthrough */
  final?: boolean;
}

export interface CaptureOptions {
  /** the final walkthrough's run */
  final?: boolean;
  /** replay the walkthrough recorded last time instead of planning a new one (a rerun) */
  replay?: boolean;
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

/** captures of one goal run one after another: two milestones landing together are both recorded, in order */
const queues = new Map<string, Promise<unknown>>();
/** the milestones (task ids) of each goal being recorded or waiting their turn */
const pending = new Map<string, string[]>();

/** every recording still running or queued, for a shutdown to wait on (bounded by the caller) */
export function milestoneQueues(): Promise<unknown>[] {
  return [...queues.values()];
}

/** the milestones of a goal being recorded now or waiting their turn */
export function milestoneRunsFor(goalId: string): string[] {
  return [...(pending.get(goalId) ?? [])];
}

/** how a scripted milestone's script is run; tests replace it */
export const scriptDeps: { current: ScriptDeps | undefined } = { current: undefined };

/** tasks whose deliverables are files under artifacts/ (a model and its snapshots, images, video): those files show the milestone */
export const FILE_SCENARIOS: readonly string[] = ['cad', 'image', 'video'];

/**
 * Record what a milestone looks like, after any recording of the same goal still running: by its Playwright script when
 * it has one; by the files it produced when its deliverables are files (a model's snapshots, images, video), since there
 * is no app to walk; else by a walkthrough Foundry plans (or replays). The result is a `milestone.evidence` event. Never throws.
 */
export function captureMilestone(engine: Engine, goal: Goal, task: Task, opts: CaptureOptions = {}): Promise<MilestoneEvidence | null> {
  pending.set(goal.id, [...(pending.get(goal.id) ?? []), task.id]);
  const next = (queues.get(goal.id) ?? Promise.resolve())
    .catch(() => {})
    .then(() => {
      // the goal and the task as they are now: a script that changed while this waited is the one run
      const g = getGoal(engine.store.db, goal.id) ?? goal;
      const t = getTask(engine.store.db, task.id) ?? task;
      if (t.milestoneScript) return captureScripted(engine, g, t, opts);
      return FILE_SCENARIOS.includes(t.scenario) ? captureFiles(engine, g, t, opts) : captureWalk(engine, g, t, opts);
    })
    .catch(() => null)
    .finally(() => {
      const left = [...(pending.get(goal.id) ?? [])];
      left.splice(left.indexOf(task.id), 1);
      if (left.length) pending.set(goal.id, left);
      else pending.delete(goal.id);
    });
  queues.set(goal.id, next);
  void next.finally(() => {
    if (queues.get(goal.id) === next) queues.delete(goal.id);
  });
  return next;
}

/** A scripted milestone: its Playwright script runs in the goal's folder, and what it attached is the evidence. */
async function captureScripted(engine: Engine, goal: Goal, task: Task, opts: CaptureOptions): Promise<MilestoneEvidence> {
  const stamp = `${new Date().toISOString().replace(/[:.]/g, '-')}-${task.id}-`;
  const run = await runMilestoneScript(engine, goal, task, stamp, scriptDeps.current);
  const evidence: MilestoneEvidence = {
    taskId: task.id,
    video: null,
    clips: run.clips,
    shots: run.shots,
    outputs: run.outputs,
    summary: run.summary,
    error: run.error,
    script: task.milestoneScript,
    status: run.status,
    log: run.log,
    ...(opts.final ? { final: true } : {}),
  };
  engine.store.append({ type: 'milestone.evidence', goalId: goal.id, payload: evidence });
  engine.config.log(`[milestone] ${goal.id}: ${task.milestoneScript} ${run.status}${run.error ? ` (${run.error.split('\n')[0]})` : ''}`);
  return evidence;
}

const IMAGE = /\.(png|jpe?g|webp|gif)$/i;
const VIDEO = /\.(mp4|webm|mov)$/i;
const MODEL = /\.(step|stp|stl|3mf|glb|dxf)$/i;
const VIEW = '(front|back|top|bottom|left|right|iso|isometric|opposite_iso|side|section(_[a-z]+)?|[a-z]*_?closeup)';

/** what an image shows: its file name without a view suffix, or its folder when the name is only a view (`stack/front.png` → stack) */
export function imageSubject(f: string): string {
  const parts = f.split('/');
  const stem = parts.at(-1)!.replace(/\.[^.]+$/, '');
  if (new RegExp(`^${VIEW}$`, 'i').test(stem) && parts.length > 1) return parts.at(-2)!;
  return stem.replace(new RegExp(`_${VIEW}$`, 'i'), '');
}

/**
 * How strongly a text names an image: its own path (8), else its subject (4) in the milestone's text; its path (2), else
 * its subject (1) in the task's manifest. A task can rewrite files of other parts (an assembly re-renders them), so the
 * images the milestone and the manifest are about come before the newest ones.
 */
export function imageRank(f: string, milestone: string, manifest: string): number {
  const subject = imageSubject(f);
  const named = (text: string) => text.includes(`artifacts/${f}`) || text.includes(f);
  return (named(milestone) ? 8 : milestone.includes(subject) ? 4 : 0) + (named(manifest) ? 2 : manifest.includes(subject) ? 1 : 0);
}

/**
 * A milestone whose deliverables are files: what the task left under the goal workspace's `artifacts/` — the images
 * (a model's snapshots, generated images) as screenshots, a video as a clip, the model files named in the summary. The
 * files the task wrote are those changed since its first attempt started (an integration copies only what a task
 * changed); when none can be told apart, every file of the goal shows. Copies go to the goal's screenshots folder, so
 * the milestone card and the notification channels show them like a walkthrough's.
 */
async function captureFiles(engine: Engine, goal: Goal, task: Task, opts: CaptureOptions): Promise<MilestoneEvidence> {
  const { store, config } = engine;
  const evidence: MilestoneEvidence = { taskId: task.id, video: null, shots: [], summary: '', error: null, app: null, ...(opts.final ? { final: true } : {}) };
  try {
    const ws = goalWorkspacePath(config.dataDir, goal);
    let root = join(ws, ARTIFACTS_DIR);
    let files = listArtifacts(ws);
    // a finished goal whose folder was cleaned up: the copies delivered to its output folder
    const run = goal.completion.artifactsRun;
    if (!files.length && run?.status === 'ok' && run.dest) {
      root = run.dest;
      files = run.files.filter((f) => existsSync(join(root, f)));
    }
    const since = Math.min(...listAttempts(store.db, task.id).map((a) => Date.parse(a.startedAt)).filter((n) => !Number.isNaN(n)), Number.POSITIVE_INFINITY);
    const all = files
      .filter((f) => !f.startsWith('samples/'))
      .map((f) => ({ f, at: statSync(join(root, f)).mtimeMs }));
    const mine = Number.isFinite(since) ? all.filter((x) => x.at >= since) : [];
    const pool = (mine.length ? mine : all).sort((a, b) => b.at - a.at || a.f.localeCompare(b.f));
    const dir = screenshotsDir(config.dataDir, goal);
    mkdirSync(dir, { recursive: true });
    const stamp = `${new Date().toISOString().replace(/[:.]/g, '-')}-${task.id}`;
    const copy = (f: string) => {
      const name = `${stamp}-${f.replace(/[^\w.-]+/g, '_')}`;
      copyFileSync(join(root, f), join(dir, name));
      return name;
    };
    // the images the milestone and the task's manifest name first, then the newest; shown in that order
    const manifest = (task.relevantFiles ?? [])
      .filter((f) => /^docs\/artifacts\/.+\.md$/.test(f))
      .map((f) => {
        try {
          return readFileSync(join(ws, f), 'utf8');
        } catch {
          return '';
        }
      })
      .join('\n');
    const rank = (f: string) => imageRank(f, task.milestone ?? '', manifest);
    const images = pool.filter((x) => IMAGE.test(x.f)).sort((a, b) => rank(b.f) - rank(a.f) || b.at - a.at || a.f.localeCompare(b.f)).slice(0, 8);
    evidence.shots = images.map((x) => ({ file: copy(x.f), caption: x.f }));
    const clip = pool.find((x) => VIDEO.test(x.f));
    if (clip) evidence.clips = [{ file: copy(clip.f), caption: clip.f }];
    const models = pool.filter((x) => MODEL.test(x.f)).map((x) => x.f);
    const shown = evidence.shots.length + (evidence.clips?.length ?? 0);
    evidence.summary = shown
      ? `What the task left under artifacts/: ${[...images.map((x) => x.f), ...(clip ? [clip.f] : [])].join(', ')}${models.length ? `. Models: ${models.join(', ')}` : ''}.`
      : '';
    evidence.error = shown ? null : task.scenario === 'cad' ? 'the task left no snapshots under artifacts/: there is nothing to look at' : 'the task left no images or video under artifacts/';
    evidence.status = shown ? 'pass' : 'fail';
  } catch (err) {
    evidence.error = `could not collect the task's files: ${String((err as Error).message ?? err)}`;
    evidence.status = 'fail';
  }
  store.append({ type: 'milestone.evidence', goalId: goal.id, payload: evidence });
  config.log(`[milestone] ${goal.id}: ${task.id} files ${evidence.status}${evidence.error ? ` (${evidence.error})` : ''}`);
  return evidence;
}

/** the walkthrough recorded last time for a milestone, to replay on a rerun */
function lastSteps(engine: Engine, goalId: string, taskId: string): WalkPlan | null {
  const ev = engine.store
    .listByGoalOfTypes(goalId, ['milestone.evidence'])
    .map((e) => e.payload as MilestoneEvidence)
    .filter((p) => p.taskId === taskId && p.steps?.length)
    .at(-1);
  return ev ? { steps: ev.steps!, summary: ev.summary.replace(/^With mock data, because the real app could not be shown: /, '') } : null;
}

/**
 * Show a person what a milestone looks like without them running anything: a cheap session plans a short walkthrough
 * from what the milestone asks to look at and the page's controls, then Playwright follows it in the preview, recording
 * a video and taking a screenshot at each point worth seeing. A step that cannot be done is skipped; when nothing can be
 * recorded, one screenshot of the page is kept. The result is a `milestone.evidence` event: the milestone card shows it
 * and the notification channels get it. Never throws.
 */
async function captureWalk(engine: Engine, goal: Goal, task: Task, opts: CaptureOptions): Promise<MilestoneEvidence | null> {
  const { store, config } = engine;
  const replay = opts.replay ? lastSteps(engine, goal.id, task.id) : null;
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
    // the CAD viewer is the person's to start: never the page a walkthrough records
    let app = pickApp(task, preview.apps.filter((a) => a.key !== CAD_VIEWER_KEY));
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
      if (app.ready && app.url) walk = await walkApp(engine, browser, goal, task, app, preview.apps, `${stamp}-`, videoDir, hide, replay);
      if (!walk || walk.allBroken) {
        const m = await toMock();
        if (m) {
          if (walk) discard(dir, walk);
          app = m;
          walk = await walkApp(engine, browser, goal, task, m, preview.apps, `${stamp}-mock-`, videoDir, hide, replay ?? (walk?.steps.length ? { steps: walk.steps, summary: walk.summary } : null));
          walk.mock = true;
        }
      }
      if (!walk) throw new Error(`the preview of ${app.name}${app.url ? ` at ${app.url}` : ''} did not answer${app.error ? `: ${app.error}` : ''}${mocked ? '' : '. A dev:mock script that serves it against fake data would let Foundry show it anyway'}`);
      evidence.app = app.key;
      evidence.shots = walk.shots;
      evidence.video = walk.video;
      evidence.summary = walk.mock ? `With mock data, because the real app could not be shown: ${walk.summary}` : walk.summary;
      if (walk.mock) evidence.mock = true;
      if (walk.steps.length) evidence.steps = walk.steps;
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
  }
  // fake data proves nothing about the real app: shown, but not counted as reached
  evidence.status = evidence.mock ? 'unverified' : evidence.shots.length || evidence.video ? 'pass' : 'fail';
  if (opts.final) evidence.final = true;
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
  /** the steps followed, kept so a rerun replays the same walkthrough */
  steps: z.infer<typeof WalkStep>[];
}

type Browser = import('playwright').Browser;

/**
 * One walkthrough of one app: plan it from the page, follow it with a recording, and screenshot where the plan asks.
 * A screenshot of an error page (an HTTP error, a "could not be found", a blank page) shows nothing of the milestone:
 * it is left out and counted.
 */
async function walkApp(engine: Engine, browser: Browser, goal: Goal, task: Task, app: PreviewAppStatus, apps: PreviewAppStatus[], prefix: string, videoDir: string, hide: (t: string) => string, given: WalkPlan | null = null): Promise<Walk> {
  const dir = screenshotsDir(engine.config.dataDir, goal);
  const url = app.url!;
  const out: Walk = { shots: [], video: null, summary: '', planError: null, broken: [], allBroken: false, steps: [] };
  let plan = given;
  if (!plan) {
    // what can be done on the page, for the plan
    const look = await browser.newPage({ viewport: VIEWPORT });
    await look.goto(url, { waitUntil: 'networkidle', timeout: 30_000 }).catch(() => {});
    const controls = await look.evaluate(outlineControls).catch(() => [] as string[]);
    const title = await look.title().catch(() => '');
    await look.close();
    const others = apps.filter((a) => a.key !== app.key && a.ready && a.url).map((a) => ({ name: a.name, dir: a.dir, url: a.url! }));
    plan = await planWalk(engine, goal, task, { name: app.name, dir: app.dir, url }, others, title, controls).catch((err) => {
      out.planError = `no walkthrough planned: ${String((err as Error).message ?? err).slice(0, 200)}`;
      return { steps: [], summary: '' } as WalkPlan;
    });
  }
  out.steps = plan.steps;
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
