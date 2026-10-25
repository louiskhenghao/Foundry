import { PROVIDER_NAME, getBrief, listEscalations } from '@foundry/core';
import type { Goal, Task } from '@foundry/core';
import { ARTIFACT_SCENARIOS, listTasks, getTask, getGoal, listAttempts, getObservation } from '@foundry/core';
import { type Continuation, type ContinueReason, goalSessionTimeoutMs, continuationMessage, cutByLimit, decideNext, maxAttemptsFor, runAttempt } from './attempt-loop.ts';
import { budgetStatus } from './budget.ts';
import { adjustmentContext } from './adjust.ts';
import type { Engine } from './engine.ts';
import { runAudit } from './audit.ts';
import { runQa } from './qa.ts';
import { dueCheckpoint, finalLookDue, openCheckpoint, openFinalCheckpoint, passMilestone, runFinalWalk, scriptedMilestones } from './checkpoint.ts';
import { materialsAwaited, requestAnswerFor } from './materials.ts';
import { raiseEscalation } from './escalation.ts';
import { headRef } from './git/git.ts';
import { recoverOverlays } from './goal-artifacts.ts';
import { catchUp, catchUpAndLand, filesOverlap } from './catchup.ts';
import { stuckIn } from './take-back.ts';
import { existsSync } from 'node:fs';
import { excludeFromGit } from './skills/autoskills.ts';
import { dropTaskWorkspace, ensureGoalWorkspace, ensureTaskWorkspace, goalWorkspacePath, listArtifacts } from './workspace.ts';
import { delegating, isDelegationTask, settleDelegations, startDelegations } from './delegation.ts';

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

  // 2c. goal tasks: a Delegated goal that finished lands, one that failed runs again, and the goal waits (blocked) while
  // one needs the person
  if (tasks.some((t) => isDelegationTask(t))) {
    await settleDelegations(engine, goal);
    if (getGoal(store.db, goal.id)?.state !== 'running') return;
    tasks = listTasks(store.db, goal.id);
  }

  // 2a. a milestone script failed again after its repair: launch nothing more, then pause there once nothing is in flight
  const failing = engine.pauseDue.get(goal.id);
  if (failing) {
    const task = tasks.find((t) => t.id === failing);
    if (engine.inFlightForGoal(goal.id).length === 0) {
      engine.pauseDue.delete(goal.id);
      if (task) void openCheckpoint(engine, goal, { task, recheck: false }, { capture: false }).catch((err) => store.append({ type: 'engine.note', goalId: goal.id, payload: { level: 'warn', message: `opening the milestone failed: ${String(err)}` } }));
    }
    return;
  }

  // 2b. a milestone landed (or a feedback fix for one): launch nothing more, let in-flight work land, then pause for the
  // human; a goal that does not pause at milestones tells them and goes on
  for (let due = dueCheckpoint(tasks); due; due = dueCheckpoint(tasks)) {
    // a feature milestone (one with a script) is recorded and the person told; the goal pauses only for the look at the end
    if (goal.milestonePause === false || due.task.milestoneScript) {
      passMilestone(engine, goal, due.task);
      tasks = listTasks(store.db, goal.id);
      continue;
    }
    // not awaited: the milestone's preview can take minutes (installs, Docker) and the goal's ticks queue behind this one
    if (engine.inFlightForGoal(goal.id).length === 0) {
      void openCheckpoint(engine, goal, due).catch((err) => store.append({ type: 'engine.note', goalId: goal.id, payload: { level: 'warn', message: `opening the milestone failed: ${String(err)}` } }));
    }
    return;
  }

  // 3. all terminal?
  if (tasks.length && tasks.every((t) => t.state === 'done' || t.state === 'failed' || t.state === 'skipped')) {
    if (tasks.some((t) => t.state === 'failed')) {
      store.append({ type: 'goal.state_changed', goalId: goal.id, payload: { from: 'running', to: 'failed', reason: `${tasks.filter((t) => t.state === 'failed').length} task(s) failed` } });
    } else if (goal.completion.audit && !goal.completion.auditRun) {
      // 3b. the audit: ponytail-audit on the finished branch, once; its must-fix findings in the goal's code become fix
      // tasks, so it runs before the final walkthrough and the review see the branch (not awaited: minutes)
      if (!engine.auditing.has(goal.id)) {
        engine.auditing.add(goal.id);
        void runAudit(engine, goal)
          .catch((err) => store.append({ type: 'goal.audit_finished', goalId: goal.id, payload: { status: 'failed', summary: '', findings: [], fixTaskIds: [], costUsd: 0, detail: `the audit crashed: ${String(err).slice(0, 280)}` } }))
          .finally(() => {
            engine.auditing.delete(goal.id);
            engine.tick(goal.id);
          });
      }
    } else if (goal.completion.qa && !goal.completion.qaRun) {
      // 3b2. the browser QA: the finished app tried in Chromium, once, after the audit; a must check that fails becomes a
      // fix task, so it runs before the final walkthrough and the review (not awaited: minutes) (ADR-0057)
      if (!engine.qaing.has(goal.id)) {
        engine.qaing.add(goal.id);
        void runQa(engine, goal, engine.qaDeps)
          .catch((err) => store.append({ type: 'goal.qa_finished', goalId: goal.id, payload: { status: 'failed', summary: '', results: [], fixTaskIds: [], costUsd: 0, detail: `the browser QA crashed: ${String(err).slice(0, 280)}` } }))
          .finally(() => {
            engine.qaing.delete(goal.id);
            engine.tick(goal.id);
          });
      }
    } else if (scriptedMilestones(tasks).length && !goal.finalWalk?.ranAt) {
      // 3c. the final walkthrough: every feature's script once more on the finished branch (not awaited: minutes)
      if (!engine.finalWalking.has(goal.id)) {
        engine.finalWalking.add(goal.id);
        void runFinalWalk(engine, goal)
          .catch((err) => store.append({ type: 'engine.note', goalId: goal.id, payload: { level: 'warn', message: `the final walkthrough failed: ${String(err)}` } }))
          .finally(() => {
            engine.finalWalking.delete(goal.id);
            engine.tick(goal.id);
          });
      }
    } else if (scriptedMilestones(tasks).length && finalLookDue(goal, tasks)) {
      // 3c. the look at the end: every feature's recording on one card
      if (engine.inFlightForGoal(goal.id).length === 0) {
        void openFinalCheckpoint(engine, goal, finalLookDue(goal, tasks)!.recheck).catch((err) => store.append({ type: 'engine.note', goalId: goal.id, payload: { level: 'warn', message: `opening the final walkthrough failed: ${String(err)}` } }));
      }
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

  // 5. start ready tasks within capacity — none while the final walkthrough or the audit runs: they read the branch as it is
  if (engine.finalWalking.has(goal.id) || engine.auditing.has(goal.id) || engine.qaing.has(goal.id)) return;
  // 5a. the ready goal tasks start as Delegated goals, as many at a time as the goal's parallel limit allows (they take no session slot: each goal has slots of its own)
  if (tasks.some((t) => isDelegationTask(t) && t.state === 'ready')) {
    await startDelegations(engine, goal, tasks);
    if (getGoal(store.db, goal.id)?.state !== 'running') return;
    tasks = listTasks(store.db, goal.id);
  }
  const inFlight = engine.inFlightForGoal(goal.id);
  let capacity = Math.max(0, goal.budgets.maxConcurrent - inFlight.length);
  const ready = tasks.filter((t) => t.state === 'ready' && !engine.isInFlight(t.id) && !isDelegationTask(t));
  // while a Delegated goal is under way its landing needs the goal workspace: every task gets a worktree of its own meanwhile
  const goalWsBusy = tasks.some((t) => engine.isInFlight(t.id) && !t.worktreePath) || !!delegating(tasks);
  const started: Task[] = [];
  for (const t of ready) {
    // a material the person promised in wait mode (ADR-0074): the task waits for it, asked for by Foundry itself, so no
    // worker session is spent on a task that cannot finish
    const awaited = materialsAwaited(getBrief(store.db, goal.id)?.brief, t);
    if (awaited.length) {
      const first = awaited[0]!;
      raiseEscalation(engine, { goal, task: t, trigger: 'needs_input', message: `"${t.title}" needs ${awaited.map((m) => m.what).join(' and ')} — you said you would provide it.`, payload: { kind: 'needs_input', source: 'foundry', materialKey: first.key, what: first.what, why: `the task "${t.title}" cannot start without it`, suggestions: '', canProceedWithout: false } });
      continue;
    }
    // Start now: the person chose to start this one past the scheduler's caution (a full set of slots, running alone,
    // files another task is changing); it gets its own worktree whenever anything else runs
    const forced = engine.forceStart.has(t.id);
    if (capacity <= 0 && !forced) continue;
    // Workspace policy: a task runs in the goal workspace only if it is the sole active task;
    // otherwise it gets its own worktree (sticky for the task's lifetime).
    const others = tasks.filter((x) => x.id !== t.id && (engine.isInFlight(x.id) || (x.state === 'ready' && x.parallelizable)));
    const useOwnWorktree = t.worktreePath != null || goalWsBusy || (t.parallelizable && others.length > 0) || (forced && (inFlight.length > 0 || started.length > 0));
    if (!t.parallelizable && inFlight.length > 0 && !forced) {
      // serial task waits for quiet — say so once, so "ready but not running" is not a mystery
      if (!engine.overlapNoted.has(t.id)) {
        engine.overlapNoted.add(t.id);
        const busy = tasks.filter((x) => inFlight.includes(x.id)).map((x) => `"${x.title}"`);
        store.append({ type: 'engine.note', goalId: goal.id, payload: { level: 'info', message: `"${t.title}" runs alone (not parallelizable): it starts once ${busy.join(', ') || 'the running task'} ${busy.length > 1 ? 'finish' : 'finishes'} — a wait for quiet, not a dependency` } });
      }
      continue;
    }
    if (!useOwnWorktree && inFlight.length > 0) continue; // goal workspace in use
    // Conflict avoidance: two tasks that declare the same files do not run at the same time, whatever the Brief says
    const active = [...tasks.filter((x) => inFlight.includes(x.id)), ...started];
    const clash = active.find((x) => filesOverlap(t.relevantFiles, x.relevantFiles).length > 0);
    if (clash && !forced) {
      if (!engine.overlapNoted.has(t.id)) {
        engine.overlapNoted.add(t.id);
        store.append({ type: 'engine.note', goalId: goal.id, payload: { level: 'info', message: `"${t.title}" waits for "${clash.title}": both touch ${filesOverlap(t.relevantFiles, clash.relevantFiles).slice(0, 3).join(', ')}` } });
      }
      continue;
    }
    capacity--;
    started.push(t);
    engine.forceStart.delete(t.id);
    void startTask(engine, goal, t, useOwnWorktree);
  }
  // nothing runs and nothing can start while a Request waits for the person: the goal is blocked meanwhile, so the wait
  // reads as one and the working clock stops; the answer unblocks it (ADR-0074)
  if (!started.length && !inFlight.length && goal.state === 'running') {
    const now = listTasks(store.db, goal.id);
    if (!now.some((t) => t.state === 'ready' || t.state === 'running' || t.state === 'observing' || t.state === 'merging') && listEscalations(store.db, { goalId: goal.id, openOnly: true }).some((e) => e.trigger === 'needs_input')) {
      store.append({ type: 'goal.state_changed', goalId: goal.id, payload: { from: 'running', to: 'blocked', reason: 'waiting for what you will provide' } });
    }
  }
}

async function startTask(engine: Engine, goal: Goal, task: Task, ownWorktree: boolean): Promise<void> {
  const { store, config } = engine;
  const slot = engine.reserve(task.id);
  // the human unstuck the task while this work hung: whatever it comes back with must not touch the task again
  const lost = () => !engine.holds(task.id, slot);
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
        // a new worktree branches from the goal branch as it stands between landings: under the goal workspace's lock, so
        // never from a merge attempt's commit before its checks are done, and not while it ends at a commit an attempt
        // could not take back (the escalation that names it blocks the goal). The task inherits the goal's artifacts
        // after any leftover overlay is undone, so never a merge attempt's laid over them for its checks
        const made = await engine.withGoalWsLock(goal.id, async () => {
          const held = await stuckIn(engine, goal, [goalWorkspacePath(config.dataDir, goal)]);
          if (held) return { held, ws: null };
          await recoverOverlays(engine, goal);
          return { held: null, ws: await ensureTaskWorkspace(config.dataDir, goal, task) };
        });
        if (!made.ws) {
          store.append({ type: 'engine.note', goalId: goal.id, payload: { level: 'warn', message: `"${task.title}" did not start: ${made.held}` } });
          // the slot goes back when this returns: not straight into another try while the goal waits for the person
          await Bun.sleep(5_000);
          return;
        }
        store.append({ type: 'task.workspace_assigned', goalId: goal.id, payload: { taskId: task.id, branch: made.ws.branch, worktreePath: made.ws.path } });
        cwd = made.ws.path;
      } else cwd = task.worktreePath;
    }
    // media and CAD tasks generate into artifacts/, which must never reach a commit (info/exclude is shared by all
    // worktrees), and neither may what a task inherited there; the leading slash anchors to the workspace root so
    // docs/artifacts/ manifests stay tracked
    if (ARTIFACT_SCENARIOS.includes(task.scenario) || listArtifacts(cwd).length) await excludeFromGit(cwd, ['/artifacts/'], (m) => config.log(m));
    task = getTask(store.db, task.id)!;
    // an attempt cut by an engine restart or a usage limit is resumed (its session keeps its context) instead of being
    // redone; a usage limit's cut is no fault of the session's and resumes past the continuation cap
    const last = listAttempts(store.db, task.id).filter((a) => a.kind === 'work').at(-1);
    const cutBy: ContinueReason = last?.resultSubtype === 'usage_limit' ? 'usage_limit' : last?.resultSubtype === 'needs_input' ? 'needs_input' : 'orphaned';
    // a session that stopped to ask the person resumes with their answer (ADR-0074), past the continuation cap too
    const answer = cutBy === 'needs_input' ? requestAnswerFor(engine, goal, task) : undefined;
    let resume: Continuation | null = last && last.state === 'interrupted' && last.sessionId && (cutBy === 'usage_limit' || cutBy === 'needs_input' || last.continuations < config.maxContinuations) ? { attempt: last, reason: cutBy, message: continuationMessage(cutBy, { answer }) } : null;
    // an Adjustment of a finished task (ADR-0078): the session that passed resumes with the person's words — it knows
    // the work it did — past the continuation cap; with no session to resume, a fresh attempt is given them instead
    if (!resume && task.adjustment && last?.state === 'passed' && last.sessionId) resume = { attempt: last, reason: 'adjust', message: continuationMessage('adjust', { adjustment: adjustmentContext(getGoal(store.db, goal.id)!, task.adjustment, config.dataDir) }) };
    const attemptsSoFar = engine.attemptCount(task.id);
    if (!resume && attemptsSoFar >= maxAttemptsFor(task)) {
      raiseEscalation(engine, { goal, task, trigger: 'retries_exhausted', message: `Task "${task.title}" used ${attemptsSoFar} attempts without passing its Must checks.`, payload: { attempts: attemptsSoFar } });
      return;
    }
    const why = resume ? (resume.reason === 'adjust' ? `resuming attempt ${resume.attempt.index} for adjustment ${task.adjustment!.n}` : `resuming attempt ${resume.attempt.index} after ${cutBy === 'usage_limit' ? 'the usage limit' : cutBy === 'needs_input' ? 'the person answered its request' : 'the engine restart'}`) : `attempt ${attemptsSoFar + 1}`;
    store.append({ type: 'task.state_changed', goalId: goal.id, payload: { taskId: task.id, from: 'ready', to: 'running', reason: why } });

    // a task in its own worktree first catches up with what other tasks landed on the goal branch (not while another
    // task's merge holds the goal workspace: the catch-up before its landing brings that)
    const caught = await catchUp(engine, getGoal(store.db, goal.id)!, getTask(store.db, task.id)!, { escalate: false, ifIdle: true });
    let outcome = await runAttempt(engine, getGoal(store.db, goal.id)!, getTask(store.db, task.id)!, cwd, { baseMoved: caught.moved ? caught : null, resume });
    engine.engineCrashes.delete(task.id);
    let fresh = getTask(store.db, task.id)!;
    if (fresh.state !== 'running' || lost()) return; // cancelled / aborted / unstuck meanwhile
    store.append({ type: 'task.state_changed', goalId: goal.id, payload: { taskId: task.id, from: 'running', to: 'observing', reason: 'attempt finished' } });
    // the worker stopped to ask the person for something (ADR-0074): the task waits for the answer, and the session
    // resumes with it through the start path above — after the first segment, and after any continuation
    const asked = (o: typeof outcome): boolean => {
      if (!o.needs) return false;
      raiseEscalation(engine, { goal, task: getTask(store.db, task.id)!, attemptId: o.attempt.id, trigger: 'needs_input', message: o.needs.what, payload: { kind: 'needs_input', source: 'worker', materialKey: null, ...o.needs } });
      return true;
    };
    if (asked(outcome)) return;
    // Continuations: while the session was cut or is making progress, resume it rather than paying for a fresh one
    let prevFailed: number | null = null;
    while (!outcome.passed) {
      const next = decideNext({ result: outcome.result, committed: outcome.committed, failedCount: outcome.report.failedCount, prevFailedCount: prevFailed, continuations: outcome.attempt.continuations, maxContinuations: config.maxContinuations, rolledBack: false, sessionId: outcome.attempt.sessionId });
      if (next.kind !== 'continue') break;
      if (next.reason === 'usage_limit') {
        // it waits as interrupted while sessions are paused; the start path above resumes it once they run again (on the
        // next account, or on this one after its reset), after an engine restart too
        const a = outcome.attempt;
        store.append({ type: 'attempt.finished', goalId: goal.id, payload: { attemptId: a.id, state: 'interrupted', resultSubtype: 'usage_limit', costUsd: a.costUsd, numTurns: a.numTurns, endRef: a.endRef, permissionDenials: [], skillsUsed: a.skillsUsed, toolsUsed: {} } });
        store.append({ type: 'attempt.concluded', goalId: goal.id, payload: { attemptId: a.id, state: 'interrupted', reason: 'stopped by a usage limit — its session resumes when sessions run again' } });
        store.append({ type: 'task.state_changed', goalId: goal.id, payload: { taskId: task.id, from: 'observing', to: 'ready', reason: `attempt ${a.index} was stopped by a usage limit; its session resumes when sessions run again` } });
        return;
      }
      if (next.reason === 'checks_failed' && outcome.nonBoundaryDenials.length) break; // a denied tool will not resolve itself
      prevFailed = outcome.report.failedCount;
      const message = continuationMessage(next.reason, { timeoutMin: Math.round(goalSessionTimeoutMs(goal, config) / 60_000), report: outcome.report.summary.slice(0, 4000) });
      store.append({ type: 'task.state_changed', goalId: goal.id, payload: { taskId: task.id, from: 'observing', to: 'running', reason: `continuation ${outcome.attempt.continuations + 1}: ${next.reason.replace('_', ' ')}` } });
      outcome = await runAttempt(engine, getGoal(store.db, goal.id)!, getTask(store.db, task.id)!, cwd, { resume: { attempt: outcome.attempt, reason: next.reason, message } });
      fresh = getTask(store.db, task.id)!;
      if (fresh.state !== 'running' || lost()) return;
      store.append({ type: 'task.state_changed', goalId: goal.id, payload: { taskId: task.id, from: 'running', to: 'observing', reason: 'continuation finished' } });
      if (asked(outcome)) return;
    }

    if (outcome.passed) {
      // every finished task becomes one Conventional Commit on the goal branch (squash merge / squashed snapshots)
      store.append({ type: 'task.state_changed', goalId: goal.id, payload: { taskId: task.id, from: 'observing', to: 'merging', reason: 'checks passed' } });
      // catch up once more right before landing: the conflict (if any) is met in the task worktree, with Merge Attempts
      // and, failing those, the human's manual resolution — the squash onto the goal branch is then conflict-free. While
      // the goal branch ends at a commit a merge attempt could not take back, the task waits to do either
      // artifacts are git-excluded, so the squash merge cannot carry them: the integration lands them before the worktree goes
      const landed = await catchUpAndLand(engine, goal.id, task.id, lost);
      if (!landed) return;
      const { merged, landing } = landed;
      if (merged && landing) {
        if (fresh.worktreePath && landing.failed.length) {
          // some could not be copied (a full disk, a file it cannot read): the worktree stays, so they are not lost
          store.append({ type: 'engine.note', goalId: goal.id, payload: { level: 'warn', message: `"${task.title}": ${landing.failed.length} artifact(s) could not be copied to the goal workspace (${landing.failed.slice(0, 3).join(', ')}); its worktree is kept so they are not lost` } });
        } else if (fresh.worktreePath) {
          await dropTaskWorkspace(goal, getTask(store.db, task.id)!).catch(() => {});
          // the worktree (and its branch) are gone — clear the pointers so the UI stops offering them
          store.append({ type: 'task.workspace_assigned', goalId: goal.id, payload: { taskId: task.id, branch: null, worktreePath: null } });
        }
        const t = getTask(store.db, task.id)!;
        // the Adjustment it carried out is done with (ADR-0078); the record stays on the goal
        if (t.adjustment) store.append({ type: 'task.adjustment_set', goalId: goal.id, payload: { taskId: task.id, adjustment: null } });
        store.append({ type: 'task.state_changed', goalId: goal.id, payload: { taskId: task.id, from: 'merging', to: 'done', reason: t.commitRef ? `committed ${t.commitRef.slice(0, 7)} on goal branch` : 'no changes to commit' } });
        // empty-repo goals: the task that created the first stack manifest unlocks autoskills for the rest
        engine.retryAutoskillsAfterTask(goal.id);
        // a running preview shows the new code; the self-check looks at it when the goal asked for one
        await engine.preview.restartIfRunning(getGoal(store.db, goal.id)!);
        await engine.afterIntegration(getGoal(store.db, goal.id)!, getTask(store.db, task.id)!);
      }
      return;
    }

    // a usage limit that stopped the session before it began leaves nothing to resume: the attempt is given back
    if (cutByLimit(outcome.result)) {
      store.append({ type: 'task.hint_set', goalId: goal.id, payload: { taskId: task.id, hint: fresh.hint, extraAttempts: 1 } });
      fresh = getTask(store.db, task.id)!;
    }
    const used = engine.attemptCount(task.id);
    const max = maxAttemptsFor(fresh);
    if (outcome.nonBoundaryDenials.length && used >= max) {
      raiseEscalation(engine, {
        goal,
        task: fresh,
        attemptId: outcome.attempt.id,
        trigger: 'permission_denial',
        message: `Task "${task.title}" failed and ${PROVIDER_NAME[goal.provider ?? 'claude']} was denied: ${outcome.nonBoundaryDenials.map((d) => d.tool_name).join(', ')}.`,
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
        message: `Task "${task.title}" used ${used}/${max} attempts; Must checks still failing.\n\n${outcome.report.summary}`,
        payload: { attempts: used, lastAttemptId: outcome.attempt.id },
      });
    }
  } catch (err) {
    if (lost()) return;
    store.append({ type: 'engine.note', goalId: goal.id, payload: { level: 'error', message: `task ${task.id} crashed in engine: ${String((err as Error)?.stack ?? err)}` } });
    // the attempt the error cut short is over: it would read "running" forever, and it was not the model's failure, so
    // the task gets the attempt back (as after an engine restart)
    for (const a of listAttempts(store.db, task.id)) {
      if (a.state !== 'created' && a.state !== 'running' && a.state !== 'observing') continue;
      const reason = `engine error: ${String((err as Error)?.message ?? err).slice(0, 160)}`;
      store.append({ type: 'attempt.finished', goalId: goal.id, payload: { attemptId: a.id, state: 'error', resultSubtype: 'engine_error', costUsd: a.costUsd, numTurns: a.numTurns, endRef: a.endRef, permissionDenials: [], skillsUsed: [], toolsUsed: {} } });
      store.append({ type: 'attempt.concluded', goalId: goal.id, payload: { attemptId: a.id, state: 'error', reason } });
      const now = getTask(store.db, task.id);
      if (a.kind === 'work' && now) store.append({ type: 'task.hint_set', goalId: goal.id, payload: { taskId: task.id, hint: now.hint, extraAttempts: 1 } });
    }
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
    engine.release(task.id, slot);
    engine.tick(goal.id);
  }
}

export { goalWorkspacePath };
