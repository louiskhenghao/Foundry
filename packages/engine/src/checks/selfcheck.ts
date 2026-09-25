import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Check, CheckResult, Goal } from '@foundry/core';
import { IdPrefix, listChecks, newId } from '@foundry/core';
import type { Engine } from '../engine.ts';
import { screenshotsDir } from '../workspace.ts';

export const SELF_CHECK_NAME = 'self-check: the preview loads without errors';

/**
 * The command that downloads Chromium for the Playwright Foundry ships. It runs that package's own CLI: `bunx playwright`
 * finds no bin at the repo root (bun links it under packages/engine) and would fetch playwright@latest, whose browser
 * revision stops matching the installed package as soon as Playwright releases a new version.
 */
export function playwrightInstallCommand(): string[] {
  const cli = join(dirname(Bun.resolveSync('playwright/package.json', import.meta.dir)), 'cli.js');
  return [process.execPath, cli, 'install', 'chromium'];
}

/** Is Playwright usable here: the package resolves and Chromium is installed. */
export async function playwrightStatus(): Promise<{ installed: boolean; browser: boolean; detail: string }> {
  try {
    const pw = await import('playwright');
    const exe = pw.chromium.executablePath();
    const browser = !!exe && existsSync(exe);
    return { installed: true, browser, detail: browser ? `Chromium at ${exe}` : 'Chromium is not downloaded yet — run the install' };
  } catch (err) {
    return { installed: false, browser: false, detail: `playwright package unavailable: ${String((err as Error).message ?? err).slice(0, 120)}` };
  }
}

/** The goal's self-check Check (goal-level must, type selfcheck), created on first use when the goal asked for one. */
export function ensureSelfCheck(engine: Engine, goal: Goal): Check | null {
  if (!goal.selfCheck) return null;
  const existing = listChecks(engine.store.db, goal.id).find((c) => c.taskId === null && c.spec.type === 'selfcheck');
  if (existing) return existing;
  const check: Check = { id: newId(IdPrefix.check), goalId: goal.id, taskId: null, name: SELF_CHECK_NAME, tier: 'must', spec: { type: 'selfcheck' } };
  engine.store.append({ type: 'check.created', goalId: goal.id, payload: { check } });
  return check;
}

/**
 * Open the goal's preview in headless Chromium, screenshot it, and collect console errors, page errors, failed requests
 * and 5xx responses. No LLM. The result is a normal CheckResult (must tier) and a `selfcheck.finished` event carrying the
 * screenshot, so it reaches the timeline, the notifications and the goal review like any other check.
 */
export async function runSelfCheck(engine: Engine, goal: Goal, opts: { taskId: string | null; check?: Check }): Promise<CheckResult | null> {
  const { store, config } = engine;
  const check = opts.check ?? ensureSelfCheck(engine, goal);
  if (!check) return null;
  const t0 = Date.now();
  const errors: string[] = [];
  let status: CheckResult['status'] = 'error';
  let summary = '';
  let screenshot: string | null = null;
  let url: string | null = null;
  try {
    const preview = await engine.preview.start(goal, 'integration');
    url = preview.url;
    if (!preview.ready) throw new Error(`the preview at ${preview.url} did not answer`);
    const pw = await import('playwright').catch((err) => {
      throw new Error(`Playwright is not installed (Settings → Tools → Install Playwright): ${String((err as Error).message ?? err).slice(0, 100)}`);
    });
    const browser = await pw.chromium.launch().catch((err) => {
      throw new Error(`Chromium could not start (Settings → Tools → Install Playwright): ${String((err as Error).message ?? err).slice(0, 160)}`);
    });
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 300)}`);
      });
      page.on('pageerror', (e) => errors.push(`page error: ${String(e.message ?? e).slice(0, 300)}`));
      page.on('requestfailed', (r) => errors.push(`request failed: ${r.method()} ${r.url().slice(0, 200)} — ${r.failure()?.errorText ?? ''}`));
      page.on('response', (r) => {
        if (r.status() >= 500) errors.push(`HTTP ${r.status()}: ${r.url().slice(0, 200)}`);
      });
      await page.goto(preview.url!, { waitUntil: 'networkidle', timeout: 30_000 });
      await page.waitForTimeout(1500);
      const dir = screenshotsDir(config.dataDir, goal);
      mkdirSync(dir, { recursive: true });
      screenshot = `${new Date().toISOString().replace(/[:.]/g, '-')}${opts.taskId ? `-${opts.taskId}` : ''}.png`;
      await page.screenshot({ path: join(dir, screenshot), fullPage: false });
    } finally {
      await browser.close().catch(() => {});
    }
    status = errors.length ? 'fail' : 'pass';
    summary = errors.length ? `${preview.url}: ${errors.length} error(s)\n${errors.slice(0, 12).join('\n')}` : `${preview.url} loaded with no console, page or network errors`;
  } catch (err) {
    status = 'error';
    summary = `self-check could not run: ${String((err as Error).message ?? err).slice(0, 400)}`;
  }
  const result: CheckResult = { id: newId(IdPrefix.checkResult), checkId: check.id, goalId: goal.id, taskId: null, attemptId: null, status, summary, rawRef: null, durationMs: Date.now() - t0, at: new Date().toISOString() };
  store.append({ type: 'check.finished', goalId: goal.id, payload: { result } });
  store.append({ type: 'selfcheck.finished', goalId: goal.id, payload: { taskId: opts.taskId, status, url, screenshot, errors: errors.slice(0, 50), summary } });
  config.log(`[selfcheck] ${goal.id}: ${status}${screenshot ? ` (${screenshot})` : ''}`);
  return result;
}
