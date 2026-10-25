/**
 * Adjust the result (ADR-0077): a finished goal takes the person's words on its result — what should change, with the
 * pictures or files they give — and carries them out itself, as the goal it is. Never a new goal, never a chat:
 * - a goal of one finished task resumes that task's session, which knows the work it did, with the words (`resume`);
 * - a goal of several tasks gets a task appended after the finished ones, a fresh session given what they delivered (`task`);
 * - a failed goal runs its failed tasks again with the words (`restart`).
 * Before anything changes, the result as it stands goes to `artifacts/.history/<n>/` (the artifacts and a figure's pages),
 * so each earlier version can still be opened. The checks and the reviewers run again as for any task; the output folder
 * gets the new files, and a pushed branch or an open pull request the new commit. It costs the goal, inside its budget.
 */
import { existsSync, readdirSync } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type { Adjustment, AdjustmentMode, Attachment, Check, Goal, Task, TaskScenario } from '@foundry/core';
import { ADJUST_ATTACHMENTS_MAX, ARTIFACTS_HISTORY_DIR, IdPrefix, getBrief, getGoal, getTask, isHistory, listAttempts, listChecks, listTasks, newId, repoHere } from '@foundry/core';
import { attachmentAbsPath } from './attachments.ts';
import { budgetStatus } from './budget.ts';
import { FIGURE_CHECK_NAME, figurePages } from './checks/figure.ts';
import type { Engine } from './engine.ts';
import { headRef } from './git/git.ts';
import { ARTIFACTS_DIR, copyInto, goalWorkspacePath, listArtifacts } from './workspace.ts';

export class AdjustError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

/** the manifest written beside a kept version: what it is and when */
const MANIFEST = 'manifest.json';
const FINISHED = new Set(['done', 'over_delivered', 'failed']);
/** deliveries that take the new commit without anything new chosen: the branch is pushed again, the pull request updated */
const CARRIES_ON = new Set(['pushed', 'pr_open', 'automerge_armed']);

/** what an Adjustment of this goal would do now, or why none can be made */
export function adjustPlan(engine: Engine, goal: Goal): { mode: AdjustmentMode; taskIds: string[] } | { refused: string } {
  if (!FINISHED.has(goal.state)) {
    if (goal.state === 'cancelled') return { refused: 'the goal was cancelled: restart it, or start a follow-up' };
    return { refused: 'the goal is still at work: adjust its result once it has finished' };
  }
  if (isHistory(goal) || !repoHere(goal)) return { refused: 'an imported goal held as history: its repository is not on this computer' };
  if (goal.delegatedFrom) return { refused: 'a Delegated goal: adjust its main goal, whose result it is part of' };
  if (goal.delivery.status === 'running') return { refused: 'its delivery is under way: adjust it once that has finished' };
  if (goal.delivery.cleanup?.done || goal.delivery.outcome === 'merged') return { refused: 'its work was merged: start a follow-up for the change' };
  if (!existsSync(goalWorkspacePath(engine.config.dataDir, goal))) return { refused: 'its progress folder is gone: start a follow-up for the change' };
  const b = budgetStatus(goal);
  if (b.exceeded) return { refused: `its ${b.exceeded === 'cost' ? 'cost' : 'time'} budget is used up: raise it under Budget first` };
  const tasks = listTasks(engine.store.db, goal.id);
  if (!getBrief(engine.store.db, goal.id)?.approved || !tasks.length) return { refused: 'the goal never got to work: restart it instead' };
  if (goal.state === 'failed') {
    const failed = tasks.filter((t) => (t.state === 'failed' || t.state === 'blocked') && t.kind !== 'goal');
    if (failed.length) return { mode: 'restart', taskIds: failed.map((t) => t.id) };
  }
  // one task did the whole goal and its session is still there to resume: it knows the work it did
  const work = tasks.filter((t) => t.origin !== 'merge');
  const only = work.length === 1 ? work[0]! : null;
  if (only && only.state === 'done' && only.kind !== 'goal') {
    const last = listAttempts(engine.store.db, only.id)
      .filter((a) => a.kind === 'work')
      .at(-1);
    if (last && last.state === 'passed' && last.sessionId && last.cwd && existsSync(last.cwd)) return { mode: 'resume', taskIds: [only.id] };
  }
  return { mode: 'task', taskIds: [] };
}

export interface AdjustView {
  /** Settings → Beta → Adjust the result is on */
  enabled: boolean;
  can: boolean;
  /** why not, when `can` is false */
  reason: string | null;
  mode: AdjustmentMode | null;
  /** the number the next Adjustment gets */
  next: number;
  /** the Adjustments made, oldest first, each with the files of the version kept before it (under artifacts/.history/<n>/) */
  history: (Adjustment & { files: string[] })[];
}

/** the goal page's view of Adjust (ADR-0077) */
export function adjustView(engine: Engine, goal: Goal): AdjustView {
  const enabled = engine.config.betaAdjust;
  const plan = enabled ? adjustPlan(engine, goal) : { refused: 'Adjust the result is off: Settings → Beta' };
  const ws = goalWorkspacePath(engine.config.dataDir, goal);
  return {
    enabled,
    can: !('refused' in plan),
    reason: 'refused' in plan ? plan.refused : null,
    mode: 'refused' in plan ? null : plan.mode,
    next: (goal.adjustments ?? []).length + 1,
    history: (goal.adjustments ?? []).map((a) => ({ ...a, files: versionFiles(ws, a.n) })),
  };
}

/** the files of the version kept before Adjustment n, relative to `artifacts/.history/<n>/` (none when nothing was kept) */
export function versionFiles(ws: string, n: number): string[] {
  const root = join(ws, ARTIFACTS_DIR, ARTIFACTS_HISTORY_DIR, String(n));
  if (!existsSync(root)) return [];
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(dir, e.name));
      else if (e.isFile() && !(dir === root && e.name === MANIFEST)) out.push(relative(root, join(dir, e.name)));
    }
  };
  walk(root);
  return out.sort();
}

/**
 * The result as it stands goes to `artifacts/.history/<n>/` before Adjustment n changes it: every artifact at its path
 * under artifacts/, and the pages named (repo-relative, a figure's committed pages) at theirs; a manifest says what and
 * when. Nothing kept when there is nothing to keep. A copy that fails throws before anything of the goal changed.
 */
export async function snapshotResult(ws: string, n: number, meta: { adjustment: Pick<Adjustment, 'id' | 'text' | 'at'>; pages?: string[] }): Promise<string[]> {
  const files = listArtifacts(ws);
  const pages = (meta.pages ?? []).filter((p) => !p.startsWith(`${ARTIFACTS_DIR}/`) && existsSync(join(ws, p)));
  if (!files.length && !pages.length) return [];
  const root = join(ws, ARTIFACTS_DIR, ARTIFACTS_HISTORY_DIR, String(n));
  await rm(root, { recursive: true, force: true });
  const kept: string[] = [];
  for (const f of files) {
    await copyInto(join(ws, ARTIFACTS_DIR, f), join(root, f));
    kept.push(f);
  }
  for (const p of pages) {
    await copyInto(join(ws, p), join(root, p));
    kept.push(p);
  }
  await writeFile(join(root, MANIFEST), JSON.stringify({ n, at: meta.adjustment.at, adjustment: { id: meta.adjustment.id, text: meta.adjustment.text }, files: kept }, null, 2));
  return kept;
}

/** what a session is told about an Adjustment: the words and where the files and links are */
export interface AdjustmentContext {
  n: number;
  text: string;
  files: { name: string; path: string }[];
  links: string[];
}

export function adjustmentContext(goal: Pick<Goal, 'id' | 'attachments'>, adjustment: Adjustment, dataDir: string): AdjustmentContext {
  const atts = goal.attachments.filter((a) => a.adjustId === adjustment.id || adjustment.attachmentIds.includes(a.id));
  return {
    n: adjustment.n,
    text: adjustment.text,
    files: atts.filter((a) => a.kind === 'file').map((a) => ({ name: a.name, path: attachmentAbsPath(dataDir, goal.id, a) ?? a.name })),
    links: atts.filter((a) => a.kind === 'link' && a.url).map((a) => a.url!),
  };
}

const given = (c: AdjustmentContext): string => {
  const files = c.files.length ? `\n\nFiles they gave, read them from these paths:\n${c.files.map((f) => `- ${f.path} (${f.name})`).join('\n')}` : '';
  const links = c.links.length ? `\n\nLinks they gave:\n${c.links.map((l) => `- ${l}`).join('\n')}` : '';
  return `${files}${links}`;
};

/**
 * Prompt section for a task carrying out an Adjustment: a fresh attempt of the resumed or restarted task, and its
 * reviewer. The resumed session itself is told in its continuation message (attempt-loop.ts).
 */
export function renderAdjustment(goal: Pick<Goal, 'id' | 'attachments'>, adjustment: Adjustment, dataDir: string, opts: { forReviewer?: boolean } = {}): string {
  const c = adjustmentContext(goal, adjustment, dataDir);
  const tail = opts.forReviewer
    ? 'This task ran and landed before; the diff is the adjustment alone. Judge whether it does what the person asked, and nothing the person did not ask for.'
    : 'This task ran and landed before; the person looked at the result and asks for this change. Build on what is in the workspace — the goal branch holds the task\'s work — change only what the adjustment needs, keep what the person did not name, and run the acceptance checks again before you stop. `artifacts/.history/` keeps the earlier result: leave it alone.';
  return `# Adjustment asked by the person (adjustment ${c.n})\n${c.text}${given(c)}\n\n${tail}`;
}

/** for the goal reviewer: every Adjustment the goal was asked for, the latest being what this run of the goal did */
export function renderAdjustments(goal: Pick<Goal, 'id' | 'attachments' | 'adjustments'>, dataDir: string): string {
  const all = goal.adjustments ?? [];
  if (!all.length) return '';
  const lines = all.map((a) => {
    const c = adjustmentContext(goal, a, dataDir);
    return `${a.n}. ${a.text}${c.files.length ? ` (files: ${c.files.map((f) => f.path).join(', ')})` : ''}${c.links.length ? ` (links: ${c.links.join(', ')})` : ''}`;
  });
  return `# Adjustments asked by the person\nAfter the goal first finished, the person looked at the result and asked for these, in order; the goal ran again for each. The latest is what this run did — judge that it was honoured, with the rest of the result still as the checks ask.\n${lines.join('\n')}`;
}

/** the spec of a task appended for an Adjustment: the words, the files, and how it sits with the finished work */
function appendedSpec(c: AdjustmentContext): string {
  return `The person looked at the finished result of this goal and asks for an adjustment (adjustment ${c.n}):\n\n${c.text}${given(c)}\n\nWhat the goal delivered is on the goal branch, and "What the steps before this one delivered" below says what each step made. Carry out the adjustment and nothing else: do not redo finished work, keep what the person did not name, and leave \`artifacts/.history/\` alone (it keeps the earlier result). Run the acceptance checks before you stop.`;
}

/** the scenario of an appended task: what most of the goal's tasks were, else its nature */
function scenarioFor(goal: Goal, tasks: Task[]): TaskScenario {
  const counts = new Map<TaskScenario, number>();
  for (const t of tasks) if (t.origin === 'brief') counts.set(t.scenario, (counts.get(t.scenario) ?? 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (top) return top;
  return goal.nature === 'figure' || goal.nature === 'image' || goal.nature === 'video' || goal.nature === 'cad' ? goal.nature : 'general';
}

const firstLine = (text: string, max = 60): string => {
  const line = text.split('\n').find((l) => l.trim())?.trim() ?? text.trim();
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
};

/**
 * Adjust a finished goal's result (ADR-0077). The staged uploads become attachments of the goal marked with the
 * Adjustment; the result as it stands is kept aside first; then the goal runs again the way `adjustPlan` says.
 */
export async function adjustGoal(engine: Engine, goalId: string, textIn: string, opts: { by?: string | null; attachments?: Attachment[] } = {}): Promise<Adjustment> {
  const { store, config } = engine;
  if (!config.betaAdjust) throw new AdjustError('Adjust the result is a beta feature: turn on Settings → Beta → Adjust the result first', 400);
  const goal = getGoal(store.db, goalId);
  if (!goal) throw new AdjustError('goal not found', 404);
  const text = textIn.trim();
  if (!text) throw new AdjustError('say what should change', 400);
  if (text.length > 20_000) throw new AdjustError('an adjustment is a note, not a document: keep it under 20,000 characters (attach the rest as a file)', 400);
  const staged = opts.attachments ?? [];
  if (staged.length > ADJUST_ATTACHMENTS_MAX) throw new AdjustError(`an adjustment takes at most ${ADJUST_ATTACHMENTS_MAX} files`, 400);
  const plan = adjustPlan(engine, goal);
  if ('refused' in plan) throw new AdjustError(plan.refused, 409);
  if (engine.adjusting.has(goalId)) throw new AdjustError('an adjustment of this goal is being set up', 409);
  engine.adjusting.add(goalId);
  try {
    const tasks = listTasks(store.db, goalId);
    const n = (goal.adjustments ?? []).length + 1;
    const id = newId(IdPrefix.adjust);
    const at = new Date().toISOString();
    const ws = goalWorkspacePath(config.dataDir, goal);
    // the result as it stands is kept before anything changes: the artifacts, and a figure's committed pages
    const pages = tasks.filter((t) => t.scenario === 'figure' && t.state === 'done').flatMap((t) => figurePages(ws, t).map((p) => relative(ws, p)));
    try {
      await snapshotResult(ws, n, { adjustment: { id, text, at }, pages });
    } catch (err) {
      throw new AdjustError(`the result could not be kept aside before the adjustment: ${String((err as Error).message ?? err)}`, 500);
    }
    // the files given become attachments of the goal, marked with this Adjustment (AttachmentError when one expired)
    const attachments: Attachment[] = staged.length ? engine.claimUploads(goalId, staged, goal.attachments.length).map((a) => ({ ...a, adjustId: id })) : [];
    for (const a of attachments) store.append({ type: 'goal.attachment_added', goalId, payload: { attachment: a } });
    const adjustment: Adjustment = { id, n, text, mode: plan.mode, taskId: plan.taskIds[0] ?? null, attachmentIds: attachments.map((a) => a.id), at, by: opts.by ?? null };
    const fresh = getGoal(store.db, goalId)!;
    const context = adjustmentContext(fresh, adjustment, config.dataDir);
    switch (plan.mode) {
      case 'restart': {
        // the failed tasks run again, each given the words; restartGoal sets the goal running
        store.append({ type: 'goal.adjusted', goalId, payload: { adjustment } });
        for (const taskId of plan.taskIds) store.append({ type: 'task.adjustment_set', goalId, payload: { taskId, adjustment } });
        await engine.restartGoal(goalId, { fromTaskIds: plan.taskIds, by: `adjustment ${n}` });
        return adjustment;
      }
      case 'resume': {
        const taskId = plan.taskIds[0]!;
        const task = getTask(store.db, taskId)!;
        store.append({ type: 'goal.adjusted', goalId, payload: { adjustment } });
        store.append({ type: 'task.adjustment_set', goalId, payload: { taskId, adjustment } });
        // the squash target moves to the branch as it stands: the adjustment lands as a commit of its own on top of the
        // task's, and the reviewer judges it alone — history already pushed is never rewritten
        store.append({ type: 'task.base_ref', goalId, payload: { taskId, ref: await headRef(ws) } });
        // one fresh attempt beyond the budget, should the resumed session not pass its checks
        store.append({ type: 'task.hint_set', goalId, payload: { taskId, hint: task.hint, extraAttempts: 1 } });
        store.append({ type: 'task.state_changed', goalId, payload: { taskId, from: task.state, to: 'ready', reason: `adjustment ${n}: ${firstLine(text)}` } });
        break;
      }
      case 'task': {
        // a task after every finished one, a fresh session told what they delivered; it gets the goal's must commands
        // like a fix task, and a figure task's page check
        const done = tasks.filter((t) => t.state === 'done' || t.state === 'skipped');
        const scenario = scenarioFor(goal, tasks);
        const task: Task = {
          id: newId(IdPrefix.task),
          goalId,
          title: `Adjustment ${n}: ${firstLine(text)}`,
          spec: appendedSpec(context),
          kind: 'feature',
          scope: null,
          scenario,
          area: null,
          tdd: 'inherit',
          dependsOn: done.map((t) => t.id),
          relevantFiles: [],
          parallelizable: false,
          retryBudget: goal.budgets.attemptsPerTask,
          origin: 'adjustment',
          milestone: null,
          milestoneVisits: 0,
          checkpointOf: null,
          difficulty: 'standard',
          state: 'pending',
          branch: null,
          worktreePath: null,
          baseRef: null,
          commitRef: null,
          commitMessage: null,
          hint: null,
          extraAttempts: 0,
          needs: [],
          delegatedGoalId: null,
          summary: null,
          adjustment: null,
          createdAt: at,
          updatedAt: at,
        };
        store.append({ type: 'goal.adjusted', goalId, payload: { adjustment: { ...adjustment, taskId: task.id } } });
        store.append({ type: 'task.created', goalId, payload: { task } });
        for (const chk of listChecks(store.db, goalId).filter((x) => x.taskId === null && x.tier === 'must' && x.spec.type === 'command')) {
          store.append({ type: 'check.created', goalId, payload: { check: { ...chk, id: newId(IdPrefix.check), taskId: task.id } } });
        }
        if (scenario === 'figure') {
          const check: Check = { id: newId(IdPrefix.check), goalId, taskId: task.id, name: FIGURE_CHECK_NAME, tier: 'must', spec: { type: 'figure' } };
          store.append({ type: 'check.created', goalId, payload: { check } });
        }
        break;
      }
    }
    store.append({ type: 'goal.state_changed', goalId, payload: { from: goal.state, to: 'running', reason: `adjustment ${n}: ${firstLine(text)}` } });
    engine.tick(goalId);
    return getGoal(store.db, goalId)!.adjustments!.find((a) => a.id === id) ?? adjustment;
  } finally {
    engine.adjusting.delete(goalId);
  }
}

/**
 * A finished goal whose branch is already out — pushed, or a pull request open — and adjusted since: the delivery
 * carries on with the new commit (resumeDelivery), nothing new chosen. Told by the order of the events: an Adjustment
 * after the last time a delivery was set going.
 */
export function adjustedSinceDelivery(engine: Engine, goal: Goal): boolean {
  if (goal.delivery.status !== 'delivered' || !goal.delivery.outcome || !CARRIES_ON.has(goal.delivery.outcome) || !(goal.adjustments ?? []).length) return false;
  const events = engine.store.listByGoalOfTypes(goal.id, ['goal.adjusted', 'delivery.policy_set']);
  const lastAdjusted = events.filter((e) => e.type === 'goal.adjusted').at(-1);
  const lastSet = events.filter((e) => e.type === 'delivery.policy_set').at(-1);
  return !!lastAdjusted && (!lastSet || lastAdjusted.seq > lastSet.seq);
}
