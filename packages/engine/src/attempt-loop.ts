import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { reportsDollars } from '@foundry/core';
import type { Attempt, Check, CheckResult, Goal, ObservationReport, Task } from '@foundry/core';
import { IdPrefix, bumpStat, chosenStyle, getAttempt, getBrief, getObservation, listAttempts, listChecks, newId, renderDecisions } from '@foundry/core';
import { LIMIT_TEXT, resumeRefused, type RunResult } from '@foundry/runner';
import { attachmentsDir, markitdownHint, renderAttachments } from './attachments.ts';
import { buildAttemptPrompt, styleApplies, summarizeReport } from './attempt-prompt.ts';
import { MCP_SERVER_PREFIX } from './memory/memory.ts';
import { memoryQuestion, memorySection } from './memory/prompt.ts';
import type { CatchUp } from './catchup.ts';
import { resolveDiscipline } from './skills/workflow.ts';
import { metaFor, workerModelFor } from './models/roles.ts';
import { budgetStatus } from './budget.ts';
import { renderUpstream } from './delegation.ts';
import { handoffSection } from './handoff.ts';
import { learningsForWorker } from './learnings.ts';
import { runCommandCheck } from './checks/command.ts';
import { reviewTaskDiff } from './checks/reviewer.ts';
import type { Engine } from './engine.ts';
import { taskCommitMessage } from './git/conventional.ts';
import { commitAll, headRef, numstat, resetHard } from './git/git.ts';
import { boundarySettings } from './guards/boundary.ts';
import { isBoundaryCommand } from './guards/patterns.ts';
import { renderSubjects, sessionDirs, subjectsAddDirs } from './subjects.ts';

export interface AttemptOutcome {
  attempt: Attempt;
  report: ObservationReport;
  result: RunResult;
  passed: boolean;
  nonBoundaryDenials: RunResult['permissionDenials'];
  /** this segment committed a workspace snapshot (it changed something) */
  committed: boolean;
}

/** Why an attempt's session is resumed instead of a new attempt being started. */
export type ContinueReason = 'orphaned' | 'max_turns' | 'max_budget' | 'timeout' | 'checks_failed' | 'usage_limit';

export interface Continuation {
  attempt: Attempt;
  reason: ContinueReason;
  message: string;
}

/** The message that resumes a session. It never restates the task: the session still has all of that. */
export function continuationMessage(reason: ContinueReason, ctx: { timeoutMin?: number; report?: string; goalBranch?: string } = {}): string {
  switch (reason) {
    case 'usage_limit':
      return 'Your session was stopped by a usage limit before you finished. The workspace is exactly as you left it (uncommitted edits were snapshotted). Continue from where you stopped; do not redo finished steps. When done, reply with the usual short summary.';
    case 'orphaned':
      return 'You were interrupted by an engine restart. The workspace is exactly as you left it (uncommitted edits were snapshotted). Continue from where you stopped; do not redo finished steps. When done, reply with the usual short summary.';
    case 'max_turns':
      return 'Your session hit its turn cap before finishing; you have a fresh allowance now. Finish the task — fewer, larger edits; run the narrow test once and the full suite only at the end. Then reply with the usual short summary.';
    case 'max_budget':
      return 'Your session hit its cost cap before finishing; you have a fresh allowance now. Finish the task — fewer, larger edits; avoid re-reading files you already know. Then reply with the usual short summary.';
    case 'timeout':
      return `Your previous session timed out${ctx.timeoutMin ? ` after ${ctx.timeoutMin} min` : ''}. If you were waiting on a long command, narrow it or run it in the background and poll; otherwise continue from where you stopped. Then reply with the usual short summary.`;
    case 'checks_failed':
      return `The engine ran the acceptance checks on your work. These still fail:

${ctx.report ?? '(see above)'}

Fix them; everything else you did is kept. Do not start over. When done, reply with the usual short summary.`;
  }
}

/**
 * A usage limit stopped the session: its rate-limit report was rejected (an exhausted extra usage counts only for a
 * session already on it), or it failed with a limit's error text.
 */
export function cutByLimit(result: Partial<Pick<RunResult, 'rateLimit' | 'isError' | 'errorMessage'>>): boolean {
  const rl = result.rateLimit;
  if (rl?.status === 'rejected' && (rl.rateLimitType !== 'overage' || rl.isUsingOverage)) return true;
  return !!result.isError && LIMIT_TEXT.test(result.errorMessage ?? '');
}

/** A session ended because it was cut, not because it decided to stop. */
export function interruptionOf(result: Pick<RunResult, 'subtype'> & Partial<Pick<RunResult, 'rateLimit' | 'isError' | 'errorMessage'>>): ContinueReason | null {
  if (cutByLimit(result)) return 'usage_limit';
  if (result.subtype === 'error_max_turns') return 'max_turns';
  if (result.subtype === 'error_max_budget_usd') return 'max_budget';
  if (result.subtype === 'killed_timeout' || result.subtype === 'killed_idle') return 'timeout';
  return null;
}

/**
 * After a failed segment: resume the same session (cheap — it keeps its context) or start a fresh attempt?
 * Resume when the session was cut, or when it made progress (committed something and is not getting worse);
 * never beyond `maxContinuations`, never after a rollback. A usage limit's cut is no fault of the session's: it always
 * resumes, and does not count towards the cap.
 */
export function decideNext(i: { result: Parameters<typeof interruptionOf>[0]; committed: boolean; failedCount: number; prevFailedCount: number | null; continuations: number; maxContinuations: number; rolledBack: boolean; sessionId: string | null }): { kind: 'continue'; reason: ContinueReason } | { kind: 'new-attempt' } {
  if (!i.sessionId || i.rolledBack) return { kind: 'new-attempt' };
  const cut = interruptionOf(i.result);
  if (cut === 'usage_limit') return { kind: 'continue', reason: cut };
  if (i.continuations >= i.maxContinuations) return { kind: 'new-attempt' };
  if (cut) return { kind: 'continue', reason: cut };
  if (i.committed && (i.prevFailedCount == null || i.failedCount <= i.prevFailedCount)) return { kind: 'continue', reason: 'checks_failed' };
  return { kind: 'new-attempt' };
}

export function maxAttemptsFor(task: Task): number {
  return task.retryBudget + task.extraAttempts;
}

/**
 * One Plan→Act→Observe pass. Never throws for model/tool failures; throws only on engine bugs
 * (the caller converts those into an engine.note + task retry).
 */
export async function runAttempt(engine: Engine, goal: Goal, task: Task, cwd: string, opts: { baseMoved?: CatchUp | null; resume?: Continuation | null } = {}): Promise<AttemptOutcome> {
  const { store, config } = engine;
  const resume = opts.resume ?? null;
  const prior = listAttempts(store.db, task.id).filter((a) => a.kind === 'work' && a.id !== resume?.attempt.id);
  const index = resume ? resume.attempt.index : prior.length + 1;
  const maxAttempts = maxAttemptsFor(task);
  const checks = listChecks(store.db, goal.id).filter((c) => c.taskId === task.id);

  // --- regression fallback: two consecutive attempts worse than the best → roll back to best
  let rolledBack: { toRef: string; reason: string } | null = null;
  const priorReports = prior.map((a) => ({ a, r: getObservation(store.db, a.id) })).filter((x) => x.r) as { a: Attempt; r: ObservationReport }[];
  if (!resume && priorReports.length >= 3) {
    const best = priorReports.reduce((m, x) => (x.r.failedCount < m.r.failedCount ? x : m));
    const [p1, p2] = priorReports.slice(-2);
    if (p1 && p2 && best.a.id !== p1.a.id && best.a.id !== p2.a.id && p1.r.failedCount > best.r.failedCount && p2.r.failedCount > best.r.failedCount && best.a.endRef) {
      await resetHard(cwd, best.a.endRef);
      rolledBack = { toRef: best.a.endRef, reason: `attempts ${p1.a.index} and ${p2.a.index} regressed relative to attempt ${best.a.index}` };
      store.append({ type: 'workspace.rolled_back', goalId: goal.id, payload: { taskId: task.id, toRef: best.a.endRef, reason: rolledBack.reason } });
    }
  }

  const baseRef = await headRef(cwd);
  /** The task's work is cumulative across attempts; reviewers and change lists judge all of it. A restart clears the task's
   *  base, so it starts again from the goal branch as it is now and its earlier attempts no longer set what is reviewed. */
  const taskBaseRef = task.baseRef ?? prior.find((a) => a.baseRef)?.baseRef ?? resume?.attempt.baseRef ?? baseRef;
  const prevReport = resume ? null : prior.length ? getObservation(store.db, prior[prior.length - 1]!.id) : null;
  // the task's difficulty picks the route; the last budgeted attempt (budget ≥ 2) and human retries run on the strong tier.
  // A continuation keeps the model its attempt started with.
  const routed = workerModelFor(config, goal, task, index);
  const model = resume?.attempt.model ?? routed.model;
  if (!resume && routed.escalated) {
    store.append({ type: 'engine.note', goalId: goal.id, payload: { level: 'info', message: `"${task.title}" attempt ${index}: running on ${routed.model} (the Complex-task model) — ${routed.escalated === 'human-retry' ? 'a retry you granted' : 'the last attempt of its budget'}` } });
  }
  const now = new Date().toISOString();
  const attemptId = resume ? resume.attempt.id : newId(IdPrefix.attempt);
  const attempt: Attempt = resume ? { ...resume.attempt, state: 'running', endedAt: null } : {
    id: attemptId,
    goalId: goal.id,
    skillsUsed: [],
    taskId: task.id,
    index,
    kind: 'work',
    sessionId: null,
    model,
    state: 'created',
    costUsd: 0,
    numTurns: 0,
    resultSubtype: null,
    baseRef,
    endRef: null,
    pid: null,
    cwd,
    transcriptPath: join(config.dataDir, 'transcripts', `${attemptId}.jsonl`),
    startedAt: now,
    endedAt: null,
    continuations: 0,
    sessions: [],
  };
  if (resume) store.append({ type: 'attempt.continued', goalId: goal.id, payload: { attemptId: attempt.id, reason: resume.reason, sessionId: attempt.sessionId } });
  else store.append({ type: 'attempt.started', goalId: goal.id, payload: { attempt } });

  const relevantContext = resume ? null : await engine.context.locate(goal, task).catch(() => null);
  const discipline = resolveDiscipline(goal, task);
  // the files the task touches decide some rules (writing for agents when AGENTS.md, CLAUDE.md or a skill is among them)
  const skillsHint = await engine.skillsFor(goal).hints.sectionFor('worker', { profile: engine.workflowProfileOf(goal), taskKind: task.kind, scenario: task.scenario, projectSkills: goal.autoskills?.status === 'installed' ? goal.autoskills.skills : [], discipline, files: task.relevantFiles });
  const mandated = await engine.skillsFor(goal).hints.mandatedFor('worker', { profile: engine.workflowProfileOf(goal), taskKind: task.kind, scenario: task.scenario, discipline, files: task.relevantFiles });
  const brief = getBrief(store.db, goal.id)?.brief;
  const areaDescription = task.area ? (brief?.areas.find((a) => a.name === task.area)?.description ?? '') : '';
  const decisions = brief ? renderDecisions(brief) : '';
  // what the tasks this one depends on delivered (a Delegated goal's summary; a plain task's commit)
  const upstream = renderUpstream(engine, task);
  const learnings = learningsForWorker(engine, goal);
  // what the folder's Memory says about this task (ADR-0071): nothing while Memory is off or the server is slow; a
  // worker with the hindsight tools is told its bank, so it may ask more mid-way
  const recalled = resume ? null : await engine.memory.reflect('attempt', memoryQuestion('attempt', { goalTitle: goal.title, taskTitle: task.title, taskSpec: task.spec, area: task.area, files: task.relevantFiles }), { repoPath: goal.repoPath, goalId: goal.id, taskId: task.id, attemptId: attempt.id });
  const memory = recalled ? memorySection(recalled.text, { kind: recalled.kind, ...(engine.mcpAllowedFor(goal).includes(MCP_SERVER_PREFIX) ? { tools: true as const, bankId: (await engine.memory.bankFor(goal.repoPath)) ?? '' } : { tools: false as const }) }) : '';
  // the chosen Style Proposal binds everything with a look (UI, mobile, media, general); backend-only scenarios never see it
  const style = brief && styleApplies(task.scenario) ? chosenStyle(brief) : null;
  // the real things the result depicts, with their pictures (outside the worktree: their folder is added to the session)
  const subjects = renderSubjects(config.dataDir, goal.id, brief, 'worker', task.scenario);
  const freshPrompt = (relevantContext: Awaited<ReturnType<typeof engine.context.locate>> | null, prevReport: ObservationReport | null) => buildAttemptPrompt({ goal, task, checks, attemptIndex: index, maxAttempts, prevReport, rolledBack, hint: task.hint, relevantContext, skillsHint, attachments: renderAttachments(goal, config.dataDir), markitdownHint: markitdownHint(engine.markitdown.available(), engine.markitdown.binary()), areaDescription, decisions, upstream, learnings, memory, style, subjects, baseMoved: opts.baseMoved ?? null });
  const prompt = resume ? resume.message : freshPrompt(relevantContext, prevReport);
  // the -p prompt is not echoed in stream-json; keep it next to the transcript for inspection (continuations append)
  mkdirSync(dirname(attempt.transcriptPath!), { recursive: true });
  if (resume) appendFileSync(attempt.transcriptPath!.replace(/\.jsonl$/, '.prompt.md'), `\n\n---\n# Continuation (${resume.reason})\n${prompt}\n`);
  else writeFileSync(attempt.transcriptPath!.replace(/\.jsonl$/, '.prompt.md'), prompt);
  const remaining = budgetStatus(goal).remainingUsd;

  /** one session of the attempt: run and stream it, book its cost and usage */
  const session = async (text: string, resumeSessionId: string | undefined, label: string): Promise<RunResult> => {
    const handle = await engine.runner.run({
      prompt: text,
      cwd,
      model,
      meta: metaFor(goal.id, routed),
      fallbackModel: model === 'opus' ? 'sonnet' : undefined,
      maxTurns: config.attemptMaxTurns,
      maxBudgetUsd: Math.max(0.05, remaining == null ? config.attemptMaxCostUsd : Math.min(config.attemptMaxCostUsd, remaining)),
      permissionMode: 'dontAsk',
      ...engine.workerToolPolicy(goal),
      appendSystemPromptFile: engine.roles.path('worker'),
      settings: boundarySettings(config.hooksDir),
      settingSources: config.settingSources,
      addDirs: sessionDirs([...(goal.attachments.length ? [attachmentsDir(config.dataDir, goal.id)] : []), ...(subjects ? subjectsAddDirs(config.dataDir, goal.id, brief) : [])]),
      timeoutMs: config.attemptTimeoutMs,
      transcriptPath: attempt.transcriptPath!,
      resumeSessionId,
      env: { FOUNDRY_ATTEMPT_ID: attempt.id, FOUNDRY_GOAL_ID: goal.id, ...(config.extraBoundaryPatterns ? { FOUNDRY_EXTRA_PATTERNS: config.extraBoundaryPatterns } : {}) },
      label,
    });
    engine.registerInFlight(task.id, attempt.id, handle);
    let hookSeen = false;
    const segmentStart = new Date().toISOString();
    let initModel: string | null = null;
    let initSession: string | null = null;
    try {
      for await (const ev of handle.events) {
        if (ev.kind === 'init') {
          initModel = ev.model;
          initSession = ev.sessionId;
          store.append({ type: 'attempt.session', goalId: goal.id, payload: { attemptId: attempt.id, sessionId: ev.sessionId, model: ev.model, pid: handle.pid } });
        }
        if (ev.kind === 'hook' && ev.name.startsWith('SessionStart')) hookSeen = true;
        if (ev.kind === 'init' && !hookSeen) {
          // fail closed: settings were silently ignored, the boundary guard is not active
          store.append({ type: 'engine.note', goalId: goal.id, payload: { level: 'error', message: `attempt ${attempt.id}: hook canary not observed before init — killing run (boundary guard inactive)` } });
          handle.kill('killed_manual');
        }
        engine.broadcast({ goalId: goal.id, taskId: task.id, attemptId: attempt.id, event: ev, ts: new Date().toISOString() });
      }
    } finally {
      engine.unregisterInFlight(task.id);
    }
    const result = await handle.result;
    store.append({ type: 'goal.cost_added', goalId: goal.id, payload: { costUsd: result.costUsd, source: `attempt:${attempt.id}` } });
    engine.recordSessionUsage(result, { goalId: goal.id, kind: 'attempt', model: attempt.model });
    store.append({ type: 'attempt.session_finished', goalId: goal.id, payload: { attemptId: attempt.id, session: { role: 'worker', segment: (getAttempt(store.db, attempt.id) ?? attempt).sessions.filter((s) => s.role === 'worker').length, sessionId: initSession ?? attempt.sessionId, model: initModel ?? attempt.model, costUsd: result.costUsd, numTurns: result.numTurns, durationMs: result.durationMs, subtype: result.subtype, startedAt: segmentStart, endedAt: new Date().toISOString(), costAvailable: result.costStatus !== 'unavailable' } } });
    if (result.costStatus === 'unavailable' && reportsDollars(goal.provider)) {
      store.append({ type: 'engine.note', goalId: goal.id, payload: { level: 'warn', message: `attempt ${attempt.id}: the session ended (${result.subtype}) before Claude Code reported its cost — ${result.numTurns} turn${result.numTurns === 1 ? '' : 's'} and its tokens are counted, the dollars are unknown and missing from the goal's total` } });
    }
    return result;
  };
  let result = await session(prompt, resume ? (attempt.sessionId ?? undefined) : undefined, `attempt ${task.title} #${index}${resume ? ` (continuation ${attempt.continuations + 1})` : ''}`);
  if (resume && resumeRefused(result)) {
    // the coding agent could not pick the session up (another account's home or signatures, a cleaned record): a new
    // session takes over in the same workspace, told what the earlier one did (ADR-0065)
    store.append({ type: 'engine.note', goalId: goal.id, payload: { level: 'warn', message: `attempt ${attempt.id}: its session could not be resumed (${(result.errorMessage ?? result.subtype).slice(0, 160)}); a new session takes over with a handoff` } });
    const why = resume.reason === 'usage_limit' ? 'stopped by a usage limit' : resume.reason === 'orphaned' ? 'interrupted by an engine restart' : `cut short: ${resume.reason.replace('_', ' ')}`;
    const handoff = await handoffSection({ cwd, attemptBaseRef: attempt.baseRef, taskBaseRef, transcriptPath: attempt.transcriptPath, provider: goal.provider ?? 'claude', why });
    const latest = prior.length ? getObservation(store.db, prior[prior.length - 1]!.id) : null;
    const text = `${freshPrompt(await engine.context.locate(goal, task).catch(() => null), latest)}\n\n${handoff}`;
    appendFileSync(attempt.transcriptPath!.replace(/\.jsonl$/, '.prompt.md'), `\n\n---\n# Handoff (the session could not be resumed)\n${text}\n`);
    result = await session(text, undefined, `attempt ${task.title} #${index} (handoff)`);
  }
  // a session a usage limit stopped mid-work resumes (scheduler): it is neither reviewed nor judged done half-way
  const limited = cutByLimit(result);

  const commit = await commitAll(cwd, taskCommitMessage(goal, task, { attempt: index }));
  if (commit.committed) store.append({ type: 'workspace.committed', goalId: goal.id, payload: { taskId: task.id, attemptId: attempt.id, ref: commit.ref } });
  // an attempt's cost and turns are cumulative over its continuations
  const soFar = resume ? (getAttempt(store.db, attempt.id) ?? attempt) : null;
  store.append({
    type: 'attempt.finished',
    goalId: goal.id,
    payload: {
      attemptId: attempt.id,
      state: 'observing',
      resultSubtype: result.subtype,
      costUsd: (soFar?.costUsd ?? 0) + result.costUsd,
      numTurns: (soFar?.numTurns ?? 0) + result.numTurns,
      endRef: commit.ref,
      permissionDenials: result.permissionDenials.map((d) => ({ tool_name: d.tool_name, tool_input: d.tool_input })),
      skillsUsed: result.skillsUsed ?? [],
      toolsUsed: result.toolsUsed ?? {},
    },
  });
  const workflow = { observable: (goal.provider ?? 'claude') === 'claude', mandated: mandated.map((m) => ({ name: m.name, invoke: m.invoke })), used: result.skillsUsed ?? [] };

  // --- Observe
  const results: CheckResult[] = [];
  for (const c of checks) {
    if (c.spec.type !== 'command') continue;
    const r = await runCommandCheck(c, { cwd, outputDir: join(config.dataDir, 'check-output'), attemptId: attempt.id, summarize: engine.summarizer(goal, cwd) });
    results.push(r);
    store.append({ type: 'check.finished', goalId: goal.id, payload: { result: r } });
  }
  bumpStat(store.db, 'attempt.cost', result.costUsd);
  const mustCommand = checks.filter((c) => c.tier === 'must' && c.spec.type === 'command');
  const objectivePassed = mustCommand.every((c) => results.find((r) => r.checkId === c.id)?.status === 'pass');

  let reviewerVerdict: ObservationReport['reviewerVerdict'] = null;
  const reviewerChecks = checks.filter((c) => c.spec.type === 'reviewer');
  const cumulativeChanged = await numstat(cwd, taskBaseRef);
  if (!limited && objectivePassed && cumulativeChanged.length === 0) {
    // Nothing changed across all attempts yet every objective check passes: the task is already
    // satisfied by the tree as-is. The reviewer has nothing to judge; checks are the truth.
    store.append({ type: 'engine.note', goalId: goal.id, payload: { level: 'info', message: `task ${task.id}: no changes needed — objective checks pass on the current tree` } });
  } else if (!limited && objectivePassed && (reviewerChecks.length || (engine.config.alwaysReviewTasks && goal.workflow.pace !== 'fast'))) {
    reviewerVerdict = await reviewTaskDiff(engine, goal, task, attempt, cwd, taskBaseRef, reviewerChecks, workflow).catch((err) => {
      store.append({ type: 'engine.note', goalId: goal.id, payload: { level: 'warn', message: `task reviewer failed: ${String(err)}` } });
      return null;
    });
    if (reviewerVerdict) store.append({ type: 'review.task.finished', goalId: goal.id, payload: { attemptId: attempt.id, taskId: task.id, verdict: reviewerVerdict } });
    for (const c of reviewerChecks) {
      const r: CheckResult = {
        id: newId(IdPrefix.checkResult),
        checkId: c.id,
        goalId: goal.id,
        taskId: task.id,
        attemptId: attempt.id,
        // no verdict = infrastructure problem (model ran out of turns, bad JSON…), never the worker's fault:
        // the check is skipped for this attempt and the objective checks decide
        status: reviewerVerdict ? (reviewerVerdict.pass ? 'pass' : 'fail') : 'skipped',
        summary: reviewerVerdict ? (reviewerVerdict.pass ? 'Reviewer: no blockers.' : reviewerVerdict.blockers.join('\n')) : 'reviewer returned no verdict — skipped for this attempt (objective checks decide)',
        rawRef: null,
        durationMs: 0,
        at: new Date().toISOString(),
      };
      results.push(r);
      store.append({ type: 'check.finished', goalId: goal.id, payload: { result: r } });
    }
  }

  const changedFiles = cumulativeChanged;
  const mustResults = results.filter((r) => checks.find((c) => c.id === r.checkId)?.tier === 'must');
  const allMustPassed = !limited && mustResults.every((r) => r.status === 'pass' || r.status === 'skipped') && (reviewerVerdict ? reviewerVerdict.pass : true) && objectivePassed;
  const failedCount = results.filter((r) => r.status !== 'pass' && r.status !== 'skipped').length + ((result.isError || limited) && !allMustPassed ? 1 : 0);
  const report: ObservationReport = {
    attemptId: attempt.id,
    taskId: task.id,
    goalId: goal.id,
    results,
    reviewerVerdict,
    changedFiles,
    summary: '',
    allMustPassed,
    failedCount,
  };
  const runNote = limited
    ? `The session was stopped by a usage limit before it finished${result.errorMessage ? ` (${result.errorMessage.slice(0, 200)})` : ''}; its edits so far are committed and it resumes where it stopped.\n`
    : result.subtype === 'error_max_budget_usd' || result.subtype === 'error_max_turns'
      ? `The previous session hit its per-session ${result.subtype === 'error_max_turns' ? 'turn' : 'cost'} cap before finishing; its edits so far are committed in this workspace — continue from them, do not start over. Work in bigger steps: fewer, more complete edits; run the narrow test once, the full suite only at the end.\n`
      : result.isError || result.subtype !== 'success'
        ? `Session ended with ${result.subtype}${result.errorMessage ? `: ${result.errorMessage.slice(0, 300)}` : ''}.\n`
        : '';
  const workerSummary = result.finalText ? `Worker's own summary:\n${result.finalText.slice(0, 1500)}\n\n` : '';
  report.summary = `${runNote}${workerSummary}${summarizeReport(report, checks, workflow)}`;
  store.append({ type: 'observation.reported', goalId: goal.id, payload: { report } });

  const nonBoundaryDenials = result.permissionDenials.filter((d) => !(d.tool_name === 'Bash' && isBoundaryCommand((d.tool_input as any)?.command)));
  store.append({ type: 'attempt.concluded', goalId: goal.id, payload: { attemptId: attempt.id, state: allMustPassed ? 'passed' : 'failed', reason: allMustPassed ? 'all must checks passed' : `${failedCount} failing` } });
  return { attempt: getAttempt(store.db, attempt.id) ?? attempt, report, result, passed: allMustPassed, nonBoundaryDenials, committed: commit.committed };
}
