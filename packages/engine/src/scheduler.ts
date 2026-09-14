import type { Goal, Task } from '@foundry/core';
import { listTasks, getTask, getGoal, listAttempts, getObservation } from '@foundry/core';
import { type Continuation, continuationMessage, decideNext, maxAttemptsFor, runAttempt } from './attempt-loop.ts';
import { budgetStatus } from './budget.ts';
import type { Engine } from './engine.ts';
import { dueCheckpoint, openCheckpoint } from './checkpoint.ts';
import { raiseEscalation } from './escalation.ts';
import { headRef } from './git/git.ts';
import { integrateTask } from './merge.ts';
import { catchUp, filesOverlap } from './catchup.ts';
import { existsSync } from 'node:fs';
import { excludeFromGit } from './skills/autoskills.ts';
import { copyArtifacts, dropTaskWorkspace, ensureGoalWorkspace, ensureTaskWorkspace, goalWorkspacePath } from './workspace.ts';

/**
 * One scheduling pass for a running goal. Idempotent; called after every event.
 */
export async function schedule(engine: Engine, goal: Goal): Promise<void> {
  const { store } = engine;
  let tasks = listTasks(store.db, goal.id);

  // 1. cascade failures: a pending task whose dependency failed can never run
  for (const t of tasks) {
    if (t.state === 'pending' && t.dependsOn.some((d) => tasks.find((x) => x.id === d)?.state === 'failed')) {
      store.append({ type: 'task.state_changed', goalId: goal.id, payload: { taskId: t.id, from: 'pending', to: 'failed', reason: 'dependency failed' } });
    }
  }
  tasks = listTasks(store.db, goal.id);

  // 2. promote pending → ready (a skipped dependency counts as satisfied: the human chose to move on)
  const satisfied = (s: Task['state'] | undefined) => s === 'done' || s === 'skipped';
  for (const t of tasks) {
    if (t.state === 'pending' && t.dependsOn.every((d) => satisfied(tasks.find((x) => x.id === d)?.state))) {
      store.append({ type: 'task.state_changed', goalId: goal.id, payload: { taskId: t.id, from: 'pending', to: 'ready', reason: 'dependencies done' } });
    }
  }
  tasks = listTasks(store.db, goal.id);

  // 2b. a milestone landed (or a feedback fix for one): launch nothing more, let in-flight work land, then pause for the human
  const due = dueCheckpoint(tasks);
  if (due) {
    if (engine.inFlightForGoal(goal.id).length === 0) await openCheckpoint(engine, goal, due);
    return;
  }

  // 3. all terminal?
  if (tasks.length && tasks.every((t) => t.state === 'done' || t.state === 'failed' || t.state === 'skipped')) {
    if (tasks.some((t) => t.state === 'failed')) {
      store.append({ type: 'goal.state_changed', goalId: goal.id, payload: { from: 'running', to: 'failed', reason: `${tasks.filter((t) => t.state === 'failed').length} task(s) failed` } });
    } else {
      const skipped = tasks.filter((t) => t.state === 'skipped').length;
      store.append({ type: 'goal.state_changed', goalId: goal.id, payload: { from: 'running', to: 'goal_review', reason: skipped ? `all tasks done (${skipped} skipped by you)` : 'all tasks done' } });
    }
    return;
  }

  // 4. budget
  const b = budgetStatus(goal);
  if (b.exceeded) {
    raiseEscalation(engine, {
      goal,
      trigger: 'budget_exceeded',
      message: b.exceeded === 'cost' ? `Cost $${b.costUsd.toFixed(2)} reached the budget of $${(b.maxCostUsd ?? 0).toFixed(2)}.` : `Elapsed ${b.elapsedMin.toFixed(0)} min reached the limit of ${b.maxDurationMin} min.`,
      payload: { ...b },
      blockGoal: true,
    });
    return;
  }

  // 5. start ready tasks within capacity
  const inFlight = engine.inFlightForGoal(goal.id);
  let capacity = Math.max(0, goal.budgets.maxConcurrent - inFlight.length);
  const ready = tasks.filter((t) => t.state === 'ready' && !engine.isInFlight(t.id));
  const goalWsBusy = tasks.some((t) => engine.isInFlight(t.id) && !t.worktreePath);
  const started: Task[] = [];
  for (const t of ready) {
    if (capacity <= 0) break;
    // Workspace policy: a task runs in the goal workspace only if it is the sole active task;
    // otherwise it gets its own worktree (sticky for the task's lifetime).
    const others = tasks.filter((x) => x.id !== t.id && (engine.isInFlight(x.id) || (x.state === 'ready' && x.parallelizable)));
    const useOwnWorktree = t.worktreePath != null || goalWsBusy || (t.parallelizable && others.length > 0);
    if (!t.parallelizable && inFlight.length > 0) {
      // serial task waits for quiet — say so once, so "ready but not running" is not a mystery
      if (!engine.overlapNoted.has(t.id)) {
        engine.overlapNoted.add(t.id);
        store.append({ type: 'engine.note', goalId: goal.id, payload: { level: 'info', message: `"${t.title}" is not parallelizable; it starts when ${tasks.filter((x) => inFlight.includes(x.id)).map((x) => `"${x.title}"`).join(', ') || 'the running task'} finishes` } });
      }
      continue;
    }
    if (!useOwnWorktree && inFlight.length > 0) continue; // goal workspace in use
    // Conflict avoidance: two tasks that declare the same files do not run at the same time, whatever the Brief says
    const active = [...tasks.filter((x) => inFlight.includes(x.id)), ...started];
    const clash = active.find((x) => filesOverlap(t.relevantFiles, x.relevantFiles).length > 0);
    if (clash) {
      if (!engine.overlapNoted.has(t.id)) {
        engine.overlapNoted.add(t.id);
        store.append({ type: 'engine.note', goalId: goal.id, payload: { level: 'info', message: `"${t.title}" waits for "${clash.title}": both touch ${filesOverlap(t.relevantFiles, clash.relevantFiles).slice(0, 3).join(', ')}` } });
      }
      continue;
    }
    capacity--;
    started.push(t);
    void startTask(engine, goal, t, useOwnWorktree);
  }
}

async function startTask(engine: Engine, goal: Goal, task: Task, ownWorktree: boolean): Promise<void> {
  const { store, config } = engine;
  engine.reserve(task.id);
  try {
    let cwd = await ensureGoalWorkspace(config.dataDir, goal);
    // project skills (autoskills) are installed into the goal workspace right after approval; give them a moment
    await engine.awaitAutoskills(goal.id);
    // optional: when nothing else is running, bring a moved base branch in before this task starts
    if (!engine.inFlightForGoal(goal.id).some((id) => id !== task.id)) await engine.refreshBase(getGoal(store.db, goal.id)!).catch((err) => config.log(`[sync] refresh failed: ${err}`));
    // the goal-branch commit the task starts from: its attempts are squashed onto it when the task completes
    if (!task.baseRef) store.append({ type: 'task.base_ref', goalId: goal.id, payload: { taskId: task.id, ref: await headRef(cwd) } });
    if (ownWorktree) {
      if (task.worktreePath && !existsSync(task.worktreePath)) {
        // the worktree was dropped (task finished earlier, then restarted; or cleaned by hand): start over from the goal branch
        store.append({ type: 'engine.note', goalId: goal.id, payload: { level: 'warn', message: `worktree of "${task.title}" is missing (${task.worktreePath}); recreating it from the goal branch` } });
        task = { ...task, worktreePath: null, branch: null };
      }
      if (!task.worktreePath) {
        const ws = await ensureTaskWorkspace(config.dataDir, goal, task);
        store.append({ type: 'task.workspace_assigned', goalId: goal.id, payload: { taskId: task.id, branch: ws.branch, worktreePath: ws.path } });
        cwd = ws.path;
      } else cwd = task.worktreePath;
    }
    // media tasks generate into artifacts/, which must never reach a commit (info/exclude is shared by all
    // worktrees); the leading slash anchors to the workspace root so docs/artifacts/ manifests stay tracked
    if (task.scenario === 'image' || task.scenario === 'video') await excludeFromGit(cwd, ['/artifacts/'], (m) => config.log(m));
    task = getTask(store.db, task.id)!;
    // an attempt cut by an engine restart is resumed (its session keeps its context) instead of being redone
    const last = listAttempts(store.db, task.id).filter((a) => a.kind === 'work').at(-1);
    let resume: Continuation | null = last && last.state === 'interrupted' && last.sessionId && last.continuations < config.maxContinuations ? { attempt: last, reason: 'orphaned', message: continuationMessage('orphaned') } : null;
    const attemptsSoFar = engine.attemptCount(task.id);
    if (!resume && attemptsSoFar >= maxAttemptsFor(task)) {
      raiseEscalation(engine, { goal, task, trigger: 'retries_exhausted', message: `Task "${task.title}" used ${attemptsSoFar} attempts without passing its Must checks.`, payload: { attempts: attemptsSoFar } });
      return;
    }
    store.append({ type: 'task.state_changed', goalId: goal.id, payload: { taskId: task.id, from: 'ready', to: 'running', reason: resume ? `resuming attempt ${resume.attempt.index} after the engine restart` : `attempt ${attemptsSoFar + 1}` } });

    // a task in its own worktree first catches up with what other tasks landed on the goal branch
    const caught = await catchUp(engine, getGoal(store.db, goal.id)!, getTask(store.db, task.id)!, { escalate: false });
    let outcome = await runAttempt(engine, getGoal(store.db, goal.id)!, getTask(store.db, task.id)!, cwd, { baseMoved: caught.moved ? caught : null, resume });
    engine.engineCrashes.delete(task.id);
    let fresh = getTask(store.db, task.id)!;
    if (fresh.state !== 'running') return; // cancelled / aborted meanwhile
    store.append({ type: 'task.state_changed', goalId: goal.id, payload: { taskId: task.id, from: 'running', to: 'observing', reason: 'attempt finished' } });
    // Continuations: while the session was cut or is making progress, resume it rather than paying for a fresh one
    let prevFailed: number | null = null;
    while (!outcome.passed) {
      const next = decideNext({ result: outcome.result, committed: outcome.committed, failedCount: outcome.report.failedCount, prevFailedCount: prevFailed, continuations: outcome.attempt.continuations, maxContinuations: config.maxContinuations, rolledBack: false, sessionId: outcome.attempt.sessionId });
      if (next.kind !== 'continue') break;
      if (next.reason === 'checks_failed' && outcome.nonBoundaryDenials.length) break; // a denied tool will not resolve itself
      prevFailed = outcome.report.failedCount;
      const message = continuationMessage(next.reason, { timeoutMin: Math.round(config.attemptTimeoutMs / 60_000), report: outcome.report.summary.slice(0, 4000) });
      store.append({ type: 'task.state_changed', goalId: goal.id, payload: { taskId: task.id, from: 'observing', to: 'running', reason: `continuation ${outcome.attempt.continuations + 1}: ${next.reason.replace('_', ' ')}` } });
      outcome = await runAttempt(engine, getGoal(store.db, goal.id)!, getTask(store.db, task.id)!, cwd, { resume: { attempt: outcome.attempt, reason: next.reason, message } });
      fresh = getTask(store.db, task.id)!;
      if (fresh.state !== 'running') return;
      store.append({ type: 'task.state_changed', goalId: goal.id, payload: { taskId: task.id, from: 'running', to: 'observing', reason: 'continuation finished' } });
    }

    if (outcome.passed) {
      // every finished task becomes one Conventional Commit on the goal branch (squash merge / squashed snapshots)
      store.append({ type: 'task.state_changed', goalId: goal.id, payload: { taskId: task.id, from: 'observing', to: 'merging', reason: 'checks passed' } });
      // catch up once more right before landing: the conflict (if any) is met in the task worktree, with Merge Attempts
      // and, failing those, the human's manual resolution — the squash onto the goal branch is then conflict-free
      const late = await catchUp(engine, getGoal(store.db, goal.id)!, getTask(store.db, task.id)!, { escalate: true });
      if (late.moved && !late.merged) return;
      const merged = await integrateTask(engine, getGoal(store.db, goal.id)!, getTask(store.db, task.id)!);
      if (merged) {
        // artifacts are git-excluded, so the squash merge cannot carry them: rescue them before the worktree goes
        if (fresh.worktreePath && existsSync(fresh.worktreePath)) {
          const n = copyArtifacts(fresh.worktreePath, goalWorkspacePath(config.dataDir, goal));
          if (n) config.log(`[artifacts] ${task.id}: ${n} file(s) copied to the goal workspace`);
        }
        if (fresh.worktreePath) {
          await dropTaskWorkspace(goal, getTask(store.db, task.id)!).catch(() => {});
          // the worktree (and its branch) are gone — clear the pointers so the UI stops offering them
          store.append({ type: 'task.workspace_assigned', goalId: goal.id, payload: { taskId: task.id, branch: null, worktreePath: null } });
        }
        const t = getTask(store.db, task.id)!;
        store.append({ type: 'task.state_changed', goalId: goal.id, payload: { taskId: task.id, from: 'merging', to: 'done', reason: t.commitRef ? `committed ${t.commitRef.slice(0, 7)} on goal branch` : 'no changes to commit' } });
        // empty-repo goals: the task that created the first stack manifest unlocks autoskills for the rest
        engine.retryAutoskillsAfterTask(goal.id);
        // a running preview shows the new code; the self-check looks at it when the goal asked for one
        await engine.preview.restartIfRunning(getGoal(store.db, goal.id)!);
        await engine.afterIntegration(getGoal(store.db, goal.id)!, getTask(store.db, task.id)!);
      }
      return;
    }

    const used = engine.attemptCount(task.id);
    const max = maxAttemptsFor(fresh);
    if (outcome.nonBoundaryDenials.length && used >= max) {
      raiseEscalation(engine, {
        goal,
        task: fresh,
        attemptId: outcome.attempt.id,
        trigger: 'permission_denial',
        message: `Task "${task.title}" failed and Claude was denied: ${outcome.nonBoundaryDenials.map((d) => d.tool_name).join(', ')}.`,
        payload: { denials: outcome.nonBoundaryDenials },
      });
      return;
    }
    if (used < max) {
      store.append({ type: 'task.state_changed', goalId: goal.id, payload: { taskId: task.id, from: 'observing', to: 'ready', reason: `retry ${used + 1}/${max}` } });
    } else {
      raiseEscalation(engine, {
        goal,
        task: fresh,
        attemptId: outcome.attempt.id,
        trigger: 'retries_exhausted',
        message: `Task "${task.title}" used ${used}/${max} attempts; Must checks still failing.\n\n${outcome.report.summary.slice(0, 1200)}`,
        payload: { attempts: used, lastAttemptId: outcome.attempt.id },
      });
    }
  } catch (err) {
    store.append({ type: 'engine.note', goalId: goal.id, payload: { level: 'error', message: `task ${task.id} crashed in engine: ${String((err as Error)?.stack ?? err)}` } });
    const t = getTask(store.db, task.id);
    if (t && (t.state === 'running' || t.state === 'observing' || t.state === 'merging')) {
      // an engine error is not the model's failure: retry a couple of times (no attempt consumed) before asking the human
      const n = (engine.engineCrashes.get(task.id) ?? 0) + 1;
      engine.engineCrashes.set(task.id, n);
      if (n < 3) {
        store.append({ type: 'task.state_changed', goalId: goal.id, payload: { taskId: task.id, from: t.state, to: 'ready', reason: `engine error (${n}/3), retrying: ${String((err as Error)?.message ?? err).slice(0, 120)}` } });
      } else {
        store.append({ type: 'task.state_changed', goalId: goal.id, payload: { taskId: task.id, from: t.state, to: 'blocked', reason: 'engine error' } });
        raiseEscalation(engine, { goal, task: t, trigger: 'retries_exhausted', message: `Engine error while running "${task.title}" (3 times in a row — this is the engine's fault, not the model's):\n\n\`${String(err)}\`\n\nRetry once the cause is fixed, or skip the task.`, payload: { kind: 'engine', error: String(err) } });
      }
    }
  } finally {
    engine.release(task.id);
    engine.tick(goal.id);
  }
}

export { goalWorkspacePath };
