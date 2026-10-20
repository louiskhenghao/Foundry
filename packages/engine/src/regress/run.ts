/**
 * Running the role-prompt regression set (ADR-0062): one in-process engine, one fresh fixture repository per case, the
 * goal taken through Clarify with its Brief approved by the harness (or, with `clarify: false`, one task per case with
 * its checks as the Brief — the cheaper run of the worker and reviewer roles alone), then judged on the finished
 * checkout: every check exits 0, no file outside the allowed ones changed, and the goal ended done within its budget.
 * A run is a plain record — what passed, what it cost, how long it took — that `compare` sets against a saved one.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getGoal, listAttemptsByGoal, listEscalations, listTasks, type GoalState } from '@foundry/core';
import type { ClaudeRunner } from '@foundry/runner';
import { budgetStatus } from '../budget.ts';
import { defaultConfig, type EngineConfig } from '../config.ts';
import { Engine } from '../engine.ts';
import { exec } from '../git/git.ts';
import { goalWorkspacePath } from '../workspace.ts';
import { makeFixture, type RegressCase } from './cases.ts';

export interface CheckResult {
  cmd: string;
  ok: boolean;
  output: string;
}
export interface CaseResult {
  name: string;
  title: string;
  state: GoalState | 'timeout' | 'error';
  passed: boolean;
  costUsd: number;
  minutes: number;
  tasks: number;
  attempts: number;
  /** tasks that needed more than one attempt */
  retries: number;
  checks: CheckResult[];
  touched: string[];
  /** files changed outside the case's allowed globs */
  disallowed: string[];
  detail: string | null;
}
export interface RegressRun {
  at: string;
  label: string;
  foundry: string;
  provider: 'claude' | 'codex';
  profile: EngineConfig['workflowProfile'];
  model: string | null;
  clarify: boolean;
  cases: CaseResult[];
  summary: { total: number; passed: number; passRate: number; costUsd: number; minutes: number };
}

export interface RunOptions {
  cases: RegressCase[];
  /** the engine's data and the fixture repositories go under it */
  workDir: string;
  /** the repository root (for `defaultConfig`) */
  root: string;
  provider?: 'claude' | 'codex';
  profile?: EngineConfig['workflowProfile'];
  /** one model alias for every role of every goal; null = the presets as configured */
  model?: string | null;
  /** run Clarify and the planner (the default); false = the case's checks as a one-task Brief */
  clarify?: boolean;
  label?: string;
  log?: (line: string) => void;
  /** a test double for the coding agent; the real one when absent */
  runner?: ClaudeRunner;
  /** more engine settings for the run (a claudeHome of its own, say) */
  config?: Partial<EngineConfig>;
  /** how long past a case's own time budget the harness waits before giving up on it (factor) */
  patience?: number;
}

const TERMINAL = new Set<GoalState>(['done', 'over_delivered', 'failed', 'cancelled']);
const FINISHED = new Set<GoalState>(['done', 'over_delivered']);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Run one case on a running engine: the fixture, the goal, the wait, the judgement. */
export async function runCase(engine: Engine, c: RegressCase, opts: Pick<RunOptions, 'workDir' | 'model' | 'clarify' | 'log' | 'patience'>): Promise<CaseResult> {
  const log = opts.log ?? (() => {});
  const db = engine.store.db;
  const repo = join(opts.workDir, 'repos', c.name);
  const base = await makeFixture(c.fixture, repo);
  const clarify = opts.clarify !== false;
  const blank: CaseResult = { name: c.name, title: c.title, state: 'error', passed: false, costUsd: 0, minutes: 0, tasks: 0, attempts: 0, retries: 0, checks: [], touched: [], disallowed: [], detail: null };
  let id: string;
  try {
    const goal = await engine.createGoal({
      prompt: c.prompt,
      title: c.title,
      repoPath: repo,
      nature: c.nature ?? 'code',
      interview: 'never',
      interviewDepth: 0,
      milestonePause: false,
      selfCheck: false,
      budgets: { maxCostUsd: c.maxCostUsd, maxDurationMin: c.maxMinutes, maxConcurrent: 2, attemptsPerTask: 2 },
      ...(opts.model ? { models: { strong: opts.model, cheap: opts.model, worker: opts.model } } : {}),
      ...(clarify ? {} : { autoBrief: { mustChecks: c.checks } }),
      delivery: { mode: 'local' },
    });
    id = goal.id;
  } catch (err) {
    return { ...blank, detail: `the goal could not be created: ${String((err as Error).message ?? err)}` };
  }
  log(`${c.name}: goal ${id} started${clarify ? '' : ' (no Clarify)'}`);

  // the wait: approve the Brief once it is ready; a goal that stops for the person, or runs past its time, is given up
  const deadline = Date.now() + c.maxMinutes * 60_000 * (opts.patience ?? 1.5);
  let state: CaseResult['state'] = 'error';
  let detail: string | null = null;
  let approved = false;
  while (true) {
    const g = getGoal(db, id)!;
    if (TERMINAL.has(g.state)) {
      state = g.state;
      if (!FINISHED.has(g.state)) detail = detail ?? `the goal ended ${g.state}`;
      break;
    }
    if (g.state === 'awaiting_brief_approval' && !approved) {
      try {
        await engine.approveBrief(id);
        approved = true;
        log(`${c.name}: Brief approved`);
      } catch (err) {
        log(`${c.name}: approval waits: ${String((err as Error).message ?? err)}`);
      }
    } else if (g.state === 'blocked' || g.state === 'awaiting_feedback') {
      const esc = listEscalations(db, { goalId: id, openOnly: true }).at(-1);
      detail = `the goal stopped for the person (${g.state}): ${esc?.message ?? 'no reason recorded'}`;
      engine.cancelGoal(id);
    } else if (Date.now() > deadline) {
      detail = `gave up after ${Math.round((Date.now() - (deadline - c.maxMinutes * 60_000 * (opts.patience ?? 1.5))) / 60_000)} minutes`;
      state = 'timeout';
      engine.cancelGoal(id);
      await sleep(2000);
      break;
    }
    await sleep(2000);
  }

  // the judgement: on the finished checkout, and on what changed since the fixture
  const goal = getGoal(db, id)!;
  const ws = goalWorkspacePath(engine.config.dataDir, goal);
  const checks: CheckResult[] = [];
  if (FINISHED.has(goal.state)) {
    for (const cmd of c.checks) {
      const r = await exec(['sh', '-c', cmd], ws, { timeoutMs: 120_000 });
      checks.push({ cmd, ok: r.code === 0, output: (r.stdout + r.stderr).trim().slice(-400) });
    }
  }
  const diff = await exec(['git', 'diff', '--name-only', base, goal.branch], repo);
  const touched = diff.code === 0 ? diff.stdout.split('\n').map((s) => s.trim()).filter(Boolean) : [];
  const globs = c.allowed.map((g) => new Bun.Glob(g));
  const disallowed = touched.filter((f) => !globs.some((g) => g.match(f)));
  const work = listAttemptsByGoal(db, id).filter((a) => a.kind === 'work');
  const byTask = new Map<string, number>();
  for (const a of work) byTask.set(a.taskId, (byTask.get(a.taskId) ?? 0) + 1);
  const failedChecks = checks.filter((k) => !k.ok);
  const passed = FINISHED.has(goal.state) && failedChecks.length === 0 && disallowed.length === 0;
  if (!passed && !detail) detail = [failedChecks.length ? `${failedChecks.length} check${failedChecks.length === 1 ? '' : 's'} failed: ${failedChecks.map((k) => k.cmd).join('; ')}` : '', disallowed.length ? `changed outside the allowed files: ${disallowed.join(', ')}` : ''].filter(Boolean).join('. ') || null;
  const result: CaseResult = {
    ...blank,
    state,
    passed,
    costUsd: Math.round(goal.costUsd * 1000) / 1000,
    minutes: Math.round(budgetStatus(goal).elapsedMin * 10) / 10,
    tasks: listTasks(db, id).filter((t) => t.origin !== 'merge').length,
    attempts: work.length,
    retries: [...byTask.values()].filter((n) => n > 1).length,
    checks,
    touched,
    disallowed,
    detail,
  };
  log(`${c.name}: ${passed ? 'passed' : 'FAILED'} · ${goal.state} · $${result.costUsd} · ${result.minutes} min${detail ? ` · ${detail}` : ''}`);
  return result;
}

/** Run the cases on one engine of their own and sum them up. */
export async function runSuite(opts: RunOptions): Promise<RegressRun> {
  const provider = opts.provider ?? 'claude';
  const config = defaultConfig(opts.root, { dataDir: join(opts.workDir, 'data'), provider, ...(opts.profile ? { workflowProfile: opts.profile } : {}), autoskills: false, useGraphify: false, log: () => {}, ...(opts.config ?? {}) });
  const engine = new Engine(config, opts.runner);
  const cases: CaseResult[] = [];
  try {
    for (const c of opts.cases) cases.push(await runCase(engine, c, opts));
  } finally {
    await engine.stop();
  }
  let foundry = 'unknown';
  try {
    foundry = (JSON.parse(readFileSync(join(opts.root, 'package.json'), 'utf8')) as { version?: string }).version ?? foundry;
  } catch {}
  const passed = cases.filter((c) => c.passed).length;
  return {
    at: new Date().toISOString(),
    label: opts.label ?? `${provider}-${config.workflowProfile}${opts.model ? `-${opts.model}` : ''}`,
    foundry,
    provider,
    profile: config.workflowProfile,
    model: opts.model ?? null,
    clarify: opts.clarify !== false,
    cases,
    summary: { total: cases.length, passed, passRate: cases.length ? passed / cases.length : 0, costUsd: Math.round(cases.reduce((a, c) => a + c.costUsd, 0) * 1000) / 1000, minutes: Math.round(cases.reduce((a, c) => a + c.minutes, 0) * 10) / 10 },
  };
}

export interface Comparison {
  /** passed in the baseline, failed now */
  regressions: string[];
  /** failed in the baseline, passed now */
  improvements: string[];
  /** cost grew by half and by at least fifty cents */
  costlier: string[];
  /** in one run only */
  onlyHere: string[];
  onlyThere: string[];
  lines: string[];
}

/** A run set against a saved one: what got worse, what got better, what costs more. */
export function compare(run: RegressRun, baseline: RegressRun): Comparison {
  const here = new Map(run.cases.map((c) => [c.name, c]));
  const there = new Map(baseline.cases.map((c) => [c.name, c]));
  const out: Comparison = { regressions: [], improvements: [], costlier: [], onlyHere: [], onlyThere: [], lines: [] };
  for (const [name, c] of here) {
    const b = there.get(name);
    if (!b) {
      out.onlyHere.push(name);
      continue;
    }
    if (b.passed && !c.passed) out.regressions.push(name);
    if (!b.passed && c.passed) out.improvements.push(name);
    if (c.costUsd > b.costUsd * 1.5 && c.costUsd - b.costUsd >= 0.5) out.costlier.push(name);
  }
  for (const name of there.keys()) if (!here.has(name)) out.onlyThere.push(name);
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  out.lines.push(`Against ${baseline.label} (${baseline.at.slice(0, 10)}): pass rate ${pct(baseline.summary.passRate)} → ${pct(run.summary.passRate)}, cost $${baseline.summary.costUsd} → $${run.summary.costUsd}, time ${baseline.summary.minutes} → ${run.summary.minutes} min.`);
  if (out.regressions.length) out.lines.push(`Regressions: ${out.regressions.join(', ')}.`);
  if (out.improvements.length) out.lines.push(`Improvements: ${out.improvements.join(', ')}.`);
  if (out.costlier.length) out.lines.push(`Costlier: ${out.costlier.map((n) => `${n} ($${there.get(n)!.costUsd} → $${here.get(n)!.costUsd})`).join(', ')}.`);
  if (out.onlyHere.length) out.lines.push(`New here: ${out.onlyHere.join(', ')}.`);
  if (out.onlyThere.length) out.lines.push(`Not run this time: ${out.onlyThere.join(', ')}.`);
  if (!out.regressions.length && !out.costlier.length) out.lines.push('Nothing got worse.');
  return out;
}

/** The run as a page to read and keep beside its JSON. */
export function renderMarkdown(run: RegressRun, cmp: Comparison | null = null): string {
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const lines = [
    `# Role-prompt regression set · ${run.label}`,
    '',
    `${run.at.slice(0, 16).replace('T', ' ')} · Foundry ${run.foundry} · ${run.provider} · suite ${run.profile}${run.model ? ` · model ${run.model}` : ''}${run.clarify ? '' : ' · no Clarify'}`,
    '',
    `**${run.summary.passed} of ${run.summary.total} passed (${pct(run.summary.passRate)}) · $${run.summary.costUsd} · ${run.summary.minutes} min**`,
    '',
    '| case | result | cost | min | tasks | retries | what went wrong |',
    '|---|---|---|---|---|---|---|',
    ...run.cases.map((c) => `| ${c.name} | ${c.passed ? '✅ pass' : `❌ ${c.state}`} | $${c.costUsd} | ${c.minutes} | ${c.tasks} | ${c.retries} | ${c.detail ?? ''} |`),
  ];
  if (cmp) lines.push('', '## Against the baseline', '', ...cmp.lines.map((l) => `- ${l}`));
  return lines.join('\n') + '\n';
}
