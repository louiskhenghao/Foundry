import { join } from 'node:path';
import type { Brief, BriefCheck, BriefTask, Goal } from '@foundry/core';
import { AreaDraftOutput, Brief as BriefSchema, RevisionOutput, TaskDraftOutput, type BriefDiff, diffBrief, getBrief, renderDecisions } from '@foundry/core';
import { z } from 'zod';
import { newId } from '@foundry/core';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { attachmentsDir, markitdownHint, renderAttachments } from './attachments.ts';
import { tryJson } from './checks/reviewer.ts';
import { materializeCheck, natureScenario, isLostSession } from './clarify.ts';
import type { Engine } from './engine.ts';
import { READONLY_DISALLOWED, READONLY_TOOLS, boundarySettings } from './guards/boundary.ts';

export const DRAFT_MAX_TURNS = 25;
export const DRAFT_MAX_BUDGET_USD = 2;
/** a revision re-reads the whole Brief and may touch every task: more room than a single-task draft */
export const REVISE_MAX_TURNS = 40;
export const REVISE_MAX_BUDGET_USD = 3;

/**
 * What the Brief page asks for. `brief` is the page's current (possibly unsaved) version so the model
 * sees what the human is looking at. Mode `task` drafts everything for one task, `acceptance` only proposes
 * its checks, `area` proposes tasks (and checks) for an Area that has none, `revise` re-plans the whole Brief
 * so the human's Decisions (answers, rejected assumptions) are honoured.
 */
export const DraftRequest = z.object({
  mode: z.enum(['task', 'acceptance', 'area', 'revise']),
  brief: BriefSchema.omit({ goalId: true }),
  taskKey: z.string().nullable().default(null),
  areaKey: z.string().nullable().default(null),
  /** free text from the human about what they want ("make it use the existing modal component") */
  notes: z.string().default(''),
});
export type DraftRequest = z.infer<typeof DraftRequest>;

/** A proposal: nothing here is in the Brief until the human accepts it on the page. */
export interface DraftProposal {
  mode: DraftRequest['mode'];
  taskKey: string | null;
  /** mode task: the fields to fill (spec only when empty on the page) */
  task: Partial<Pick<BriefTask, 'spec' | 'kind' | 'scope' | 'scenario' | 'areaKey' | 'dependsOnKeys' | 'relevantFiles'>> | null;
  /** mode area: whole new tasks (keys already renumbered to be unique in the Brief) */
  tasks: BriefTask[];
  /** checks for the task / the new tasks / the Area (taskKey set accordingly) */
  checks: BriefCheck[];
  rationale: string;
  costUsd: number;
  /** mode revise: the whole revised Brief and what it changes against the one sent */
  revision?: { diff: BriefDiff; revised: Omit<Brief, 'goalId'>; changeSummary: string };
}

export async function runDraft(engine: Engine, goal: Goal, req: DraftRequest): Promise<DraftProposal> {
  const { store, config } = engine;
  if (goal.state !== 'awaiting_brief_approval') throw new Error(`goal is ${goal.state}; drafts are only possible while the Brief awaits approval`);
  const brief: Brief = { ...req.brief, goalId: goal.id };
  const task = req.taskKey ? brief.tasks.find((t) => t.key === req.taskKey) : undefined;
  if ((req.mode === 'task' || req.mode === 'acceptance') && !task) throw new Error(`task ${req.taskKey} is not in the Brief`);
  const area = req.areaKey ? brief.areas.find((a) => a.key === req.areaKey) : undefined;
  if (req.mode === 'area' && !area) throw new Error(`area ${req.areaKey} is not in the Brief`);

  const channel = `draft-${goal.id}`;
  const say = (text: string) => engine.broadcast({ goalId: goal.id, taskId: null, attemptId: channel, event: { kind: 'text', text }, ts: new Date().toISOString() });
  say(req.mode === 'revise' ? '— revision requested: syncing the workspace, then the Clarifier re-reads the Brief and the repository…' : '— draft requested: syncing the workspace, then a read-only session explores the repository…');
  const ws = await engine.ensureSyncedWorkspace(goal);
  const overview = await engine.context.overview(ws).catch(() => null);
  const hint = await engine.skills.hints.sectionFor('clarifier', { scenario: natureScenario(goal.nature) });
  const attachments = [renderAttachments(goal, config.dataDir), markitdownHint(engine.markitdown.available(), engine.markitdown.binary())].filter(Boolean).join('\n\n');
  const outputSchema = req.mode === 'area' ? AreaDraftOutput : req.mode === 'revise' ? RevisionOutput : TaskDraftOutput;
  const schema = zodToJsonSchema(outputSchema, { $refStrategy: 'none' });
  const source = req.mode === 'revise' ? 'revise' : 'draft';
  const n = store.listByGoal(goal.id, 5000).filter((e) => e.type === 'goal.cost_added' && (e.payload as { source?: string }).source === source).length + 1;
  const prompt = buildDraftPrompt(goal, brief, req, task, area, overview, hint, attachments);
  const run = (p: string, resume?: string) =>
    engine.runner.run({
      prompt: p,
      cwd: ws,
      model: goal.models.strong,
      meta: { goalId: goal.id, tier: 'strong' },
      maxTurns: req.mode === 'revise' ? REVISE_MAX_TURNS : DRAFT_MAX_TURNS,
      maxBudgetUsd: req.mode === 'revise' ? REVISE_MAX_BUDGET_USD : DRAFT_MAX_BUDGET_USD,
      permissionMode: 'dontAsk',
      allowedTools: READONLY_TOOLS,
      disallowedTools: READONLY_DISALLOWED,
      appendSystemPromptFile: engine.roles.path('clarifier'),
      jsonSchema: schema,
      settings: boundarySettings(config.hooksDir),
      settingSources: config.settingSources,
      addDirs: goal.attachments.length ? [attachmentsDir(config.dataDir, goal.id)] : undefined,
      resumeSessionId: resume,
      timeoutMs: 5 * 60_000,
      transcriptPath: join(config.dataDir, 'transcripts', `${source}-${goal.id}-${n}.jsonl`),
      label: `draft ${req.mode} ${req.taskKey ?? req.areaKey ?? ''} (${goal.title})`,
    });

  let cost = 0;
  const exec = async (p: string, resume?: string) => {
    const handle = await run(p, resume);
    for await (const ev of handle.events) engine.broadcast({ goalId: goal.id, taskId: null, attemptId: channel, event: ev, ts: new Date().toISOString() });
    const result = await handle.result;
    cost += result.costUsd;
    store.append({ type: 'goal.cost_added', goalId: goal.id, payload: { costUsd: result.costUsd, source } });
    engine.recordSessionUsage(result, { goalId: goal.id, kind: 'clarify', model: goal.models.strong });
    return result;
  };
  const parse = (raw: unknown) => outputSchema.safeParse(raw);

  // a revision resumes the Clarify interview session when there is one: it already knows the repository and the answers
  const interviewSession = req.mode === 'revise' ? (goal.interview?.sessionId ?? undefined) : undefined;
  let result = await exec(prompt, interviewSession);
  if (interviewSession && isLostSession(result)) {
    say('— the Clarify session could not be resumed; starting a fresh one');
    result = await exec(prompt);
  }
  let parsed = parse(result.structuredOutput ?? tryJson(result.finalText));
  if (!parsed.success && result.sessionId) {
    result = await exec(`Your previous answer did not match the required JSON schema (${parsed.error.issues.slice(0, 3).map((i) => i.path.join('.') + ': ' + i.message).join('; ')}). Output ONLY the JSON object now.`, result.sessionId);
    parsed = parse(result.structuredOutput ?? tryJson(result.finalText));
  }
  if (!parsed.success) throw new Error(`the draft session did not return a usable proposal${result.errorMessage ? `: ${result.errorMessage}` : ''}`);

  const nextKey = keyAllocator(brief);
  if (req.mode === 'revise') {
    const out = parsed.data as RevisionOutput;
    const revised = toRevisedBrief(brief, out);
    const diff = diffBrief(brief, revised);
    return { mode: req.mode, taskKey: null, task: null, tasks: [], checks: [], rationale: out.changeSummary, costUsd: cost, revision: { diff, revised, changeSummary: out.changeSummary } };
  }
  if (req.mode === 'area') {
    const out = parsed.data as AreaDraftOutput;
    const rename = new Map<string, string>();
    const tasks: BriefTask[] = out.tasks.map((t) => {
      const key = nextKey('T');
      rename.set(t.key, key);
      return { key, title: t.title, spec: t.spec, kind: t.kind, scope: t.scope ?? null, scenario: t.scenario, areaKey: area!.key, tdd: 'inherit', dependsOnKeys: [], parallelizable: t.parallelizable, relevantFiles: t.relevantFiles, milestone: null };
    });
    const known = new Set([...brief.tasks.map((t) => t.key), ...tasks.map((t) => t.key)]);
    out.tasks.forEach((t, i) => {
      tasks[i]!.dependsOnKeys = t.dependsOnKeys.map((k) => rename.get(k) ?? k).filter((k) => known.has(k) && k !== tasks[i]!.key);
    });
    const checks: BriefCheck[] = out.checks.map((c) => {
      const taskKey = c.taskKey ? (rename.get(c.taskKey) ?? (known.has(c.taskKey) ? c.taskKey : null)) : null;
      return { key: nextKey('C'), name: c.name, tier: c.tier, taskKey, areaKey: taskKey ? null : area!.key, spec: materializeCheck(c, taskKey) };
    });
    return { mode: req.mode, taskKey: null, task: null, tasks, checks, rationale: out.rationale, costUsd: cost };
  }

  const out = parsed.data as TaskDraftOutput;
  const taskKeys = new Set(brief.tasks.map((t) => t.key));
  const checks: BriefCheck[] = out.checks.map((c) => ({ key: nextKey('C'), name: c.name, tier: c.tier, taskKey: task!.key, areaKey: null, spec: materializeCheck(c, task!.key) }));
  if (req.mode === 'acceptance') return { mode: req.mode, taskKey: task!.key, task: null, tasks: [], checks, rationale: out.rationale, costUsd: cost };
  const fields: NonNullable<DraftProposal['task']> = {};
  if (out.spec && !task!.spec.trim()) fields.spec = out.spec;
  if (out.kind) fields.kind = out.kind;
  if (out.scenario) fields.scenario = out.scenario;
  if (out.scope !== undefined) fields.scope = out.scope;
  if (out.areaKey && brief.areas.some((a) => a.key === out.areaKey)) fields.areaKey = out.areaKey;
  fields.dependsOnKeys = out.dependsOnKeys.filter((k) => taskKeys.has(k) && k !== task!.key);
  fields.relevantFiles = out.relevantFiles;
  return { mode: req.mode, taskKey: task!.key, task: fields, tasks: [], checks, rationale: out.rationale, costUsd: cost };
}

/**
 * The revised Brief: the model's tasks/checks/areas (keys kept where it kept them), the human's questions and
 * assumption verdicts preserved (assumption ids matched by text; new ones get ids), new non-blocking questions appended.
 */
function toRevisedBrief(current: Brief, out: RevisionOutput): Omit<Brief, 'goalId'> {
  const areaKeys = new Set(out.areas.map((a) => a.key));
  const area = (k: string | null | undefined) => (k && areaKeys.has(k) ? k : null);
  const usedQ = new Set<string>();
  const assumptions = out.assumptions.map((text) => {
    const prev = current.assumptions.find((a) => a.text.trim() === text.trim() && !usedQ.has(a.id));
    if (prev) usedQ.add(prev.id);
    return prev ? { ...prev, text } : { id: newId('as'), text, accepted: true, applied: false };
  });
  // a rejected assumption the model dropped stays on record so the Decision is not lost
  for (const a of current.assumptions) if (!a.accepted && !usedQ.has(a.id)) assumptions.push(a);
  const taskKeys = new Set(out.tasks.map((t) => t.key));
  return {
    title: out.title?.trim() ?? current.title,
    understanding: out.understanding,
    areas: out.areas.map((a) => ({ key: a.key, name: a.name, slug: a.slug, description: a.description ?? '' })),
    assumptions,
    checks: out.checks
      .filter((c) => !c.taskKey || taskKeys.has(c.taskKey))
      .map((c) => ({ key: c.key, name: c.name, tier: c.tier, taskKey: c.taskKey, areaKey: c.taskKey ? null : area(c.areaKey), spec: materializeCheck(c, c.taskKey) })),
    tasks: out.tasks.map((t) => ({ key: t.key, title: t.title, spec: t.spec, kind: t.kind ?? 'feature', scope: t.scope ?? null, scenario: t.scenario ?? 'general', areaKey: area(t.areaKey), tdd: 'inherit', dependsOnKeys: t.dependsOnKeys.filter((k) => taskKeys.has(k) && k !== t.key), parallelizable: t.parallelizable, relevantFiles: t.relevantFiles, milestone: t.milestone ?? null })),
    costEstimateUsd: out.costEstimateUsd,
    run: out.run ?? current.run,
    timeEstimateMin: out.timeEstimateMin,
    questions: [...current.questions, ...out.newQuestions.map((q) => ({ id: newId('q'), text: q.text, answer: null, blocking: false, areaKey: area(q.areaKey), options: [], kind: 'text' as const, applied: false }))],
    styleOptions: current.styleOptions,
  };
}

/** Keys unique within the Brief: T<n> / C<n> continuing after the highest existing number. */
function keyAllocator(brief: Brief) {
  const max = (prefix: string, keys: string[]) => keys.reduce((m, k) => (k.startsWith(prefix) && /^\d+$/.test(k.slice(prefix.length)) ? Math.max(m, Number(k.slice(prefix.length))) : m), 0);
  const counters: Record<string, number> = { T: max('T', brief.tasks.map((t) => t.key)), C: max('C', brief.checks.map((c) => c.key)) };
  return (prefix: 'T' | 'C') => `${prefix}${++counters[prefix]!}`;
}

function briefSummary(brief: Brief): string {
  const areaName = (k: string | null) => brief.areas.find((a) => a.key === k)?.name ?? '—';
  const lines = [
    `## Understanding\n${brief.understanding.trim()}`,
    brief.areas.length ? `## Areas\n${brief.areas.map((a) => `- ${a.key} ${a.name} (scope \`${a.slug}\`): ${a.description}`).join('\n')}` : '',
    brief.assumptions.length ? `## Assumptions\n${brief.assumptions.map((a) => `- ${a.accepted ? '' : '[REJECTED by the human] '}${a.text}`).join('\n')}` : '',
    renderDecisions(brief, '## Decisions from the human'),
    `## Existing tasks\n${brief.tasks.map((t) => `- ${t.key} [${areaName(t.areaKey)} · ${t.kind} · ${t.scenario}] ${t.title}${t.dependsOnKeys.length ? ` (after ${t.dependsOnKeys.join(', ')})` : ''}\n${t.spec.trim().split('\n').map((l) => `  ${l}`).join('\n')}`).join('\n')}`,
    brief.checks.length ? `## Existing checks\n${brief.checks.map((c) => `- ${c.key} [${c.tier}] ${c.taskKey ? `task ${c.taskKey}` : `goal${c.areaKey ? ` · ${areaName(c.areaKey)}` : ''}`}: ${c.name}${c.spec.type === 'command' ? ` — \`${c.spec.cmd}\`` : c.spec.type === 'reviewer' ? ` — reviewer: ${c.spec.rubric}` : ''}`).join('\n')}` : '',
  ];
  return lines.filter(Boolean).join('\n\n');
}

function buildDraftPrompt(goal: Goal, brief: Brief, req: DraftRequest, task: BriefTask | undefined, area: Brief['areas'][number] | undefined, overview: string | null, skillsHint: string | null, attachments: string): string {
  const rules = `Rules:\n- Acceptance checks must be decidable: a command check is a real command that runs from the repo root (exit 0 = pass); a reviewer check has a concrete rubric naming what to look at. Must = what the human asked for; stretch = valuable extras.\n- Do not restate or duplicate existing tasks and checks; reference them by key where relevant (dependsOnKeys).\n- Keep the language and conventions of the Brief and the repository. Task titles are imperative commit subjects without type prefix.`;
  const ask =
    req.mode === 'revise'
      ? `# Your job\nThe human answered questions and/or rejected assumptions (see "Decisions from the human" above). Revise the Brief so that every decision is honoured: change, add or drop tasks and checks as needed (including Areas if a decision changes the scope), update the understanding and the estimate. Explore the repository (read-only) where a decision needs it.\n\nRules for the revision:\n- **Keep the keys** of every task, check and Area you keep (changed or not); give new ones the next free number (T${brief.tasks.length + 1}…, C${brief.checks.length + 1}…). A task you drop simply does not appear.\n- Do not touch what no decision affects.\n- Do not return questions — only genuinely new, non-blocking ones in newQuestions (usually none).\n- Say in changeSummary what changed because of which decision.\nOutput the complete revised Brief as JSON matching the schema.`
      : req.mode === 'area'
      ? `# Your job\nThe Area **${area!.name}** (${area!.key}, scope \`${area!.slug}\`) — "${area!.description}" — has no tasks yet. Explore the repository (read-only) as needed and propose 1–6 tasks for this Area only (areaKey = ${area!.key}), each doable by one engineer-session, with their acceptance checks. New tasks may depend on existing task keys or on each other. Output JSON matching the schema.`
      : req.mode === 'acceptance'
        ? `# Your job\nPropose acceptance checks for task **${task!.key} — ${task!.title}** only. Leave spec null. Output JSON matching the schema.`
        : `# Your job\nThe human added task **${task!.key} — ${task!.title}**${task!.spec.trim() ? ' and already wrote a spec (keep it; return spec null)' : ' without a spec'}. Explore the repository (read-only) as needed and draft what is missing: the spec (markdown: what to change, where, how to know it is done), kind, scenario, scope (null = Area slug), areaKey, tdd: 'inherit', dependsOnKeys (existing keys it must run after), relevantFiles, and its acceptance checks. Output JSON matching the schema.`;
  return [
    `# Goal from the user\n${goal.prompt}`,
    attachments,
    `# The Brief so far\n${briefSummary(brief)}`,
    task ? `# The task in question\nkey: ${task.key}\ntitle: ${task.title}\nkind: ${task.kind} · scenario: ${task.scenario} · area: ${task.areaKey ?? '—'}\n${task.spec.trim() ? `spec:\n${task.spec.trim()}` : 'spec: (empty)'}` : '',
    req.notes.trim() ? `# Notes from the human\n${req.notes.trim()}` : '',
    overview ? `# Repository overview\n${overview}` : '',
    skillsHint ?? '',
    ask,
    rules,
  ]
    .filter(Boolean)
    .join('\n\n');
}

export { getBrief };
