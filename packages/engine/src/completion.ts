/**
 * Completion actions: automatic wrap-up chosen at Brief approval.
 * - Defaults are inferred from the Brief (what kind of work the tasks are).
 * - The graph refresh (graphify / gitnexus) runs when the goal is finished — after delivery for goals that
 *   leave the machine, at `done` for local ones — so the knowledge graph reflects the code that actually landed.
 * Failures never block the goal: every outcome is recorded on `goal.completion_ran` and the goal stays done.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Brief, DocType, Goal } from '@ai-engine/core';
import { pendingDecisions } from '@ai-engine/core';
import type { Engine } from './engine.ts';
import { exec } from './git/git.ts';
import { pullFastForward } from './git/sync.ts';
import { goalWorkspacePath } from './workspace.ts';

/** Task scenarios that mean the goal changes code (research/video/docs-only goals have none of these). */
const CODE_SCENARIOS = new Set(['frontend', 'backend', 'fullstack', 'data', 'mobile', 'infra']);

/** Defaults when the UI sends nothing (Simple mode, API callers): inferred from the Brief. */
export function inferCompletion(brief: Brief, ws: string): { graphRefresh: boolean; docs: DocType[]; reason: string } {
  const code = brief.tasks.some((t) => CODE_SCENARIOS.has(t.scenario ?? 'general'));
  const docs: DocType[] = [];
  if (code) docs.push('to-prd', 'readme-update');
  if (code && existsSync(join(ws, 'CHANGELOG.md'))) docs.push('changelog');
  if (pendingDecisions(brief).length) docs.push('to-questionnaire');
  return { graphRefresh: code, docs, reason: code ? 'inferred: coding goal' : 'inferred: no coding tasks' };
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
