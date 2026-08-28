import { join } from 'node:path';
import type { Brief, Goal, GoalNature, TaskScenario } from '@ai-engine/core';
import { BriefOutput, IdPrefix, getGoal, newId, uncoveredAreas } from '@ai-engine/core';
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

/**
 * Clarify: explore the repo, produce a Brief, hand it to the human once.
 */
export async function runClarify(engine: Engine, goal: Goal): Promise<void> {
  const { store, config } = engine;
  engine.clarifying.add(goal.id);
  try {
    store.append({ type: 'clarify.started', goalId: goal.id, payload: { attemptId: null } });
    const questions: Brief['questions'] = [];
    if (await isDirty(goal.repoPath).catch(() => false)) {
      questions.push({
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
    const prompt = buildClarifyPrompt({ ...goal, nature }, overview, clarifierHint, [renderAttachments(goal, config.dataDir), markitdownHint(engine.markitdown.available(), engine.markitdown.binary())].filter(Boolean).join('\n\n'), decisions, isEmptyRepo(ws), engine.imageGenAvailable());
    const addDirs = goal.attachments.length ? [attachmentsDir(config.dataDir, goal.id)] : undefined;
    const schema = zodToJsonSchema(BriefOutput, { $refStrategy: 'none' });
    const transcriptPath = join(config.dataDir, 'transcripts', `clarify-${goal.id}.jsonl`);
    const run = async (p: string, resume?: string) =>
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

    let handle = await run(prompt);
    for await (const ev of handle.events) engine.broadcast({ goalId: goal.id, taskId: null, attemptId: `clarify-${goal.id}`, event: ev, ts: new Date().toISOString() });
    let result = await handle.result;
    store.append({ type: 'goal.cost_added', goalId: goal.id, payload: { costUsd: result.costUsd, source: 'clarify' } });
    engine.recordSessionUsage(result, { goalId: goal.id, kind: 'clarify', model: goal.models.strong });

    // one follow-up turn in the same session: a schema repair, or a coverage repair (an Area without tasks)
    const followUp = async (message: string, source: string) => {
      handle = await run(message, result.sessionId!);
      for await (const ev of handle.events) engine.broadcast({ goalId: goal.id, taskId: null, attemptId: `clarify-${goal.id}`, event: ev, ts: new Date().toISOString() });
      result = await handle.result;
      store.append({ type: 'goal.cost_added', goalId: goal.id, payload: { costUsd: result.costUsd, source } });
      engine.recordSessionUsage(result, { goalId: goal.id, kind: 'clarify', model: goal.models.strong });
      return BriefOutput.safeParse(result.structuredOutput ?? tryJson(result.finalText));
    };

    let parsed = BriefOutput.safeParse(result.structuredOutput ?? tryJson(result.finalText));
    if (!parsed.success && result.sessionId) {
      parsed = await followUp(`Your previous answer did not match the required JSON schema (${parsed.error.issues.slice(0, 3).map((i) => i.path.join('.') + ': ' + i.message).join('; ')}). Output ONLY the JSON object now.`, 'clarify-repair');
    }
    if (parsed.success && result.sessionId) {
      const missing = uncoveredAreas({ areas: parsed.data.areas, tasks: parsed.data.tasks });
      if (missing.length) {
        const repaired = await followUp(coverageRepairMessage(missing), 'clarify-coverage');
        if (repaired.success) parsed = repaired;
        else store.append({ type: 'engine.note', goalId: goal.id, payload: { level: 'warn', message: `coverage repair did not return a valid Brief; keeping the first one (${missing.map((a) => a.name).join(', ')} uncovered)` } });
      }
    }

    let brief: Brief;
    // the Clarifier's verdict wins over the pre-classification, but never over a nature the user chose
    if (parsed.success && wasAuto && parsed.data.nature !== nature) {
      store.append({ type: 'goal.nature_set', goalId: goal.id, payload: { nature: parsed.data.nature, reason: nature === 'auto' ? 'clarifier verdict' : `clarifier verdict (over pre-classification: ${nature})` } });
    }
    if (parsed.success) {
      brief = toBrief(goal, parsed.data, questions);
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
        tasks: [{ key: 'T1', title: goal.title, spec: goal.prompt, kind: 'feature', scope: null, scenario: 'general', areaKey: 'A1', tdd: 'inherit', dependsOnKeys: [], parallelizable: false, relevantFiles: [] }],
        costEstimateUsd: 0,
        timeEstimateMin: 0,
        styleOptions: [],
        questions: [
          ...questions,
          { id: newId('q'), text: 'The clarifier could not produce a structured Brief. Edit the tasks and checks manually, then answer "ok" here.', answer: null, blocking: true, areaKey: null, options: [], kind: 'text', applied: false },
        ],
      };
    }
    store.append({ type: 'brief.proposed', goalId: goal.id, payload: { brief } });
    store.append({ type: 'goal.state_changed', goalId: goal.id, payload: { from: 'clarifying', to: 'awaiting_brief_approval', reason: 'brief proposed' } });
  } catch (err) {
    store.append({ type: 'engine.note', goalId: goal.id, payload: { level: 'error', message: `clarify crashed: ${String((err as Error)?.stack ?? err)}` } });
    store.append({ type: 'goal.state_changed', goalId: goal.id, payload: { from: 'clarifying', to: 'failed', reason: `clarify crashed: ${String(err)}` } });
  } finally {
    engine.clarifying.delete(goal.id);
  }
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

function buildClarifyPrompt(goal: Goal, overview: string | null, skillsHint: string | null = null, attachments = '', decisions = '', emptyRepo = false, imageGen = true): string {
  return [
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
    tasks: o.tasks.map((t) => ({ key: t.key, title: t.title, spec: t.spec, kind: t.kind ?? 'feature', scope: t.scope ?? null, scenario: t.scenario ?? 'general', areaKey: area(t.areaKey), tdd: 'inherit', dependsOnKeys: t.dependsOnKeys, parallelizable: t.parallelizable, relevantFiles: t.relevantFiles })),
    costEstimateUsd: o.costEstimateUsd,
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
