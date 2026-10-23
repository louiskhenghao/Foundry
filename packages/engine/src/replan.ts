/**
 * Replan: after a Delegated goal lands, the planner reads what it delivered and touches up the tasks that have not
 * started yet — their spec, start files and Deliverables — so they build on what is really there (a path that moved, a
 * format the data has, a detail the summary settled). Never the DAG, the checks or the titles, never a task under way,
 * one bounded session per landing, and nothing when nothing downstream is left. Every change is an event the person
 * sees on the task.
 */
import { join } from 'node:path';
import type { Goal, Task } from '@foundry/core';
import { jsonSchemaFor, getBrief, getTask, listTasks, renderDecisions } from '@foundry/core';
import { z } from 'zod';
import { budgetStatus } from './budget.ts';
import { cleanDeliverables } from './checks/delivers.ts';
import { tryJson } from './checks/reviewer.ts';
import type { Engine } from './engine.ts';
import { READONLY_DISALLOWED, READONLY_TOOLS, boundarySettings } from './guards/boundary.ts';
import { metaFor, modelFor } from './models/roles.ts';
import { goalWorkspacePath } from './workspace.ts';

export const REPLAN_MAX_TURNS = 20;
export const REPLAN_MAX_BUDGET_USD = 2;
const REPLAN_TIMEOUT_MS = 10 * 60_000;

const ReplanOutput = z.object({
  revisions: z
    .array(
      z.object({
        taskId: z.string().describe('The id of the task, as given.'),
        spec: z.string().describe('The whole new spec (markdown), with the same intent and scope; the parts the landed step changed rewritten.'),
        relevantFiles: z.array(z.string()).nullable().describe('The full new list of start files, or null to keep the current one.'),
        delivers: z.array(z.string()).nullable().describe('The full new list of files it leaves for the tasks after it, or null to keep the current one.'),
        why: z.string().describe('One sentence for the human: what the landed step changed for this task.'),
      }),
    )
    .describe('Only the tasks that need a touch-up. Empty when nothing changed.'),
  note: z.string().describe('One or two sentences: what the landed step settled, and what was left alone.'),
});
type ReplanOutput = z.infer<typeof ReplanOutput>;

/** the tasks after `landed` (transitively) that have not started: pending or ready, with no session on them */
export function downstreamUnstarted(tasks: Task[], landed: Pick<Task, 'id'>, inFlight: (id: string) => boolean): Task[] {
  const below = new Set<string>([landed.id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const t of tasks) if (!below.has(t.id) && t.dependsOn.some((d) => below.has(d))) (below.add(t.id), (grew = true));
  }
  return tasks.filter((t) => t.id !== landed.id && below.has(t.id) && (t.state === 'pending' || t.state === 'ready') && !inFlight(t.id));
}

/** what a revision changes against the task as it is: nothing to record when the planner returned it as it was */
export function revisionChanges(task: Task, r: ReplanOutput['revisions'][number]): { spec: string; relevantFiles: string[] | null; delivers: string[] | null } | null {
  const spec = r.spec.trim();
  if (!spec) return null;
  const files = r.relevantFiles ? r.relevantFiles.map((f) => f.trim()).filter(Boolean) : null;
  const delivers = r.delivers ? cleanDeliverables(r.delivers) : null;
  const same = (a: readonly string[] | null, b: readonly string[]) => a === null || (a.length === b.length && a.every((x, i) => x === b[i]));
  if (spec === task.spec.trim() && same(files, task.relevantFiles) && same(delivers, task.delivers ?? [])) return null;
  return { spec, relevantFiles: files && !same(files, task.relevantFiles) ? files : null, delivers: delivers && !same(delivers, task.delivers ?? []) ? delivers : null };
}

function buildReplanPrompt(engine: Engine, goal: Goal, landed: Task, downstream: Task[]): string {
  const brief = getBrief(engine.store.db, goal.id)?.brief;
  const titles = new Map(listTasks(engine.store.db, goal.id).map((t) => [t.id, t.title]));
  const tasks = downstream.map((t) => ({ taskId: t.id, title: t.title, kind: t.kind, scenario: t.scenario, after: t.dependsOn.map((d) => titles.get(d) ?? d), spec: t.spec, relevantFiles: t.relevantFiles, delivers: t.delivers ?? [] }));
  return [
    `# Goal from the user\n${goal.prompt}`,
    brief?.understanding.trim() ? `# What was understood (approved Brief)\n${brief.understanding.trim()}` : '',
    brief ? renderDecisions(brief) : '',
    `# What just landed\nThe step "${landed.title}" was done by a delegated goal and landed on the goal branch.\n\n${landed.summary ?? '(no summary)'}${landed.delivers?.length ? `\n\nFiles it promised, now on the branch:\n${landed.delivers.map((f) => `- ${f}`).join('\n')}` : ''}`,
    `# The tasks after it that have not started\n\`\`\`json\n${JSON.stringify(tasks, null, 1)}\n\`\`\``,
    `# Your job\nRead what landed (the repository is here, read-only: look at the files it delivered where that settles a detail) and touch up ONLY what it changes for the tasks above: a path that is elsewhere than the spec assumed, the format or the names the delivered data really has, a detail the summary settled, a file the task should read first, a file it should leave behind. Keep each task's intent, scope, acceptance and title; never add, drop or reorder tasks; never touch checks. Return a revision only for a task that needs one — with its whole new spec — and none when nothing changed. Output JSON matching the schema, nothing else.`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

/**
 * One planner session after a Delegated goal landed, applied to the downstream tasks still unstarted when it comes back.
 * Bounded in turns, cost and time; it never fails the landing (a session that returns nothing usable is noted).
 */
export async function replanAfterLanding(engine: Engine, goal: Goal, landed: Task): Promise<void> {
  const { store, config } = engine;
  const downstream = downstreamUnstarted(listTasks(store.db, goal.id), landed, (id) => engine.isInFlight(id));
  if (!downstream.length) return;
  const b = budgetStatus(goal);
  if (b.remainingUsd != null && b.remainingUsd < 0.5) {
    store.append({ type: 'engine.note', goalId: goal.id, payload: { level: 'info', message: `no replan after "${landed.title}" landed: the goal's budget has $${b.remainingUsd.toFixed(2)} left` } });
    return;
  }
  const model = modelFor(config, goal, 'planner');
  const handle = await engine.runner.run({
    prompt: buildReplanPrompt(engine, goal, landed, downstream),
    cwd: goalWorkspacePath(config.dataDir, goal),
    model: model.model,
    meta: metaFor(goal.id, model),
    maxTurns: REPLAN_MAX_TURNS,
    maxBudgetUsd: Math.max(0.1, Math.min(REPLAN_MAX_BUDGET_USD, b.remainingUsd ?? REPLAN_MAX_BUDGET_USD)),
    permissionMode: 'dontAsk',
    allowedTools: READONLY_TOOLS,
    disallowedTools: READONLY_DISALLOWED,
    appendSystemPromptFile: engine.roles.path('planner'),
    jsonSchema: jsonSchemaFor(ReplanOutput),
    settings: boundarySettings(config.hooksDir),
    settingSources: config.settingSources,
    strictMcp: true,
    timeoutMs: REPLAN_TIMEOUT_MS,
    transcriptPath: join(config.dataDir, 'transcripts', `replan-${goal.id}-${landed.id}.jsonl`),
    label: `replan ${goal.title}`,
  });
  const untrack = engine.trackBackground(goal.id, handle);
  let result;
  try {
    for await (const ev of handle.events) engine.broadcast({ goalId: goal.id, taskId: landed.id, attemptId: `replan-${landed.id}`, event: ev, ts: new Date().toISOString() });
    result = await handle.result;
  } finally {
    untrack();
  }
  store.append({ type: 'goal.cost_added', goalId: goal.id, payload: { costUsd: result.costUsd, source: 'replan' } });
  engine.recordSessionUsage(result, { goalId: goal.id, kind: 'replan', model: model.model });
  const parsed = ReplanOutput.safeParse(result.structuredOutput ?? tryJson(result.finalText));
  if (!parsed.success || result.isError) {
    store.append({ type: 'engine.note', goalId: goal.id, payload: { level: 'warn', message: `the replan after "${landed.title}" landed returned nothing usable (${result.errorMessage ?? result.subtype}); the tasks after it keep their specs` } });
    return;
  }
  // only the tasks still unstarted now: one that began meanwhile keeps the spec it started with
  const allowed = new Map(downstreamUnstarted(listTasks(store.db, goal.id), landed, (id) => engine.isInFlight(id)).map((t) => [t.id, t]));
  let touched = 0;
  for (const r of parsed.data.revisions) {
    const task = allowed.get(r.taskId);
    if (!task) continue;
    const change = revisionChanges(getTask(store.db, task.id) ?? task, r);
    if (!change) continue;
    store.append({ type: 'task.revised', goalId: goal.id, payload: { taskId: task.id, spec: change.spec, relevantFiles: change.relevantFiles, delivers: change.delivers, reason: r.why.trim() || `after "${landed.title}" landed`, afterTaskId: landed.id } });
    touched++;
  }
  store.append({ type: 'engine.note', goalId: goal.id, payload: { level: 'info', message: `replan after "${landed.title}" landed: ${touched ? `${touched} task${touched === 1 ? '' : 's'} touched up` : 'nothing to change'}${parsed.data.note.trim() ? ` — ${parsed.data.note.trim().slice(0, 400)}` : ''}` } });
}
