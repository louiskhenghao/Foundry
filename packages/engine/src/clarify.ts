import { join } from 'node:path';
import type { Brief, Goal, GoalNature, Interview, InterviewQuestion, InterviewRound, TaskScenario } from '@foundry/core';
import { BriefOutput, BriefSkeleton, INTERVIEW_MAX_QUESTIONS, PlanOutput, INTERVIEW_MAX_ROUNDS, IdPrefix, InterviewOutput, getGoal, interviewAnswers, interviewDepth, newId, uncoveredAreas } from '@foundry/core';
import type { RunHandle, RunResult } from '@foundry/runner';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { attachmentsDir, markitdownHint, renderAttachments } from './attachments.ts';
import { tryJson } from './checks/reviewer.ts';
import { metaFor, modelFor } from './models/roles.ts';
import type { Engine } from './engine.ts';
import { git, isDirty } from './git/git.ts';
import { READONLY_DISALLOWED, READONLY_TOOLS, boundarySettings } from './guards/boundary.ts';
import { hasStackManifest } from './skills/autoskills.ts';
import { startSentence } from './follow-up.ts';
import { readdirSync } from 'node:fs';

/** Files that do not make a repository "have code": a freshly initialised repo may carry any of these. */
const EMPTY_REPO_IGNORE = new Set(['.git', '.claude', '.agents', '.DS_Store', 'graphify-out', 'CLAUDE.md', 'AGENTS.md', 'README.md', '.gitignore', '.gitattributes', 'LICENSE', 'docs']);

/** The scenario that filters clarifier/planner skill hints for a nature; undefined = no filter (code and unclassified goals). */
export function natureScenario(nature: GoalNature): TaskScenario | undefined {
  return nature === 'docs' || nature === 'research' || nature === 'image' || nature === 'video' ? nature : undefined;
}

const NatureVerdict = z.object({ nature: z.enum(['code', 'docs', 'research', 'image', 'video']) });

/**
 * One cheap single-turn call that classifies an `auto` goal's nature BEFORE the Clarify prompt is built,
 * so the prompt sections and skill hints match the goal (a poster goal should never be handed
 * codebase-design). Null on any failure — Clarify then runs with the judge-it-yourself sections.
 */
async function classifyNature(engine: Engine, goal: Goal, ws: string): Promise<GoalNature | null> {
  try {
    const handle = await engine.runner.run({
      prompt: `Classify what this goal produces. code = software changes; docs = prose/documents; research = an investigation ending in a cited report; image = generated/edited images; video = generated/edited video or audio. Pick the dominant one for mixed goals.\n\n# Goal\n${goal.prompt.slice(0, 4000)}`,
      cwd: ws,
      model: goal.models.cheap,
      meta: { goalId: goal.id, tier: 'cheap' },
      maxTurns: 1,
      maxBudgetUsd: 0.1,
      permissionMode: 'dontAsk',
      allowedTools: [],
      jsonSchema: zodToJsonSchema(NatureVerdict, { $refStrategy: 'none' }),
      timeoutMs: 60_000,
      label: `classify nature ${goal.title}`,
    });
    for await (const ev of handle.events) engine.broadcast({ goalId: goal.id, taskId: null, attemptId: `clarify-${goal.id}`, event: ev, ts: new Date().toISOString() });
    const r = await handle.result;
    engine.store.append({ type: 'goal.cost_added', goalId: goal.id, payload: { costUsd: r.costUsd, source: 'clarify' } });
    engine.recordSessionUsage(r, { goalId: goal.id, kind: 'clarify', model: goal.models.cheap });
    const parsed = NatureVerdict.safeParse(r.structuredOutput ?? tryJson(r.finalText));
    return parsed.success ? parsed.data.nature : null;
  } catch {
    return null;
  }
}

/** An empty repository has no stack manifest and nothing but scaffolding-free files — the tech stack is then the human's decision. */
export function isEmptyRepo(ws: string): boolean {
  if (hasStackManifest(ws)) return false;
  try {
    return readdirSync(ws).every((n) => EMPTY_REPO_IGNORE.has(n));
  } catch {
    return false;
  }
}

/** Multi-Area goals need more turns and budget than the old "1–6 tasks" briefs. */
export const CLARIFY_MAX_TURNS = 90;
export const CLARIFY_MAX_BUDGET_USD = 6;
const PLANNER_MAX_TURNS = 45;
const PLANNER_MAX_BUDGET_USD = 4;

/** Everything one Clarify session needs; the interview's later rounds resume the session and rebuild this only to recover a lost one. */
interface ClarifyContext {
  ws: string;
  prompt: string;
  wasAuto: boolean;
  nature: GoalNature;
  /** engine-made questions (dirty repo …) that ride into the Brief */
  extraQuestions: Brief['questions'];
  run: (p: string, resume?: string) => Promise<RunHandle>;
  planner: { model: string; run: (skeleton: BriefSkeleton, resume?: { sessionId: string; message: string }) => Promise<RunHandle> };
}

async function prepareClarify(engine: Engine, goal: Goal): Promise<ClarifyContext> {
  const { store, config } = engine;
  const extraQuestions: Brief['questions'] = [];
  if (await isDirty(goal.repoPath).catch(() => false)) {
    extraQuestions.push({
      id: newId('q'),
      text: `The repository at ${goal.repoPath} has uncommitted changes. The goal branch is created from the last commit of '${goal.baseBranch}' (or its remote tip when that is newer), so those changes will NOT be visible to the workers. Continue anyway? (answer "yes" to continue, or commit/stash first and recreate the goal)`,
      answer: null,
      blocking: true,
      areaKey: null,
      options: [],
      kind: 'text',
      applied: false,
    });
  }
  // explore the goal worktree, not the user's checkout: it was just fetched and may be ahead of the local base
  const ws = await engine.ensureSyncedWorkspace(goal);
  // auto goals: settle the nature BEFORE building the prompt, so its sections and skill hints match the goal
  const wasAuto = goal.nature === 'auto';
  let nature = goal.nature;
  if (wasAuto) {
    const n = await classifyNature(engine, goal, ws);
    if (n) {
      nature = n;
      store.append({ type: 'goal.nature_set', goalId: goal.id, payload: { nature: n, reason: 'pre-clarify classification' } });
    }
  }
  await engine.context.prepare(ws).catch((err) => config.log(`[clarify] context prepare failed: ${err}`));
  let overview = await engine.context.overview(ws).catch(() => null);
  const sync = getGoal(store.db, goal.id)?.baseSync;
  if (sync && sync.startedFrom === 'remote') overview = `${overview ?? ''}\n\n## Base branch\nThis checkout is ${sync.remote}/${sync.base} (${sync.behind} commit(s) newer than the local ${sync.base}).`.trim();
  // recent commit subjects: the clarifier matches their language and style for task titles
  const log = await git(['log', '--no-merges', '--format=%s', '-n', '8', '--', '.'], ws).catch(() => null);
  if (log && log.code === 0 && log.stdout.trim()) overview = `${overview ?? ''}\n\n## Recent commits\n${log.stdout.trim()}`.trim();

  const scenario = natureScenario(nature);
  const [clarifierHint, plannerHint] = await Promise.all([engine.skillsFor(goal).hints.sectionFor('clarifier', { scenario }), engine.skillsFor(goal).hints.sectionFor('planner', { scenario })]);
  // a re-run keeps the human's Decisions from the discarded Brief
  const reclarified = store.listByGoal(goal.id, 5000).filter((e) => e.type === 'goal.reclarified').at(-1);
  const decisions = reclarified ? ((reclarified.payload as { decisions?: string }).decisions ?? '') : '';
  // a Follow-up: the earlier goal's snapshot, plus where this checkout actually started (recorded by the Base Sync)
  const synced = getGoal(store.db, goal.id) ?? goal;
  const previous = goal.follows?.context ? [goal.follows.context, startSentence(synced)].filter(Boolean).join('\n') : '';
  const prompt = buildClarifyPrompt({ ...goal, nature }, overview, clarifierHint, [renderAttachments(goal, config.dataDir), markitdownHint(engine.markitdown.available(), engine.markitdown.binary())].filter(Boolean).join('\n\n'), decisions, isEmptyRepo(ws), engine.imageGenAvailable(), goal.interview ? interviewDepth(goal.interview) : null, previous);
  const addDirs = goal.attachments.length ? [attachmentsDir(config.dataDir, goal.id)] : undefined;
  const schema = zodToJsonSchema(goal.interview ? InterviewOutput : BriefSkeleton, { $refStrategy: 'none' });
  const transcriptPath = join(config.dataDir, 'transcripts', `clarify-${goal.id}.jsonl`);
  const classifiedGoal = { ...goal, nature };
  const clarifierModel = modelFor(config, classifiedGoal, 'clarifier');
  const codex = (goal.provider ?? config.provider) === 'codex';
  const run = (p: string, resume?: string) =>
    engine.runner.run({
      prompt: p,
      cwd: ws,
      model: clarifierModel.model,
      meta: metaFor(goal.id, clarifierModel),
      maxTurns: CLARIFY_MAX_TURNS,
      maxBudgetUsd: CLARIFY_MAX_BUDGET_USD,
      permissionMode: 'dontAsk',
      allowedTools: READONLY_TOOLS,
      disallowedTools: READONLY_DISALLOWED,
      appendSystemPromptFile: engine.roles.path('clarifier'),
      jsonSchema: schema,
      settings: boundarySettings(config.hooksDir),
      settingSources: config.settingSources,
      // Clarify only reads the repository: no MCP servers (mail, calendars, browsers…) to load into every turn
      strictMcp: true,
      addDirs,
      resumeSessionId: resume,
      // a turn that writes the Brief can think for minutes without printing anything (267 s seen against a 300 s limit)
      timeoutMs: 30 * 60_000,
      idleTimeoutMs: 10 * 60_000,
      transcriptPath,
      label: `clarify ${goal.title}`,
    });
  const plannerModel = modelFor(config, classifiedGoal, 'planner');
  const planner = {
    model: plannerModel.model,
    run: (skeleton: BriefSkeleton, resume?: { sessionId: string; message: string }) =>
      engine.runner.run({
        prompt: resume ? resume.message : buildPlannerPrompt({ ...goal, nature }, skeleton, { overview, attachments: renderAttachments(goal, config.dataDir), decisions, interview: goal.interview, emptyRepo: isEmptyRepo(ws), imageGen: engine.imageGenAvailable(), previous, plannerHint }),
        cwd: ws,
        model: plannerModel.model,
        meta: metaFor(goal.id, plannerModel),
        maxTurns: PLANNER_MAX_TURNS,
        maxBudgetUsd: PLANNER_MAX_BUDGET_USD,
        permissionMode: 'dontAsk',
        allowedTools: READONLY_TOOLS,
        disallowedTools: READONLY_DISALLOWED,
        appendSystemPromptFile: engine.roles.path('planner'),
        jsonSchema: zodToJsonSchema(PlanOutput, { $refStrategy: 'none' }),
        settings: boundarySettings(config.hooksDir),
        settingSources: config.settingSources,
        strictMcp: true,
        addDirs,
        resumeSessionId: resume?.sessionId,
        timeoutMs: 20 * 60_000,
        idleTimeoutMs: 10 * 60_000,
        transcriptPath: join(config.dataDir, 'transcripts', `planner-${goal.id}.jsonl`),
        label: `planner ${goal.title}`,
      }),
  };
  return { ws, prompt, wasAuto, nature, extraQuestions, run, planner };
}

/**
 * The planner session: the task plan for every Area of the Clarifier's Brief, with task-level checks and the estimate,
 * written once (the Clarifier never re-types it). An Area left without tasks gets one repair turn in the same session.
 * null when no usable plan came back.
 */
async function planTasks(engine: Engine, goal: Goal, ctx: ClarifyContext, skeleton: BriefSkeleton): Promise<PlanOutput | null> {
  const { store } = engine;
  const run = async (resume?: { sessionId: string; message: string }): Promise<{ plan: PlanOutput | null; result: RunResult }> => {
    const handle = await ctx.planner.run(skeleton, resume);
    for await (const ev of handle.events) engine.broadcast({ goalId: goal.id, taskId: null, attemptId: `clarify-${goal.id}`, event: ev, ts: new Date().toISOString() });
    const result = await handle.result;
    store.append({ type: 'goal.cost_added', goalId: goal.id, payload: { costUsd: result.costUsd, source: 'planner' } });
    engine.recordSessionUsage(result, { goalId: goal.id, kind: 'planner', model: ctx.planner.model });
    const parsed = PlanOutput.safeParse(result.structuredOutput ?? tryJson(result.finalText));
    return { plan: parsed.success && !result.isError ? parsed.data : null, result };
  };
  store.append({ type: 'clarify.stage', goalId: goal.id, payload: { stage: 'planning' } });
  let { plan, result } = await run();
  if (!plan && result.sessionId && repairable(result)) ({ plan, result } = await run({ sessionId: result.sessionId, message: 'No usable plan came back (it ended early or did not match the required JSON schema). Output ONLY the plan JSON now: {"tasks": [...], "checks": [...], "costEstimateUsd": n, "timeEstimateMin": n}.' }));
  if (!plan) {
    store.append({ type: 'engine.note', goalId: goal.id, payload: { level: 'warn', message: `the planner returned no usable plan (${result.errorMessage ?? result.subtype})` } });
    return null;
  }
  const missing = uncoveredAreas({ areas: skeleton.areas, tasks: plan.tasks });
  if (missing.length && result.sessionId && repairable(result)) {
    const repaired = await run({ sessionId: result.sessionId, message: coverageRepairMessage(missing) });
    if (repaired.plan) plan = repaired.plan;
  }
  return plan;
}

/** `key`, or `key-2`, `key-3`… when it is taken; the one returned is taken from then on */
function claim(used: Set<string>, key: string): string {
  let k = key;
  for (let i = 2; used.has(k); i++) k = `${key}-${i}`;
  used.add(k);
  return k;
}

/**
 * The Clarifier's Brief and the planner's plan as one Brief: goal-level and task-level checks together. Keys are kept
 * unique (approval gives each task key its own task, so a repeated one would merge two tasks) and a dependency on a key
 * that does not exist, or on the task itself, is dropped; a reference to a repeated key means its first task.
 */
export function mergePlan(skeleton: BriefSkeleton, plan: PlanOutput): BriefOutput {
  const { goalChecks, planningNotes: _notes, ...rest } = skeleton;
  const taskKeys = new Set<string>();
  const named = plan.tasks.map((t) => ({ ...t, key: claim(taskKeys, t.key) }));
  const tasks = named.map((t) => ({ ...t, dependsOnKeys: [...new Set(t.dependsOnKeys)].filter((k) => taskKeys.has(k) && k !== t.key) }));
  const checkKeys = new Set<string>();
  const taskChecks = plan.checks.filter((c) => taskKeys.has(c.taskKey)).map((c) => ({ ...c, key: claim(checkKeys, c.key) }));
  const goalLevel = goalChecks.map((c) => ({ ...c, key: claim(checkKeys, c.key), taskKey: null }));
  return { ...rest, tasks, checks: [...taskChecks, ...goalLevel], costEstimateUsd: plan.costEstimateUsd, timeEstimateMin: plan.timeEstimateMin };
}

/** No plan came back: one task per Area from the Clarifier's notes, and a blocking question so the human sees why */
function unplanned(skeleton: BriefSkeleton): BriefOutput {
  const tasks = skeleton.areas.map((a, i) => ({ key: `T${i + 1}`, title: `build ${a.name}`.slice(0, 60), spec: `${a.description}\n\n${skeleton.planningNotes}`, kind: 'feature' as const, scenario: 'general' as const, areaKey: a.key, dependsOnKeys: [], parallelizable: false, relevantFiles: [], difficulty: 'standard' as const }));
  return mergePlan({ ...skeleton, openQuestions: [...skeleton.openQuestions, { text: 'The planner could not split this goal into tasks, so each Area is one task for now. Draft tasks for an Area on this page, or edit them, then answer "ok" here.', blocking: true, areaKey: null, options: [] }] }, { tasks, checks: [], costEstimateUsd: 0, timeEstimateMin: 0 });
}

/** run one Clarify turn (fresh or resumed), streaming it to the goal's clarify channel and booking its cost */
async function turn(engine: Engine, goal: Goal, ctx: ClarifyContext, message: string, resume: string | undefined, source: string): Promise<RunResult> {
  engine.store.append({ type: 'clarify.stage', goalId: goal.id, payload: { stage: 'clarifying' } });
  const handle = await ctx.run(message, resume);
  for await (const ev of handle.events) engine.broadcast({ goalId: goal.id, taskId: null, attemptId: `clarify-${goal.id}`, event: ev, ts: new Date().toISOString() });
  const result = await handle.result;
  engine.store.append({ type: 'goal.cost_added', goalId: goal.id, payload: { costUsd: result.costUsd, source } });
  engine.recordSessionUsage(result, { goalId: goal.id, kind: 'clarify', model: modelFor(engine.config, { ...goal, nature: ctx.nature }, 'clarifier').model });
  return result;
}

/**
 * A session worth one more turn: not killed (engine shutdown, cancel, timeout) and not stopped at its budget, where
 * another turn would only start a process the engine just stopped or spend past the cap.
 */
export function repairable(r: RunResult): boolean {
  return !r.subtype.startsWith('killed') && r.subtype !== 'error_max_budget_usd';
}

/** a resumed session that never got going: the CLI could not find the conversation (expired, other machine, wiped) */
export function isLostSession(r: RunResult): boolean {
  return r.subtype !== 'success' && ((r.numTurns ?? 0) === 0 || /no conversation found|session.*not found|could not resume/i.test(r.errorMessage ?? ''));
}

/**
 * Clarify: explore the repo, then — when the goal has an interview — ask the human what only they can decide, round
 * by round, and write the Brief once nothing is left to ask. Without an interview it is the one-shot Brief of before.
 */
export async function runClarify(engine: Engine, goal: Goal): Promise<void> {
  const { store } = engine;
  engine.clarifying.add(goal.id);
  try {
    store.append({ type: 'clarify.started', goalId: goal.id, payload: { attemptId: null } });
    const ctx = await prepareClarify(engine, goal);
    const result = await turn(engine, goal, ctx, ctx.prompt, undefined, 'clarify');
    await settle(engine, getGoal(store.db, goal.id)!, ctx, result);
  } catch (err) {
    store.append({ type: 'engine.note', goalId: goal.id, payload: { level: 'error', message: `clarify crashed: ${String((err as Error)?.stack ?? err)}` } });
    store.append({ type: 'goal.state_changed', goalId: goal.id, payload: { from: 'clarifying', to: 'failed', reason: `clarify crashed: ${String(err)}` } });
  } finally {
    engine.clarifying.delete(goal.id);
  }
}

/**
 * The human answered the open round: record it and continue the Clarify session in the background. Validation is
 * synchronous so the API can report it; the session's outcome arrives as the next round or the Brief.
 */
export function answerInterview(engine: Engine, goal: Goal, answers: Record<string, string>, finish: boolean): void {
  const iv = goal.interview;
  if (goal.state !== 'clarifying' || !iv || iv.status !== 'awaiting_answers') throw new Error('no interview round is waiting for answers');
  const round = iv.rounds.at(-1)!;
  const known = new Set(round.questions.map((q) => q.key));
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(answers)) if (known.has(k) && v.trim()) clean[k] = v.trim();
  if (!finish) {
    const missing = round.questions.filter((q) => q.blocking && !clean[q.key]);
    if (missing.length) throw new Error(`answer the blocking question(s) first, or press "enough": ${missing.map((q) => q.key).join(', ')}`);
  }
  // reserve before the event: the tick the event triggers must not start a second session
  engine.clarifying.add(goal.id);
  engine.store.append({ type: 'interview.round_answered', goalId: goal.id, payload: { round: round.round, answers: clean, finish } });
  void continueInterview(engine, getGoal(engine.store.db, goal.id)!, { reserved: true });
}

/** Resume the Clarify session with the round's answers; a lost session starts over with the interview so far. */
export async function continueInterview(engine: Engine, goal: Goal, opts: { reserved?: boolean } = {}): Promise<void> {
  const { store } = engine;
  if (!opts.reserved) engine.clarifying.add(goal.id);
  try {
    const iv = goal.interview;
    const round = iv?.rounds.at(-1);
    if (!iv || !round?.answers) return;
    const ctx = await prepareClarify(engine, goal);
    const message = answersMessage(iv, round);
    let result = iv.sessionId ? await turn(engine, goal, ctx, message, iv.sessionId, 'clarify') : null;
    if (!result || isLostSession(result)) {
      // the conversation is gone: a fresh session gets the whole interview so far and picks up where it stopped
      store.append({ type: 'engine.note', goalId: goal.id, payload: { level: 'info', message: result ? `clarify session ${iv.sessionId} could not be resumed (${result.errorMessage ?? result.subtype}); starting a fresh one with the interview so far` : 'continuing the interview in a fresh session' } });
      result = await turn(engine, goal, ctx, `${ctx.prompt}\n\n${interviewSoFar(iv)}\n\n${closingInstruction(iv, round)}`, undefined, 'clarify');
    }
    await settle(engine, getGoal(store.db, goal.id)!, ctx, result);
  } catch (err) {
    store.append({ type: 'engine.note', goalId: goal.id, payload: { level: 'error', message: `clarify crashed: ${String((err as Error)?.stack ?? err)}` } });
    store.append({ type: 'goal.state_changed', goalId: goal.id, payload: { from: 'clarifying', to: 'failed', reason: `clarify crashed: ${String(err)}` } });
  } finally {
    engine.clarifying.delete(goal.id);
  }
}

function canAskMore(iv: Interview): boolean {
  const last = iv.rounds.at(-1);
  return iv.rounds.length < INTERVIEW_MAX_ROUNDS && !last?.finish;
}

function closingInstruction(iv: Interview, round: InterviewRound): string {
  if (round.finish) return 'The human asked you to stop asking and write the Brief now: plan with these answers, record an assumption for everything still open, and leave `questions` empty.';
  if (iv.rounds.length >= INTERVIEW_MAX_ROUNDS) return `That was round ${INTERVIEW_MAX_ROUNDS} of ${INTERVIEW_MAX_ROUNDS}, the last one: write the Brief now (\`questions\` empty), with assumptions for anything still open.`;
  return `If these answers make a decision askable that you could not ask before, ask the next round (at most ${INTERVIEW_MAX_QUESTIONS} questions, \`brief\` null). Otherwise write the Brief now (\`questions\` empty). Output the JSON only.`;
}

function answersMessage(iv: Interview, round: InterviewRound): string {
  const lines = round.questions.map((q) => `- ${q.key}: ${q.text}\n  A: ${round.answers?.[q.key] ?? '(no answer — proceed on your recommendation and record it as an assumption)'}`);
  return `# Round ${round.round} answers\n${lines.join('\n')}\n\n${closingInstruction(iv, round)}`;
}

/** the whole interview rendered for a fresh session */
function interviewSoFar(iv: Interview): string {
  const parts = iv.rounds.map((r) => `## Round ${r.round}\n${r.questions.map((q) => `- ${q.key}: ${q.text}\n  A: ${r.answers?.[q.key] ?? '(no answer — proceed on your recommendation)'}`).join('\n')}`);
  return `# Interview so far\nYou already asked these rounds in an earlier session and the human answered; do not ask them again.\n\n${parts.join('\n\n')}`;
}

/** interview answers become Decisions in the Brief: every later session receives them, and Revise honours them */
function interviewDecisions(iv: Interview | null): Brief['questions'] {
  if (!iv) return [];
  return interviewAnswers(iv).map(({ question, answer }) => ({ id: newId('q'), text: question.text, answer, blocking: false, areaKey: null, options: question.options, kind: 'text' as const, applied: true }));
}

function normalizeQuestions(iv: Interview, qs: InterviewOutput['questions']): InterviewQuestion[] {
  const round = iv.rounds.length + 1;
  const seen = new Set(iv.rounds.flatMap((r) => r.questions.map((q) => q.key)));
  return qs.slice(0, INTERVIEW_MAX_QUESTIONS).map((q, i) => {
    let key = (q.key ?? '').trim() || `R${round}Q${i + 1}`;
    if (seen.has(key)) key = `R${round}Q${i + 1}`;
    seen.add(key);
    return { key, text: q.text, options: (q.options ?? []).filter(Boolean).slice(0, 4), reason: q.reason ?? '', dependsOn: q.dependsOn && seen.has(q.dependsOn) ? q.dependsOn : null, blocking: q.blocking ?? true };
  });
}

/** What a session's output means: a round to ask, or the Brief — with one repair turn when it is neither. */
async function settle(engine: Engine, goal: Goal, ctx: ClarifyContext, first: RunResult): Promise<void> {
  const { store } = engine;
  let result = first;
  const iv = goal.interview;
  // a round of questions, the Brief skeleton (the planner adds the tasks), or a whole Brief a model wrote with its tasks
  type Turn = { questions: InterviewOutput['questions']; brief: BriefSkeleton | null; full: BriefOutput | null };
  const parseTurn = (raw: unknown): Turn | null => {
    if (iv) {
      const p = InterviewOutput.safeParse(raw);
      if (p.success) return { questions: p.data.questions, brief: p.data.brief, full: null };
    }
    const wrapped = raw && typeof raw === 'object' && 'brief' in raw ? (raw as { brief: unknown; questions?: unknown }) : null;
    const inner = wrapped ? wrapped.brief : raw;
    const questions = iv && wrapped && Array.isArray(wrapped.questions) ? (InterviewOutput.shape.questions.safeParse(wrapped.questions).data ?? []) : [];
    const s = BriefSkeleton.safeParse(inner);
    if (s.success) return { questions, brief: s.data, full: null };
    const b = BriefOutput.safeParse(inner);
    return b.success ? { questions, brief: null, full: b.data } : null;
  };
  let out = parseTurn(result.structuredOutput ?? tryJson(result.finalText));
  if (!out && result.sessionId && repairable(result)) {
    // checked against the schema the session was given: one-shot sessions write the skeleton, not a whole Brief
    const issues = iv ? InterviewOutput.safeParse(result.structuredOutput ?? tryJson(result.finalText)) : BriefSkeleton.safeParse(result.structuredOutput ?? tryJson(result.finalText));
    const detail = issues.success ? '' : issues.error.issues.slice(0, 3).map((i) => i.path.join('.') + ': ' + i.message).join('; ');
    result = await turn(engine, goal, ctx, `Your previous answer did not match the required JSON schema (${detail}). ${iv ? 'Output either {"questions": [...], "brief": null} to ask a round, or {"questions": [], "brief": {...}} with the Brief.' : 'Output ONLY the JSON object now.'}`, result.sessionId, 'clarify-repair');
    out = parseTurn(result.structuredOutput ?? tryJson(result.finalText));
  }

  // a round of questions: the goal waits for the human
  if (iv && out && out.questions.length && !out.brief && !out.full && canAskMore(iv)) {
    const questions = normalizeQuestions(iv, out.questions);
    store.append({ type: 'interview.round_asked', goalId: goal.id, payload: { round: iv.rounds.length + 1, sessionId: result.sessionId ?? null, questions } });
    return;
  }
  // questions came back although no more rounds are allowed: one more turn to get the Brief
  if (iv && out && !out.brief && !out.full && result.sessionId && repairable(result)) {
    result = await turn(engine, goal, ctx, 'No more questions can be asked. Write the Brief now with assumptions for everything still open; `questions` must be empty. Output the JSON only.', result.sessionId, 'clarify-repair');
    out = parseTurn(result.structuredOutput ?? tryJson(result.finalText));
  }

  // the Clarifier wrote everything but the plan: the planner adds it, once
  let parsed: BriefOutput | null = out?.full ?? null;
  if (out?.brief) {
    const plan = await planTasks(engine, goal, ctx, out.brief);
    parsed = plan ? mergePlan(out.brief, plan) : unplanned(out.brief);
  } else if (parsed && result.sessionId) {
    // a whole Brief (tasks included) from the Clarifier itself: it repairs an Area it left without tasks
    const missing = uncoveredAreas({ areas: parsed.areas, tasks: parsed.tasks });
    if (missing.length) {
      const r2 = await turn(engine, goal, ctx, coverageRepairMessage(missing, 'Brief'), result.sessionId, 'clarify-coverage');
      const repaired = parseTurn(r2.structuredOutput ?? tryJson(r2.finalText));
      if (repaired?.full) parsed = repaired.full;
      // the session's schema allows only the skeleton: a skeleton back is planned like any other
      else if (repaired?.brief) {
        const plan = await planTasks(engine, goal, ctx, repaired.brief);
        parsed = plan ? mergePlan(repaired.brief, plan) : unplanned(repaired.brief);
      } else store.append({ type: 'engine.note', goalId: goal.id, payload: { level: 'warn', message: `coverage repair did not return a valid Brief; keeping the first one (${missing.map((a) => a.name).join(', ')} uncovered)` } });
    }
  }

  // the Clarifier's verdict wins over the pre-classification, but never over a nature the user chose
  if (parsed && ctx.wasAuto && parsed.nature !== ctx.nature) {
    store.append({ type: 'goal.nature_set', goalId: goal.id, payload: { nature: parsed.nature, reason: ctx.nature === 'auto' ? 'clarifier verdict' : `clarifier verdict (over pre-classification: ${ctx.nature})` } });
  }
  let brief: Brief;
  const decisions = interviewDecisions(iv);
  if (parsed) {
    brief = toBrief(goal, parsed, [...decisions, ...ctx.extraQuestions]);
    // still uncovered after the repair turn: leave the gap to the human (Draft on the Brief page, or delete the Area)
    for (const a of uncoveredAreas(brief)) {
      brief.questions.push({ id: newId('q'), text: `Area "${a.name}" has no tasks yet. Use "Draft tasks for this Area" on the Brief page, or delete the Area if this goal does not cover it.`, answer: null, blocking: false, areaKey: a.key, options: [], kind: 'text', applied: false });
    }
  } else {
    brief = {
      goalId: goal.id,
      title: '',
      understanding: result.finalText ?? `(clarifier ended with ${result.subtype}${result.errorMessage ? ': ' + result.errorMessage : ''})`,
      areas: [{ key: 'A1', name: 'General', slug: 'general', description: '' }],
      assumptions: [],
      checks: [],
      tasks: [{ key: 'T1', title: goal.title, spec: goal.prompt, kind: 'feature', scope: null, scenario: 'general', areaKey: 'A1', tdd: 'inherit', dependsOnKeys: [], parallelizable: false, relevantFiles: [], milestone: null }],
      costEstimateUsd: 0,
      timeEstimateMin: 0,
      run: null,
      apps: null,
      styleOptions: [],
      questions: [
        ...decisions,
        ...ctx.extraQuestions,
        { id: newId('q'), text: 'The clarifier could not produce a structured Brief. Edit the tasks and checks manually, then answer "ok" here.', answer: null, blocking: true, areaKey: null, options: [], kind: 'text', applied: false },
      ],
    };
  }
  if (iv) store.append({ type: 'interview.finished', goalId: goal.id, payload: { rounds: iv.rounds.length, reason: iv.rounds.at(-1)?.finish ? 'human' : iv.rounds.length === 0 ? 'nothing_to_ask' : iv.rounds.length >= INTERVIEW_MAX_ROUNDS ? 'cap' : 'brief' } });
  store.append({ type: 'brief.proposed', goalId: goal.id, payload: { brief } });
  store.append({ type: 'goal.state_changed', goalId: goal.id, payload: { from: 'clarifying', to: 'awaiting_brief_approval', reason: 'brief proposed' } });
}

const TECH_STACK_SECTION = `This repository has no code yet, so there is nothing to discover — the tech stack is the human's decision, not yours to assume. Unless the goal (or a Decision above) already names the stack, include exactly ONE blocking question choosing it: propose 2–4 concrete, complete stack options suited to this goal (e.g. "Next.js + Prisma + Postgres", "NestJS API + React SPA", "Laravel + MySQL", a Bun/Node monorepo …) in the question's \`options\`, with YOUR recommended option FIRST. Plan the tasks assuming that recommended option, and make the first task scaffold the project (initialise the chosen stack, package manifest, build/test commands) — every other task depends on it. Must checks may only use commands that will exist once that scaffold task is done.`;

/** what every media task's spec and checks must say: where files go, parallel generation, the manifest, how they are judged */
function mediaConventions(kind: 'image' | 'video', ffprobe: boolean): string {
  return `Conventions every media task's spec MUST state verbatim:\n- generated files go to \`artifacts/\` in the workspace (the engine keeps that folder out of git)\n- independent artifacts are generated IN PARALLEL (launch the generation calls together, e.g. background jobs), never one after another; at most one regeneration pass per artifact\n- the task also writes its manifest \`docs/artifacts/<task-slug>.md\` (committed): one bullet per artifact — file name, what it shows, and the prompt/parameters used\nAcceptance: reviewer checks whose rubric judges the manifest AND the artifacts themselves (the reviewer opens image files to look at them)${kind === 'video' ? `; add a must command check verifying each video with ffprobe (duration, resolution)${ffprobe ? '' : ' — ffprobe is NOT installed on this machine, so use a plain file-exists check instead'}` : ''}. Command checks otherwise only verify objective facts (files exist, counts).`;
}

/**
 * The nature rules that shape a plan, for the planner: how tasks are cut and checked per kind of goal. The Clarifier's
 * own decisions (the nature, style directions, a stack question) are settled in the Brief it receives.
 */
function plannerNatureSection(goal: Goal, emptyRepo: boolean): string {
  const ffprobe = Bun.which('ffprobe') != null;
  const scaffold = '# Empty repository\nThere is no code yet. The Brief records the tech stack (as a question or an assumption): make the FIRST task scaffold that stack (package manifest, build and test commands) and make every other task depend on it. Checks may only use commands that exist once it is done.';
  const docs = '# Documents\nOne writing task per document or chapter (scenario `docs`). Checks are reviewer rubrics (audience, structure, tone, completeness, factual grounding) or objective file checks; never build/test/lint.';
  const research = '# Research\nInvestigation tasks (scenario `research`) whose output is cited markdown reports committed to the repository. Checks: reviewer rubrics verifying sources are cited and conclusions follow from them, plus checks that the report files exist; never build/test/lint.';
  const media = (kind: 'image' | 'video') => `# Media: ${kind}\nTasks per deliverable batch (scenario \`${kind}\`), following the style direction the Brief recommends. ${mediaConventions(kind, ffprobe)} Never build/test/lint checks.`;
  const nature = goal.nature;
  if (nature === 'docs') return docs;
  if (nature === 'research') return research;
  if (nature === 'image' || nature === 'video') return media(nature);
  if (nature === 'code') return emptyRepo ? scaffold : '';
  return [`# Plan by the Brief's nature\nThe Brief sets \`nature\`; follow the rules below that match it.`, emptyRepo ? scaffold : '', docs, research, media('image'), media('video')].filter(Boolean).join('\n\n');
}

/** Nature-specific planning rules. Auto goals get the conditional form: judge the nature first, then apply its rules. */
function natureSection(goal: Goal, emptyRepo: boolean, imageGen = true): string {
  const ffprobe = Bun.which('ffprobe') != null;
  const styleAsk = `\nAlso output 2–4 \`styleOptions\` — distinct visual directions the human can SEE before any generation starts: real hex palette, 1–3 typefaces, 3–6 style keywords, one or two sentences on feel/composition; YOUR recommendation FIRST. Plan the tasks assuming the recommended direction.`;
  const noBackend = `\n- IMPORTANT: no image-generation backend is configured on this machine (sessions have no OPENAI_API_KEY), so workers cannot call a generation API — at best they hand-author SVG/HTML and render it, at noticeably lower fidelity. Record this as an explicit assumption (e.g. "No AI image backend is configured; image deliverables will be hand-authored SVG renders") so the human can reject it and configure a key in Settings → Tools before approving the plan.`;
  const media = (kind: 'image' | 'video') =>
    `# Nature: ${kind}\nThis goal produces media files, not software. Set \`nature: "${kind}"\` and plan tasks per deliverable batch (scenario \`${kind}\`).${styleAsk}${kind === 'image' && !imageGen ? noBackend : ''}\n${mediaConventions(kind, ffprobe)} Never ask about tech stacks and never propose build/test/lint checks.`;
  const docs = `# Nature: documents\nThis goal produces prose, not software. Set \`nature: "docs"\` and plan writing tasks (scenario \`docs\`), one per document or chapter; Areas are documents or audiences, not apps. Acceptance: reviewer checks with a precise rubric (audience, structure, tone, completeness, factual grounding); command checks only for objective facts (a file exists, links resolve). Never ask about tech stacks and never propose build/test/lint checks.`;
  const research = `# Nature: research\nThis goal produces knowledge. Set \`nature: "research"\` and plan investigation tasks (scenario \`research\`) whose output is cited markdown reports committed to the repository; Areas are questions or topics. Every claim needs a source; acceptance: reviewer checks whose rubric verifies sources are cited and conclusions follow from them, plus command checks that the report files exist. Never ask about tech stacks and never propose build/test/lint checks.`;
  switch (goal.nature) {
    case 'docs':
      return docs;
    case 'research':
      return research;
    case 'image':
      return media('image');
    case 'video':
      return media('video');
    case 'code':
      return [emptyRepo ? `# Empty repository\n${TECH_STACK_SECTION}` : '', `# Style directions for UI goals\nWhen this goal's main deliverable is a user interface (a landing page, a product UI), also output 2–4 \`styleOptions\` (real hex palette, typefaces, keywords, a one-line feel; recommendation first) so the human can SEE the direction before work starts. Skip them for backend/tooling goals.`]
        .filter(Boolean)
        .join('\n\n');
    case 'auto':
      return [
        `# Judge the nature first\nThe user did not say what kind of goal this is. Decide from the prompt and set \`nature\` accordingly: code (software), docs (prose), research (a cited report), image or video (media files). Then follow the matching rules:\n- code${emptyRepo ? `, empty repository: ${TECH_STACK_SECTION}` : ': explore the repo as below.'}\n- docs / research / image / video: apply the corresponding section below and ignore build/test/stack concerns entirely.`,
        docs,
        research,
        media('image'),
        media('video'),
      ].join('\n\n');
  }
}

function buildClarifyPrompt(goal: Goal, overview: string | null, skillsHint: string | null = null, attachments = '', decisions = '', emptyRepo = false, imageGen = true, interview: number | null = null, previous = ''): string {
  return [
    interview ? interviewSection(interview) : '',
    `# Goal from the user\n${goal.prompt}`,
    decisions ? `${decisions}\nTreat these as settled: plan with them, record them as assumptions, and do not ask about them again.` : '',
    previous,
    natureSection(goal, emptyRepo, imageGen),
    attachments ? `${attachments}\nWhen an attachment matters for a specific task, name it (by file name) in that task's spec.` : '',
    overview ? `# Repository overview\n${overview}` : '',
    skillsHint ?? '',
    `# Your job\nExplore this repository (read-only) enough to understand how the goal should be implemented here: build/test commands, conventions, the files involved. Then write the Brief as JSON matching the schema — everything except the task plan: a planner session splits the goal into tasks right after you, from your Brief and your \`planningNotes\`. Do not write tasks.\n\nRequirements for the Brief:\n- **Areas first.** Read the goal and every attachment and enumerate the parts of the product it covers: one Area per user-facing role or app it names (e.g. student portal, teacher portal, school admin, system admin), plus a \`shared\` Area for groundwork all of them need (data model, auth, layout). A small goal has exactly one Area. Every Area listed in your understanding MUST appear in \`areas\`; the planner gives each at least one task.\n- **\`goalChecks\`** verify the merged result. *Must* = ONLY what the user explicitly asked for plus the repo's existing quality gates (its test/typecheck/lint/build commands, if any); every command must be a real command that works in this repo from its root. *Stretch* = improvements you propose on top (docs, edge-case tests, performance, accessibility…); never fold them into must. Give a check that verifies one Area that Area's \`areaKey\`.\n- **\`planningNotes\`** carry what the planner needs and should not have to rediscover: per Area, the files and modules involved and where new code goes; the build, test and lint commands; conventions (naming, test layout, the language of commit messages); what must exist before what; risks; and how the rules above shape the tasks (scaffolding first in an empty repository, deliverable batches for media). Facts and constraints, not a task list; a few hundred words.\n- Prefer assumptions over questions. A question is blocking only if a wrong guess would waste the whole goal.\n- \`title\` is one Conventional Commits header for the whole goal (e.g. \`feat(site): add resort landing page\`) — it becomes the PR title. Write it in the language of the repository's recent commits (see the overview); default to English.`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** The planner's prompt: what the Clarifier learned and wrote, and the rules for splitting it into tasks. */
export function buildPlannerPrompt(goal: Goal, skeleton: BriefSkeleton, c: { overview: string | null; attachments: string; decisions: string; interview: Interview | null; emptyRepo: boolean; imageGen: boolean; previous: string; plannerHint: string | null }): string {
  const { planningNotes, ...brief } = skeleton;
  const answers = c.interview ? interviewAnswers(c.interview) : [];
  return [
    `# Goal from the user\n${goal.prompt}`,
    c.decisions ? `${c.decisions}\nThese are settled: plan with them.` : '',
    answers.length ? `# The human's answers in the interview (settled)\n${answers.map(({ question, answer }) => `- ${question.text}\n  A: ${answer}`).join('\n')}` : '',
    c.previous,
    plannerNatureSection({ ...goal, nature: skeleton.nature ?? goal.nature }, c.emptyRepo),
    c.attachments,
    c.overview ? `# Repository overview\n${c.overview}` : '',
    `# The Brief from the Clarifier\nAreas, assumptions and goal-level checks are settled; plan within them.\n\`\`\`json\n${JSON.stringify(brief, null, 1)}\n\`\`\``,
    `# Planning notes from the Clarifier\n${planningNotes}`,
    c.plannerHint ?? '',
    `# Your job\nSplit the goal into tasks for EVERY Area of the Brief and return the plan as JSON matching the schema: \`tasks\`, their task-level \`checks\`, and the estimate (\`costEstimateUsd\`, \`timeEstimateMin\`). The notes above are the Clarifier's findings: read the repository (read-only) only where they leave a file, command or convention open. Do not interview anyone and do not change files.\n- Put the test/typecheck/lint commands on the task that must make them pass (the goal-level checks above already verify the merged result); a task whose result is judged rather than run gets a reviewer check with a precise rubric.\n- Mark 1–3 \`milestone\` tasks after which a person can see or try something for the first time; null for every other task.\n- Each task's \`title\` is its Conventional Commits subject: imperative, ≤ 60 chars, no trailing period, no type prefix, in the language of the repository's recent commits; \`scope\` defaults to the Area's slug.\nOutput the JSON only.`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

/**
 * How far the Clarifier probes at each interview depth. The depth sets how thoroughly it thinks and asks, not how many
 * rounds it takes: a deep interview of a small goal can still end after one round.
 */
const DEPTH_RULES: Record<number, string> = {
  1: 'Depth 1 of 5 (light): ask only what a wrong guess would waste the goal over; everything else is an assumption. Zero rounds is right whenever the goal can be planned safely.',
  2: 'Depth 2 of 5: ask what a wrong guess would waste the goal over, and the scope trade-offs the human would want to make; details are assumptions. Zero rounds is right for a small, unambiguous goal.',
  3: 'Depth 3 of 5 (standard): ask the decisions that shape the result — scope, behaviour, the trade-offs a person would want a say in; small details are assumptions. Zero rounds is right for a small, unambiguous goal.',
  4: 'Depth 4 of 5 (thorough): besides the decisions that shape the result, ask about edge cases, empty and error states, data rules, permissions and what each screen or command shows. The human asked to be interviewed: ask at least one round unless there is truly nothing a person could decide.',
  5: 'Depth 5 of 5 (to the bottom): leave nothing a person could decide to an assumption. Walk every area of the goal — behaviour, each screen\'s content and interactions, edge cases, empty and error states, data and migrations, permissions, performance, security, accessibility, rollout — and keep asking, round after round, as each answer opens the next decision, until nothing is left or the human says enough. Ask at least two rounds unless the goal truly has nothing left to decide. Assumptions are only for what the human declines to decide.',
};

/** The interview rules the Clarifier follows before writing the Brief (a grilling, with the human in the loop). */
function interviewSection(depth: number): string {
  return `# Interview before the Brief
You may ask the human questions in rounds before writing the Brief — the way a careful engineer interviews before planning. Facts are yours to find; decisions are theirs.
- Explore first. Never ask what the repository, the attachments or the goal already answer; every question cites what you found or could not find (\`reason\`).
- A round = every decision you can ask about NOW, whose prerequisites are settled — at most ${INTERVIEW_MAX_QUESTIONS}, the most consequential first. A question that depends on an answer you have not heard yet waits for the next round; when a question follows from an earlier answer, name it in \`dependsOn\`.
- Every question offers 2–4 concrete options with YOUR recommendation first (free text stays possible). \`blocking\` = a wrong guess would waste the goal; everything else is an assumption the human may correct.
- How deep to go: ${DEPTH_RULES[Math.min(5, Math.max(1, depth))]}
- When nothing is left to ask at this depth — or the human says enough — write the Brief: the answers become Decisions, the rest assumptions. (A hard stop at ${INTERVIEW_MAX_ROUNDS} rounds exists only as a safety net.)
- Output per turn: either \`{"questions": [...], "brief": null}\` to ask a round, or \`{"questions": [], "brief": {...}}\` with the Brief. Write questions in the language of the goal.`;
}

export function coverageRepairMessage(missing: { key: string; name: string }[], output: 'plan' | 'Brief' = 'plan'): string {
  return `The Area(s) ${missing.map((a) => `"${a.name}" (${a.key})`).join(', ')} got no task. Add 1–6 tasks (with their checks, areaKey set) for each of them; every Area must have at least one. Output the complete ${output} JSON again, nothing else.`;
}

/** Map an LLM check (flat) to a BriefCheck spec. Shared by Clarify and Draft. */
export function materializeCheck(c: { type: 'command' | 'reviewer'; cmd?: string | null; rubric?: string | null; name: string }, taskKey: string | null): Brief['checks'][number]['spec'] {
  return c.type === 'command' ? { type: 'command', cmd: c.cmd ?? 'true', timeoutMs: 300_000, expectExitCode: 0 } : { type: 'reviewer', scope: taskKey ? 'task-diff' : 'goal-diff', rubric: c.rubric ?? c.name };
}

export function toBrief(goal: Goal, o: BriefOutput, extraQuestions: Brief['questions']): Brief {
  const areaKeys = new Set(o.areas.map((a) => a.key));
  const area = (k: string | null | undefined) => (k && areaKeys.has(k) ? k : null);
  const styleOptions = (o.styleOptions ?? []).map((s) => ({ key: s.key, name: s.name, palette: s.palette ?? [], fonts: s.fonts ?? [], keywords: s.keywords ?? [], description: s.description ?? '', samples: [] as string[], chosenSample: null as string | null }));
  // a Follow-up that kept its predecessor's style: when this goal has a look at all, that direction comes first and is already picked
  const kept = goal.follows?.style ?? null;
  if (kept && styleOptions.length && !styleOptions.some((s) => s.name === kept.name)) styleOptions.unshift({ ...kept, key: styleOptions.some((s) => s.key === kept.key) ? `${kept.key}-kept` : kept.key, samples: [], chosenSample: null });
  const keptAnswer = kept && styleOptions.some((s) => s.name === kept.name) ? kept.name : null;
  return {
    goalId: goal.id,
    title: o.title?.trim() ?? '',
    understanding: o.understanding,
    areas: o.areas.map((a) => ({ key: a.key, name: a.name, slug: a.slug, description: a.description ?? '' })),
    assumptions: o.assumptions.map((text) => ({ id: newId('as'), text, accepted: true, applied: false })),
    checks: o.checks.map((c) => ({ key: c.key, name: c.name, tier: c.tier, taskKey: c.taskKey ?? null, areaKey: c.taskKey ? null : area(c.areaKey), spec: materializeCheck(c, c.taskKey ?? null) })),
    tasks: o.tasks.map((t) => ({ key: t.key, title: t.title, spec: t.spec, kind: t.kind ?? 'feature', scope: t.scope ?? null, scenario: t.scenario ?? 'general', areaKey: area(t.areaKey), tdd: 'inherit', dependsOnKeys: t.dependsOnKeys, parallelizable: t.parallelizable, relevantFiles: t.relevantFiles, milestone: t.milestone ?? null, difficulty: t.difficulty ?? 'standard' })),
    costEstimateUsd: o.costEstimateUsd,
    run: o.run ?? null,
    apps: o.apps ?? null,
    timeEstimateMin: o.timeEstimateMin,
    questions: [
      ...extraQuestions,
      ...(o.openQuestions ?? []).map((q) => ({ id: newId('q'), text: q.text, answer: null, blocking: q.blocking, areaKey: area(q.areaKey), options: q.options ?? [], kind: 'text' as const, applied: false })),
      // the style question is engine-generated (never left to the LLM to remember): its options are the proposal names, recommendation first
      ...(styleOptions.length
        ? [{ id: newId('q'), text: 'Which style direction should the deliverables follow? Pick a card — you can generate a sample image for any of them before deciding.', answer: keptAnswer, blocking: true, areaKey: null, options: styleOptions.map((s) => s.name), kind: 'style' as const, applied: !!keptAnswer }]
        : []),
    ],
    styleOptions,
  };
}

export { IdPrefix };
