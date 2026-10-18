/**
 * Delegated goals: a `goal` task of a main goal is done by a goal of its own — its own Clarify, plan and tasks — that
 * starts from the main goal's branch and lands back on it as the task's one commit, its artifacts with it. One level
 * only: a Delegated goal never delegates. The main goal runs one Delegated goal at a time and pauses (blocked) while
 * that goal needs the person; a Delegated goal that failed has its failed tasks restarted, as many times as the task's
 * attempt budget allows, before the main goal asks.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Budgets, Goal, GoalNature, Task } from '@foundry/core';
import { chosenStyle, getBrief, getGoal, getTask, interviewDepth, listCheckResultsByGoal, listChecks, listEscalations, listTasks, renderDecisions } from '@foundry/core';
import { maxAttemptsFor } from './attempt-loop.ts';
import { budgetStatus } from './budget.ts';
import type { Engine } from './engine.ts';
import { raiseEscalation } from './escalation.ts';
import { headerOf, taskCommitMessage } from './git/conventional.ts';
import { commitStaged, conflictedFiles, git, headRef } from './git/git.ts';
import { resolveConflicts } from './merge.ts';
import { replanAfterLanding } from './replan.ts';
import { stuckIn } from './take-back.ts';
import { copyArtifactFiles, ensureGoalWorkspace, goalWorkspacePath, trackedArtifacts } from './workspace.ts';

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n).trimEnd()} …(truncated)` : s);

/** a task done by a Delegated goal rather than by worker sessions */
export const isDelegationTask = (t: Pick<Task, 'kind'>): boolean => t.kind === 'goal';
/** a goal task between its start and its landing: its Delegated goal is at work, waits for the person, or lands */
const DELEGATING_STATES: readonly Task['state'][] = ['running', 'observing', 'merging'];
/** the goal task whose Delegated goal is under way, if any (one at a time) */
export const delegating = (tasks: Task[]): Task | undefined => tasks.find((t) => isDelegationTask(t) && DELEGATING_STATES.includes(t.state));
/** the reason a main goal is blocked while its Delegated goal needs the person (settleDelegations unblocks it by this prefix) */
const WAIT_REASON = 'waiting for the delegated goal';

/** what a task's scenario says the Delegated goal produces; general lets its Clarifier decide */
function natureFor(task: Pick<Task, 'scenario'>): GoalNature {
  switch (task.scenario) {
    case 'image':
    case 'video':
    case 'cad':
    case 'docs':
    case 'research':
      return task.scenario;
    case 'general':
      return 'auto';
    default:
      return 'code';
  }
}

/** why a Delegated goal waits for the person, or null while it works, is about to be approved by the engine, or is finished */
export function delegationNeedsHuman(engine: Engine, g: Goal): string | null {
  switch (g.state) {
    case 'blocked':
      return 'is blocked: answer its item in the Inbox';
    case 'awaiting_feedback':
      return 'paused at a milestone for your look';
    case 'awaiting_brief_approval': {
      if (!g.delegation.autoApprove) return 'waits for you to approve its Brief';
      const brief = getBrief(engine.store.db, g.id)?.brief;
      const open = brief?.questions.filter((q) => q.blocking && !q.answer?.trim()) ?? [];
      return open.length ? `has ${open.length} blocking question${open.length === 1 ? '' : 's'} on its Brief only you can answer` : null;
    }
    case 'clarifying':
      return g.interview?.status === 'awaiting_answers' ? 'asked you a question in its interview' : null;
    case 'running':
    case 'goal_review': {
      // a task of its own blocked on an escalation, a command to approve: the goal reads running, the person is still needed
      const open = listEscalations(engine.store.db, { goalId: g.id, openOnly: true });
      return open.length ? `has ${open.length} item${open.length === 1 ? '' : 's'} waiting for you in the Inbox` : null;
    }
    default:
      return null;
  }
}

/**
 * The Delegated goal for a `goal` task: the main goal's coding agent, models, discipline and view; the task's spec as its
 * prompt; the main goal's branch as its base; what is left of the main goal's budget as its own; no delivery of its own
 * (the main goal delivers). Its interview is capped so an auto-approved goal may ask nothing: the main goal's Decisions
 * are in its Clarify prompt (delegationContext).
 */
export async function createDelegatedGoal(engine: Engine, main: Goal, task: Task): Promise<Goal> {
  const b = budgetStatus(main);
  const budgets: Partial<Budgets> = {
    maxCostUsd: b.remainingUsd == null ? null : Math.max(1, Number(b.remainingUsd.toFixed(2))),
    maxDurationMin: b.maxDurationMin == null ? null : Math.max(10, Math.ceil(b.maxDurationMin - b.elapsedMin)),
    maxConcurrent: main.budgets.maxConcurrent,
    attemptsPerTask: main.budgets.attemptsPerTask,
  };
  const brief = getBrief(engine.store.db, main.id)?.brief;
  const area = task.area ? brief?.areas.find((a) => a.name === task.area) : null;
  const prompt = `${task.spec.trim()}${area?.description ? `\n\n(Area of the main goal: ${task.area} — ${area.description})` : ''}`;
  const depth = main.interview ? interviewDepth(main.interview) : 0;
  return engine.createGoal({
    provider: main.provider,
    codexModel: main.codexModelOverride,
    title: task.title,
    prompt,
    repoPath: main.repoPath,
    baseBranch: main.branch,
    budgets,
    budgetPreset: 'custom',
    selfCheck: main.selfCheck,
    milestonePause: main.milestonePause,
    interviewDepth: main.delegation.autoApprove ? Math.min(depth, 3) : depth,
    effort: main.effort,
    modelPreset: main.modelPreset,
    mode: main.mode,
    workflow: main.workflow,
    nature: natureFor(task),
    outputDir: null,
    delivery: { mode: 'local' },
    delegation: { allow: false, autoApprove: main.delegation.autoApprove },
    delegatedFrom: { goalId: main.id, taskId: task.id, title: main.title, style: brief ? chosenStyle(brief) : null },
  });
}

/**
 * The next ready `goal` task of a running main goal starts as a Delegated goal — one at a time. A task that came back to
 * ready after an answer (retry) carries on with the Delegated goal it already has.
 */
export async function startDelegations(engine: Engine, goal: Goal, tasks: Task[]): Promise<void> {
  const { store } = engine;
  if (delegating(tasks)) return;
  const next = tasks.find((t) => isDelegationTask(t) && t.state === 'ready');
  if (!next) return;
  const existing = next.delegatedGoalId ? getGoal(store.db, next.delegatedGoalId) : null;
  if (existing) {
    await resumeDelegated(engine, goal, next, existing);
    return;
  }
  try {
    const made = await createDelegatedGoal(engine, goal, next);
    store.append({ type: 'task.delegated', goalId: goal.id, payload: { taskId: next.id, goalId: made.id, title: made.title } });
    store.append({ type: 'task.state_changed', goalId: goal.id, payload: { taskId: next.id, from: 'ready', to: 'running', reason: `delegated to the goal "${made.title}" (${made.id})` } });
  } catch (err) {
    raiseEscalation(engine, { goal, task: next, trigger: 'retries_exhausted', message: `The delegated goal for "${next.title}" could not be created: ${String((err as Error)?.message ?? err)}\n\nRetry tries again; skip moves on without this step.`, payload: { kind: 'delegation' }, blockGoal: true });
  }
}

/** the task's Delegated goal goes on: a finished one lands at the next pass, a failed or cancelled one runs again, a working one is waited for */
async function resumeDelegated(engine: Engine, goal: Goal, task: Task, d: Goal): Promise<void> {
  const { store } = engine;
  if (d.state === 'failed' || d.state === 'cancelled') {
    const restarted = await restartFailedTasks(engine, d, `the main goal "${goal.title}" asked for another try`);
    if (!restarted) {
      raiseEscalation(engine, { goal, task, trigger: 'retries_exhausted', message: `The delegated goal "${d.title}" is ${d.state} and could not be restarted. Open it to see why; skip moves on without this step.`, payload: { kind: 'delegation', goalId: d.id }, blockGoal: true });
      return;
    }
  }
  store.append({ type: 'task.delegated', goalId: goal.id, payload: { taskId: task.id, goalId: d.id, title: d.title } });
  store.append({ type: 'task.state_changed', goalId: goal.id, payload: { taskId: task.id, from: 'ready', to: 'running', reason: `the delegated goal "${d.title}" goes on (${d.state.replace(/_/g, ' ')})` } });
}

/**
 * Restart a Delegated goal's failed tasks (and what depends on them): the failed tasks no failed task is above, or a
 * cancelled goal's unfinished tasks. False when nothing could be restarted. The restarted tasks are told why.
 */
async function restartFailedTasks(engine: Engine, d: Goal, why: string): Promise<string[] | null> {
  const { store } = engine;
  const tasks = listTasks(store.db, d.id);
  const failed = tasks.filter((t) => t.state === 'failed' || t.state === 'blocked');
  let roots = failed.filter((t) => !t.dependsOn.some((id) => failed.some((f) => f.id === id)));
  // a cancelled goal may have failed nothing: what it never finished runs again
  if (!roots.length && d.state === 'cancelled') roots = tasks.filter((t) => t.state === 'pending' || t.state === 'ready');
  if (!roots.length) {
    if (d.state === 'cancelled') {
      // every task finished (or was skipped): the goal only needs to carry on from where it was
      store.append({ type: 'goal.state_changed', goalId: d.id, payload: { from: 'cancelled', to: 'running', reason: why } });
      return [];
    }
    return null;
  }
  for (const r of roots) {
    const note = `The delegated goal failed at this task, and ${why}. Read what happened in the previous attempt below and take a different approach.`;
    store.append({ type: 'task.hint_set', goalId: d.id, payload: { taskId: r.id, hint: r.hint ? `${r.hint}\n\n${note}` : note, extraAttempts: 0 } });
  }
  try {
    const r = await engine.restartGoal(d.id, { fromTaskIds: roots.map((t) => t.id) });
    return r.restarted;
  } catch (err) {
    store.append({ type: 'engine.note', goalId: d.id, payload: { level: 'warn', message: `could not restart the failed tasks: ${String((err as Error)?.message ?? err)}` } });
    return null;
  }
}

/**
 * Every pass of a main goal: a Delegated goal that finished lands, one that failed is restarted (within the task's
 * attempt budget) or escalated, and the main goal is blocked while one needs the person — and goes on once none does.
 */
export async function settleDelegations(engine: Engine, goal: Goal): Promise<void> {
  const { store } = engine;
  const tasks = listTasks(store.db, goal.id).filter((t) => isDelegationTask(t) && t.delegatedGoalId && DELEGATING_STATES.includes(t.state));
  const waiting: string[] = [];
  for (const t of tasks) {
    const d = getGoal(store.db, t.delegatedGoalId!);
    if (!d) {
      if (t.state === 'running') raiseEscalation(engine, { goal, task: t, trigger: 'retries_exhausted', message: `The delegated goal doing "${t.title}" no longer exists (deleted). Retry starts a new one; skip moves on without this step.`, payload: { kind: 'delegation' }, blockGoal: true });
      continue;
    }
    if (t.state !== 'running') {
      // observing / merging: a landing under way, or one an engine restart cut short (then it lands again)
      if (!engine.landingDelegations.has(t.id)) landDelegation(engine, goal, t, d);
      continue;
    }
    if (d.state === 'done' || d.state === 'over_delivered') {
      landDelegation(engine, goal, t, d);
      continue;
    }
    if (d.state === 'failed') {
      await recoverFailedDelegation(engine, goal, t, d);
      continue;
    }
    if (d.state === 'cancelled') {
      raiseEscalation(engine, { goal, task: t, trigger: 'retries_exhausted', message: `The delegated goal "${d.title}" was cancelled. Retry restarts what it had not finished; skip moves on without this step.`, payload: { kind: 'delegation', goalId: d.id }, blockGoal: true });
      continue;
    }
    const need = delegationNeedsHuman(engine, d);
    if (need) waiting.push(`"${d.title}" ${need}`);
  }
  const fresh = getGoal(store.db, goal.id);
  if (!fresh) return;
  if (waiting.length && fresh.state === 'running') {
    store.append({ type: 'goal.state_changed', goalId: goal.id, payload: { from: 'running', to: 'blocked', reason: `${WAIT_REASON}: ${waiting.join('; ')}` } });
  } else if (!waiting.length && fresh.state === 'blocked' && blockedForDelegation(engine, fresh)) {
    const to = fresh.stateBeforeBlock && fresh.stateBeforeBlock !== 'blocked' ? fresh.stateBeforeBlock : 'running';
    store.append({ type: 'goal.state_changed', goalId: goal.id, payload: { from: 'blocked', to, reason: 'the delegated goal no longer needs you' } });
  }
}

/** the goal was blocked for a Delegated goal (not by an escalation of its own), and nothing else keeps it blocked */
function blockedForDelegation(engine: Engine, goal: Goal): boolean {
  const last = engine.store
    .listByGoalOfTypes(goal.id, ['goal.state_changed'])
    .filter((e) => (e.payload as { to: string }).to === 'blocked')
    .at(-1);
  if (!last || !String((last.payload as { reason: string }).reason).startsWith(WAIT_REASON)) return false;
  const open = listEscalations(engine.store.db, { goalId: goal.id, openOnly: true }).filter((e) => e.trigger === 'budget_exceeded' || (e.taskId === null && e.trigger === 'retries_exhausted') || !!(e.payload as { stuck?: unknown }).stuck || (e.payload as { kind?: string }).kind === 'delegation');
  return open.length === 0;
}

/** a failed Delegated goal runs its failed tasks again, as often as the task's attempt budget allows; then the person is asked */
async function recoverFailedDelegation(engine: Engine, goal: Goal, task: Task, d: Goal): Promise<void> {
  const { store } = engine;
  const n = store.listByGoalOfTypes(goal.id, ['task.delegation_restarted']).filter((e) => (e.payload as { taskId: string }).taskId === task.id).length;
  const max = Math.max(0, maxAttemptsFor(task) - 1);
  const ask = (why: string) =>
    raiseEscalation(engine, {
      goal,
      task,
      trigger: 'retries_exhausted',
      message: `The delegated goal "${d.title}" failed${n ? ` again (restarted ${n} time${n === 1 ? '' : 's'})` : ''}: ${why}\n\nOpen that goal to see what went wrong and fix it there, or retry here (its failed tasks run again, with your hint); skip moves on without this step.`,
      payload: { kind: 'delegation', goalId: d.id, restarts: n },
      blockGoal: true,
    });
  if (n >= max) {
    ask(`this task's ${maxAttemptsFor(task)} attempt${maxAttemptsFor(task) === 1 ? ' is' : 's are'} used up.`);
    return;
  }
  const restarted = await restartFailedTasks(engine, d, `the main goal "${goal.title}" restarted it (restart ${n + 1} of ${max})`);
  if (!restarted) {
    ask('it has no failed task to run again.');
    return;
  }
  store.append({ type: 'task.delegation_restarted', goalId: goal.id, payload: { taskId: task.id, goalId: d.id, restarted, n: n + 1 } });
}

/** a task of the main goal working in its goal workspace (no worktree of its own): a landing there would be folded into its commit */
function goalWorkspaceTaken(engine: Engine, goal: Goal, except: string): boolean {
  return listTasks(engine.store.db, goal.id).some((t) => t.id !== except && !isDelegationTask(t) && t.origin !== 'merge' && !t.worktreePath && (engine.isInFlight(t.id) || (!!t.baseRef && ['running', 'observing', 'merging', 'blocked', 'ready'].includes(t.state))));
}

/**
 * A finished Delegated goal lands on the main goal's branch as the task's one commit (a squash of its branch, conflicts
 * through Merge Attempts), its artifacts are copied over, and what it delivered is summarised for the tasks that depend
 * on it. Runs in the background: a landing can take minutes (merge attempts). The task reads merging meanwhile.
 */
function landDelegation(engine: Engine, goal: Goal, task: Task, d: Goal): void {
  const { store, config } = engine;
  if (engine.landingDelegations.has(task.id)) return;
  if (task.state === 'running') store.append({ type: 'task.state_changed', goalId: goal.id, payload: { taskId: task.id, from: 'running', to: 'observing', reason: `the delegated goal "${d.title}" finished ${d.state.replace(/_/g, '-')}` } });
  if (task.state !== 'merging') store.append({ type: 'task.state_changed', goalId: goal.id, payload: { taskId: task.id, from: 'observing', to: 'merging', reason: `landing ${d.branch} on ${goal.branch}` } });
  const lost = () => getTask(store.db, task.id)?.state !== 'merging' || engine.isStopped;
  const run = async () => {
    const goalWs = goalWorkspacePath(config.dataDir, goal);
    const delegatedWs = goalWorkspacePath(config.dataDir, d);
    // another task works in the goal workspace: its squash would fold this landing into its own commit — wait for it
    let noted = false;
    while (goalWorkspaceTaken(engine, goal, task.id)) {
      if (lost()) return;
      if (!noted) {
        noted = true;
        store.append({ type: 'engine.note', goalId: goal.id, payload: { level: 'info', message: `"${task.title}" is done and waits to land: a task works in the goal's folder first` } });
      }
      await Bun.sleep(2000);
    }
    const result = await engine.withGoalWsLock(goal.id, async () => {
      const held = await stuckIn(engine, goal, [goalWs]);
      if (held) return { merged: false as const, held };
      await ensureGoalWorkspace(config.dataDir, goal);
      const message = taskCommitMessage(goal, task);
      store.append({ type: 'merge.started', goalId: goal.id, payload: { taskId: task.id, into: goal.branch } });
      const squash = () => git(['merge', '--squash', '--no-commit', d.branch], goalWs);
      const r = await squash();
      let ref: string | null;
      if (r.code !== 0) {
        const files = await conflictedFiles(goalWs);
        store.append({ type: 'merge.conflict', goalId: goal.id, payload: { taskId: task.id, files } });
        store.append({ type: 'engine.note', goalId: goal.id, payload: { level: 'info', message: `landing the delegated goal "${d.title}" conflicts with what landed on ${goal.branch} meanwhile; if the merge attempts give up, merge ${goal.branch} into its folder (${delegatedWs}) by hand and retry the task` } });
        const ok = await resolveConflicts(engine, goal, task, files, { ref: d.branch, label: `the delegated goal "${d.title}" (${d.branch})`, intent: task.spec }, { cwd: goalWs, redo: async () => void (await squash()), commitMessage: message }, r.stderr);
        if (!ok) return { merged: false as const, held: null };
        ref = await headRef(goalWs);
      } else {
        const c = await commitStaged(goalWs, message);
        ref = c.committed ? c.ref : null;
      }
      store.append({ type: 'merge.completed', goalId: goal.id, payload: { taskId: task.id, ref: await headRef(goalWs) } });
      store.append({ type: 'task.committed', goalId: goal.id, payload: { taskId: task.id, ref, message } });
      // its artifacts are git-excluded, so outside the commit: every file under its artifacts/ that git tracks on neither side
      const failed: string[] = [];
      let files: string[] = [];
      if (existsSync(delegatedWs)) {
        const skip = new Set([...(await trackedArtifacts(delegatedWs)), ...(await trackedArtifacts(goalWs))]);
        files = await copyArtifactFiles(delegatedWs, goalWs, { skip, inherited: true, onError: (f) => failed.push(f) });
      }
      if (files.length || failed.length) store.append({ type: 'task.artifacts_landed', goalId: goal.id, payload: { taskId: task.id, files, ...(failed.length ? { failed } : {}) } });
      return { merged: true as const, ref, files };
    });
    if (!result.merged) {
      // held: nothing lands on a commit git would not take back; the task waits as merging and lands at a later pass.
      // Not held: the merge attempts gave up and escalated (the task is blocked; a retry lands again)
      if (result.held) store.append({ type: 'engine.note', goalId: goal.id, payload: { level: 'info', message: `"${task.title}" waits to land: ${result.held}` } });
      return;
    }
    if (lost()) return;
    // the files the task promised: its Delegated goal was held to them, so a missing one is news (a path named otherwise), not a failure
    const missing = (task.delivers ?? []).filter((f) => !existsSync(join(goalWs, f)));
    if (missing.length) store.append({ type: 'engine.note', goalId: goal.id, payload: { level: 'warn', message: `"${task.title}" landed, but ${missing.length === 1 ? 'a file it promised is' : 'files it promised are'} not on the goal branch: ${missing.join(', ')} — the tasks after it were told to expect ${missing.length === 1 ? 'it' : 'them'}` } });
    store.append({ type: 'task.summary_set', goalId: goal.id, payload: { taskId: task.id, summary: summarizeDelegatedGoal(engine, d, result.files, result.ref) } });
    // the planner's touch-up of the tasks after it, while they still cannot start (this task reads merging until it is done)
    await replanAfterLanding(engine, getGoal(store.db, goal.id) ?? goal, getTask(store.db, task.id)!).catch((err) => store.append({ type: 'engine.note', goalId: goal.id, payload: { level: 'warn', message: `the replan after "${task.title}" landed crashed: ${String((err as Error)?.message ?? err).slice(0, 300)}` } }));
    if (lost()) return;
    store.append({ type: 'task.state_changed', goalId: goal.id, payload: { taskId: task.id, from: 'merging', to: 'done', reason: result.ref ? `the delegated goal landed as ${result.ref.slice(0, 7)} on the goal branch` : 'the delegated goal landed (no changes to commit)' } });
    engine.retryAutoskillsAfterTask(goal.id);
    const now = getGoal(store.db, goal.id);
    if (now) {
      await engine.preview.restartIfRunning(now);
      await engine.afterIntegration(now, getTask(store.db, task.id)!);
    }
  };
  engine.landingDelegations.set(
    task.id,
    run()
      .catch((err) => void (engine.isStopped || store.append({ type: 'engine.note', goalId: goal.id, payload: { level: 'error', message: `landing the delegated goal "${d.title}" crashed: ${String((err as Error)?.stack ?? err)}` } })))
      .finally(() => {
        engine.landingDelegations.delete(task.id);
        engine.tick(goal.id);
      }),
  );
}

/**
 * What a Delegated goal delivered, for the tasks that depend on it: what it set out to do, its tasks and how they ended,
 * the Decisions made there, its review, what it left open, and the files it put under artifacts/. Bounded: every
 * dependent task's prompt carries it. Written once, without a model.
 */
export function summarizeDelegatedGoal(engine: Engine, d: Goal, files: string[], ref: string | null): string {
  const db = engine.store.db;
  const parts = [`## ${d.title}\nDone by the delegated goal ${d.id}, which ended ${d.state.replace(/_/g, '-')}${ref ? ` and landed as commit ${ref.slice(0, 7)}` : ', with no changes to commit'}.`];
  const b = getBrief(db, d.id);
  if (b?.brief.understanding.trim()) parts.push(`What it set out to do: ${clip(b.brief.understanding.trim(), 800)}`);
  const tasks = listTasks(db, d.id).filter((t) => t.origin !== 'merge');
  if (tasks.length) {
    const lines = tasks.slice(0, 30).map((t) => `- [${t.state}] ${clip(t.title, 100)}${t.commitRef ? ` (${t.commitRef.slice(0, 7)})` : ''}`);
    if (tasks.length > 30) lines.push(`- … and ${tasks.length - 30} more`);
    parts.push(`What it did:\n${lines.join('\n')}`);
  }
  if (b?.approved) {
    const decisions = renderDecisions(b.brief, 'Decisions made there');
    if (decisions) parts.push(clip(decisions, 1200));
  }
  const review = [...engine.store.listByGoal(d.id, 5000)].reverse().find((e) => e.type === 'review.goal.finished')?.payload as { passed: boolean; overDelivered: boolean; notes: string } | undefined;
  if (review) parts.push(`Its review ${review.overDelivered ? 'passed, over-delivered' : review.passed ? 'passed' : 'did not pass'}${review.notes?.trim() ? `: ${clip(review.notes.trim(), 600)}` : '.'}`);
  const open: string[] = tasks.filter((t) => t.state === 'skipped').map((t) => `the task "${clip(t.title, 100)}" was skipped by the human`);
  const latest = new Map(listCheckResultsByGoal(db, d.id).map((r) => [r.checkId, r.status]));
  for (const c of listChecks(db, d.id).filter((c) => c.tier === 'stretch' && latest.get(c.id) !== 'pass').slice(0, 10)) open.push(`the stretch check "${clip(c.name, 120)}" is not met`);
  if (open.length) parts.push(`Left open:\n${open.map((o) => `- ${o}`).join('\n')}`);
  if (files.length) {
    const lines = files.slice(0, 40).map((f) => `- artifacts/${f}`);
    if (files.length > 40) lines.push(`- … and ${files.length - 40} more`);
    parts.push(`Files it delivered under artifacts/ in this workspace (not in git):\n${lines.join('\n')}`);
  }
  return clip(parts.join('\n\n'), 6000);
}

/**
 * The `# What the steps before this one delivered` section of a worker prompt (and of a Delegated goal's Clarify): the
 * summaries of the tasks this one depends on, or, for a task without one, the commit it landed as. '' when there is
 * nothing to say.
 */
export function renderUpstream(engine: Engine, task: Pick<Task, 'dependsOn'>): string {
  const db = engine.store.db;
  const lines: string[] = [];
  for (const id of task.dependsOn) {
    const d = getTask(db, id);
    if (!d) continue;
    const files = d.delivers?.length ? `\nFiles it leaves for you:\n${d.delivers.map((f) => `- ${f}`).join('\n')}` : '';
    if (d.summary) lines.push(`${d.summary}${files}`);
    else if (d.state === 'done') lines.push(`## ${d.title}\n${d.commitRef ? `Landed as commit ${d.commitRef.slice(0, 7)}${d.commitMessage ? `: ${headerOf(d.commitMessage)}` : ''}` : 'Landed with no changes to commit'}.${files}`);
    else if (d.state === 'skipped') lines.push(`## ${d.title}\nSkipped by the human: its work was not done.`);
  }
  if (!lines.length) return '';
  return clip(`# What the steps before this one delivered\nThis task builds on them: use what they made, do not redo or undo it.\n\n${lines.join('\n\n')}`, 9000);
}

/**
 * The `# Part of a larger goal` section of a Delegated goal's Clarify and planner prompts: the main goal, what was
 * understood and decided there, what the steps before this one delivered, and how to ask (prefer assumptions). '' for a
 * goal that is not delegated.
 */
export function delegationContext(engine: Engine, goal: Goal): string {
  const from = goal.delegatedFrom;
  if (!from) return '';
  const db = engine.store.db;
  const main = getGoal(db, from.goalId);
  const task = getTask(db, from.taskId);
  const parts = [
    `# Part of a larger goal\nThis goal is one step of the main goal "${from.title}"${main ? ` (${main.state.replace(/_/g, '-')})` : ' (since deleted)'}${task ? `: its task "${task.title}"` : ''}. Do that step in full and well, and nothing beyond it: the other steps are the main goal's other tasks. The branch you work on holds the main goal's work so far — build on it and do not undo it.`,
  ];
  if (main) parts.push(`## What the main goal asks for\n${clip(main.prompt.trim(), 2500)}`);
  const b = main ? getBrief(db, main.id) : null;
  if (b?.approved) {
    if (b.brief.understanding.trim()) parts.push(`## What was understood about the main goal\n${clip(b.brief.understanding.trim(), 1500)}`);
    const decisions = renderDecisions(b.brief, '## Decisions the human made on the main goal');
    if (decisions) parts.push(`${clip(decisions, 2500)}\nThey are settled for this goal too: do not ask about them again.`);
  }
  if (task) {
    const upstream = renderUpstream(engine, task);
    if (upstream) parts.push(upstream.replace(/^# /, '## '));
    if (task.delivers?.length) parts.push(`## What this goal must deliver\nThe main goal's next steps read these files; each must exist on the branch when this goal is done (they are its must checks):\n${task.delivers.map((f) => `- ${f}`).join('\n')}`);
  }
  parts.push('## Asking the human\nThe main goal was interviewed and its Brief approved already. Prefer assumptions; ask only what a wrong guess would waste this goal over and nothing above answers.');
  return clip(parts.join('\n\n'), 12000);
}

/**
 * A Delegated goal whose main goal allows it is approved by the engine once its Brief is in, unless a blocking question
 * is left for the person (then the main goal waits). No completion actions of its own: the main goal documents and
 * refreshes the graph once everything has landed.
 */
export function autoApproveDelegated(engine: Engine, goal: Goal): void {
  const { store } = engine;
  if (!goal.delegatedFrom || !goal.delegation.autoApprove || goal.state !== 'awaiting_brief_approval') return;
  if (engine.investigating.has(goal.id) || engine.approvingDelegated.has(goal.id)) return;
  const brief = getBrief(store.db, goal.id)?.brief;
  if (!brief || brief.questions.some((q) => q.blocking && !q.answer?.trim())) return;
  const main = goal.delegatedFrom.title;
  engine.approvingDelegated.set(
    goal.id,
    engine
      .approveBrief(goal.id, undefined, undefined, { graphRefresh: false, docs: [], audit: false })
      .then(() => void store.append({ type: 'engine.note', goalId: goal.id, payload: { level: 'info', message: `Brief approved by the engine: the main goal "${main}" approves its delegated goals itself` } }))
      .catch((err) => void (engine.isStopped || store.append({ type: 'engine.note', goalId: goal.id, payload: { level: 'warn', message: `the Brief could not be approved by the engine (${String((err as Error)?.message ?? err)}); approve it yourself` } })))
      .finally(() => engine.approvingDelegated.delete(goal.id)),
  );
}
