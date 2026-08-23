import { join } from 'node:path';
import type { Attempt, Check, Goal, ReviewerVerdict, Task } from '@ai-engine/core';
import { ReviewerVerdict as ReviewerVerdictSchema } from '@ai-engine/core';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { Engine } from '../engine.ts';
import { diff } from '../git/git.ts';
import { READONLY_DISALLOWED, READONLY_TOOLS, boundarySettings } from '../guards/boundary.ts';

/**
 * Task-level lightweight review: cheap model, diff + spec only, blockers only.
 * Runs only after objective checks passed (decision 14).
 */
export interface WorkflowObservation {
  /** skills the worker was required to invoke for this task kind */
  mandated: { name: string; invoke: string }[];
  /** skills the worker actually invoked (observed) */
  used: string[];
}

/** Did the session invoke this skill? Matches bare names and plugin-qualified names. */
export const usedSkill = (used: string[], name: string): boolean => used.some((u) => u === name || u.endsWith(`:${name}`) || u === name.replace(/^\//, ''));

export function formatWorkflowObservation(w: WorkflowObservation | null | undefined): string {
  if (!w?.mandated.length) return '';
  const lines = w.mandated.map((m) => `- ${m.invoke}: ${usedSkill(w.used, m.name) ? 'invoked ✓' : 'NOT invoked'}`);
  return `# Workflow\nThe worker was required to invoke these skills for this kind of task; observed Skill-tool invocations: ${w.used.length ? w.used.join(', ') : 'none'}.\n${lines.join('\n')}\nA missing invocation is worth a note (the next attempt will read it), not a blocker — judge the diff on its merits.`;
}

export async function reviewTaskDiff(engine: Engine, goal: Goal, task: Task, attempt: Attempt, cwd: string, baseRef: string, checks: Check[], workflow?: WorkflowObservation | null): Promise<ReviewerVerdict | null> {
  const d = await diff(cwd, baseRef, 'HEAD', 20_000);
  if (!d.trim()) return { pass: false, blockers: ['No changes were made in this attempt.'] };
  const rubric = checks
    .map((c) => (c.spec.type === 'reviewer' ? `- ${c.name}: ${c.spec.rubric}` : ''))
    .filter(Boolean)
    .join('\n');
  const reviewerHint = await engine.skills.hints.sectionFor('reviewer-task', { scenario: task.scenario });
  const prompt = [
    `# Task (${task.kind}${task.scenario !== 'general' ? `, ${task.scenario}` : ''})\n${task.title}\n\n${task.spec}`,
    rubric ? `# Rubric (verify each)\n${rubric}` : '',
    reviewerHint ?? '',
    formatWorkflowObservation(workflow),
    `# Diff\n\`\`\`diff\n${d}\n\`\`\``,
    `The diff is above — judge from it; open at most a few files, only when the diff cannot answer. Review it against the task on two axes — Spec (does it do what the task and rubric ask?) and Standards (does it follow this repository's conventions?). Report BLOCKERS only: correctness bugs, security issues, scope violations (changes clearly outside the task), destroyed functionality, hard-coded secrets, or rubric items not met. Style nits are not blockers. If there are no blockers, pass.\n\nOutput: call the structured-output tool with the verdict object itself as its arguments — top-level keys \`pass\` (boolean), \`blockers\` (string[]), \`notes\` (string) and nothing else. Do NOT wrap it in a string or under a \`parameters\` key; that fails validation and costs a retry.`,
  ]
    .filter(Boolean)
    .join('\n\n');

  const handle = await engine.runner.run({
    prompt,
    cwd,
    model: goal.models.cheap,
    meta: { goalId: goal.id, tier: 'cheap' },
    // the cheap model sometimes spends its turns reading files; give it room, and nudge once below if it still returns no JSON
    maxTurns: 20,
    maxBudgetUsd: 0.8,
    permissionMode: 'dontAsk',
    allowedTools: READONLY_TOOLS,
    disallowedTools: READONLY_DISALLOWED,
    appendSystemPromptFile: engine.roles.path('reviewer-task'),
    jsonSchema: zodToJsonSchema(ReviewerVerdictSchema, { $refStrategy: 'none' }),
    settings: boundarySettings(engine.config.hooksDir),
    settingSources: engine.config.settingSources,
    timeoutMs: 5 * 60_000,
    transcriptPath: join(engine.config.dataDir, 'transcripts', `${attempt.id}.review.jsonl`),
    label: `review ${task.title}`,
  });
  const started = new Date().toISOString();
  let initModel: string | null = null;
  for await (const ev of handle.events) {
    if (ev.kind === 'init') initModel = ev.model;
    engine.broadcast({ goalId: goal.id, taskId: task.id, attemptId: attempt.id, event: ev, ts: new Date().toISOString(), role: 'reviewer' });
  }
  const r = await handle.result;
  engine.store.append({ type: 'goal.cost_added', goalId: goal.id, payload: { costUsd: r.costUsd, source: `review-task:${attempt.id}` } });
  engine.recordSessionUsage(r, { goalId: goal.id, kind: 'review-task', model: goal.models.cheap });
  engine.store.append({ type: 'attempt.session_finished', goalId: goal.id, payload: { attemptId: attempt.id, session: { role: 'reviewer', segment: attempt.continuations, sessionId: r.sessionId, model: initModel ?? goal.models.cheap, costUsd: r.costUsd, numTurns: r.numTurns, durationMs: r.durationMs, subtype: r.subtype, startedAt: started, endedAt: new Date().toISOString() } } });
  let parsed = ReviewerVerdictSchema.safeParse(r.structuredOutput ?? tryJson(r.finalText));
  if (!parsed.success && r.sessionId) {
    // one nudge in the same session: "stop reading, answer now"
    const again = await engine.runner.run({
      prompt: 'Stop exploring. Reply now with ONLY the JSON verdict matching the schema (pass, blockers, notes). If you are unsure, pass with a note.',
      cwd,
      model: goal.models.cheap,
      meta: { goalId: goal.id, tier: 'cheap' },
      maxTurns: 2,
      maxBudgetUsd: 0.2,
      permissionMode: 'dontAsk',
      allowedTools: READONLY_TOOLS,
      disallowedTools: READONLY_DISALLOWED,
      jsonSchema: zodToJsonSchema(ReviewerVerdictSchema, { $refStrategy: 'none' }),
      settings: boundarySettings(engine.config.hooksDir),
      settingSources: engine.config.settingSources,
      resumeSessionId: r.sessionId,
      timeoutMs: 3 * 60_000,
      transcriptPath: join(engine.config.dataDir, 'transcripts', `${attempt.id}.review.jsonl`),
      label: `review ${task.title} (nudge)`,
    });
    const started2 = new Date().toISOString();
    for await (const ev of again.events) engine.broadcast({ goalId: goal.id, taskId: task.id, attemptId: attempt.id, event: ev, ts: new Date().toISOString(), role: 'reviewer' });
    const r2 = await again.result;
    engine.store.append({ type: 'goal.cost_added', goalId: goal.id, payload: { costUsd: r2.costUsd, source: `review-task:${attempt.id}` } });
    engine.recordSessionUsage(r2, { goalId: goal.id, kind: 'review-task', model: goal.models.cheap });
    engine.store.append({ type: 'attempt.session_finished', goalId: goal.id, payload: { attemptId: attempt.id, session: { role: 'reviewer', segment: attempt.continuations, sessionId: r2.sessionId, model: initModel ?? goal.models.cheap, costUsd: r2.costUsd, numTurns: r2.numTurns, durationMs: r2.durationMs, subtype: r2.subtype, startedAt: started2, endedAt: new Date().toISOString() } } });
    parsed = ReviewerVerdictSchema.safeParse(r2.structuredOutput ?? tryJson(r2.finalText));
  }
  if (!parsed.success) {
    engine.store.append({ type: 'engine.note', goalId: goal.id, payload: { level: 'warn', message: `task reviewer returned no verdict for attempt ${attempt.id} (${r.subtype}${r.errorMessage ? `: ${r.errorMessage.slice(0, 120)}` : ''}) — objective checks decide this attempt` } });
    return null;
  }
  return parsed.data;
}

export function tryJson(s: string | null): unknown {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    const m = s.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]);
      } catch {}
    }
    return null;
  }
}
