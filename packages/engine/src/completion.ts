/**
 * Completion actions: automatic wrap-up chosen at Brief approval.
 * - Defaults are inferred from the Brief (what kind of work the tasks are).
 * - The graph refresh (graphify / gitnexus) runs when the goal is finished — after delivery for goals that
 *   leave the machine, at `done` for local ones — so the knowledge graph reflects the code that actually landed.
 * Failures never block the goal: every outcome is recorded on `goal.completion_ran` and the goal stays done.
 */
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Brief, DocType, Goal } from '@foundry/core';
import { MEDIA_NATURES, pendingDecisions } from '@foundry/core';
import type { Engine } from './engine.ts';
import { exec } from './git/git.ts';
import { pullFastForward } from './git/sync.ts';
import { ARTIFACTS_DIR, goalWorkspacePath, listArtifacts } from './workspace.ts';

/** Task scenarios that mean the goal changes code (research/video/docs-only goals have none of these). */
const CODE_SCENARIOS = new Set(['frontend', 'backend', 'fullstack', 'data', 'mobile', 'infra']);

/** Defaults when the UI sends nothing (Simple mode, API callers): inferred from the Brief. */
export function inferCompletion(brief: Brief, ws: string, pace: 'thorough' | 'fast' = 'thorough'): { graphRefresh: boolean; docs: DocType[]; reason: string } {
  const code = brief.tasks.some((t) => CODE_SCENARIOS.has(t.scenario ?? 'general'));
  if (pace === 'fast') return { graphRefresh: code, docs: [], reason: 'fast pace: no generated docs' };
  const docs: DocType[] = [];
  if (code) docs.push('to-prd', 'readme-update');
  if (code && existsSync(join(ws, 'CHANGELOG.md'))) docs.push('changelog');
  if (pendingDecisions(brief).length) docs.push('to-questionnaire');
  return { graphRefresh: code, docs, reason: code ? 'inferred: coding goal' : 'inferred: no coding tasks' };
}

/**
 * Copy the goal workspace's artifacts/ to the goal's output folder when the goal finishes.
 * Never throws and never blocks the goal; the outcome lands on `goal.artifacts_delivered`.
 * Media goals without an output folder get a `skipped` record (the artifacts stay in the workspace);
 * other goals with no artifacts get no record at all.
 */
export async function deliverArtifacts(engine: Engine, goal: Goal): Promise<void> {
  const { store, config } = engine;
  if (goal.completion.artifactsRun) return;
  const ws = goalWorkspacePath(config.dataDir, goal.id);
  const files = listArtifacts(ws);
  const record = (payload: { status: 'ok' | 'skipped' | 'failed'; files: string[]; dest: string; detail: string }) => store.append({ type: 'goal.artifacts_delivered', goalId: goal.id, payload });
  if (!files.length) {
    if (MEDIA_NATURES.includes(goal.nature)) record({ status: 'skipped', files: [], dest: goal.outputDir ?? '', detail: 'no artifacts were produced' });
    return;
  }
  if (!goal.outputDir) {
    record({ status: 'skipped', files, dest: '', detail: `no output folder set — ${files.length} artifact(s) stay in the goal workspace (Open ▾)` });
    return;
  }
  try {
    for (const f of files) {
      const dest = join(goal.outputDir, f);
      mkdirSync(dirname(dest), { recursive: true });
      cpSync(join(ws, ARTIFACTS_DIR, f), dest);
    }
    record({ status: 'ok', files, dest: goal.outputDir, detail: `${files.length} artifact(s) copied` });
    store.append({ type: 'engine.note', goalId: goal.id, payload: { level: 'info', message: `${files.length} artifact(s) delivered to ${goal.outputDir}` } });
    config.log(`[completion] ${goal.id}: ${files.length} artifact(s) → ${goal.outputDir}`);
  } catch (err) {
    record({ status: 'failed', files, dest: goal.outputDir, detail: String((err as Error).message ?? err).slice(0, 300) });
    store.append({ type: 'engine.note', goalId: goal.id, payload: { level: 'warn', message: `artifact delivery to ${goal.outputDir} failed: ${String((err as Error).message ?? err).slice(0, 200)}` } });
  }
}

/** Per-tool argv for the graph refresh; a tool that is not on PATH is recorded as skipped. */
const GRAPH_TOOLS: { name: string; args: string[] }[] = [
  { name: 'graphify', args: ['update'] },
  { name: 'gitnexus', args: ['analyze'] },
];

export function shouldRunGraphRefresh(goal: Goal): boolean {
  if (!goal.completion.graphRefresh || goal.completion.graphRun) return false;
  return goal.delivery.policy.mode === 'local' || goal.delivery.status === 'delivered';
}

export interface GraphRefreshDeps {
  which?: (name: string) => string | null;
  exec?: typeof exec;
}

/**
 * Refresh the knowledge graph where the delivered code lives: the user's checkout for delivered goals
 * (fast-forwarded to the merged base first, when possible), the goal workspace for local-mode goals.
 */
export async function runGraphRefresh(engine: Engine, goal: Goal, deps: GraphRefreshDeps = {}): Promise<void> {
  const { store, config } = engine;
  const which = deps.which ?? ((n: string) => Bun.which(n));
  const run = deps.exec ?? exec;
  const tools: { name: string; status: 'ok' | 'skipped' | 'failed'; detail: string }[] = [];
  let cwd = goalWorkspacePath(config.dataDir, goal.id);
  if (goal.delivery.policy.mode !== 'local') {
    const pull = await pullFastForward(goal.repoPath, goal.baseBranch).catch((err) => ({ ok: false, detail: String((err as Error).message ?? err) }));
    tools.push({ name: 'pull', status: pull.ok ? 'ok' : 'skipped', detail: pull.detail });
    cwd = goal.repoPath;
  }
  for (const t of GRAPH_TOOLS) {
    if (!which(t.name)) {
      tools.push({ name: t.name, status: 'skipped', detail: 'not on PATH' });
      continue;
    }
    const t0 = Date.now();
    try {
      const r = await run([t.name, ...t.args], cwd, { timeoutMs: 10 * 60_000 });
      tools.push({ name: t.name, status: r.code === 0 ? 'ok' : 'failed', detail: r.code === 0 ? `${t.args.join(' ')} in ${Math.round((Date.now() - t0) / 1000)}s` : (r.stderr || r.stdout).trim().slice(-200) || `exited ${r.code}` });
    } catch (err) {
      tools.push({ name: t.name, status: 'failed', detail: String((err as Error).message ?? err).slice(0, 200) });
    }
  }
  store.append({ type: 'goal.completion_ran', goalId: goal.id, payload: { tools } });
  const summary = tools.map((t) => `${t.name} ${t.status}`).join(', ');
  store.append({ type: 'engine.note', goalId: goal.id, payload: { level: 'info', message: `graph refresh: ${summary}` } });
  config.log(`[completion] ${goal.id}: ${summary}`);
}
