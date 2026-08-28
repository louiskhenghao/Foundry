import { join } from 'node:path';
import type { Attempt, Goal, Task } from '@foundry/core';
import { IdPrefix, getAttempt, listAttempts, listChecks, newId } from '@foundry/core';
import { runCommandCheck } from './checks/command.ts';
import type { Engine } from './engine.ts';
import { raiseEscalation } from './escalation.ts';
import { GIT_IDENT, abortInProgress, commitAll, commitStaged, conflictedFiles, git, gitOk, headRef, refExists } from './git/git.ts';
import { ccHeader, taskCommitMessage } from './git/conventional.ts';
import { READONLY_DISALLOWED, WORKER_TOOLS, boundarySettings } from './guards/boundary.ts';
import { goalWorkspacePath } from './workspace.ts';

const MERGE_ATTEMPT_BUDGET = 2;

export interface MergeSource {
  /** git ref to merge into the goal branch (task/<id> or origin/main) */
  ref: string;
  /** human label for prompts/messages */
  label: string;
  /** what the incoming side was trying to do */
  intent: string;
}

/** How the conflicted state was produced, so a Merge Attempt can be retried the same way. */
export interface ConflictOp {
  cwd: string;
  /** re-create the conflicted state after an abort (e.g. `git merge --squash <ref>` again) */
  redo: () => Promise<void>;
  /** message for the commit that concludes the resolution */
  commitMessage: string;
  /** extra context for the merger prompt */
  hint?: string;
  /** run the goal's must command checks in `cwd` after a resolution (default true) */
  runChecks?: boolean;
  /** raise an escalation when the budget is spent (default true; delivery's stack builder prefers to fall back) */
  escalate?: boolean;
}

/**
 * A finished task becomes exactly one Conventional Commit on the goal branch:
 * - a task that worked in its own worktree is squash-merged (`git merge --squash task/<id>`);
 * - a task that worked in the goal workspace has its attempt snapshots squashed (`reset --soft <baseRef>`).
 * Conflicts go through Merge Attempts; an unresolved conflict escalates and returns false.
 * Emits `task.committed` (ref null when the task changed nothing).
 */
export function integrateTask(engine: Engine, goal: Goal, task: Task): Promise<boolean> {
  return engine.withGoalWsLock(goal.id, () => integrateTaskUnlocked(engine, goal, task));
}

async function integrateTaskUnlocked(engine: Engine, goal: Goal, task: Task): Promise<boolean> {
  const { store } = engine;
  const goalWs = goalWorkspacePath(engine.config.dataDir, goal.id);
  const message = taskCommitMessage(goal, task);
  let ref: string | null = null;

  if (task.branch && task.worktreePath) {
    await commitAll(task.worktreePath, message);
    store.append({ type: 'merge.started', goalId: goal.id, payload: { taskId: task.id, into: goal.branch } });
    const squash = () => git(['merge', '--squash', '--no-commit', task.branch!], goalWs);
    const r = await squash();
    if (r.code !== 0) {
      const files = await conflictedFiles(goalWs);
      store.append({ type: 'merge.conflict', goalId: goal.id, payload: { taskId: task.id, files } });
      const ok = await resolveConflicts(engine, goal, task, files, { ref: task.branch, label: task.branch, intent: task.spec }, { cwd: goalWs, redo: async () => void (await squash()), commitMessage: message }, r.stderr);
      if (!ok) return false;
      ref = await headRef(goalWs);
    } else {
      const c = await commitStaged(goalWs, message);
      ref = c.committed ? c.ref : null;
    }
    store.append({ type: 'merge.completed', goalId: goal.id, payload: { taskId: task.id, ref: await headRef(goalWs) } });
  } else {
    const head = await headRef(goalWs);
    if (task.baseRef && task.baseRef !== head && (await refExists(goalWs, task.baseRef))) {
      await gitOk(['reset', '--soft', task.baseRef], goalWs);
      const c = await commitStaged(goalWs, message);
      ref = c.committed ? c.ref : null;
    } else if (!task.baseRef) {
      // no recorded base (task ran outside the scheduler): keep whatever is there, commit anything pending
      const c = await commitAll(goalWs, message);
      ref = c.committed ? c.ref : null;
    }
  }
  store.append({ type: 'task.committed', goalId: goal.id, payload: { taskId: task.id, ref, message } });
  return true;
}

/**
 * Merge `src.ref` into the goal branch (in the goal workspace) with a real merge commit. Used by
 * delivery to sync with the remote base branch. The `task` is the unit the merge belongs to.
 */
export async function mergeBranchInto(engine: Engine, goal: Goal, task: Task, src: MergeSource, opts: { autoResolve?: boolean; cwd?: string; into?: string; escalate?: boolean } = {}): Promise<boolean> {
  const { store } = engine;
  const goalWs = opts.cwd ?? goalWorkspacePath(engine.config.dataDir, goal.id);
  const into = opts.into ?? goal.branch;
  const autoResolve = opts.autoResolve ?? true;
  const message = `${ccHeader({ type: 'chore', scope: 'sync', subject: `merge ${src.label} into ${into}` })}\n\nGoal: ${goal.id}`;
  store.append({ type: 'merge.started', goalId: goal.id, payload: { taskId: task.id, into } });
  const merge = () => git([...GIT_IDENT, 'merge', '--no-ff', '-m', message, src.ref], goalWs);
  const r = await merge();
  if (r.code === 0) {
    store.append({ type: 'merge.completed', goalId: goal.id, payload: { taskId: task.id, ref: await headRef(goalWs) } });
    return true;
  }
  const files = await conflictedFiles(goalWs);
  store.append({ type: 'merge.conflict', goalId: goal.id, payload: { taskId: task.id, files } });
  if (files.length && !autoResolve) {
    await abortInProgress(goalWs);
    if (opts.escalate !== false) raiseEscalation(engine, { goal, task, trigger: 'retries_exhausted', message: `Merging ${src.label} into ${into} conflicts in ${files.join(', ')} and automatic resolution is disabled by the delivery policy.`, payload: { kind: 'merge', files } });
    return false;
  }
  const ok = await resolveConflicts(engine, goal, task, files, src, { cwd: goalWs, redo: async () => void (await merge()), commitMessage: message, escalate: opts.escalate }, r.stderr);
  if (ok) store.append({ type: 'merge.completed', goalId: goal.id, payload: { taskId: task.id, ref: await headRef(goalWs) } });
  return ok;
}

/**
 * Shared conflict path: no conflicted files → abort + escalate; otherwise up to MERGE_ATTEMPT_BUDGET
 * Merge Attempts, each starting from a freshly re-created conflict. Escalates when the budget is spent.
 */
export async function resolveConflicts(engine: Engine, goal: Goal, task: Task, files: string[], src: MergeSource, op: ConflictOp, stderr = ''): Promise<boolean> {
  const { store } = engine;
  if (!files.length) {
    await abortInProgress(op.cwd);
    store.append({ type: 'engine.note', goalId: goal.id, payload: { level: 'error', message: `merge of ${src.label} failed without conflicts: ${stderr.slice(0, 500)}` } });
    if (op.escalate !== false) raiseEscalation(engine, { goal, task, trigger: 'retries_exhausted', message: `Could not merge ${src.label}: ${stderr.slice(0, 300)}`, payload: { kind: 'merge' } });
    return false;
  }
  const reasons: string[] = [];
  let previous: { attempt: Attempt; reason: string } | null = null;
  for (let i = 1; i <= MERGE_ATTEMPT_BUDGET; i++) {
    // the second try resumes the first session (it knows the files) unless continuations are off
    const resume = previous && previous.attempt.sessionId && engine.config.maxContinuations > 0 ? previous : null;
    const r = await runMergeAttempt(engine, goal, task, files, i, src, op, resume);
    if (r.ok) return true;
    reasons.push(`attempt ${i}: ${r.reason}`);
    previous = { attempt: r.attempt, reason: r.reason };
    await abortInProgress(op.cwd);
    await op.redo();
  }
  await abortInProgress(op.cwd);
  if (op.escalate === false) return false;
  raiseEscalation(engine, {
    goal,
    task,
    trigger: 'retries_exhausted',
    message: `Merging \`${src.label}\` into \`${goal.branch}\` conflicts in:\n${files.map((f) => `- \`${f}\``).join('\n')}\n\n${MERGE_ATTEMPT_BUDGET} merge attempts could not resolve it:\n${reasons.map((r) => `- ${r}`).join('\n')}\n\nYou can resolve it by hand (**Resolve manually**), let the engine try again with a hint, or skip the task.`,
    payload: { kind: 'merge', files, reasons },
  });
  return false;
}

async function runMergeAttempt(engine: Engine, goal: Goal, task: Task, files: string[], n: number, src: MergeSource, op: ConflictOp, resume: { attempt: Attempt; reason: string } | null = null): Promise<{ ok: boolean; reason: string; attempt: Attempt }> {
  const { store, config } = engine;
  const cwd = op.cwd;
  const index = resume ? resume.attempt.index : listAttempts(store.db, task.id).length + 1;
  const attempt: Attempt = resume ? { ...resume.attempt, state: 'running', endedAt: null } : {
    id: newId(IdPrefix.attempt),
    goalId: goal.id,
    skillsUsed: [],
    taskId: task.id,
    index,
    kind: 'merge',
    sessionId: null,
    model: goal.models.strong,
    state: 'created',
    costUsd: 0,
    numTurns: 0,
    resultSubtype: null,
    baseRef: await headRef(cwd),
    endRef: null,
    pid: null,
    cwd,
    transcriptPath: join(config.dataDir, 'transcripts', `merge-${task.id}-${n}.jsonl`),
    startedAt: new Date().toISOString(),
    endedAt: null,
    continuations: 0,
    sessions: [],
  };
  if (resume) store.append({ type: 'attempt.continued', goalId: goal.id, payload: { attemptId: attempt.id, reason: 'merge_retry', sessionId: attempt.sessionId } });
  else store.append({ type: 'attempt.started', goalId: goal.id, payload: { attempt } });

  const hunks: string[] = [];
  for (const f of files.slice(0, 10)) {
    const content = await Bun.file(join(cwd, f)).text().catch(() => '');
    const lines = content.split('\n');
    const idx = lines.findIndex((l) => l.startsWith('<<<<<<<'));
    hunks.push(`## ${f}\n\`\`\`\n${lines.slice(Math.max(0, idx - 5), idx + 200).join('\n')}\n\`\`\``);
  }
  const mergerHint = await engine.skills.hints.sectionFor('merger');
  // what the receiving side did since the two diverged: the merger must keep that too
  const mb = await git(['merge-base', 'HEAD', src.ref], cwd);
  const ours = mb.code === 0 ? (await git(['log', '--no-merges', '--format=%s', `${mb.stdout.trim()}..HEAD`], cwd)).stdout.split('\n').filter(Boolean) : [];
  const target = op.cwd === goalWorkspacePath(config.dataDir, goal.id) ? goal.branch : task.branch ?? goal.branch;
  const prompt = resume
    ? `The conflict was re-created from scratch in this worktree. Your previous resolution did not land: ${resume.reason}.\nResolve it again — you already know these files — and this time make sure the must checks pass before you stop. Edit the files, \`git add\` them, do not commit.`
    : [
    `# Merge conflict to resolve\n\`${src.label}\` is being merged into \`${target}\`.`,
    mergerHint ?? '',
    `# What the incoming side (${src.label}) was doing\n${src.intent}`,
    ours.length ? `# What the receiving side (${target}) already has since they diverged\n${ours.slice(0, 15).map((c) => `- ${c}`).join('\n')}\nKeep all of it.` : '',
    `# Goal\n${goal.prompt}`,
    task.hint ? `# Hint from the human\n${task.hint}` : '',
    op.hint ? `# Context\n${op.hint}` : '',
    `# Conflicted files\n${files.map((f) => `- ${f}`).join('\n')}`,
    hunks.join('\n\n'),
    `Resolve every conflict so that BOTH sides' intent is preserved. Edit the files to remove all conflict markers, then run \`git add\` on them. Do NOT commit and do NOT run git merge/rebase/reset/cherry-pick. Run the project's tests if cheap. Reply with a short summary.`,
  ]
    .filter(Boolean)
    .join('\n\n');

  const handle = await engine.runner.run({
    prompt,
    cwd,
    model: goal.models.strong,
    meta: { goalId: goal.id, tier: 'strong' },
    maxTurns: 50,
    maxBudgetUsd: 2,
    permissionMode: 'dontAsk',
    allowedTools: WORKER_TOOLS,
    appendSystemPromptFile: engine.roles.path('merger'),
    settings: boundarySettings(config.hooksDir),
    settingSources: config.settingSources,
    timeoutMs: 10 * 60_000,
    transcriptPath: attempt.transcriptPath!,
    resumeSessionId: resume ? (attempt.sessionId ?? undefined) : undefined,
    env: { FOUNDRY_ATTEMPT_ID: attempt.id },
    label: `merge ${src.label} #${n}`,
  });
  const segmentStart = new Date().toISOString();
  let initModel: string | null = null;
  for await (const ev of handle.events) {
    if (ev.kind === 'init') {
      initModel = ev.model;
      store.append({ type: 'attempt.session', goalId: goal.id, payload: { attemptId: attempt.id, sessionId: ev.sessionId, model: ev.model, pid: handle.pid } });
    }
    engine.broadcast({ goalId: goal.id, taskId: task.id, attemptId: attempt.id, event: ev, ts: new Date().toISOString(), role: 'merger' });
  }
  const result = await handle.result;
  store.append({ type: 'goal.cost_added', goalId: goal.id, payload: { costUsd: result.costUsd, source: `merge:${attempt.id}` } });
  engine.recordSessionUsage(result, { goalId: goal.id, kind: 'merge', model: goal.models.strong });
  store.append({ type: 'attempt.session_finished', goalId: goal.id, payload: { attemptId: attempt.id, session: { role: 'merger', segment: attempt.continuations, sessionId: result.sessionId ?? attempt.sessionId, model: initModel ?? goal.models.strong, costUsd: result.costUsd, numTurns: result.numTurns, durationMs: result.durationMs, subtype: result.subtype, startedAt: segmentStart, endedAt: new Date().toISOString() } } });

  const remaining = await conflictedFiles(cwd);
  let ok = remaining.length === 0;
  let reason = ok ? '' : `${remaining.length} file(s) still conflicted (${remaining.slice(0, 4).join(', ')})${result.subtype !== 'success' ? `; session ended with ${result.subtype}` : ''}`;
  if (ok) {
    await gitOk(['add', '-A'], cwd);
    // `git commit` concludes a merge, a squash merge and a cherry-pick alike
    const c = await git([...GIT_IDENT, 'commit', '-q', '-m', `${op.commitMessage}\n\nResolved by merge attempt ${n}`], cwd);
    ok = c.code === 0;
    if (!ok) reason = `commit failed: ${c.stderr.slice(0, 200)}`;
  }
  if (ok && op.runChecks !== false) {
    const checks = listChecks(store.db, goal.id).filter((c) => c.spec.type === 'command' && c.tier === 'must');
    // only regressions count: a check already red on the goal branch before this merge is not the merge's fault
    const baseline = await engine.baseline.failing(goal, attempt.baseRef!);
    const failed: string[] = [];
    const preexisting: string[] = [];
    for (const c of checks) {
      const r = await runCommandCheck(c, { cwd, outputDir: join(config.dataDir, 'check-output'), attemptId: attempt.id });
      store.append({ type: 'check.finished', goalId: goal.id, payload: { result: r } });
      if (r.status !== 'pass') (baseline.has(c.id) ? preexisting : failed).push(`${c.name} (${r.status}: ${r.summary.slice(0, 160).replace(/\s+/g, ' ')})`);
    }
    if (failed.length) {
      ok = false;
      reason = `conflicts resolved but must checks regressed — ${failed.join('; ')}${preexisting.length ? ` (ignored, already failing before the merge: ${preexisting.map((x) => x.split(' (')[0]).join(', ')})` : ''}`;
    } else if (preexisting.length) {
      store.append({ type: 'engine.note', goalId: goal.id, payload: { level: 'info', message: `merge attempt ${n} for ${src.label}: ${preexisting.length} must check(s) fail but already failed on the goal branch before the merge — accepted` } });
    }
  }
  store.append({
    type: 'attempt.finished',
    goalId: goal.id,
    payload: { attemptId: attempt.id, state: 'observing', resultSubtype: result.subtype, costUsd: (resume ? resume.attempt.costUsd : 0) + result.costUsd, numTurns: (resume ? resume.attempt.numTurns : 0) + result.numTurns, endRef: ok ? await headRef(cwd) : null, permissionDenials: [], skillsUsed: result.skillsUsed ?? [], toolsUsed: result.toolsUsed ?? {} },
  });
  store.append({ type: 'attempt.concluded', goalId: goal.id, payload: { attemptId: attempt.id, state: ok ? 'passed' : 'failed', reason: ok ? 'merged and checks pass' : reason } });
  return { ok, reason, attempt: getAttempt(store.db, attempt.id) ?? attempt };
}

export { READONLY_DISALLOWED, commitStaged };
