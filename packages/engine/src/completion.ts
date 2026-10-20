/**
 * Completion actions: automatic wrap-up chosen at Brief approval.
 * - Defaults are inferred from the Brief (what kind of work the tasks are).
 * - The graph refresh (graphify / gitnexus) runs when the goal is finished — after delivery for goals that
 *   leave the machine, at `done` for local ones — so the knowledge graph reflects the code that actually landed.
 * Failures never block the goal: every outcome is recorded on `goal.completion_ran` and the goal stays done.
 */
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Brief, DocType, Goal } from '@foundry/core';
import { ARTIFACT_NATURES, pendingDecisions } from '@foundry/core';
import type { Engine } from './engine.ts';
import { dropEmptyGraphDir } from './context/graphify-provider.ts';
import { restoreGuidance, snapshotGuidance } from './git/agent-guidance.ts';
import { exec } from './git/git.ts';
import { pullFastForward } from './git/sync.ts';
import { cadModelIn, goalUsesArtifacts, recoverOverlays, retryUnlanded } from './goal-artifacts.ts';
import { ARTIFACTS_DIR, copyIdentity, copyInto, goalWorkspacePath, listArtifacts } from './workspace.ts';
import { codeWork } from './skills/workflow.ts';

/** Task scenarios that mean the goal changes code (research/video/docs-only goals have none of these). */
const CODE_SCENARIOS = new Set(['frontend', 'backend', 'fullstack', 'data', 'mobile', 'infra']);

/** Defaults when the UI sends nothing (Simple mode, API callers): inferred from the Brief. */
export function inferCompletion(brief: Brief, ws: string, pace: 'thorough' | 'fast' = 'thorough', auditDefault = false, qaDefault = false): { graphRefresh: boolean; docs: DocType[]; audit: boolean; qa: boolean; reason: string } {
  const code = brief.tasks.some((t) => CODE_SCENARIOS.has(t.scenario ?? 'general'));
  // the audit is Ponytail's review of the finished branch: a goal of documents, research or media alone gets none
  const audit = auditDefault && brief.tasks.some((t) => codeWork(t));
  // the browser QA opens the app: only a goal with a web app to open gets one (ADR-0057)
  const qa = qaDefault && !!(brief.apps?.length || brief.run);
  if (pace === 'fast') return { graphRefresh: code, docs: [], audit, qa, reason: 'fast pace: no generated docs' };
  const docs: DocType[] = [];
  if (code) docs.push('to-prd', 'readme-update');
  if (code && existsSync(join(ws, 'CHANGELOG.md'))) docs.push('changelog');
  if (pendingDecisions(brief).length) docs.push('to-questionnaire');
  return { graphRefresh: code, docs, audit, qa, reason: code ? 'inferred: coding goal' : 'inferred: no coding tasks' };
}

/**
 * Whether a finished goal's artifacts are due for delivery: never delivered, or run again since its last delivery began
 * (a restart, even one while it copied), while its progress folder still holds artifacts (a goal tidied up since keeps
 * the delivery it had). Told by the order of the events, not their times: a clock that stepped back, or events another
 * computer recorded, would deliver again and again. A delivery begins once the goal has finished.
 */
export function artifactsDue(engine: Engine, goal: Goal): boolean {
  if (!goal.completion.artifactsRun) return true;
  const events = engine.store.listByGoalOfTypes(goal.id, ['goal.state_changed', 'goal.artifacts_delivered']);
  const last = events.filter((e) => e.type === 'goal.artifacts_delivered').at(-1);
  if (!last) return true;
  const to = (e: (typeof events)[number]) => (e.type === 'goal.state_changed' ? (e.payload as { to: string }).to : null);
  // where it began, as it recorded it: after a state change, named by its id (numbers change in a Transfer); earlier
  // deliveries: after the goal last finished before the record
  const after = (last.payload as { startedAfter?: string }).startedAfter;
  const began = (after ? events.find((e) => e.id === after)?.seq : undefined) ?? events.filter((e) => ['done', 'over_delivered'].includes(to(e) ?? '') && e.seq < last.seq).at(-1)?.seq ?? last.seq;
  const ranAgain = events.some((e) => to(e) === 'running' && e.seq > began);
  return ranAgain && listArtifacts(goalWorkspacePath(engine.config.dataDir, goal)).length > 0;
}

/**
 * Copy the goal workspace's artifacts/ to the goal's output folder when the goal finishes, and again when it finishes
 * after it ran again (artifactsDue).
 * Never throws and never blocks the goal; the outcome lands on `goal.artifacts_delivered`.
 * Media goals without an output folder get a `skipped` record (the artifacts stay in the workspace), and so does a goal
 * that keeps artifacts but has none (no tick delivers it again); a goal that keeps no artifacts gets no record at all.
 */
export async function deliverArtifacts(engine: Engine, goal: Goal): Promise<void> {
  const { store, config } = engine;
  if (!artifactsDue(engine, goal)) return;
  const ws = goalWorkspacePath(config.dataDir, goal);
  // under the goal workspace's lock, like any landing: what an unfinished undo left laid over goes first (the goal's own
  // exports are delivered, not a task's that never landed), then what a landing could not copy comes again from the task
  // worktree kept for it, so the delivery has it
  await engine
    .withGoalWsLock(goal.id, async () => {
      await recoverOverlays(engine, goal);
      await retryUnlanded(engine, goal);
    })
    .catch((err) => store.append({ type: 'engine.note', goalId: goal.id, payload: { level: 'warn', message: `copying the files a landing missed failed: ${String((err as Error)?.message ?? err).slice(0, 200)}` } }));
  const files = listArtifacts(ws);
  const record = (payload: { status: 'ok' | 'skipped' | 'failed'; files: string[]; dest: string; detail: string; model?: string | null; startedAt?: string; startedAfter?: string; copies?: Record<string, string> }) => store.append({ type: 'goal.artifacts_delivered', goalId: goal.id, payload });
  if (!files.length) {
    if (ARTIFACT_NATURES.includes(goal.nature) || goalUsesArtifacts(engine, goal)) record({ status: 'skipped', files: [], dest: goal.outputDir ?? '', detail: 'no artifacts were produced' });
    return;
  }
  if (!goal.outputDir) {
    record({ status: 'skipped', files, dest: '', detail: `no output folder set — ${files.length} artifact(s) stay in the goal workspace (Open ▾)` });
    return;
  }
  // a file written after this moment may not be what the output folder gets: the tidy-up after a merge keeps it; and a
  // run again that begins after this event is delivered again (artifactsDue)
  const startedAt = new Date().toISOString();
  const startedAfter = store.listByGoalOfTypes(goal.id, ['goal.state_changed']).at(-1)?.id;
  // delivering again (the goal ran again): only the copies this goal made there are replaced. One changed in the output
  // folder since (edited, or another goal's delivery renamed over it), before the copy or while it ran, is left as it
  // is, and stays recorded as this goal's last copy so a later delivery leaves it too (and so does one this delivery
  // did not have); the new version stays in the progress folder, which the tidy-up after a merge then keeps
  const before = goal.completion.artifactsRun?.status === 'ok' && goal.completion.artifactsRun.dest === goal.outputDir ? goal.completion.artifactsRun.copies : undefined;
  const changedThere = (f: string) => {
    try {
      return copyIdentity(statSync(join(goal.outputDir!, f))) !== before![f];
    } catch {
      return false;
    }
  };
  try {
    // off the event loop, and renamed into place: a delivery cut short leaves the output folder's earlier copy whole.
    // Each copy as it was made: the tidy-up after a merge tells it from one another goal's delivery renames over it
    const copies: Record<string, string> = { ...before };
    const left: string[] = [];
    for (const f of files) {
      const mine = before?.[f];
      const made = mine && changedThere(f) ? null : await copyInto(join(ws, ARTIFACTS_DIR, f), join(goal.outputDir, f), mine ? { over: mine } : {});
      if (made) copies[f] = copyIdentity(made);
      else {
        left.push(f);
        copies[f] = mine!;
      }
    }
    const sent = files.filter((f) => !left.includes(f));
    // the model the CAD Viewer opens once the workspace is gone, chosen here by the files' own times (a copy's are new)
    const model = goal.nature === 'cad' ? cadModelIn(join(ws, ARTIFACTS_DIR), files) : undefined;
    const leftNote = left.length ? `; ${left.length} left as they are in the output folder, changed there since the last delivery (${left.slice(0, 3).join(', ')}${left.length > 3 ? ', …' : ''}): the new version${left.length === 1 ? ' stays' : 's stay'} in the progress folder` : '';
    record({ status: 'ok', files: sent, dest: goal.outputDir, detail: `${sent.length} artifact(s) copied${leftNote}`, startedAt, ...(startedAfter ? { startedAfter } : {}), copies, ...(model !== undefined ? { model } : {}) });
    store.append({ type: 'engine.note', goalId: goal.id, payload: { level: left.length ? 'warn' : 'info', message: `${sent.length} artifact(s) delivered to ${goal.outputDir}${leftNote}` } });
    config.log(`[completion] ${goal.id}: ${sent.length} artifact(s) → ${goal.outputDir}`);
  } catch (err) {
    record({ status: 'failed', files, dest: goal.outputDir, detail: String((err as Error).message ?? err).slice(0, 300) });
    store.append({ type: 'engine.note', goalId: goal.id, payload: { level: 'warn', message: `artifact delivery to ${goal.outputDir} failed: ${String((err as Error).message ?? err).slice(0, 200)}` } });
  }
}

/** Per-tool argv for the graph refresh; a tool that is not on PATH is recorded as skipped. */
const GRAPH_TOOLS: { name: string; args: string[] }[] = [
  { name: 'graphify', args: ['update'] },
  // index only: without it, gitnexus writes its own section into CLAUDE.md and AGENTS.md and skills into .claude
  { name: 'gitnexus', args: ['analyze', '--index-only'] },
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
  let cwd = goalWorkspacePath(config.dataDir, goal);
  if (goal.delivery.policy.mode !== 'local') {
    const pull = await pullFastForward(goal.repoPath, goal.baseBranch).catch((err) => ({ ok: false, detail: String((err as Error).message ?? err) }));
    tools.push({ name: 'pull', status: pull.ok ? 'ok' : 'skipped', detail: pull.detail });
    cwd = goal.repoPath;
  }
  // the tools refresh an index; anything they write into the agent guidance files is put back
  const guidance = snapshotGuidance(cwd);
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
  const restored = restoreGuidance(cwd, guidance);
  dropEmptyGraphDir(cwd);
  if (restored.length) store.append({ type: 'engine.note', goalId: goal.id, payload: { level: 'info', message: `graph refresh: put back ${restored.join(', ')}, which a tool had changed` } });
  store.append({ type: 'goal.completion_ran', goalId: goal.id, payload: { tools } });
  const summary = tools.map((t) => `${t.name} ${t.status}`).join(', ');
  store.append({ type: 'engine.note', goalId: goal.id, payload: { level: 'info', message: `graph refresh: ${summary}` } });
  config.log(`[completion] ${goal.id}: ${summary}`);
}
