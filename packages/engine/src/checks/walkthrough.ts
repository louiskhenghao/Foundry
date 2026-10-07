import { mkdirSync, mkdtempSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { Goal, Task } from '@foundry/core';
import type { Engine } from '../engine.ts';
import { boundarySettings } from '../guards/boundary.ts';
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
  try {
    mkdirSync(dir, { recursive: true });
    const preview = await engine.preview.start(goal, 'milestone');
    if (!preview.url || !preview.ready) throw new Error(`the preview${preview.url ? ` at ${preview.url}` : ''} did not answer`);
    const pw = await import('playwright').catch(() => {
      throw new Error('Playwright is not installed (Settings → Preview & self-check)');
    });
    const browser = await pw.chromium.launch().catch(() => {
      throw new Error("Chromium is not installed (Settings → Preview & self-check → Install Chromium)");
    });
    try {
      // what can be done on the page, for the plan
      const look = await browser.newPage({ viewport: VIEWPORT });
      await look.goto(preview.url, { waitUntil: 'networkidle', timeout: 30_000 }).catch(() => {});
      const controls = await look.evaluate(outlineControls).catch(() => [] as string[]);
      const title = await look.title().catch(() => '');
      await look.close();
      const plan = await planWalk(engine, goal, task, preview.url, title, controls).catch((err) => {
        evidence.error = `no walkthrough planned: ${String((err as Error).message ?? err).slice(0, 200)}`;
        return { steps: [], summary: '' } as WalkPlan;
      });
      evidence.summary = hide(plan.summary);
      const ctx = await browser.newContext({ viewport: VIEWPORT, recordVideo: { dir: videoDir, size: VIEWPORT } });
      const page = await ctx.newPage();
      await page.goto(preview.url, { waitUntil: 'networkidle', timeout: 30_000 }).catch(() => {});
      await page.waitForTimeout(800);
      const shoot = async (caption: string) => {
        const file = `${stamp}-${String(evidence.shots.length + 1).padStart(2, '0')}.png`;
        await page.screenshot({ path: join(dir, file) });
        evidence.shots.push({ file, caption: hide(caption).slice(0, 200) });
      };
      for (const step of plan.steps) {
        try {
          await runStep(page, preview.url, step);
          if (step.action === 'shot') await shoot(step.caption || step.target);
        } catch {
          // a control that is not there or a page that changed: the walkthrough goes on
        }
      }
      if (!evidence.shots.length) await shoot(task.milestone ?? task.title);
      const video = page.video();
      await ctx.close();
      const recorded = video ? await video.path().catch(() => null) : null;
      if (recorded && plan.steps.length) {
        evidence.video = `${stamp}-walk.webm`;
        renameSync(recorded, join(dir, evidence.video));
      }
    } finally {
      await browser.close().catch(() => {});
    }
  } catch (err) {
    evidence.error = hide(String((err as Error).message ?? err)).slice(0, 300);
  } finally {
    rmSync(videoDir, { recursive: true, force: true });
    capturing.delete(goal.id);
  }
  store.append({ type: 'milestone.evidence', goalId: goal.id, payload: evidence });
  config.log(`[milestone] ${goal.id}: ${evidence.shots.length} screenshot(s)${evidence.video ? ' and a video' : ''}${evidence.error ? ` (${evidence.error})` : ''}`);
  return evidence;
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

async function planWalk(engine: Engine, goal: Goal, task: Task, url: string, title: string, controls: string[]): Promise<WalkPlan> {
  const { config } = engine;
  const prompt = [
    `# What to show\nThe milestone "${task.title}" of the goal "${goal.title}" landed. The person would check:\n${task.milestone ?? task.spec.slice(0, 600)}`,
    `# The running app\n${url}${title ? ` — "${title}"` : ''}\nControls on the first page:\n${controls.length ? controls.map((c) => `- ${c}`).join('\n') : '(none found)'}`,
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
  return WalkPlan.parse(r.structuredOutput);
}
