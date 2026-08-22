import { join } from 'node:path';
import type { Check, CheckResult, Goal, Task } from '@ai-engine/core';
import { IdPrefix, getBrief, listChecks, listTasks, newId } from '@ai-engine/core';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { attachmentsDir, renderAttachments } from './attachments.ts';
import { budgetStatus } from './budget.ts';
import { runCommandCheck } from './checks/command.ts';
import { tryJson } from './checks/reviewer.ts';
import type { Engine } from './engine.ts';
import { goalScenario } from './skills/workflow.ts';
import { raiseEscalation } from './escalation.ts';
import { diff } from './git/git.ts';
import { READONLY_DISALLOWED, READONLY_TOOLS, boundarySettings } from './guards/boundary.ts';
import { goalWorkspacePath } from './workspace.ts';

const GoalReviewOutput = z.object({
  mustVerdicts: z.array(z.object({ checkName: z.string(), pass: z.boolean(), reason: z.string() })),
  stretchVerdicts: z.array(z.object({ checkName: z.string(), pass: z.boolean(), reason: z.string() })),
  fixTasks: z.array(z.object({ title: z.string(), spec: z.string(), relevantFiles: z.array(z.string()) })).describe('Tasks needed to make failing MUST items pass. Empty if all must items pass.'),
  notes: z.string(),
});

/**
 * Goal-level review: re-run all goal-level command checks (objective truth), then a strong-model
 * review of the whole diff against Must/Stretch. Failing Must → fix tasks (bounded) or escalation.
 */
export async function runGoalReview(engine: Engine, goal: Goal): Promise<void> {
  const { store, config } = engine;
  const goalWs = goalWorkspacePath(config.dataDir, goal.id);
  const checks = listChecks(store.db, goal.id);
  const goalChecks = checks.filter((c) => c.taskId === null);
  const results: CheckResult[] = [];

  for (const c of goalChecks) {
    if (c.spec.type !== 'command') continue;
    const r = await runCommandCheck(c, { cwd: goalWs, outputDir: join(config.dataDir, 'check-output'), attemptId: null });
    results.push(r);
    store.append({ type: 'check.finished', goalId: goal.id, payload: { result: r } });
  }
  // Stretch command checks attached to tasks also count toward over-delivery; re-run them on the merged tree.
  for (const c of checks.filter((x) => x.taskId !== null && x.tier === 'stretch' && x.spec.type === 'command')) {
    const r = await runCommandCheck(c, { cwd: goalWs, outputDir: join(config.dataDir, 'check-output'), attemptId: null });
    results.push(r);
    store.append({ type: 'check.finished', goalId: goal.id, payload: { result: r } });
  }

  const reviewerChecks = goalChecks.filter((c) => c.spec.type === 'reviewer');
  let review: z.infer<typeof GoalReviewOutput> | null = null;
  let reviewError: string | null = null;
  const baseDiff = await diff(goalWs, goal.baseBranch, 'HEAD', 120_000);
  if (baseDiff.trim() && (reviewerChecks.length || engine.config.alwaysReviewTasks)) {
    review = await reviewGoal(engine, goal, goalWs, baseDiff, checks, results).catch((err) => {
      reviewError = String((err as Error).message ?? err).slice(0, 300);
      store.append({ type: 'engine.note', goalId: goal.id, payload: { level: 'warn', message: `goal reviewer failed: ${reviewError}` } });
      return null;
    });
  }
  for (const c of reviewerChecks) {
    const v = review ? [...review.mustVerdicts, ...review.stretchVerdicts].find((x) => x.checkName === c.name) : null;
    const r: CheckResult = {
      id: newId(IdPrefix.checkResult),
      checkId: c.id,
      goalId: goal.id,
      taskId: null,
      attemptId: null,
      status: v ? (v.pass ? 'pass' : 'fail') : review ? 'fail' : 'error',
      summary: v ? v.reason : review ? 'reviewer gave no verdict for this check' : `reviewer session produced no verdict — ${reviewError ?? 'unknown error'}. Answer "Retry" to run the review again.`,
      rawRef: null,
      durationMs: 0,
      at: new Date().toISOString(),
    };
    results.push(r);
    store.append({ type: 'check.finished', goalId: goal.id, payload: { result: r } });
  }

  const tier = (r: CheckResult) => checks.find((c) => c.id === r.checkId)?.tier;
  const mustResults = results.filter((r) => tier(r) === 'must');
  const stretchResults = results.filter((r) => tier(r) === 'stretch');
  // Task-level stretch checks that passed during their attempts (non-command, e.g. reviewer) are counted from the brief
  const mustPassed = mustResults.every((r) => r.status === 'pass') && (review ? review.mustVerdicts.every((v) => v.pass) : true);
  const stretchChecksAll = checks.filter((c) => c.tier === 'stretch');
  const stretchPassed = stretchChecksAll.length > 0 && stretchResults.length > 0 && stretchResults.every((r) => r.status === 'pass') && (review ? review.stretchVerdicts.every((v) => v.pass) : true);

  if (mustPassed) {
    store.append({ type: 'review.goal.finished', goalId: goal.id, payload: { passed: true, overDelivered: stretchPassed, mustResults, stretchResults, fixTaskIds: [], notes: review?.notes ?? '' } });
    store.append({ type: 'goal.state_changed', goalId: goal.id, payload: { from: 'goal_review', to: stretchPassed ? 'over_delivered' : 'done', reason: stretchPassed ? 'all must + stretch checks pass' : 'all must checks pass' } });
    return;
  }

  // Failing must: spawn fix tasks (bounded) or escalate
  const fixSpecs = review?.fixTasks ?? [];
  if (goal.fixCycles < config.maxFixCycles && (fixSpecs.length || mustResults.some((r) => r.status !== 'pass'))) {
    const now = new Date().toISOString();
    const existing = listTasks(store.db, goal.id);
    const specs = fixSpecs.length
      ? fixSpecs
      : [
          {
            title: 'Fix failing goal-level checks',
            spec: `The following goal-level checks fail on the merged result:\n${mustResults
              .filter((r) => r.status !== 'pass')
              .map((r) => `- ${checks.find((c) => c.id === r.checkId)?.name}\n\`\`\`\n${r.summary.slice(0, 1200)}\n\`\`\``)
              .join('\n')}\nMake them pass without weakening the checks.`,
            relevantFiles: [],
          },
        ];
    const ids: string[] = [];
    for (const s of specs) {
      const t: Task = {
        id: newId(IdPrefix.task),
        goalId: goal.id,
        title: s.title,
        spec: s.spec,
        kind: 'bug',
        scope: null,
        scenario: goalScenario(existing),
        dependsOn: existing.filter((x) => x.state === 'done' || x.state === 'skipped').map((x) => x.id),
        relevantFiles: s.relevantFiles,
        parallelizable: false,
        retryBudget: goal.budgets.attemptsPerTask,
        origin: 'goal-review-fix',
        state: 'pending',
        branch: null,
        worktreePath: null,
        baseRef: null,
        commitRef: null,
        commitMessage: null,
        hint: null,
        extraAttempts: 0,
        createdAt: now,
        updatedAt: now,
      };
      store.append({ type: 'task.created', goalId: goal.id, payload: { task: t } });
      // goal-level must command checks are re-run at the next review; give the fix task the same checks so its attempts self-verify
      for (const c of goalChecks.filter((x) => x.tier === 'must' && x.spec.type === 'command')) {
        const copy: Check = { ...c, id: newId(IdPrefix.check), taskId: t.id };
        store.append({ type: 'check.created', goalId: goal.id, payload: { check: copy } });
      }
      ids.push(t.id);
    }
    store.append({ type: 'review.goal.finished', goalId: goal.id, payload: { passed: false, overDelivered: false, mustResults, stretchResults, fixTaskIds: ids, notes: review?.notes ?? '' } });
    store.append({ type: 'goal.state_changed', goalId: goal.id, payload: { from: 'goal_review', to: 'running', reason: `fix cycle ${goal.fixCycles + 1}: ${ids.length} fix task(s)` } });
    return;
  }

  store.append({ type: 'review.goal.finished', goalId: goal.id, payload: { passed: false, overDelivered: false, mustResults, stretchResults, fixTaskIds: [], notes: review?.notes ?? '' } });
  raiseEscalation(engine, {
    goal,
    trigger: 'retries_exhausted',
    message: reviewError
      ? `The goal reviewer session produced no verdict (${reviewError}), so the reviewer-type Must checks could not be judged: ${mustResults
          .filter((r) => r.status === 'error')
          .map((r) => checks.find((c) => c.id === r.checkId)?.name)
          .join(', ')}. All command checks ${mustResults.filter((r) => r.status !== 'error').every((r) => r.status === 'pass') ? 'passed' : 'did not all pass'}.\n\n**Retry with hint** runs the goal review again (no new work is done).`
      : `Goal review failed after ${goal.fixCycles} fix cycle(s). Failing Must checks: ${mustResults
          .filter((r) => r.status !== 'pass')
          .map((r) => checks.find((c) => c.id === r.checkId)?.name)
          .join(', ')}${review ? `\n\n${review.notes.slice(0, 800)}` : ''}`,
    payload: { kind: 'goal-review' },
    blockGoal: true,
  });
}

async function reviewGoal(engine: Engine, goal: Goal, cwd: string, d: string, checks: Check[], objective: CheckResult[]) {
  const brief = getBrief(engine.store.db, goal.id)?.brief;
  const fmt = (c: Check) => `- [${c.tier}] ${c.name}${c.spec.type === 'reviewer' ? `: ${c.spec.rubric}` : c.spec.type === 'command' ? ` (command \`${c.spec.cmd}\` → ${objective.find((r) => r.checkId === c.id)?.status ?? 'n/a'})` : ''}`;
  const reviewerHint = await engine.skills.hints.sectionFor('reviewer-goal', { scenario: goalScenario(listTasks(engine.store.db, goal.id)) });
  const prompt = [
    `# Goal\n${goal.title}\n\n${goal.prompt}`,
    renderAttachments(goal, engine.config.dataDir),
    brief ? `# Approved understanding\n${brief.understanding}` : '',
    reviewerHint ?? '',
    `# Fixed point\nThe base of this review is \`${goal.baseBranch}\`; everything in the diff below was added by this goal.`,
    `# Acceptance checks\nObjective command checks were already executed by the engine; their status is shown. You judge the reviewer-type checks and the overall result.\n${checks.map(fmt).join('\n')}`,
    `# Full diff against ${goal.baseBranch}\n\`\`\`diff\n${d}\n\`\`\``,
    `The full diff is above — judge from it. Open a file only when the diff alone cannot answer a check (a handful at most); do not re-read files that appear in the diff. Judge every check by name. For MUST items that fail, propose concrete fix tasks. Do not propose work beyond the listed checks.`,
  ]
    .filter(Boolean)
    .join('\n\n');
  // Reviewing a whole goal means reading a large diff and often a few files: give it the same room as a worker session
  // (bounded by what is left of the goal budget), and nudge once if it ran out before answering.
  const remaining = budgetStatus(goal).remainingUsd;
  // floor of $6 even when the goal budget is exhausted: a review that cannot finish is pure waste, and the budget
  // overrun itself is escalated to the human separately
  const cap = Math.max(6, remaining == null ? engine.config.attemptMaxCostUsd : Math.min(engine.config.attemptMaxCostUsd, remaining));
  const transcriptPath = join(engine.config.dataDir, 'transcripts', `goal-review-${goal.id}-${goal.fixCycles}.jsonl`);
  const channel = `goal-review-${goal.fixCycles}`;
  const base = {
    cwd,
    model: goal.models.strong,
    meta: { goalId: goal.id, tier: 'strong' },
    permissionMode: 'dontAsk' as const,
    allowedTools: READONLY_TOOLS,
    disallowedTools: READONLY_DISALLOWED,
    jsonSchema: zodToJsonSchema(GoalReviewOutput, { $refStrategy: 'none' }),
    settings: boundarySettings(engine.config.hooksDir),
    settingSources: engine.config.settingSources,
    addDirs: goal.attachments.length ? [attachmentsDir(engine.config.dataDir, goal.id)] : undefined,
    transcriptPath,
  };
  const handle = await engine.runner.run({ ...base, prompt, maxTurns: 80, maxBudgetUsd: cap, appendSystemPromptFile: engine.roles.path('reviewer-goal'), timeoutMs: 15 * 60_000, label: `goal review ${goal.title}` });
  for await (const ev of handle.events) engine.broadcast({ goalId: goal.id, taskId: null, attemptId: channel, event: ev, ts: new Date().toISOString() });
  let r = await handle.result;
  engine.store.append({ type: 'goal.cost_added', goalId: goal.id, payload: { costUsd: r.costUsd, source: 'goal-review' } });
  engine.recordSessionUsage(r, { goalId: goal.id, kind: 'review-goal', model: goal.models.strong });
  let parsed = GoalReviewOutput.safeParse(r.structuredOutput ?? tryJson(r.finalText));
  if (!parsed.success && r.sessionId) {
    // the session ended (budget/turns) before the JSON: resume it with a small fresh budget and ask for the verdict only
    const again = await engine.runner.run({ ...base, prompt: 'Stop exploring. Reply now with ONLY the JSON verdict matching the schema, judging from what you have already read. Unverified Must items fail with a reason; unverified Stretch items pass.', maxTurns: 3, maxBudgetUsd: 2, resumeSessionId: r.sessionId, timeoutMs: 5 * 60_000, label: `goal review ${goal.title} (nudge)` });
    for await (const ev of again.events) engine.broadcast({ goalId: goal.id, taskId: null, attemptId: channel, event: ev, ts: new Date().toISOString() });
    const r2 = await again.result;
    engine.store.append({ type: 'goal.cost_added', goalId: goal.id, payload: { costUsd: r2.costUsd, source: 'goal-review' } });
    engine.recordSessionUsage(r2, { goalId: goal.id, kind: 'review-goal', model: goal.models.strong });
    parsed = GoalReviewOutput.safeParse(r2.structuredOutput ?? tryJson(r2.finalText));
    if (!parsed.success) r = r2;
  }
  if (!parsed.success) throw new Error(`${r.subtype}${r.errorMessage ? ` (${r.errorMessage.slice(0, 120)})` : ''}: no JSON verdict`);
  return parsed.data;
}
