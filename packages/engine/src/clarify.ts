import { join } from 'node:path';
import type { Brief, Goal, GoalNature, Interview, InterviewQuestion, InterviewRound, TaskScenario } from '@foundry/core';
import { renderCompanions } from './companions.ts';
import { BriefOutput, BriefSkeleton, INTERVIEW_MAX_QUESTIONS, PlanOutput, INTERVIEW_MAX_ROUNDS, IdPrefix, InterviewOutput, getBrief, getGoal, interviewAnswers, interviewDepth, interviewNotes, mergeSubjects, newId, noteQuestion, planOutputSchema, uncoveredAreas } from '@foundry/core';
import { delegationContext } from './delegation.ts';
import { learningsContext } from './learnings.ts';
import type { RunHandle, RunResult } from '@foundry/runner';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { attachmentsDir, markitdownHint, renderAttachments } from './attachments.ts';
import { tryJson } from './checks/reviewer.ts';
import { metaFor, modelFor } from './models/roles.ts';
import type { Engine } from './engine.ts';
import { git, isDirty } from './git/git.ts';
import { READONLY_DISALLOWED, READONLY_TOOLS, boundarySettings } from './guards/boundary.ts';
import { memoryQuestion, memorySection } from './memory/prompt.ts';
import { hasStackManifest } from './skills/autoskills.ts';
import { startSentence } from './follow-up.ts';
import { readdirSync } from 'node:fs';
import { resolveDiscipline } from './skills/workflow.ts';
import { renderReferences } from './references.ts';
import { subjectsFromClarifier } from './subjects.ts';

/** Files that do not make a repository "have code": a freshly initialised repo may carry any of these. */
const EMPTY_REPO_IGNORE = new Set(['.git', '.claude', '.agents', '.DS_Store', 'graphify-out', 'CLAUDE.md', 'AGENTS.md', 'README.md', '.gitignore', '.gitattributes', 'LICENSE', 'docs']);

/** The scenario that filters clarifier/planner skill hints for a nature; undefined = no filter (code and unclassified goals). */
export function natureScenario(nature: GoalNature): TaskScenario | undefined {
  return nature === 'docs' || nature === 'research' || nature === 'image' || nature === 'video' || nature === 'cad' ? nature : undefined;
}

const NatureVerdict = z.object({ nature: z.enum(['code', 'docs', 'research', 'image', 'video', 'cad']) });

/**
 * One cheap single-turn call that classifies an `auto` goal's nature BEFORE the Clarify prompt is built,
 * so the prompt sections and skill hints match the goal (a poster goal should never be handed
 * codebase-design). Null on any failure — Clarify then runs with the judge-it-yourself sections.
 */
async function classifyNature(engine: Engine, goal: Goal, ws: string, cad: boolean): Promise<GoalNature | null> {
  try {
    // cad is offered only where text-to-cad is installed: a goal that needs it on another machine is code work
    const { handle, untrack } = await startSession(engine, goal, 'clarifying', () =>
      engine.runner.run({
      prompt: `Classify what this goal produces. code = software changes; docs = prose/documents; research = an investigation ending in a cited report; image = generated/edited images; video = generated/edited video or audio${cad ? '; cad = 3D parts or assemblies (STEP/STL/3MF), engineering drawings, DXF cut profiles or robot description files (URDF/SDF)' : ''}. Pick the dominant one for mixed goals.\n\n# Goal\n${goal.prompt.slice(0, 4000)}`,
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
      lane: 'interactive',
      }),
    );
    try {
      for await (const ev of handle.events) engine.broadcast({ goalId: goal.id, taskId: null, attemptId: `clarify-${goal.id}`, event: ev, ts: new Date().toISOString() });
      const r = await handle.result;
      engine.store.append({ type: 'goal.cost_added', goalId: goal.id, payload: { costUsd: r.costUsd, source: 'clarify' } });
      engine.recordSessionUsage(r, { goalId: goal.id, kind: 'clarify', model: goal.models.cheap });
      const parsed = NatureVerdict.safeParse(r.structuredOutput ?? tryJson(r.finalText));
      if (!parsed.success) return null;
      return parsed.data.nature === 'cad' && !cad ? 'code' : parsed.data.nature;
    } finally {
      untrack();
    }
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
  /** text-to-cad installed for this goal: a cad verdict stands; without it, cad work is code work */
  cadAvailable: boolean;
  /** engine-made questions (dirty repo …) that ride into the Brief */
  extraQuestions: Brief['questions'];
  run: (p: string, resume?: string) => Promise<RunHandle>;
  planner: { model: string; run: (skeleton: BriefSkeleton, resume?: { sessionId: string; message: string }) => Promise<RunHandle> };
}

async function prepareClarify(engine: Engine, goal: Goal): Promise<ClarifyContext> {
  const { store, config } = engine;
  const extraQuestions: Brief['questions'] = [];
  // a Delegated goal starts from the main goal's branch, not from the checkout: its dirt was the main goal's question
  if (!goal.delegatedFrom && (await isDirty(goal.repoPath).catch(() => false))) {
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
  // text-to-cad installed for this goal's coding agent: cad can be offered, judged and planned (asked once for the whole run)
  const cadAvailable = await engine.cadAvailable(goal);
  // auto goals: settle the nature BEFORE building the prompt, so its sections and skill hints match the goal. The
  // classification (a short model call) and the repository overview (graphify may build its graph first) run side by side.
  const wasAuto = goal.nature === 'auto';
  let nature = goal.nature;
  const [verdict, base, log] = await Promise.all([
    wasAuto ? classifyNature(engine, goal, ws, cadAvailable) : Promise.resolve(null),
    engine.context
      .prepare(ws)
      .catch((err) => config.log(`[clarify] context prepare failed: ${err}`))
      .then(() => engine.context.overview(ws).catch(() => null)),
    // recent commit subjects: the clarifier matches their language and style for task titles
    git(['log', '--no-merges', '--format=%s', '-n', '8', '--', '.'], ws).catch(() => null),
  ]);
  if (wasAuto && verdict) {
    nature = verdict;
    store.append({ type: 'goal.nature_set', goalId: goal.id, payload: { nature: verdict, reason: 'pre-clarify classification' } });
  }
  let overview = base;
  const sync = getGoal(store.db, goal.id)?.baseSync;
  if (sync && sync.startedFrom === 'remote') overview = `${overview ?? ''}\n\n## Base branch\nThis checkout is ${sync.remote}/${sync.base} (${sync.behind} commit(s) newer than the local ${sync.base}).`.trim();
  if (log && log.code === 0 && log.stdout.trim()) overview = `${overview ?? ''}\n\n## Recent commits\n${log.stdout.trim()}`.trim();

  const scenario = natureScenario(nature);
  const [clarifierHint, plannerHint] = await Promise.all([engine.skillsFor(goal).hints.sectionFor('clarifier', { profile: engine.workflowProfileOf(goal), scenario }), engine.skillsFor(goal).hints.sectionFor('planner', { profile: engine.workflowProfileOf(goal), scenario, discipline: resolveDiscipline(goal, null) })]);
  // a re-run keeps the human's Decisions from the discarded Brief
  const reclarified = store.listByGoal(goal.id, 5000).filter((e) => e.type === 'goal.reclarified').at(-1);
  const decisions = reclarified ? ((reclarified.payload as { decisions?: string }).decisions ?? '') : '';
  // a Follow-up: the earlier goal's snapshot, plus where this checkout actually started (recorded by the Base Sync)
  const synced = getGoal(store.db, goal.id) ?? goal;
  const followUp = goal.follows?.context ? [goal.follows.context, startSentence(synced)].filter(Boolean).join('\n') : '';
  // a Delegated goal: the main goal, what was decided there, and what the steps before it delivered
  // what the goal follows, what it is part of, what earlier goals in this folder learned (ADR-0040), and what the folder's
  // Memory says about goals like it (ADR-0071; the planner is given the same answer)
  const [recalled, aboutPerson] = await Promise.all([
    engine.memory.reflect('clarify', memoryQuestion('clarify', { goalTitle: goal.title, goalPrompt: goal.prompt }), { repoPath: goal.repoPath, goalId: goal.id }),
    // and what the person's own bank says about them: how they decide, what they ask for in every project
    engine.memory.reflectPerson(memoryQuestion('person', { goalTitle: goal.title, goalPrompt: goal.prompt }), { repoPath: goal.repoPath, goalId: goal.id }),
  ]);
  const previous = [followUp, delegationContext(engine, goal), learningsContext(engine, goal), recalled ? memorySection(recalled.text, { tools: false, kind: recalled.kind }) : '', aboutPerson ? memorySection(aboutPerson.text, { tools: false, about: 'person', kind: aboutPerson.kind }) : ''].filter(Boolean).join('\n\n');
  const prompt = buildClarifyPrompt({ ...goal, nature }, overview, clarifierHint, [renderAttachments(goal, config.dataDir), markitdownHint(engine.markitdown.available(), engine.markitdown.binary())].filter(Boolean).join('\n\n'), decisions, isEmptyRepo(ws), engine.imageGenAvailable(), goal.interview ? interviewDepth(goal.interview) : null, previous, cadAvailable);
  const addDirs = goal.attachments.length ? [attachmentsDir(config.dataDir, goal.id)] : undefined;
  const schema = zodToJsonSchema(goal.interview ? InterviewOutput : BriefSkeleton, { $refStrategy: 'none' });
  const transcriptPath = join(config.dataDir, 'transcripts', `clarify-${goal.id}.jsonl`);
  const classifiedGoal = { ...goal, nature };
  const clarifierModel = modelFor(config, classifiedGoal, 'clarifier');
  const codex = (goal.provider ?? config.provider) !== 'claude'; // no Skill tool: skills are read from their SKILL.md
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
      // a person waits for it: one slot beyond the limit, before queued work
      lane: 'interactive',
    });
  const plannerModel = modelFor(config, classifiedGoal, 'planner');
  const planner = {
    model: plannerModel.model,
    run: (skeleton: BriefSkeleton, resume?: { sessionId: string; message: string }) =>
      engine.runner.run({
        prompt: resume ? resume.message : buildPlannerPrompt({ ...goal, nature }, skeleton, { overview, attachments: renderAttachments(goal, config.dataDir), decisions, interview: goal.interview, emptyRepo: isEmptyRepo(ws), imageGen: engine.imageGenAvailable(), previous, plannerHint, delegation: goal.delegation.allow }),
        cwd: ws,
        model: plannerModel.model,
        meta: metaFor(goal.id, plannerModel),
        maxTurns: PLANNER_MAX_TURNS,
        maxBudgetUsd: PLANNER_MAX_BUDGET_USD,
        permissionMode: 'dontAsk',
        allowedTools: READONLY_TOOLS,
        disallowedTools: READONLY_DISALLOWED,
        appendSystemPromptFile: engine.roles.path('planner'),
        // the `goal` kind is offered only where the goal allows delegation
        jsonSchema: zodToJsonSchema(planOutputSchema(goal.delegation.allow), { $refStrategy: 'none' }),
        settings: boundarySettings(config.hooksDir),
        settingSources: config.settingSources,
        strictMcp: true,
        addDirs,
        resumeSessionId: resume?.sessionId,
        timeoutMs: 20 * 60_000,
        idleTimeoutMs: 10 * 60_000,
        transcriptPath: join(config.dataDir, 'transcripts', `planner-${goal.id}.jsonl`),
        label: `planner ${goal.title}`,
        lane: 'interactive',
      }),
  };
  return { ws, prompt, wasAuto, nature, cadAvailable, extraQuestions, run, planner };
}

/**
 * The planner session: the task plan for every Area of the Clarifier's Brief, with task-level checks and the estimate,
 * written once (the Clarifier never re-types it). An Area left without tasks gets one repair turn in the same session.
 * null when no usable plan came back.
 */
async function planTasks(engine: Engine, goal: Goal, ctx: ClarifyContext, skeleton: BriefSkeleton): Promise<PlanOutput | null> {
  const { store } = engine;
  const run = async (resume?: { sessionId: string; message: string }): Promise<{ plan: PlanOutput | null; result: RunResult }> => {
    const { handle, untrack } = await startSession(engine, goal, 'planning', () => ctx.planner.run(skeleton, resume));
    try {
      for await (const ev of handle.events) engine.broadcast({ goalId: goal.id, taskId: null, attemptId: `clarify-${goal.id}`, event: ev, ts: new Date().toISOString() });
      const result = await handle.result;
      store.append({ type: 'goal.cost_added', goalId: goal.id, payload: { costUsd: result.costUsd, source: 'planner' } });
      engine.recordSessionUsage(result, { goalId: goal.id, kind: 'planner', model: ctx.planner.model });
      const parsed = PlanOutput.safeParse(result.structuredOutput ?? tryJson(result.finalText));
      return { plan: parsed.success && !result.isError ? parsed.data : null, result };
    } finally {
      untrack();
    }
  };
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

/** the planner's part of a Brief, empty: what a skeleton is stored with until the plan arrives */
const EMPTY_PLAN: PlanOutput = { tasks: [], checks: [], costEstimateUsd: 0, timeEstimateMin: 0 };

/**
 * The planner's tasks, task-level checks and estimate filled into the Brief as it stands (the skeleton, with whatever
 * the person edited meanwhile): understanding, Areas, assumptions, questions and goal-level checks are kept as they
 * are. A task of an Area the person deleted meanwhile is dropped with its checks; task check keys stay unique against
 * the kept goal-level ones. No plan: one task per Area and a blocking question, so the person sees why.
 */
export function fillPlan(goal: Goal, current: Brief, skeleton: BriefSkeleton, plan: PlanOutput | null): Brief {
  const areas = new Set(current.areas.map((a) => a.key));
  const planned: PlanOutput = plan ?? {
    tasks: current.areas.map((a, i) => ({ key: `T${i + 1}`, title: `build ${a.name}`.slice(0, 60), spec: `${a.description}\n\n${skeleton.planningNotes}`, kind: 'feature' as const, scenario: 'general' as const, areaKey: a.key, dependsOnKeys: [], parallelizable: false, relevantFiles: [], difficulty: 'standard' as const })),
    checks: [],
    costEstimateUsd: 0,
    timeEstimateMin: 0,
  };
  const tasks = planned.tasks.filter((t) => !t.areaKey || areas.has(t.areaKey));
  // the plan as a Brief holds it, against the Areas as they are now; goal-level checks, questions and style come from `current`
  const merged = toBrief(goal, mergePlan({ ...skeleton, areas: current.areas, goalChecks: [], openQuestions: [], styleOptions: [], subjects: [] }, { ...planned, tasks }), []);
  const used = new Set(current.checks.filter((c) => c.taskKey === null).map((c) => c.key));
  const taskChecks = merged.checks.filter((c) => c.taskKey !== null).map((c) => ({ ...c, key: claim(used, c.key) }));
  const brief: Brief = { ...current, tasks: merged.tasks, checks: [...current.checks.filter((c) => c.taskKey === null), ...taskChecks], costEstimateUsd: merged.costEstimateUsd, timeEstimateMin: merged.timeEstimateMin };
  if (!plan) brief.questions = [...brief.questions, { id: newId('q'), text: 'The planner could not split this goal into tasks, so each Area is one task for now. Draft tasks for an Area on this page, or edit them, then answer "ok" here.', answer: null, blocking: true, areaKey: null, options: [], kind: 'text', applied: false }];
  return brief;
}

/** the goal moved on while a session ran (cancelled, deleted): what the session returned is not written */
const gone = (engine: Engine, goalId: string): boolean => getGoal(engine.store.db, goalId)?.state !== 'clarifying';

/**
 * Start a session of the Clarify phase. The wait is recorded as a step of its own when every slot is taken (the goal
 * page shows it with a timer), the stage itself once the session has its slot — not again when it already shows, so a
 * repair turn does not restart the timer. The handle is tracked with the goal's background sessions, so cancelling the
 * goal kills it.
 */
async function startSession(engine: Engine, goal: Goal, stage: 'clarifying' | 'planning', start: () => Promise<RunHandle>): Promise<{ handle: RunHandle; untrack: () => void }> {
  const at = (s: 'queued' | 'clarifying' | 'planning') => {
    if (getGoal(engine.store.db, goal.id)?.clarifyStage?.stage !== s) engine.store.append({ type: 'clarify.stage', goalId: goal.id, payload: { stage: s } });
  };
  if (engine.runner.wouldQueue?.('interactive')) at('queued');
  const handle = await start();
  // cancelled while it waited for a slot (a waiting session cannot be killed, it has no process yet): killed as it starts
  if (gone(engine, goal.id)) handle.kill('killed_manual');
  else at(stage);
  return { handle, untrack: engine.trackBackground(goal.id, handle) };
}

/** a cad verdict without text-to-cad on this computer is code work; the Clarifier's verdict wins over the pre-classification, never over a nature the user chose */
function settleNature(engine: Engine, goal: Goal, ctx: ClarifyContext, o: Pick<BriefOutput, 'nature'>): void {
  if (o.nature === 'cad' && !ctx.cadAvailable) o.nature = 'code';
  if (ctx.wasAuto && o.nature !== ctx.nature) engine.store.append({ type: 'goal.nature_set', goalId: goal.id, payload: { nature: o.nature, reason: ctx.nature === 'auto' ? 'clarifier verdict' : `clarifier verdict (over pre-classification: ${ctx.nature})` } });
}

/**
 * Subjects: the ones the goal starts with (a main goal's, an earlier goal's) and those on the Brief before a Re-run
 * Clarify keep their pictures; the Clarifier's new ones follow, with the attached images it named as the person's pictures.
 */
function subjectsFor(engine: Engine, goal: Goal, parsed: Pick<BriefOutput, 'subjects'> | null): Brief['subjects'] {
  return mergeSubjects(goal.delegatedFrom?.subjects ?? goal.follows?.subjects ?? [], getBrief(engine.store.db, goal.id)?.brief.subjects ?? [], parsed ? subjectsFromClarifier(engine, goal, parsed.subjects) : []);
}

/** the interview is over once the Brief (or its skeleton) is written: recorded once, with why it ended */
function finishInterview(engine: Engine, goal: Goal): void {
  const iv = goal.interview;
  if (!iv || iv.status === 'done') return;
  engine.store.append({ type: 'interview.finished', goalId: goal.id, payload: { rounds: iv.rounds.length, reason: iv.rounds.at(-1)?.finish ? 'human' : iv.rounds.length === 0 ? 'nothing_to_ask' : iv.rounds.length >= INTERVIEW_MAX_ROUNDS ? 'cap' : 'brief' } });
}

/**
 * Skeleton first (ADR-0046): the Clarifier's Brief without its tasks is stored and shown at once, editable while the
 * planner splits the goal into tasks; the plan is then filled into the Brief as it stands, the person's edits kept.
 * null when the goal moved on meanwhile (cancelled): nothing is written then.
 */
async function planSkeleton(engine: Engine, goal: Goal, ctx: ClarifyContext, skeleton: BriefSkeleton, decisions: Brief['questions']): Promise<Brief | null> {
  const { store } = engine;
  settleNature(engine, goal, ctx, skeleton);
  const provisional = toBrief(goal, mergePlan(skeleton, EMPTY_PLAN), decisions);
  provisional.subjects = subjectsFor(engine, goal, skeleton);
  // nothing more is asked once the skeleton is written: the interview is over before the plan
  finishInterview(engine, goal);
  store.append({ type: 'brief.skeleton_proposed', goalId: goal.id, payload: { brief: provisional } });
  const plan = await planTasks(engine, goal, ctx, skeleton);
  if (gone(engine, goal.id)) return null;
  // the Brief as it stands now: the person may have edited it while the planner worked
  return fillPlan(goal, getBrief(store.db, goal.id)?.brief ?? provisional, skeleton, plan);
}

/** run one Clarify turn (fresh or resumed), streaming it to the goal's clarify channel and booking its cost */
async function turn(engine: Engine, goal: Goal, ctx: ClarifyContext, message: string, resume: string | undefined, source: string): Promise<RunResult> {
  const { handle, untrack } = await startSession(engine, goal, 'clarifying', () => ctx.run(message, resume));
  try {
    for await (const ev of handle.events) engine.broadcast({ goalId: goal.id, taskId: null, attemptId: `clarify-${goal.id}`, event: ev, ts: new Date().toISOString() });
    const result = await handle.result;
    engine.store.append({ type: 'goal.cost_added', goalId: goal.id, payload: { costUsd: result.costUsd, source } });
    engine.recordSessionUsage(result, { goalId: goal.id, kind: 'clarify', model: modelFor(engine.config, { ...goal, nature: ctx.nature }, 'clarifier').model });
    return result;
  } finally {
    untrack();
  }
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
    if (gone(engine, goal.id)) return; // cancelled while the workspace and the classification were prepared
    const result = await turn(engine, goal, ctx, ctx.prompt, undefined, 'clarify');
    await settle(engine, getGoal(store.db, goal.id)!, ctx, result);
  } catch (err) {
    store.append({ type: 'engine.note', goalId: goal.id, payload: { level: 'error', message: `clarify crashed: ${String((err as Error)?.stack ?? err)}` } });
    store.append({ type: 'goal.state_changed', goalId: goal.id, payload: { from: 'clarifying', to: 'failed', reason: `clarify crashed: ${String(err)}` } });
  } finally {
    engine.clarifying.delete(goal.id);
  }
}

/** a note is the human's words, kept whole; a novel is not */
export const INTERVIEW_NOTE_MAX = 4000;

/**
 * The human answered the open round: record it and continue the Clarify session in the background. Validation is
 * synchronous so the API can report it; the session's outcome arrives as the next round or the Brief. `note` is what
 * they wrote unasked (a correction, something the questions missed): it travels with the answers and becomes a Decision.
 */
export function answerInterview(engine: Engine, goal: Goal, answers: Record<string, string>, finish: boolean, note: string | null = null): void {
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
  const words = note?.trim().slice(0, INTERVIEW_NOTE_MAX) || null;
  // reserve before the event: the tick the event triggers must not start a second session
  engine.clarifying.add(goal.id);
  engine.store.append({ type: 'interview.round_answered', goalId: goal.id, payload: { round: round.round, answers: clean, finish, note: words } });
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

/** what the human wrote unasked with a round, as the Clarifier reads it: a Decision, whatever the questions were */
const noteSection = (note: string | null) => (note?.trim() ? `# Also from the human (unasked)\n${note.trim()}\nThis is a Decision like an answer: let it correct your understanding and shape the next round or the Brief.` : '');

/** a round's answers as the model reads them, the human's note after them (the interview's rounds and a Revise's alike) */
export function roundAnswers(round: InterviewRound): string {
  const lines = round.questions.map((q) => `- ${q.key}: ${q.text}\n  A: ${round.answers?.[q.key] ?? '(no answer — proceed on your recommendation and record it as an assumption)'}`);
  return [`# Round ${round.round} answers\n${lines.join('\n')}`, noteSection(round.note)].filter(Boolean).join('\n\n');
}

function answersMessage(iv: Interview, round: InterviewRound): string {
  return `${roundAnswers(round)}\n\n${closingInstruction(iv, round)}`;
}

/** the whole interview rendered for a fresh session */
function interviewSoFar(iv: Interview): string {
  const parts = iv.rounds.map((r) => [`## Round ${r.round}\n${r.questions.map((q) => `- ${q.key}: ${q.text}\n  A: ${r.answers?.[q.key] ?? '(no answer — proceed on your recommendation)'}`).join('\n')}`, r.note?.trim() ? `- Note from the human: ${r.note.trim()}` : ''].filter(Boolean).join('\n'));
  return `# Interview so far\nYou already asked these rounds in an earlier session and the human answered; do not ask them again.\n\n${parts.join('\n\n')}`;
}

/** interview answers and notes become Decisions in the Brief: every later session receives them, and Revise honours them */
function interviewDecisions(iv: Interview | null): Brief['questions'] {
  if (!iv) return [];
  return [
    ...interviewAnswers(iv).map(({ question, answer }) => ({ id: newId('q'), text: question.text, answer, blocking: false, areaKey: null, options: question.options, kind: 'text' as const, applied: true })),
    ...interviewNotes(iv).map(({ note }) => noteQuestion(newId('q'), note, true)),
  ];
}

/** a model's round as the goal keeps it: at most 8 questions, keys unique across the rounds so far, 4 options at most */
export function normalizeQuestions(iv: Pick<Interview, 'rounds'>, qs: InterviewOutput['questions']): InterviewQuestion[] {
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

  if (gone(engine, goal.id)) return; // cancelled while the session ran: its answer is not written
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

  if (gone(engine, goal.id)) return;

  // the interview's answers and notes, and the engine's own questions (a dirty checkout…), as the Brief's Decisions
  const decisions = [...interviewDecisions(iv), ...ctx.extraQuestions];
  let brief: Brief | null = null;
  if (out?.brief) {
    // the Clarifier wrote everything but the plan: the skeleton is shown at once, the planner adds the tasks
    brief = await planSkeleton(engine, goal, ctx, out.brief, decisions);
    if (!brief) return;
  } else if (out?.full) {
    let parsed = out.full;
    if (result.sessionId) {
      // a whole Brief (tasks included) from the Clarifier itself: it repairs an Area it left without tasks
      const missing = uncoveredAreas({ areas: parsed.areas, tasks: parsed.tasks });
      if (missing.length) {
        const r2 = await turn(engine, goal, ctx, coverageRepairMessage(missing, 'Brief'), result.sessionId, 'clarify-coverage');
        if (gone(engine, goal.id)) return;
        const repaired = parseTurn(r2.structuredOutput ?? tryJson(r2.finalText));
        if (repaired?.full) parsed = repaired.full;
        // the session's schema allows only the skeleton: a skeleton back is planned like any other
        else if (repaired?.brief) {
          brief = await planSkeleton(engine, goal, ctx, repaired.brief, decisions);
          if (!brief) return;
        } else store.append({ type: 'engine.note', goalId: goal.id, payload: { level: 'warn', message: `coverage repair did not return a valid Brief; keeping the first one (${missing.map((a) => a.name).join(', ')} uncovered)` } });
      }
    }
    if (!brief) {
      settleNature(engine, goal, ctx, parsed);
      brief = toBrief(goal, parsed, decisions);
      brief.subjects = subjectsFor(engine, goal, parsed);
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
        { id: newId('q'), text: 'The clarifier could not produce a structured Brief. Edit the tasks and checks manually, then answer "ok" here.', answer: null, blocking: true, areaKey: null, options: [], kind: 'text', applied: false },
      ],
    };
    brief.subjects = subjectsFor(engine, goal, null);
  }
  // still uncovered after the repair turn (or an Area added while the planner worked): leave the gap to the human
  for (const a of uncoveredAreas(brief)) {
    brief.questions.push({ id: newId('q'), text: `Area "${a.name}" has no tasks yet. Use "Draft tasks for this Area" on the Brief page, or delete the Area if this goal does not cover it.`, answer: null, blocking: false, areaKey: a.key, options: [], kind: 'text', applied: false });
  }
  finishInterview(engine, getGoal(store.db, goal.id) ?? goal);
  store.append({ type: 'brief.proposed', goalId: goal.id, payload: { brief } });
  store.append({ type: 'goal.state_changed', goalId: goal.id, payload: { from: 'clarifying', to: 'awaiting_brief_approval', reason: 'brief proposed' } });
}

const TECH_STACK_SECTION = `This repository has no code yet, so there is nothing to discover — the tech stack is the human's decision, not yours to assume. Unless the goal (or a Decision above) already names the stack, include exactly ONE blocking question choosing it: propose 2–4 concrete, complete stack options suited to this goal (e.g. "Next.js + Prisma + Postgres", "NestJS API + React SPA", "Laravel + MySQL", a Bun/Node monorepo …) in the question's \`options\`, with YOUR recommended option FIRST. Plan the tasks assuming that recommended option, and make the first task scaffold the project (initialise the chosen stack, package manifest, build/test commands) — every other task depends on it. Must checks may only use commands that will exist once that scaffold task is done.`;

/** what the Clarifier names when the result depicts real things: Foundry finds their pictures before the plan runs (ADR-0042) */
const SUBJECTS_ASK = `# Subjects: real things the result must look like
When the result depicts something that exists (a specific vehicle, building, landmark, product or artwork; never a person), name it in \`subjects\` (at most 3), precisely enough to search for pictures of exactly that one (make, model, generation or year), with \`lookFor\`: what must match (the proportions, the distinctive features, colours and materials). Foundry finds pictures of each before the plan runs, and every worker and reviewer compares against them. When the user attached pictures of it, list their file names in \`pictures\`. Leave \`subjects\` empty for invented designs, generic styles and anything that is not a physical thing.`;

/** the Subjects a goal starts with (a main goal's or an earlier goal's, with their pictures): named once, never again */
function keptSubjectsNote(goal: Goal): string {
  const kept = goal.delegatedFrom?.subjects ?? goal.follows?.subjects ?? [];
  if (!kept.length) return '';
  return `These Subjects are settled already, with their pictures (from ${goal.delegatedFrom ? 'the main goal' : 'the previous goal'}): ${kept.map((s) => `"${s.name}"`).join(', ')}. Do not name them again in \`subjects\`.`;
}

const subjectsSection = (goal: Goal) => [SUBJECTS_ASK, keptSubjectsNote(goal)].filter(Boolean).join('\n');

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
  if (nature === 'cad') return CAD_PLAN;
  if (nature === 'code') return emptyRepo ? scaffold : '';
  return [`# Plan by the Brief's nature\nThe Brief sets \`nature\`; follow the rules below that match it.`, emptyRepo ? scaffold : '', docs, research, media('image'), media('video'), CAD_PLAN].filter(Boolean).join('\n\n');
}

/** how a cad goal is cut: one task per part or assembly, geometry checks first, the robot files after the parts they describe */
const CAD_PLAN =
  '# CAD\nOne task per part or assembly (scenario `cad`); robot description files (URDF, SRDF, SDF) and drawings are tasks of their own, after the parts they describe. Each task delivers its build123d source in the repository (the repository\'s own layout, else `cad/`), its exports under `artifacts/` (STEP always; STL, 3MF, GLB, DXF or a drawing PDF when the Brief asks), front, top, right and isometric snapshots next to them, and a manifest entry under `docs/artifacts/` with the dimensions, process, material, checks and files. Exports and snapshots live only under `artifacts/`, kept out of git: this overrides the cad skill\'s example layout (`STEP/`, `STL/`, `snapshots/` beside the source), so checks name `artifacts/<part>.step` and never a tracked export folder. Checks: Python geometry checks (key dimensions, interference, wall thickness) as command checks, a DfAM or DFM check for the process the Brief names, and a reviewer rubric against the Brief\'s dimensions. A check or a committed script never reaches into the coding agent\'s plugin folder (`~/.claude/plugins/…`, `~/.codex/plugins/…`): that path carries the plugin\'s version and differs per machine, so a check that needs one of the skills\' tools (the DfAM measurer) runs a copy the task puts in the repository, licence kept. No web tech stacks; no build/test/lint checks beyond the geometry checks.';

/** Nature-specific planning rules. Auto goals get the conditional form: judge the nature first, then apply its rules. */
function natureSection(goal: Goal, emptyRepo: boolean, imageGen = true, cadAvailable = false): string {
  const ffprobe = Bun.which('ffprobe') != null;
  const styleAsk = `\nAlso output 2–4 \`styleOptions\` — distinct visual directions the human can SEE before any generation starts: real hex palette, 1–3 typefaces, 3–6 style keywords, one or two sentences on feel/composition; YOUR recommendation FIRST (the human's pick from the interview, if any, marked \`chosen: true\`). Plan the tasks assuming the first direction.`;
  const noBackend = `\n- IMPORTANT: no image-generation backend is configured on this machine (sessions have no OPENAI_API_KEY), so workers cannot call a generation API — at best they hand-author SVG/HTML and render it, at noticeably lower fidelity. Record this as an explicit assumption (e.g. "No AI image backend is configured; image deliverables will be hand-authored SVG renders") so the human can reject it and configure a key in Settings → Tools before approving the plan.`;
  const media = (kind: 'image' | 'video') =>
    `# Nature: ${kind}\nThis goal produces media files, not software. Set \`nature: "${kind}"\` and plan tasks per deliverable batch (scenario \`${kind}\`).${styleAsk}${kind === 'image' && !imageGen ? noBackend : ''}\n${mediaConventions(kind, ffprobe)} Never ask about tech stacks and never propose build/test/lint checks.`;
  const docs = `# Nature: documents\nThis goal produces prose, not software. Set \`nature: "docs"\` and plan writing tasks (scenario \`docs\`), one per document or chapter; Areas are documents or audiences, not apps. Acceptance: reviewer checks with a precise rubric (audience, structure, tone, completeness, factual grounding); command checks only for objective facts (a file exists, links resolve). Never ask about tech stacks and never propose build/test/lint checks.`;
  const research = `# Nature: research\nThis goal produces knowledge. Set \`nature: "research"\` and plan investigation tasks (scenario \`research\`) whose output is cited markdown reports committed to the repository; Areas are questions or topics. Every claim needs a source; acceptance: reviewer checks whose rubric verifies sources are cited and conclusions follow from them, plus command checks that the report files exist. Never ask about tech stacks and never propose build/test/lint checks.`;
  const cad = `# Nature: cad\nThis goal produces geometry and mechanical descriptions: parts and assemblies (STEP always; STL, 3MF or GLB when asked), engineering drawings, DXF cut profiles, robot description files. Set \`nature: "cad"\` and plan one task per part or assembly (scenario \`cad\`), robot files and drawings after the parts they describe; Areas are assemblies or sub-systems. Settle before planning: the manufacturing process (FDM or SLA printing, CNC, sheet metal, injection moulding) and the key dimensions with their unit are BLOCKING questions unless the prompt states them; material, tolerances and fits, mating parts (an attached STEP, drawing or photo), the printer's build volume and extra formats are assumptions the human can change. Acceptance: Python geometry checks (key dimensions, interference, wall thickness) as command checks on the exports under \`artifacts/\` (not the cad skill's \`STEP/\` and \`STL/\` folders), a DfAM or DFM check for the named process, and a reviewer rubric against the dimensions; no check reaches into the coding agent's plugin folder. Output an empty \`styleOptions\` (no visual directions); never ask about web tech stacks and never propose build/test/lint checks beyond the geometry checks.`;
  switch (goal.nature) {
    case 'docs':
      return docs;
    case 'research':
      return research;
    case 'image':
      return [media('image'), subjectsSection(goal)].join('\n\n');
    case 'video':
      return [media('video'), subjectsSection(goal)].join('\n\n');
    case 'cad':
      return [cad, subjectsSection(goal)].join('\n\n');
    case 'code':
      return [emptyRepo ? `# Empty repository\n${TECH_STACK_SECTION}` : '', `# Style directions for UI goals\nWhen this goal's main deliverable is a user interface (a landing page, a product UI), also output 2–4 \`styleOptions\` (real hex palette, typefaces, keywords, a one-line feel; recommendation first) so the human can SEE the direction before work starts; one the interview already settled goes first with \`chosen: true\`. Skip them for backend/tooling goals.`, subjectsSection(goal)]
        .filter(Boolean)
        .join('\n\n');
    case 'auto':
      return [
        `# Judge the nature first\nThe user did not say what kind of goal this is. Decide from the prompt and set \`nature\` accordingly: code (software), docs (prose), research (a cited report), image or video (media files)${cadAvailable ? ', cad (parts, drawings, robot description files)' : ''}. Then follow the matching rules:\n- code${emptyRepo ? `, empty repository: ${TECH_STACK_SECTION}` : ': explore the repo as below.'}\n- docs / research / image / video${cadAvailable ? ' / cad' : ''}: apply the corresponding section below and ignore build/test/stack concerns entirely.`,
        docs,
        research,
        media('image'),
        media('video'),
        ...(cadAvailable ? [cad] : []),
        `${subjectsSection(goal)}\nThis applies to code (a user interface), image, video${cadAvailable ? ' and cad' : ''} goals; docs and research goals name no Subjects.`,
      ].join('\n\n');
  }
}

function buildClarifyPrompt(goal: Goal, overview: string | null, skillsHint: string | null = null, attachments = '', decisions = '', emptyRepo = false, imageGen = true, interview: number | null = null, previous = '', cadAvailable = false): string {
  return [
    interview ? interviewSection(interview) : '',
    `# Goal from the user\n${goal.prompt}`,
    decisions ? `${decisions}\nTreat these as settled: plan with them, record them as assumptions, and do not ask about them again.` : '',
    previous,
    goal.references.length ? `${renderReferences(goal)}\nGround the Brief in the report: what the reference does becomes the understanding and the acceptance checks, in the person's words. A goal that only asks to understand the reference, not to change this repository, is of nature research: its deliverable is the report under docs/, and its tasks analyse rather than build. Never plan copying the reference's code or assets.` : '',
    natureSection(goal, emptyRepo, imageGen, cadAvailable),
    attachments ? `${attachments}\nWhen an attachment matters for a specific task, name it (by file name) in that task's spec.` : '',
    overview ? `# Repository overview\n${overview}` : '',
    renderCompanions(goal),
    skillsHint ?? '',
    `# Your job\nExplore this repository (read-only) enough to understand how the goal should be implemented here: build/test commands, conventions, the files involved. Then write the Brief as JSON matching the schema — everything except the task plan: a planner session splits the goal into tasks right after you, from your Brief and your \`planningNotes\`. Do not write tasks.\n\nRequirements for the Brief:\n- **Areas first.** Read the goal and every attachment and enumerate the parts of the product it covers: one Area per user-facing role or app it names (e.g. student portal, teacher portal, school admin, system admin), plus a \`shared\` Area for groundwork all of them need (data model, auth, layout). A small goal has exactly one Area. Every Area listed in your understanding MUST appear in \`areas\`; the planner gives each at least one task.\n- **\`goalChecks\`** verify the merged result. *Must* = ONLY what the user explicitly asked for plus the repo's existing quality gates (its test/typecheck/lint/build commands, if any); every command must be a real command that works in this repo from its root. *Stretch* = improvements you propose on top (docs, edge-case tests, performance, accessibility…); never fold them into must. Give a check that verifies one Area that Area's \`areaKey\`.\n- **\`planningNotes\`** carry what the planner needs and should not have to rediscover: per Area, the files and modules involved and where new code goes; the build, test and lint commands; conventions (naming, test layout, the language of commit messages); what must exist before what; risks; and how the rules above shape the tasks (scaffolding first in an empty repository, deliverable batches for media). Facts and constraints, not a task list; a few hundred words.\n- Prefer assumptions over questions. A question is blocking only if a wrong guess would waste the whole goal.\n- \`title\` is one Conventional Commits header for the whole goal (e.g. \`feat(site): add resort landing page\`) — it becomes the PR title. Write it in the language of the repository's recent commits (see the overview); default to English.`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** The planner's prompt: what the Clarifier learned and wrote, and the rules for splitting it into tasks. */
/** the plan a lazy senior dev would write: only what the goal needs, built on what the repository already has */
const PLAN_LEAN = `# Plan lean (Ponytail is on for this goal)
Before you carve tasks, check what already exists: a helper, component, service or pattern in this repository, the standard library, a platform feature, an installed dependency. Plan on top of it, never a task to rebuild it. Plan only what the goal asks for: no task for options, abstractions or flexibility nobody asked for, and the fewest tasks that cover every Area. A task that exists only to prepare for a possible later need is cut. Never cut validation, error handling, security, accessibility or the tests the work needs.`;

/** when the goal allows it: a step that is a project of its own becomes a `goal` task, done by a Delegated goal */
const DELEGATE_SECTION = `# Delegated goals (allowed on this goal)
A task of kind \`goal\` is not done by one worker session: Foundry makes a goal of its own for it — its own Clarify, plan and tasks, on this goal's branch — and its result lands here as that task's commit, its files under artifacts/ with it, before the tasks that depend on it start. Use it for a step that is itself a project: research that must come first and shape the rest, a craft of its own next to the code (a 3D model, a video, a set of images), or a part so large that one plan for everything would stay shallow. Do not use it for ordinary tasks: a goal task costs a whole Clarify. Its \`spec\` is the prompt that goal gets, so write it the way the human wrote this goal — what to make, for whom, what must and must not happen, and what the other steps expect back from it; its \`scenario\` says what it produces (image, video, cad, research, docs, or a code scenario). Give it \`dependsOnKeys\` on what it needs first, and make the tasks that use its result depend on it. Goal tasks with no dependency between them run in parallel, as many as the goal's parallel limit allows; give each a \`budgetUsd\` share of the whole estimate when you can say, else they share what is left evenly.`;

export function buildPlannerPrompt(goal: Goal, skeleton: BriefSkeleton, c: { overview: string | null; attachments: string; decisions: string; interview: Interview | null; emptyRepo: boolean; imageGen: boolean; previous: string; plannerHint: string | null; delegation?: boolean }): string {
  const { planningNotes, ...brief } = skeleton;
  const answers = c.interview ? interviewAnswers(c.interview) : [];
  return [
    `# Goal from the user\n${goal.prompt}`,
    c.decisions ? `${c.decisions}\nThese are settled: plan with them.` : '',
    answers.length ? `# The human's answers in the interview (settled)\n${answers.map(({ question, answer }) => `- ${question.text}\n  A: ${answer}`).join('\n')}` : '',
    c.previous,
    renderReferences(goal),
    plannerNatureSection({ ...goal, nature: skeleton.nature ?? goal.nature }, c.emptyRepo),
    c.delegation ? DELEGATE_SECTION : '',
    c.attachments,
    c.overview ? `# Repository overview\n${c.overview}` : '',
    renderCompanions(goal),
    `# The Brief from the Clarifier\nAreas, assumptions and goal-level checks are settled; plan within them.\n\`\`\`json\n${JSON.stringify(brief, null, 1)}\n\`\`\``,
    `# Planning notes from the Clarifier\n${planningNotes}`,
    c.plannerHint ?? '',
    resolveDiscipline(goal, { tdd: 'inherit', scenario: natureScenario(skeleton.nature ?? goal.nature) }).ponytail === 'on' ? PLAN_LEAN : '',
    `# Your job\nSplit the goal into tasks for EVERY Area of the Brief and return the plan as JSON matching the schema: \`tasks\`, their task-level \`checks\`, and the estimate (\`costEstimateUsd\`, \`timeEstimateMin\`). The notes above are the Clarifier's findings: read the repository (read-only) only where they leave a file, command or convention open. Do not interview anyone and do not change files.\n- Put the test/typecheck/lint commands on the task that must make them pass (the goal-level checks above already verify the merged result); a task whose result is judged rather than run gets a reviewer check with a precise rubric.\n- Give every user-visible feature a \`milestone\` on its closing task (the one after which the feature can be tried end to end), and a \`milestoneScript\` when the feature has a web UI or an HTTP API; null on every other task.
- Name in \`delivers\` the files a task leaves for the tasks after it (repo-relative; under artifacts/ for media and CAD): each is checked when the task lands, and the next tasks are told where they are. A \`goal\` task's \`delivers\` is what its delegated goal must leave behind.\n- Each task's \`title\` is its Conventional Commits subject: imperative, ≤ 60 chars, no trailing period, no type prefix, in the language of the repository's recent commits; \`scope\` defaults to the Area's slug.\nOutput the JSON only.`,
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
- The human may add a note to a round: something you did not ask, or got wrong. A note is a Decision like an answer — let it correct your understanding and shape the next round or the Brief.
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
  const kept = goal.follows?.style ?? goal.delegatedFrom?.style ?? null;
  if (kept && styleOptions.length && !styleOptions.some((s) => s.name === kept.name)) styleOptions.unshift({ ...kept, key: styleOptions.some((s) => s.key === kept.key) ? `${kept.key}-kept` : kept.key, samples: [], chosenSample: null });
  // a direction the human already picked in the interview is not asked again: the question starts answered, still changeable
  const picked = kept ? null : (o.styleOptions ?? []).find((s) => s.chosen)?.name ?? null;
  const keptAnswer = kept && styleOptions.some((s) => s.name === kept.name) ? kept.name : picked;
  return {
    goalId: goal.id,
    title: o.title?.trim() ?? '',
    understanding: o.understanding,
    areas: o.areas.map((a) => ({ key: a.key, name: a.name, slug: a.slug, description: a.description ?? '' })),
    assumptions: o.assumptions.map((text) => ({ id: newId('as'), text, accepted: true, applied: false })),
    checks: o.checks.map((c) => ({ key: c.key, name: c.name, tier: c.tier, taskKey: c.taskKey ?? null, areaKey: c.taskKey ? null : area(c.areaKey), spec: materializeCheck(c, c.taskKey ?? null) })),
    // a `goal` task where the goal allows no delegation (a model that ignored the schema) is an ordinary task
    tasks: o.tasks.map((t) => ({ key: t.key, title: t.title, spec: t.spec, kind: t.kind === 'goal' && !goal.delegation.allow ? 'feature' : (t.kind ?? 'feature'), scope: t.scope ?? null, scenario: t.scenario ?? 'general', areaKey: area(t.areaKey), tdd: 'inherit', dependsOnKeys: t.dependsOnKeys, parallelizable: t.parallelizable, relevantFiles: t.relevantFiles, delivers: t.delivers ?? [], budgetUsd: t.kind === 'goal' ? (t.budgetUsd ?? null) : null, repo: t.kind === 'goal' && goal.delegation.allow ? (t.repo ?? null) : null, milestone: t.milestone ?? null, milestoneScript: t.milestone ? (t.milestoneScript ?? null) : null, difficulty: t.difficulty ?? 'standard' })),
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
