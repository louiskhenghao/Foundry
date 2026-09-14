import { join } from 'node:path';
import type { Brief, Goal, GoalNature, Interview, InterviewQuestion, InterviewRound, TaskScenario } from '@foundry/core';
import { BriefOutput, INTERVIEW_MAX_QUESTIONS, INTERVIEW_MAX_ROUNDS, IdPrefix, InterviewOutput, getGoal, interviewAnswers, newId, uncoveredAreas } from '@foundry/core';
import type { RunHandle, RunResult } from '@foundry/runner';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { attachmentsDir, markitdownHint, renderAttachments } from './attachments.ts';
import { tryJson } from './checks/reviewer.ts';
import type { Engine } from './engine.ts';
import { git, isDirty } from './git/git.ts';
import { READONLY_DISALLOWED, READONLY_TOOLS, boundarySettings } from './guards/boundary.ts';
import { hasStackManifest } from './skills/autoskills.ts';
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

/** Everything one Clarify session needs; the interview's later rounds resume the session and rebuild this only to recover a lost one. */
interface ClarifyContext {
  ws: string;
  prompt: string;
  wasAuto: boolean;
  nature: GoalNature;
  /** engine-made questions (dirty repo …) that ride into the Brief */
  extraQuestions: Brief['questions'];
  run: (p: string, resume?: string) => Promise<RunHandle>;
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
  const [clarifierHint, plannerHint] = await Promise.all([engine.skills.hints.sectionFor('clarifier', { scenario }), engine.skills.hints.sectionFor('planner', { scenario })]);
  // a re-run keeps the human's Decisions from the discarded Brief
  const reclarified = store.listByGoal(goal.id, 5000).filter((e) => e.type === 'goal.reclarified').at(-1);
  const decisions = reclarified ? ((reclarified.payload as { decisions?: string }).decisions ?? '') : '';
  const prompt = buildClarifyPrompt({ ...goal, nature }, overview, clarifierHint, [renderAttachments(goal, config.dataDir), markitdownHint(engine.markitdown.available(), engine.markitdown.binary())].filter(Boolean).join('\n\n'), decisions, isEmptyRepo(ws), engine.imageGenAvailable(), goal.interview?.mode ?? null);
  const addDirs = goal.attachments.length ? [attachmentsDir(config.dataDir, goal.id)] : undefined;
  const schema = zodToJsonSchema(goal.interview ? InterviewOutput : BriefOutput, { $refStrategy: 'none' });
  const transcriptPath = join(config.dataDir, 'transcripts', `clarify-${goal.id}.jsonl`);
  const run = (p: string, resume?: string) =>
    engine.runner.run({
      prompt: p,
      cwd: ws,
      model: goal.models.strong,
      meta: { goalId: goal.id, tier: 'strong' },
      maxTurns: CLARIFY_MAX_TURNS,
      maxBudgetUsd: CLARIFY_MAX_BUDGET_USD,
      permissionMode: 'dontAsk',
      allowedTools: READONLY_TOOLS,
      disallowedTools: READONLY_DISALLOWED,
      appendSystemPromptFile: engine.roles.path('clarifier'),
      agents: { planner: { description: 'Plans the task DAG for a goal. Use after exploring the repo.', prompt: engine.roles.text('planner') + (plannerHint ? `\n\n${plannerHint}` : ''), model: goal.models.strong } },
      jsonSchema: schema,
      settings: boundarySettings(config.hooksDir),
      settingSources: config.settingSources,
      addDirs,
      resumeSessionId: resume,
      timeoutMs: 15 * 60_000,
      transcriptPath,
      label: `clarify ${goal.title}`,
    });
  return { ws, prompt, wasAuto, nature, extraQuestions, run };
}

/** run one Clarify turn (fresh or resumed), streaming it to the goal's clarify channel and booking its cost */
async function turn(engine: Engine, goal: Goal, ctx: ClarifyContext, message: string, resume: string | undefined, source: string): Promise<RunResult> {
  const handle = await ctx.run(message, resume);
  for await (const ev of handle.events) engine.broadcast({ goalId: goal.id, taskId: null, attemptId: `clarify-${goal.id}`, event: ev, ts: new Date().toISOString() });
  const result = await handle.result;
  engine.store.append({ type: 'goal.cost_added', goalId: goal.id, payload: { costUsd: result.costUsd, source } });
  engine.recordSessionUsage(result, { goalId: goal.id, kind: 'clarify', model: goal.models.strong });
  return result;
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
  const parseTurn = (raw: unknown): { questions: InterviewOutput['questions']; brief: BriefOutput | null } | null => {
    if (iv) {
      const p = InterviewOutput.safeParse(raw);
      if (p.success) return p.data;
    }
    const b = BriefOutput.safeParse(raw);
    return b.success ? { questions: [], brief: b.data } : null;
  };
  let out = parseTurn(result.structuredOutput ?? tryJson(result.finalText));
  if (!out && result.sessionId) {
    const issues = iv ? InterviewOutput.safeParse(result.structuredOutput ?? tryJson(result.finalText)) : BriefOutput.safeParse(result.structuredOutput ?? tryJson(result.finalText));
    const detail = issues.success ? '' : issues.error.issues.slice(0, 3).map((i) => i.path.join('.') + ': ' + i.message).join('; ');
    result = await turn(engine, goal, ctx, `Your previous answer did not match the required JSON schema (${detail}). ${iv ? 'Output either {"questions": [...], "brief": null} to ask a round, or {"questions": [], "brief": {...}} with the Brief.' : 'Output ONLY the JSON object now.'}`, result.sessionId, 'clarify-repair');
    out = parseTurn(result.structuredOutput ?? tryJson(result.finalText));
  }

  // a round of questions: the goal waits for the human
  if (iv && out && out.questions.length && !out.brief && canAskMore(iv)) {
    const questions = normalizeQuestions(iv, out.questions);
    store.append({ type: 'interview.round_asked', goalId: goal.id, payload: { round: iv.rounds.length + 1, sessionId: result.sessionId ?? null, questions } });
    return;
  }
  // questions came back although no more rounds are allowed: one more turn to get the Brief
  if (iv && out && !out.brief && result.sessionId) {
    result = await turn(engine, goal, ctx, 'No more questions can be asked. Write the Brief now with assumptions for everything still open; `questions` must be empty. Output the JSON only.', result.sessionId, 'clarify-repair');
    out = parseTurn(result.structuredOutput ?? tryJson(result.finalText));
  }

  let parsed: BriefOutput | null = out?.brief ?? null;
  if (parsed && result.sessionId) {
    const missing = uncoveredAreas({ areas: parsed.areas, tasks: parsed.tasks });
    if (missing.length) {
      const r2 = await turn(engine, goal, ctx, coverageRepairMessage(missing), result.sessionId, 'clarify-coverage');
      const repaired = parseTurn(r2.structuredOutput ?? tryJson(r2.finalText));
      if (repaired?.brief) parsed = repaired.brief;
      else store.append({ type: 'engine.note', goalId: goal.id, payload: { level: 'warn', message: `coverage repair did not return a valid Brief; keeping the first one (${missing.map((a) => a.name).join(', ')} uncovered)` } });
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

/** Nature-specific planning rules. Auto goals get the conditional form: judge the nature first, then apply its rules. */
function natureSection(goal: Goal, emptyRepo: boolean, imageGen = true): string {
  const ffprobe = Bun.which('ffprobe') != null;
  const styleAsk = `\nAlso output 2–4 \`styleOptions\` — distinct visual directions the human can SEE before any generation starts: real hex palette, 1–3 typefaces, 3–6 style keywords, one or two sentences on feel/composition; YOUR recommendation FIRST. Plan the tasks assuming the recommended direction.`;
  const noBackend = `\n- IMPORTANT: no image-generation backend is configured on this machine (sessions have no OPENAI_API_KEY), so workers cannot call a generation API — at best they hand-author SVG/HTML and render it, at noticeably lower fidelity. Record this as an explicit assumption (e.g. "No AI image backend is configured; image deliverables will be hand-authored SVG renders") so the human can reject it and configure a key in Settings → Tools before approving the plan.`;
  const media = (kind: 'image' | 'video') =>
    `# Nature: ${kind}\nThis goal produces media files, not software. Set \`nature: "${kind}"\` and plan tasks per deliverable batch (scenario \`${kind}\`).${styleAsk}${kind === 'image' && !imageGen ? noBackend : ''}\nConventions every media task's spec MUST state verbatim:\n- generated files go to \`artifacts/\` in the workspace (the engine keeps that folder out of git)\n- independent artifacts are generated IN PARALLEL (launch the generation calls together, e.g. background jobs), never one after another; at most one regeneration pass per artifact\n- the task also writes its manifest \`docs/artifacts/<task-slug>.md\` (committed): one bullet per artifact — file name, what it shows, and the prompt/parameters used\nAcceptance: reviewer checks whose rubric judges the manifest AND the artifacts themselves (the reviewer opens image files to look at them)${kind === 'video' ? `; add a must command check verifying each video with ffprobe (duration, resolution)${ffprobe ? '' : ' — ffprobe is NOT installed on this machine, so use a plain file-exists check instead'}` : ''}. Command checks otherwise only verify objective facts (files exist, counts). Never ask about tech stacks and never propose build/test/lint checks.`;
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

function buildClarifyPrompt(goal: Goal, overview: string | null, skillsHint: string | null = null, attachments = '', decisions = '', emptyRepo = false, imageGen = true, interview: 'auto' | 'always' | null = null): string {
  return [
    interview ? interviewSection(interview) : '',
    `# Goal from the user\n${goal.prompt}`,
    decisions ? `${decisions}\nTreat these as settled: plan with them, record them as assumptions, and do not ask about them again.` : '',
    natureSection(goal, emptyRepo, imageGen),
    attachments ? `${attachments}\nWhen an attachment matters for a specific task, name it (by file name) in that task's spec.` : '',
    overview ? `# Repository overview\n${overview}` : '',
    skillsHint ?? '',
    `# Your job\nExplore this repository (read-only) enough to understand how the goal should be implemented here: build/test commands, conventions, the files involved. Then list the **Areas** the goal covers, use the \`planner\` agent to split each Area into tasks, and produce the Brief as JSON matching the schema.\n\nRequirements for the Brief:\n- **Areas first.** Read the goal and every attachment and enumerate the parts of the product it covers: one Area per user-facing role or app it names (e.g. student portal, teacher portal, school admin, system admin), plus a \`shared\` Area for groundwork all of them need (data model, auth, layout). A small goal has exactly one Area. Every Area listed in your understanding MUST appear in \`areas\`, and **every Area MUST have at least one task** — a Brief that mentions four apps and plans only one is wrong.\n- **Tasks per Area: 1–6.** There is no limit on the total; the limit is per Area. Each task must be completable by one engineer-session without talking to anyone; give concrete file paths in relevantFiles; set \`areaKey\` on every task. Tasks of the shared Area come first and the others depend on them.\n- **Must checks** come ONLY from what the user explicitly asked for plus the repo's existing quality gates (its test/typecheck/lint/build commands, if any). Every command check must be a real command that works in this repo from its root.\n- **Stretch checks** are improvements you propose on top (docs, edge-case tests, performance, accessibility…). Never fold them into must.\n- Tasks that touch disjoint files can be parallelizable; tasks that must build on each other use dependsOnKeys.\n- Put test/typecheck/lint commands as task-level checks on the task that must make them pass, AND as goal-level checks (taskKey null) so the merged result is verified. Give each goal-level check that verifies one Area that Area's \`areaKey\`; repo-wide gates keep null.\n- Prefer assumptions over questions. A question is blocking only if a wrong guess would waste the whole goal.
- Set each task's \`kind\`: bug (something is broken — the worker must reproduce it first), feature, refactor, research (a spike whose output is knowledge), chore.
- Set each task's \`scenario\` (frontend / backend / fullstack / data / mobile / infra / docs / research / image / video / general): it decides which specialised skills the worker is handed — UI work gets the design skills, media work the image/video skills — so be precise and never leave a UI or media task as "general".
- Commits and pull requests follow Conventional Commits. Each task's \`title\` is its commit subject: imperative, ≤ 60 chars, no trailing period, NO type prefix (the type comes from \`kind\`); \`scope\` defaults to the Area's slug — set it only when a narrower module name is obviously better. \`title\` (top level) is one Conventional Commits header for the whole goal (e.g. \`feat(site): add resort landing page\`) — it becomes the PR title. Write titles in the language of the repository's recent commits (see the overview); default to English.`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** The interview rules the Clarifier follows before writing the Brief (a grilling, with the human in the loop). */
function interviewSection(mode: 'auto' | 'always'): string {
  return `# Interview before the Brief
You may ask the human questions in rounds before writing the Brief — the way a careful engineer interviews before planning. Facts are yours to find; decisions are theirs.
- Explore first. Never ask what the repository, the attachments or the goal already answer; every question cites what you found or could not find (\`reason\`).
- A round = every decision you can ask about NOW, whose prerequisites are settled — at most ${INTERVIEW_MAX_QUESTIONS}, the most consequential first. A question that depends on an answer you have not heard yet waits for the next round; when a question follows from an earlier answer, name it in \`dependsOn\`.
- Every question offers 2–4 concrete options with YOUR recommendation first (free text stays possible). \`blocking\` = a wrong guess would waste the goal; everything else is an assumption the human may correct.
- At most ${INTERVIEW_MAX_ROUNDS} rounds. When nothing is left to ask — or the human says enough — write the Brief: the answers become Decisions, the rest assumptions. ${mode === 'always' ? 'The human asked to be interviewed: ask at least one round unless there is truly nothing a person could decide.' : 'Zero rounds is right for a small, unambiguous goal.'}
- Output per turn: either \`{"questions": [...], "brief": null}\` to ask a round, or \`{"questions": [], "brief": {...}}\` with the Brief. Write questions in the language of the goal.`;
}

export function coverageRepairMessage(missing: { key: string; name: string }[]): string {
  return `The Brief you produced lists the Area(s) ${missing.map((a) => `"${a.name}" (${a.key})`).join(', ')} but plans no task for ${missing.length === 1 ? 'it' : 'them'}. Add 1–6 tasks (with their checks, areaKey set) for each of these Areas — use the planner agent again if needed. Drop an Area only if the goal really does not ask for it, and say so in the understanding. Output the complete Brief JSON again, nothing else.`;
}

/** Map an LLM check (flat) to a BriefCheck spec. Shared by Clarify and Draft. */
export function materializeCheck(c: { type: 'command' | 'reviewer'; cmd: string | null; rubric: string | null; name: string }, taskKey: string | null): Brief['checks'][number]['spec'] {
  return c.type === 'command' ? { type: 'command', cmd: c.cmd ?? 'true', timeoutMs: 300_000, expectExitCode: 0 } : { type: 'reviewer', scope: taskKey ? 'task-diff' : 'goal-diff', rubric: c.rubric ?? c.name };
}

export function toBrief(goal: Goal, o: BriefOutput, extraQuestions: Brief['questions']): Brief {
  const areaKeys = new Set(o.areas.map((a) => a.key));
  const area = (k: string | null | undefined) => (k && areaKeys.has(k) ? k : null);
  const styleOptions = (o.styleOptions ?? []).map((s) => ({ key: s.key, name: s.name, palette: s.palette ?? [], fonts: s.fonts ?? [], keywords: s.keywords ?? [], description: s.description ?? '', samples: [], chosenSample: null }));
  return {
    goalId: goal.id,
    title: o.title?.trim() ?? '',
    understanding: o.understanding,
    areas: o.areas.map((a) => ({ key: a.key, name: a.name, slug: a.slug, description: a.description ?? '' })),
    assumptions: o.assumptions.map((text) => ({ id: newId('as'), text, accepted: true, applied: false })),
    checks: o.checks.map((c) => ({ key: c.key, name: c.name, tier: c.tier, taskKey: c.taskKey, areaKey: c.taskKey ? null : area(c.areaKey), spec: materializeCheck(c, c.taskKey) })),
    tasks: o.tasks.map((t) => ({ key: t.key, title: t.title, spec: t.spec, kind: t.kind ?? 'feature', scope: t.scope ?? null, scenario: t.scenario ?? 'general', areaKey: area(t.areaKey), tdd: 'inherit', dependsOnKeys: t.dependsOnKeys, parallelizable: t.parallelizable, relevantFiles: t.relevantFiles, milestone: t.milestone ?? null })),
    costEstimateUsd: o.costEstimateUsd,
    run: o.run ?? null,
    timeEstimateMin: o.timeEstimateMin,
    questions: [
      ...extraQuestions,
      ...o.questions.map((q) => ({ id: newId('q'), text: q.text, answer: null, blocking: q.blocking, areaKey: area(q.areaKey), options: q.options ?? [], kind: 'text' as const, applied: false })),
      // the style question is engine-generated (never left to the LLM to remember): its options are the proposal names, recommendation first
      ...(styleOptions.length
        ? [{ id: newId('q'), text: 'Which style direction should the deliverables follow? Pick a card — you can generate a sample image for any of them before deciding.', answer: null, blocking: true, areaKey: null, options: styleOptions.map((s) => s.name), kind: 'style' as const, applied: false }]
        : []),
    ],
    styleOptions,
  };
}

export { IdPrefix };
