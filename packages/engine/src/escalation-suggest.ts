import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Escalation, EscalationSuggestion, Goal, Task } from '@foundry/core';
import { getBrief, getEscalation, getGoal, getObservation, getTask, listAttempts, listCheckResultsByGoal, listChecks, renderDecisions } from '@foundry/core';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { tryJson } from './checks/reviewer.ts';
import type { Engine } from './engine.ts';
import { READONLY_DISALLOWED, READONLY_TOOLS, boundarySettings } from './guards/boundary.ts';
import { goalWorkspacePath } from './workspace.ts';

export const SUGGEST_MAX_BUDGET_USD = 1;

const SuggestOutput = z.object({
  diagnosis: z.string().describe('Two to five sentences for the human: what actually went wrong, in plain words, naming files/checks where useful.'),
  action: z.enum(['retry_with_hint', 'skip_task', 'resolve_manually', 'raise_budget']).describe('retry_with_hint = the worker can fix it with the hint below; skip_task = not worth it / out of scope; resolve_manually = a merge conflict a human should settle; raise_budget = the task is fine but needs more attempts or money.'),
  hint: z.string().describe('The hint to give the next attempt: concrete, imperative, mentions the files/commands/decisions that matter. Empty when action is not retry_with_hint.'),
  confidence: z.enum(['high', 'medium', 'low']),
});

/** Last lines of a session transcript as the human-readable gist (assistant text and tool calls), bounded. */
function transcriptTail(path: string | null, maxLines = 40): string {
  if (!path || !existsSync(path)) return '';
  const out: string[] = [];
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let o: any;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    const content = o?.message?.content;
    if (!Array.isArray(content)) continue;
    for (const b of content) {
      if (b.type === 'text' && o.type === 'assistant' && b.text?.trim()) out.push(`assistant: ${String(b.text).replace(/\s+/g, ' ').slice(0, 240)}`);
      if (b.type === 'tool_use') out.push(`tool ${b.name}: ${JSON.stringify(b.input ?? {}).slice(0, 160)}`);
      if (b.type === 'tool_result' && b.is_error) out.push(`✗ ${String(typeof b.content === 'string' ? b.content : JSON.stringify(b.content)).replace(/\s+/g, ' ').slice(0, 200)}`);
    }
  }
  return out.slice(-maxLines).join('\n');
}

function buildPrompt(goal: Goal, task: Task | null, esc: Escalation, ctx: { report: string; failing: string; tail: string; decisions: string; hint: string | null; understanding: string }): string {
  return [
    `# Goal\n${goal.title}\n\n${goal.prompt.trim()}`,
    ctx.understanding ? `# Approved understanding\n${ctx.understanding}` : '',
    ctx.decisions,
    task ? `# The blocked task (${task.kind}, ${task.scenario})\n${task.title}\n\n${task.spec.trim()}${ctx.hint ? `\n\nHint already given by the human: ${ctx.hint}` : ''}` : '',
    `# Why it is blocked\n${esc.message}`,
    ctx.report ? `# Last observation report\n${ctx.report}` : '',
    ctx.failing ? `# Failing checks (latest results)\n${ctx.failing}` : '',
    ctx.tail ? `# Tail of the last session\n\`\`\`\n${ctx.tail}\n\`\`\`` : '',
    `# Your job\nYou are advising the human who owns this goal; they may not be an engineer. Read the evidence above; open files in this worktree only if the evidence is not enough (read-only). Decide what to do and explain why in plain words. If a hint can unblock the worker, write it as if you were the tech lead leaving a note: name the real cause, the files, the commands to run, and the decision to take (e.g. "use PostgreSQL syntax", "merge the goal branch first", "the test expects X, not Y"). Do not propose skipping unless the work is genuinely out of scope or impossible here. Output JSON matching the schema.`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

export async function runSuggest(engine: Engine, escalationId: string): Promise<EscalationSuggestion> {
  const { store, config } = engine;
  const esc = getEscalation(store.db, escalationId);
  if (!esc) throw new Error(`escalation ${escalationId} not found`);
  if (esc.state !== 'open') throw new Error(`escalation is already ${esc.state}`);
  const goal = getGoal(store.db, esc.goalId)!;
  const task = esc.taskId ? getTask(store.db, esc.taskId) : null;
  const attempts = task ? listAttempts(store.db, task.id) : [];
  const last = attempts.filter((a) => a.kind === 'work').at(-1) ?? attempts.at(-1) ?? null;
  const report = last ? (getObservation(store.db, last.id)?.summary ?? '') : '';
  const checks = listChecks(store.db, goal.id);
  const failing = last
    ? listCheckResultsByGoal(store.db, goal.id)
        .filter((r) => r.attemptId === last.id && r.status !== 'pass' && r.status !== 'skipped')
        .map((r) => `- ${checks.find((c) => c.id === r.checkId)?.name ?? r.checkId} (${r.status}):\n${r.summary.slice(0, 1200)}`)
        .join('\n')
    : '';
  const brief = getBrief(store.db, goal.id)?.brief;
  const cwd = task?.worktreePath && existsSync(task.worktreePath) ? task.worktreePath : goalWorkspacePath(config.dataDir, goal.id);
  const prompt = buildPrompt(goal, task, esc, { report: report.slice(0, 6000), failing: failing.slice(0, 6000), tail: transcriptTail(last?.transcriptPath ?? null), decisions: brief ? renderDecisions(brief) : '', hint: task?.hint ?? null, understanding: brief?.understanding.slice(0, 2000) ?? '' });
  const n = store.listByGoal(goal.id, 5000).filter((e) => e.type === 'goal.cost_added' && (e.payload as { source?: string }).source === 'suggest').length + 1;
  const handle = await engine.runner.run({
    prompt,
    cwd: existsSync(cwd) ? cwd : goal.repoPath,
    model: goal.models.strong,
    meta: { goalId: goal.id, tier: 'strong' },
    maxTurns: 20,
    maxBudgetUsd: SUGGEST_MAX_BUDGET_USD,
    permissionMode: 'dontAsk',
    allowedTools: READONLY_TOOLS,
    disallowedTools: READONLY_DISALLOWED,
    jsonSchema: zodToJsonSchema(SuggestOutput, { $refStrategy: 'none' }),
    settings: boundarySettings(config.hooksDir),
    settingSources: config.settingSources,
    timeoutMs: 4 * 60_000,
    transcriptPath: join(config.dataDir, 'transcripts', `suggest-${escalationId}-${n}.jsonl`),
    label: `suggest ${task?.title ?? esc.trigger}`,
  });
  for await (const ev of handle.events) engine.broadcast({ goalId: goal.id, taskId: task?.id ?? null, attemptId: `suggest-${escalationId}`, event: ev, ts: new Date().toISOString() });
  const result = await handle.result;
  store.append({ type: 'goal.cost_added', goalId: goal.id, payload: { costUsd: result.costUsd, source: 'suggest' } });
  engine.recordSessionUsage(result, { goalId: goal.id, kind: 'suggest', model: goal.models.strong });
  const parsed = SuggestOutput.safeParse(result.structuredOutput ?? tryJson(result.finalText));
  if (!parsed.success) throw new Error(`the AI did not return a usable suggestion${result.errorMessage ? `: ${result.errorMessage}` : ''}`);
  const suggestion: EscalationSuggestion = { ...parsed.data, hint: parsed.data.action === 'retry_with_hint' ? parsed.data.hint.trim() : parsed.data.hint.trim(), costUsd: result.costUsd, at: new Date().toISOString() };
  store.append({ type: 'escalation.suggested', goalId: goal.id, payload: { escalationId, suggestion } });
  return suggestion;
}
