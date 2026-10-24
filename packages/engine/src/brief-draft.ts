import { join } from 'node:path';
import { jsonSchemaFor, reportsDollars, assignMaterials } from '@foundry/core';
import type { Brief, BriefCheck, BriefTask, Goal, InterviewQuestion, InterviewRound } from '@foundry/core';
import { AreaDraftOutput, Brief as BriefSchema, REVISE_MAX_ROUNDS, ReviseTurnOutput, RevisionOutput, TaskDraftOutput, type BriefDiff, diffBrief, getBrief, getGoal, noteQuestion, renderDecisions } from '@foundry/core';
import { z } from 'zod';
import { newId } from '@foundry/core';
import type { RunResult } from '@foundry/runner';
import { attachmentsDir, markitdownHint, renderAttachments } from './attachments.ts';
import { metaFor, modelFor } from './models/roles.ts';
import { tryJson } from './checks/reviewer.ts';
import { INTERVIEW_NOTE_MAX, materializeCheck, natureScenario, isLostSession, normalizeQuestions, repairable, roundAnswers } from './clarify.ts';
import type { Engine } from './engine.ts';
import { READONLY_DISALLOWED, READONLY_TOOLS, boundarySettings } from './guards/boundary.ts';

export const DRAFT_MAX_TURNS = 25;
export const DRAFT_MAX_BUDGET_USD = 2;
/** a revision re-reads the whole Brief and may touch every task: more room than a single-task draft */
export const REVISE_MAX_TURNS = 40;
export const REVISE_MAX_BUDGET_USD = 3;
/** questions a Revise may put to the human in one round */
const INTERVIEW_MAX_QUESTIONS_REVISE = 8;

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

/** The human's answers to a Revise round: the page's current Brief comes along, as it does for the Revise itself. */
export const ReviseAnswer = z.object({
  brief: BriefSchema.omit({ goalId: true }),
  answers: z.record(z.string()).default({}),
  /** propose now with what there is, whatever is still open */
  finish: z.boolean().default(false),
  /** what the human wrote unasked with the answers */
  note: z.string().nullable().default(null),
});
export type ReviseAnswer = z.infer<typeof ReviseAnswer>;

/** A proposal: nothing here is in the Brief until the human accepts it on the page. */
export interface DraftProposal {
  costAvailable?: boolean;
  mode: DraftRequest['mode'];
  taskKey: string | null;
  /** mode task: the fields to fill (spec only when empty on the page) */
  task: Partial<Pick<BriefTask, 'spec' | 'kind' | 'scope' | 'scenario' | 'areaKey' | 'dependsOnKeys' | 'relevantFiles' | 'delivers'>> | null;
  /** mode area: whole new tasks (keys already renumbered to be unique in the Brief) */
  tasks: BriefTask[];
  /** checks for the task / the new tasks / the Area (taskKey set accordingly) */
  checks: BriefCheck[];
  rationale: string;
  costUsd: number;
  /** mode revise: the whole revised Brief and what it changes against the one sent */
  revision?: { diff: BriefDiff; revised: Omit<Brief, 'goalId'>; changeSummary: string };
  /** mode revise: no proposal yet — the Clarifier asks the human these first (answered through answerRevise) */
  round?: { round: number; questions: InterviewQuestion[] };
}

export async function runDraft(engine: Engine, goal: Goal, req: DraftRequest): Promise<DraftProposal> {
  if (goal.state !== 'awaiting_brief_approval') throw new Error(`goal is ${goal.state}; drafts are only possible while the Brief awaits approval`);
  const brief: Brief = { ...req.brief, goalId: goal.id };
  const task = req.taskKey ? brief.tasks.find((t) => t.key === req.taskKey) : undefined;
  if ((req.mode === 'task' || req.mode === 'acceptance') && !task) throw new Error(`task ${req.taskKey} is not in the Brief`);
  const area = req.areaKey ? brief.areas.find((a) => a.key === req.areaKey) : undefined;
  if (req.mode === 'area' && !area) throw new Error(`area ${req.areaKey} is not in the Brief`);
  const s = await draftSession(engine, goal, brief, req, task, area);
  const { exec, prompt, say } = s;

  // a revision resumes the Clarify interview session when there is one: it already knows the repository and the answers
  const interviewSession = req.mode === 'revise' ? (goal.interview?.sessionId ?? undefined) : undefined;
  let result = await exec(prompt, interviewSession);
  if (interviewSession && isLostSession(result)) {
    say('— the Clarify session could not be resumed; starting a fresh one');
    result = await exec(prompt);
  }
  if (req.mode === 'revise') return settleRevise(engine, goal, brief, s, result, []);
  const parse = (raw: unknown) => s.outputSchema.safeParse(raw);
  let parsed = parse(result.structuredOutput ?? tryJson(result.finalText));
  if (!parsed.success && result.sessionId) {
    result = await exec(`Your previous answer did not match the required JSON schema (${parsed.error.issues.slice(0, 3).map((i) => i.path.join('.') + ': ' + i.message).join('; ')}). Output ONLY the JSON object now.`, result.sessionId);
    parsed = parse(result.structuredOutput ?? tryJson(result.finalText));
  }
  if (!parsed.success) throw new Error(`the draft session did not return a usable proposal${result.errorMessage ? `: ${result.errorMessage}` : ''}`);
  const cost = s.cost();

  const nextKey = keyAllocator(brief);
  if (req.mode === 'area') {
    const out = parsed.data as AreaDraftOutput;
    const rename = new Map<string, string>();
    const tasks: BriefTask[] = out.tasks.map((t) => {
      const key = nextKey('T');
      rename.set(t.key, key);
      return { key, title: t.title, spec: t.spec, kind: t.kind, scope: t.scope ?? null, scenario: t.scenario, areaKey: area!.key, tdd: 'inherit', dependsOnKeys: [], parallelizable: t.parallelizable, relevantFiles: t.relevantFiles, delivers: t.delivers ?? [], milestone: null, difficulty: t.difficulty ?? 'standard' };
    });
    const known = new Set([...brief.tasks.map((t) => t.key), ...tasks.map((t) => t.key)]);
    out.tasks.forEach((t, i) => {
      tasks[i]!.dependsOnKeys = t.dependsOnKeys.map((k) => rename.get(k) ?? k).filter((k) => known.has(k) && k !== tasks[i]!.key);
    });
    const checks: BriefCheck[] = out.checks.map((c) => {
      const taskKey = c.taskKey ? (rename.get(c.taskKey) ?? (known.has(c.taskKey) ? c.taskKey : null)) : null;
      return { key: nextKey('C'), name: c.name, tier: c.tier, taskKey, areaKey: taskKey ? null : area!.key, spec: materializeCheck(c, taskKey) };
    });
    return { mode: req.mode, taskKey: null, task: null, tasks, checks, rationale: out.rationale, costUsd: cost, costAvailable: reportsDollars(goal.provider) };
  }

  const out = parsed.data as TaskDraftOutput;
  const taskKeys = new Set(brief.tasks.map((t) => t.key));
  const checks: BriefCheck[] = out.checks.map((c) => ({ key: nextKey('C'), name: c.name, tier: c.tier, taskKey: task!.key, areaKey: null, spec: materializeCheck(c, task!.key) }));
  if (req.mode === 'acceptance') return { mode: req.mode, taskKey: task!.key, task: null, tasks: [], checks, rationale: out.rationale, costUsd: cost, costAvailable: reportsDollars(goal.provider) };
  const fields: NonNullable<DraftProposal['task']> = {};
  if (out.spec && !task!.spec.trim()) fields.spec = out.spec;
  if (out.kind) fields.kind = out.kind;
  if (out.scenario) fields.scenario = out.scenario;
  if (out.scope !== undefined) fields.scope = out.scope;
  if (out.areaKey && brief.areas.some((a) => a.key === out.areaKey)) fields.areaKey = out.areaKey;
  fields.dependsOnKeys = out.dependsOnKeys.filter((k) => taskKeys.has(k) && k !== task!.key);
  fields.relevantFiles = out.relevantFiles;
  if (out.delivers?.length) fields.delivers = out.delivers;
  return { mode: req.mode, taskKey: task!.key, task: fields, tasks: [], checks, rationale: out.rationale, costUsd: cost, costAvailable: reportsDollars(goal.provider) };
}

/** a draft or Revise session's pieces: the read-only Clarifier run with its prompt, caps and bookkeeping */
interface DraftSession {
  exec: (p: string, resume?: string) => Promise<RunResult>;
  /** the full prompt, for a fresh session when a resumed one is lost */
  prompt: string;
  cost: () => number;
  say: (text: string) => void;
  outputSchema: z.ZodTypeAny;
}
type ReviseSession = Pick<DraftSession, 'exec' | 'prompt' | 'cost'>;

/** the session a draft or Revise runs in: workspace synced, the prompt built, every turn broadcast and booked */
async function draftSession(engine: Engine, goal: Goal, brief: Brief, req: DraftRequest, task: BriefTask | undefined, area: Brief['areas'][number] | undefined): Promise<DraftSession> {
  const { store, config } = engine;
  const channel = `draft-${goal.id}`;
  const say = (text: string) => engine.broadcast({ goalId: goal.id, taskId: null, attemptId: channel, event: { kind: 'text', text }, ts: new Date().toISOString() });
  say(req.mode === 'revise' ? '— revision requested: syncing the workspace, then the Clarifier re-reads the Brief and the repository…' : '— draft requested: syncing the workspace, then a read-only session explores the repository…');
  const ws = await engine.ensureSyncedWorkspace(goal);
  const overview = await engine.context.overview(ws).catch(() => null);
  const hint = await engine.skillsFor(goal).hints.sectionFor('clarifier', { profile: engine.workflowProfileOf(goal), scenario: natureScenario(goal.nature) });
  const attachments = [renderAttachments(goal, config.dataDir), markitdownHint(engine.markitdown.available(), engine.markitdown.binary())].filter(Boolean).join('\n\n');
  const outputSchema = req.mode === 'area' ? AreaDraftOutput : req.mode === 'revise' ? ReviseTurnOutput : TaskDraftOutput;
  const schema = jsonSchemaFor(outputSchema);
  const source = req.mode === 'revise' ? 'revise' : 'draft';
  const n = store.listByGoal(goal.id, 5000).filter((e) => e.type === 'goal.cost_added' && (e.payload as { source?: string }).source === source).length + 1;
  const prompt = buildDraftPrompt(goal, brief, req, task, area, overview, hint, attachments);
  const run = (p: string, resume?: string) =>
    engine.runner.run({
      prompt: p,
      cwd: ws,
      model: modelFor(config, goal, 'clarifier').model,
      meta: metaFor(goal.id, modelFor(config, goal, 'clarifier')),
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
      // a person waits for it on the Brief page: one slot beyond the limit, before queued work
      lane: 'interactive',
    });
  let cost = 0;
  const exec = async (p: string, resume?: string) => {
    const handle = await run(p, resume);
    // tracked with the goal's background sessions: cancelling the goal kills it
    const untrack = engine.trackBackground(goal.id, handle);
    try {
      for await (const ev of handle.events) engine.broadcast({ goalId: goal.id, taskId: null, attemptId: channel, event: ev, ts: new Date().toISOString() });
      const result = await handle.result;
      cost += result.costUsd;
      store.append({ type: 'goal.cost_added', goalId: goal.id, payload: { costUsd: result.costUsd, source } });
      engine.recordSessionUsage(result, { goalId: goal.id, kind: 'clarify', model: modelFor(config, goal, 'clarifier').model });
      return result;
    } finally {
      untrack();
    }
  };
  return { exec, prompt, cost: () => cost, say, outputSchema };
}

/** the Revise session that answers a round: the same prompt as the Revise itself, for a fresh start when needed */
const reviseSession = (engine: Engine, goal: Goal, brief: Brief, notes: string): Promise<ReviseSession> => draftSession(engine, goal, brief, { mode: 'revise', brief, taskKey: null, areaKey: null, notes }, undefined, undefined);

/** what a Revise round's answers end with: ask once more, or propose now */
function reviseClosing(finish: boolean, roundsAsked: number): string {
  if (finish) return 'The human asked you to stop asking: propose the revision now with your recommended answers for whatever is still open (record them as assumptions). `questions` must be empty. Output the JSON only.';
  if (roundsAsked >= REVISE_MAX_ROUNDS) return `That was round ${REVISE_MAX_ROUNDS} of ${REVISE_MAX_ROUNDS}, the last one you may ask: propose the revision now (\`questions\` empty), with assumptions for anything still open. Output the JSON only.`;
  return 'If these answers leave a decision you cannot safely assume, you may ask one more round (`revision` null). Otherwise propose the revision now (`questions` empty). Output the JSON only.';
}

/** the rounds a Revise already asked, rendered for a fresh session that replaces a lost one */
function reviseSoFar(rounds: InterviewRound[]): string {
  return `# Questions you already asked in this revision\nThe human answered them in an earlier session; do not ask them again.\n\n${rounds.filter((r) => r.answers).map(roundAnswers).join('\n\n')}`;
}

/** the human's answers and notes from the rounds a Revise asked, as applied Decisions for the revised Brief */
function roundDecisions(rounds: InterviewRound[]): Brief['questions'] {
  return rounds.flatMap((r) => [
    ...r.questions.flatMap((q) => (r.answers?.[q.key]?.trim() ? [{ id: newId('q'), text: q.text, answer: r.answers[q.key]!.trim(), blocking: false, areaKey: null, options: q.options, kind: 'text' as const, applied: true }] : [])),
    ...(r.note?.trim() ? [noteQuestion(newId('q'), r.note, true)] : []),
  ]);
}

/**
 * What a Revise turn came back with: a round of questions (the goal keeps it; the page asks the human), or the revision
 * as a proposal. A turn that still asks past the round cap is sent back once for the revision; one unparsable answer is
 * repaired in the same session.
 */
async function settleRevise(engine: Engine, goal: Goal, brief: Brief, s: ReviseSession, first: RunResult, rounds: InterviewRound[]): Promise<DraftProposal> {
  const { store } = engine;
  const finish = (reason: 'proposal' | 'cap' | 'failed') => {
    if (rounds.length) store.append({ type: 'revise.finished', goalId: goal.id, payload: { rounds: rounds.length, reason } });
  };
  let result = first;
  // lenient like the interview: a bare revision (no wrapper) from a model that ignored the schema, or an older session, is taken as one
  const parse = (r: RunResult) => {
    const raw = r.structuredOutput ?? tryJson(r.finalText);
    const turn = ReviseTurnOutput.safeParse(raw);
    if (turn.success) return turn;
    const bare = RevisionOutput.safeParse(raw);
    return bare.success ? ReviseTurnOutput.safeParse({ questions: [], revision: bare.data }) : turn;
  };
  let parsed = parse(result);
  if (!parsed.success && result.sessionId && repairable(result)) {
    result = await s.exec(`Your previous answer did not match the required JSON schema (${parsed.error.issues.slice(0, 3).map((i) => i.path.join('.') + ': ' + i.message).join('; ')}). Output either {"questions": [...], "revision": null} to ask the human, or {"questions": [], "revision": {...}} with the revised Brief. Output ONLY the JSON object now.`, result.sessionId);
    parsed = parse(result);
  }
  // a round of questions: the goal keeps it, the Brief page asks the human
  if (parsed.success && parsed.data.questions.length && !parsed.data.revision && rounds.length < REVISE_MAX_ROUNDS) {
    const questions = normalizeQuestions({ rounds }, parsed.data.questions);
    store.append({ type: 'revise.round_asked', goalId: goal.id, payload: { round: rounds.length + 1, sessionId: result.sessionId ?? null, questions } });
    return { mode: 'revise', taskKey: null, task: null, tasks: [], checks: [], rationale: '', costUsd: s.cost(), costAvailable: reportsDollars(goal.provider), round: { round: rounds.length + 1, questions } };
  }
  // questions past the cap: one more turn for the revision
  if (parsed.success && !parsed.data.revision && result.sessionId && repairable(result)) {
    result = await s.exec('No more questions can be asked. Propose the revision now with assumptions for everything still open; `questions` must be empty. Output the JSON only.', result.sessionId);
    parsed = parse(result);
  }
  if (!parsed.success || !parsed.data.revision) {
    finish('failed');
    throw new Error(`the draft session did not return a usable proposal${result.errorMessage ? `: ${result.errorMessage}` : ''}`);
  }
  const out = parsed.data.revision;
  const revised = toRevisedBrief(brief, out, roundDecisions(rounds));
  const diff = diffBrief(brief, revised);
  finish('proposal');
  return { mode: 'revise', taskKey: null, task: null, tasks: [], checks: [], rationale: out.changeSummary, costUsd: s.cost(), costAvailable: reportsDollars(goal.provider), revision: { diff, revised, changeSummary: out.changeSummary } };
}

/**
 * The human answered the round a Revise asked: the Revise session resumes with the answers (a fresh one with the full
 * prompt and the rounds so far when it is lost) and comes back with the proposal, or one more round.
 */
export async function answerRevise(engine: Engine, goal: Goal, ans: ReviseAnswer): Promise<DraftProposal> {
  const rv = goal.revise;
  if (goal.state !== 'awaiting_brief_approval' || !rv || rv.status !== 'awaiting_answers') throw new Error('no Revise round is waiting for answers');
  const round = rv.rounds.at(-1)!;
  const known = new Set(round.questions.map((q) => q.key));
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(ans.answers)) if (known.has(k) && v.trim()) clean[k] = v.trim();
  if (!ans.finish) {
    const missing = round.questions.filter((q) => q.blocking && !clean[q.key]);
    if (missing.length) throw new Error(`answer the blocking question(s) first, or press "enough": ${missing.map((q) => q.key).join(', ')}`);
  }
  const note = ans.note?.trim().slice(0, INTERVIEW_NOTE_MAX) || null;
  engine.store.append({ type: 'revise.round_answered', goalId: goal.id, payload: { round: round.round, answers: clean, finish: ans.finish, note } });
  const after = getGoal(engine.store.db, goal.id)!;
  const rounds = after.revise?.rounds ?? [];
  const answered = rounds.at(-1)!;
  const brief: Brief = { ...ans.brief, goalId: goal.id };
  const s = await reviseSession(engine, goal, brief, '');
  const closing = reviseClosing(ans.finish, rounds.length);
  let result = rv.sessionId ? await s.exec(`${roundAnswers(answered)}\n\n${closing}`, rv.sessionId) : null;
  if (!result || isLostSession(result)) {
    engine.store.append({ type: 'engine.note', goalId: goal.id, payload: { level: 'info', message: result ? `the Revise session ${rv.sessionId} could not be resumed (${result.errorMessage ?? result.subtype}); starting a fresh one with its questions so far` : 'continuing the Revise in a fresh session' } });
    result = await s.exec(`${s.prompt}\n\n${reviseSoFar(rounds)}\n\n${closing}`);
  }
  return settleRevise(engine, goal, brief, s, result, rounds);
}

/** The human let an asking Revise go: cancelled it, or approved the Brief over its open round. */
export function cancelRevise(engine: Engine, goal: Goal): void {
  if (goal.revise?.status !== 'awaiting_answers') return;
  engine.store.append({ type: 'revise.finished', goalId: goal.id, payload: { rounds: goal.revise.rounds.length, reason: 'abandoned' } });
}

/**
 * The revised Brief: the model's tasks/checks/areas (keys kept where it kept them), the human's questions and
 * assumption verdicts preserved (assumption ids matched by text; new ones get ids), the answers and notes of the
 * rounds the Revise asked as applied Decisions, new non-blocking questions appended.
 */
export function toRevisedBrief(current: Brief, out: RevisionOutput, decided: Brief['questions'] = []): Omit<Brief, 'goalId'> {
  const materials = [
    ...(out.provides ?? []).map((p) => {
      const prev = (current.provides ?? []).find((x) => x.key === p.key);
      return prev ? { ...prev, what: p.what, mode: prev.status === 'waiting' ? (p.mode ?? prev.mode) : prev.mode } : { key: p.key, what: p.what, neededBy: [], mode: p.mode ?? ('wait' as const), status: 'waiting' as const, receivedAt: null, attachmentIds: [], note: null };
    }),
    ...(current.provides ?? []).filter((x) => x.status !== 'waiting' && !(out.provides ?? []).some((p) => p.key === x.key)),
  ];
  const revised = assignMaterials(out.tasks, materials);
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
      .map((c) => ({ key: c.key, name: c.name, tier: c.tier, taskKey: c.taskKey ?? null, areaKey: c.taskKey ? null : area(c.areaKey), spec: materializeCheck(c, c.taskKey ?? null) })),
    tasks: revised.tasks.map((t) => ({ key: t.key, title: t.title, spec: t.spec, needs: t.needs, kind: t.kind ?? 'feature', scope: t.scope ?? null, scenario: t.scenario ?? 'general', areaKey: area(t.areaKey), tdd: 'inherit', dependsOnKeys: t.dependsOnKeys.filter((k) => taskKeys.has(k) && k !== t.key), parallelizable: t.parallelizable, relevantFiles: t.relevantFiles, delivers: t.delivers ?? [], milestone: t.milestone === undefined ? (current.tasks.find((c) => c.key === t.key)?.milestone ?? null) : t.milestone, milestoneScript: t.milestoneScript === undefined ? (current.tasks.find((c) => c.key === t.key)?.milestoneScript ?? null) : t.milestoneScript, difficulty: t.difficulty ?? 'standard' })),
    // materials keep what already arrived; a revision renames or adds, and drops only ones still waiting (ADR-0074)
    provides: revised.provides,
    costEstimateUsd: out.costEstimateUsd,
    run: out.run ?? current.run,
    apps: out.apps ?? current.apps,
    timeEstimateMin: out.timeEstimateMin,
    questions: [...current.questions, ...decided, ...out.newQuestions.map((q) => ({ id: newId('q'), text: q.text, answer: null, blocking: false, areaKey: area(q.areaKey), options: [], kind: 'text' as const, applied: false }))],
    styleOptions: current.styleOptions,
  };
}

/** Keys unique within the Brief: T<n> / C<n> continuing after the highest existing number. */
function keyAllocator(brief: Brief) {
  const max = (prefix: string, keys: string[]) => keys.reduce((m, k) => (k.startsWith(prefix) && /^\d+$/.test(k.slice(prefix.length)) ? Math.max(m, Number(k.slice(prefix.length))) : m), 0);
  const counters: Record<string, number> = { T: max('T', brief.tasks.map((t) => t.key)), C: max('C', brief.checks.map((c) => c.key)) };
  return (prefix: 'T' | 'C') => `${prefix}${++counters[prefix]!}`;
}

export function briefSummary(brief: Brief): string {
  const areaName = (k: string | null) => brief.areas.find((a) => a.key === k)?.name ?? '—';
  const lines = [
    `## Understanding\n${brief.understanding.trim()}`,
    brief.areas.length ? `## Areas\n${brief.areas.map((a) => `- ${a.key} ${a.name} (scope \`${a.slug}\`): ${a.description}`).join('\n')}` : '',
    brief.assumptions.length ? `## Assumptions\n${brief.assumptions.map((a) => `- ${a.accepted ? '' : '[REJECTED by the human] '}${a.text}`).join('\n')}` : '',
    renderDecisions(brief, '## Decisions from the human'),
    `## Existing tasks\n${brief.tasks.map((t) => `- ${t.key} [${areaName(t.areaKey)} · ${t.kind} · ${t.scenario}] ${t.title}${t.dependsOnKeys.length ? ` (after ${t.dependsOnKeys.join(', ')})` : ''}${t.milestone ? `\n  milestone (the goal pauses here for a look): ${t.milestone}` : ''}\n${t.spec.trim().split('\n').map((l) => `  ${l}`).join('\n')}`).join('\n')}`,
    brief.checks.length ? `## Existing checks\n${brief.checks.map((c) => `- ${c.key} [${c.tier}] ${c.taskKey ? `task ${c.taskKey}` : `goal${c.areaKey ? ` · ${areaName(c.areaKey)}` : ''}`}: ${c.name}${c.spec.type === 'command' ? ` — \`${c.spec.cmd}\`` : c.spec.type === 'reviewer' ? ` — reviewer: ${c.spec.rubric}` : ''}`).join('\n')}` : '',
  ];
  return lines.filter(Boolean).join('\n\n');
}

/** what every proposal on the Brief page must keep to (a Draft, a Revise, a second opinion) */
export const DRAFT_RULES = `Rules:\n- Acceptance checks must be decidable: a command check is a real command that runs from the repo root (exit 0 = pass); a reviewer check has a concrete rubric naming what to look at. Must = what the human asked for; stretch = valuable extras.\n- Do not restate or duplicate existing tasks and checks; reference them by key where relevant (dependsOnKeys).\n- Keep the language and conventions of the Brief and the repository. Task titles are imperative commit subjects without type prefix.`;

function buildDraftPrompt(goal: Goal, brief: Brief, req: DraftRequest, task: BriefTask | undefined, area: Brief['areas'][number] | undefined, overview: string | null, skillsHint: string | null, attachments: string): string {
  const rules = DRAFT_RULES;
  const ask =
    req.mode === 'revise'
      ? `# Your job\nThe human answered questions, wrote notes and/or rejected assumptions (see "Decisions from the human" above). Revise the Brief so that every decision is honoured: change, add or drop tasks and checks as needed (including Areas if a decision changes the scope), update the understanding and the estimate. Explore the repository (read-only) where a decision needs it.\n\nYou may ask the human first. When a decision leaves something open that you cannot safely assume, output \`{"questions": [...], "revision": null}\`: at most ${INTERVIEW_MAX_QUESTIONS_REVISE} questions, the most consequential first, each with 2–4 options (YOUR recommendation first) and the reason that leaves it open. The page asks them and you get the answers; you may ask at most ${REVISE_MAX_ROUNDS} rounds. Facts are yours to find in the repository; only decisions are theirs. Otherwise output \`{"questions": [], "revision": {...}}\` with the revision.\n\nRules for the revision:\n- **Keep the keys** of every task, check and Area you keep (changed or not); give new ones the next free number (T${brief.tasks.length + 1}…, C${brief.checks.length + 1}…). A task you drop simply does not appear.\n- Do not touch what no decision affects. Keep each kept task's \`milestone\` and \`milestoneScript\` as they are unless a decision changes them.\n- newQuestions is for genuinely new, non-blocking questions the revision raises for the Brief page (usually none); what you need answered before revising goes in \`questions\` instead.\n- Say in changeSummary what changed because of which decision.\nOutput the complete revised Brief as JSON matching the schema.`
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
