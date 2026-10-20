/**
 * Browser QA at the end of a goal (ADR-0057): once every task has landed, one session opens the finished app in a
 * browser the engine started and tries each acceptance check the way a person would, with small Playwright scripts
 * it writes under a scratch folder, and reports what passed and what did not, with screenshots. A must check that
 * failed becomes a fix task before the final review. The session changes no code: whatever it touched outside its
 * scratch folder is thrown away. Runs once per goal; a goal with no web app, no browser or no budget left is a
 * skipped QA, not an error. Never throws.
 */
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Goal, QaResult } from '@foundry/core';
import { CAD_VIEWER_KEY, getBrief, getGoal, listChecks } from '@foundry/core';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { attachmentsDir, renderAttachments } from './attachments.ts';
import { budgetStatus } from './budget.ts';
import { tryJson } from './checks/reviewer.ts';
import { playwrightStatus } from './checks/selfcheck.ts';
import type { Engine } from './engine.ts';
import { createFixTasks } from './fix-tasks.ts';
import { git } from './git/git.ts';
import { WORKER_BASE_TOOLS, boundaryEnv, boundarySettings } from './guards/boundary.ts';
import { metaFor, modelFor } from './models/roles.ts';
import { excludeFromGit } from './skills/autoskills.ts';
import { goalWorkspacePath, screenshotsDir } from './workspace.ts';

/** at most this many failed must checks become fix tasks: more is a result the person should look at whole */
export const QA_MAX_FIX_TASKS = 6;
/** the least a QA may spend: opening an app and trying it is at least that much work */
const QA_MIN_CAP_USD = 4;
/** the scratch folder the session's scripts live in, kept out of git */
export const QA_DIR = '.foundry-qa';

const QaOutput = z.object({
  summary: z.string().describe('Two or three sentences in plain English: what was tried in the browser and how it went.'),
  results: z
    .array(
      z.object({
        check: z.string().describe('The acceptance check this covers, by its name as given; "general" for a problem outside the checks (an error page, a broken link, a console error that breaks a page)'),
        status: z.enum(['pass', 'fail', 'skipped']).describe('pass = seen working in the browser; fail = seen not working, with the steps; skipped = could not be tried in a browser, with why'),
        evidence: z.string().describe('What was done in the browser and what was seen: the page, the action, the result'),
        problem: z.string().nullable().describe('fail: what went wrong, with the concrete steps that show it'),
        fix: z.string().nullable().describe('fail: the smallest fix that would make it pass'),
        files: z.array(z.string()).default([]).describe('fail: repository-relative paths likely involved'),
        shots: z.array(z.string()).default([]).describe('the screenshot file names this result saved under the screenshots folder given (the prefix included)'),
      }),
    )
    .max(40),
});

/** what the engine needs from outside the session, replaceable in tests: the browser, and the preview the app runs in */
export interface QaDeps {
  playwright: () => Promise<{ installed: boolean; browser: boolean; detail: string }>;
  startPreview: (engine: Engine, goal: Goal) => Promise<{ ready: boolean; error: string | null; apps: { key: string; name: string; url: string | null; ready: boolean }[] }>;
  /** where Playwright is on this computer, for the session's scripts to import */
  playwrightPath: () => string | null;
}
export const defaultQaDeps: QaDeps = {
  playwright: playwrightStatus,
  startPreview: (engine, goal) => engine.preview.start(goal, 'qa'),
  playwrightPath: () => {
    try {
      return Bun.resolveSync('playwright', import.meta.dir);
    } catch {
      return null;
    }
  },
};

/** the files under the screenshots folder a result named, that exist and carry this run's prefix */
export function realShots(dir: string, prefix: string, named: string[]): string[] {
  let present: string[] = [];
  try {
    present = readdirSync(dir);
  } catch {
    return [];
  }
  // a name given without the prefix still finds its file: the session may say `form.png` for `qa-…-form.png`
  const full = named.map((n) => n.split('/').pop() ?? n).map((n) => (n.startsWith(prefix) ? n : `${prefix}${n}`));
  return full.filter((n, i, all) => present.includes(n) && all.indexOf(n) === i);
}

/** a failed result's check names a must check when the names match, whatever the case and the spaces around */
const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Throw away whatever the session changed outside its scratch folder (tracked files restored, new files removed; the
 * scratch folder is excluded from git, so `clean` never sees it). Returns the paths that were put back.
 */
export async function revertOutsideScratch(ws: string): Promise<string[]> {
  const status = await git(['status', '--porcelain', '-z'], ws);
  const changed = status.code === 0 ? status.stdout.split('\0').filter(Boolean).map((l) => l.slice(3)) : [];
  const outside = changed.filter((p) => !p.startsWith(`${QA_DIR}/`) && p !== QA_DIR);
  if (!outside.length) return [];
  await git(['checkout', '--', '.'], ws);
  // the scratch folder is excluded from git, and kept even when it is not yet
  await git(['clean', '-fd', '-e', QA_DIR], ws);
  return outside;
}

export async function runQa(engine: Engine, goal: Goal, deps: QaDeps = defaultQaDeps): Promise<void> {
  const { store, config } = engine;
  const finish = (p: { status: 'ok' | 'skipped' | 'failed'; summary: string; results: QaResult[]; fixTaskIds: string[]; costUsd: number; detail: string }) =>
    store.append({ type: 'goal.qa_finished', goalId: goal.id, payload: p });
  const skip = (detail: string): void => {
    finish({ status: 'skipped', summary: '', results: [], fixTaskIds: [], costUsd: 0, detail });
  };
  let costUsd = 0;
  try {
    const ws = goalWorkspacePath(config.dataDir, goal);
    if (!engine.preview.resolveApps(goal)) return skip('the goal has no web app to open: nothing to test in a browser');
    const pw = await deps.playwright();
    if (!pw.browser) return skip(`Chromium for Playwright is not installed (Settings → Preview & self-check): ${pw.detail}`);
    const pwPath = deps.playwrightPath();
    if (!pwPath) return skip('Playwright is not installed with Foundry: the QA scripts have nothing to drive the browser with');
    const remaining = budgetStatus(goal).remainingUsd;
    if (remaining != null && remaining <= 0) return skip('the goal has no budget left for the browser QA');
    const cap = Math.max(QA_MIN_CAP_USD, remaining == null ? config.attemptMaxCostUsd : Math.min(config.attemptMaxCostUsd, remaining));
    const preview = await deps.startPreview(engine, goal);
    const apps = preview.apps.filter((a) => a.url && a.key !== CAD_VIEWER_KEY);
    if (!apps.length) return skip(`the preview did not start: ${preview.error ?? 'no app answered'}`);
    const brief = getBrief(store.db, goal.id)?.brief ?? null;
    // the acceptance checks a browser can show: the goal's and the tasks', must first; a command check is named with its command
    const checks = listChecks(store.db, goal.id)
      .filter((c) => c.tier === 'must' || c.tier === 'stretch')
      .sort((a, b) => Number(a.tier !== 'must') - Number(b.tier !== 'must'))
      .slice(0, 40);
    const checkLines = checks.map((c) => `- [${c.tier}${c.taskId ? '' : ', goal-level'}] ${c.name}: ${c.spec.type === 'command' ? `the command \`${c.spec.cmd}\` passes` : c.spec.type === 'reviewer' ? c.spec.rubric : JSON.stringify(c.spec)}`);
    const scratch = join(ws, QA_DIR);
    mkdirSync(scratch, { recursive: true });
    await excludeFromGit(ws, [`${QA_DIR}/`], config.log).catch(() => false);
    const shots = screenshotsDir(config.dataDir, goal);
    mkdirSync(shots, { recursive: true });
    const prefix = `qa-${new Date().toISOString().replace(/[:.]/g, '-')}-`;
    const reviewer = modelFor(config, goal, 'goalReviewer');
    const prompt = [
      `# Goal\n${goal.title}\n\n${goal.prompt}`,
      brief ? `# What was understood\n${brief.understanding}` : '',
      renderAttachments(goal, config.dataDir),
      `# The app, running\n${apps.map((a) => `- ${a.name}: ${a.url}${a.ready ? '' : ' (did not answer yet: wait for it, then retry)'}`).join('\n')}\nThe engine started it from the finished branch checked out here; use it as it is. Never start a server of your own on these ports.`,
      `# Acceptance checks\n${checkLines.join('\n') || '(none written down: test what the goal asked for)'}`,
      `# How to test\n- Write small Playwright scripts (TypeScript) under \`${QA_DIR}/\` in this folder and run them with \`bun <script>\`. Import Playwright from the path in \`FOUNDRY_QA_PLAYWRIGHT\`: \`const { chromium } = await import(process.env.FOUNDRY_QA_PLAYWRIGHT!)\`. Launch Chromium headless and drive the app at \`FOUNDRY_QA_URL\`.\n- Save a screenshot of what each check shows under \`FOUNDRY_QA_SHOTS\`, named \`FOUNDRY_QA_PREFIX\` + a short name (for example \`${prefix}signup-done.png\`), and name those files in your report.\n- One result per acceptance check, by its name as given above; \`general\` for a problem outside the checks. A check a browser cannot try (a command, a backend-only check) is \`skipped\`, with why.\n- Change nothing outside \`${QA_DIR}/\`: whatever you change elsewhere is thrown away afterwards.`,
      'Then report the QA as JSON matching the schema: `summary`, and `results`, failures first. A failed must check becomes a fix task before the final review; everything is shown to the person with the screenshots.',
    ]
      .filter(Boolean)
      .join('\n\n');
    const channel = `qa-${goal.id}`;
    const base = {
      cwd: ws,
      model: reviewer.model,
      meta: metaFor(goal.id, reviewer),
      permissionMode: 'dontAsk' as const,
      allowedTools: WORKER_BASE_TOOLS,
      jsonSchema: zodToJsonSchema(QaOutput, { $refStrategy: 'none' }),
      settings: boundarySettings(config.hooksDir),
      settingSources: config.settingSources,
      env: { ...boundaryEnv(config, goal.id), FOUNDRY_QA_PLAYWRIGHT: pwPath, FOUNDRY_QA_SHOTS: shots, FOUNDRY_QA_PREFIX: prefix, FOUNDRY_QA_URL: apps[0]!.url! },
      addDirs: [shots, ...(goal.attachments.length ? [attachmentsDir(config.dataDir, goal.id)] : [])],
      transcriptPath: join(config.dataDir, 'transcripts', `qa-${goal.id}-${Date.now()}.jsonl`),
    };
    const run = async (spec: Parameters<Engine['runner']['run']>[0]) => {
      const handle = await engine.runner.run(spec);
      const untrack = engine.trackBackground(goal.id, handle);
      try {
        for await (const ev of handle.events) engine.broadcast({ goalId: goal.id, taskId: null, attemptId: channel, event: ev, ts: new Date().toISOString() });
        const r = await handle.result;
        costUsd += r.costUsd;
        store.append({ type: 'goal.cost_added', goalId: goal.id, payload: { costUsd: r.costUsd, source: 'qa' } });
        engine.recordSessionUsage(r, { goalId: goal.id, kind: 'qa', model: reviewer.model });
        return r;
      } finally {
        untrack();
      }
    };
    let r = await run({ ...base, prompt, maxTurns: 120, maxBudgetUsd: cap, appendSystemPromptFile: engine.roles.path('qa'), timeoutMs: 30 * 60_000, label: `qa ${goal.title}` });
    let parsed = QaOutput.safeParse(r.structuredOutput ?? tryJson(r.finalText));
    if (!parsed.success && r.sessionId && !engine.isStopped) {
      const r2 = await run({ ...base, prompt: 'Stop testing. Reply now with ONLY the JSON report matching the schema, from what you have seen so far.', maxTurns: 3, maxBudgetUsd: Math.max(0.5, Math.min(2, cap - r.costUsd)), resumeSessionId: r.sessionId, timeoutMs: 5 * 60_000, label: `qa ${goal.title} (nudge)` });
      parsed = QaOutput.safeParse(r2.structuredOutput ?? tryJson(r2.finalText));
      if (!parsed.success) r = r2;
    }
    // the session's own edits outside its scratch folder go, whatever it reported
    const reverted = await revertOutsideScratch(ws).catch(() => []);
    if (reverted.length) store.append({ type: 'engine.note', goalId: goal.id, payload: { level: 'warn', message: `the browser QA changed ${reverted.length} file(s) outside its scratch folder; they were put back: ${reverted.slice(0, 5).join(', ')}${reverted.length > 5 ? '…' : ''}` } });
    if (!parsed.success) throw new Error(`${r.subtype}${r.errorMessage ? ` (${r.errorMessage.slice(0, 120)})` : ''}: no JSON report`);
    const mustNames = checks.filter((c) => c.tier === 'must').map((c) => c.name);
    const results: QaResult[] = parsed.data.results.map((x) => ({ ...x, must: mustNames.some((n) => sameName(n, x.check)), shots: realShots(shots, prefix, x.shots), fixTaskId: null }));
    const failedMust = results.filter((x) => x.status === 'fail' && x.must);
    const fixable = failedMust.slice(0, QA_MAX_FIX_TASKS);
    const now = getGoal(store.db, goal.id);
    const fixTaskIds =
      now && now.state === 'running' && fixable.length
        ? createFixTasks(
            engine,
            now,
            fixable.map((x) => ({ title: `qa: ${x.check}`.slice(0, 60), spec: `Browser QA tried "${x.check}" on the finished app and it did not hold.\n\nWhat was seen: ${x.evidence}\n\nProblem: ${x.problem ?? '(see above)'}\n\nFix: ${x.fix ?? 'make the check hold in the browser'}\n\nFiles: ${x.files.join(', ') || '(find them)'}`, relevantFiles: x.files })),
            null,
            { origin: 'qa-fix' },
          )
        : [];
    fixable.forEach((x, i) => {
      x.fixTaskId = fixTaskIds[i] ?? null;
    });
    const n = (s: QaResult['status']) => results.filter((x) => x.status === s).length;
    const counts = `${n('pass')} passed, ${n('fail')} failed, ${n('skipped')} skipped`;
    const left = failedMust.length - fixTaskIds.length;
    const detail = !results.length
      ? 'nothing was tried'
      : fixTaskIds.length
        ? `${counts}; ${fixTaskIds.length} failed must check(s) became fix tasks${left ? `, ${left} more wait for you (at most ${QA_MAX_FIX_TASKS} per QA)` : ''}`
        : failedMust.length
          ? `${counts}; ${failedMust.length} must check(s) failed, but the goal is no longer running: they wait for a follow-up`
          : `${counts}${n('fail') ? '; what failed is outside the must checks' : ''}`;
    finish({ status: 'ok', summary: parsed.data.summary, results, fixTaskIds, costUsd, detail });
    if (fixTaskIds.length) store.append({ type: 'engine.note', goalId: goal.id, payload: { level: 'info', message: `the browser QA found ${fixTaskIds.length} must check(s) that do not hold in the browser; fix tasks run before the final review` } });
  } catch (err) {
    finish({ status: 'failed', summary: '', results: [], fixTaskIds: [], costUsd, detail: String((err as Error).message ?? err).slice(0, 300) });
  }
}

/** true when the scratch folder exists in the goal's folder: a QA ran there once */
export const qaScratchExists = (ws: string): boolean => existsSync(join(ws, QA_DIR));
