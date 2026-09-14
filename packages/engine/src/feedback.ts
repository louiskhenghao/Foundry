import { join } from 'node:path';
import type { Goal } from '@foundry/core';
import { FeedbackPlan, getBrief, getTask, listTasks, renderDecisions } from '@foundry/core';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { hintOnly } from './checkpoint.ts';
import { tryJson } from './checks/reviewer.ts';
import type { Engine } from './engine.ts';
import { READONLY_DISALLOWED, READONLY_TOOLS, boundarySettings } from './guards/boundary.ts';
import { goalWorkspacePath } from './workspace.ts';

/** a triage session is small: it reads the Brief and the feedback, opens a file or two at most */
export const FEEDBACK_MAX_BUDGET_USD = 0.5;

/**
 * Turn what the person wrote at a milestone into a plan (hint / fix tasks / decision) with a cheap read-only session.
 * The plan is shown to the person and applied only when they confirm it (answer `feedback` with the plan).
 */
export async function classifyFeedback(engine: Engine, goal: Goal, text: string): Promise<FeedbackPlan> {
  const { store, config } = engine;
  const cp = goal.checkpoint;
  if (!cp) throw new Error('no milestone is open for this goal');
  if (!text.trim()) throw new Error('feedback is empty');
  const brief = getBrief(store.db, goal.id)?.brief;
  const milestone = getTask(store.db, cp.taskId);
  const tasks = listTasks(store.db, goal.id);
  const prompt = [
    `# Goal\n${goal.title}\n\n${goal.prompt.slice(0, 3000)}`,
    brief ? `# Approved understanding\n${brief.understanding}` : '',
    brief ? renderDecisions(brief) : '',
    `# Milestone\n"${milestone?.title ?? cp.taskId}" — the person was asked to look at: ${cp.lookFor}${cp.recheck ? '\n\nThis is the SECOND look at this milestone, after fix tasks from earlier feedback. Only kind "hint" is allowed now: fold anything else into the hint text.' : ''}`,
    `# Landed tasks\n${tasks.filter((t) => t.state === 'done').map((t) => `- ${t.title}`).join('\n') || '(none)'}\n\n# Tasks still to run\n${tasks.filter((t) => t.state === 'pending' || t.state === 'ready').map((t) => `- ${t.title}`).join('\n') || '(none)'}`,
    `# What the person wrote\n${text.trim()}`,
  ]
    .filter(Boolean)
    .join('\n\n');
  const handle = await engine.runner.run({
    prompt,
    cwd: goalWorkspacePath(config.dataDir, goal),
    model: goal.models.cheap,
    meta: { goalId: goal.id, tier: 'cheap' },
    permissionMode: 'dontAsk',
    allowedTools: READONLY_TOOLS,
    disallowedTools: READONLY_DISALLOWED,
    jsonSchema: zodToJsonSchema(FeedbackPlan, { $refStrategy: 'none' }),
    settings: boundarySettings(config.hooksDir),
    settingSources: config.settingSources,
    appendSystemPromptFile: engine.roles.path('feedback'),
    maxTurns: 15,
    maxBudgetUsd: FEEDBACK_MAX_BUDGET_USD,
    timeoutMs: 3 * 60_000,
    transcriptPath: join(config.dataDir, 'transcripts', `feedback-${goal.id}-${Date.now()}.jsonl`),
    label: `feedback triage ${goal.title}`,
  });
  for await (const ev of handle.events) engine.broadcast({ goalId: goal.id, taskId: null, attemptId: `feedback-${goal.id}`, event: ev, ts: new Date().toISOString() });
  const r = await handle.result;
  store.append({ type: 'goal.cost_added', goalId: goal.id, payload: { costUsd: r.costUsd, source: 'feedback' } });
  engine.recordSessionUsage(r, { goalId: goal.id, kind: 'feedback', model: goal.models.cheap });
  const parsed = FeedbackPlan.safeParse(r.structuredOutput ?? tryJson(r.finalText));
  if (!parsed.success) throw new Error(`the triage session gave no plan (${r.subtype}${r.errorMessage ? `: ${r.errorMessage.slice(0, 120)}` : ''})`);
  return cp.recheck ? hintOnly(parsed.data) : parsed.data;
}
