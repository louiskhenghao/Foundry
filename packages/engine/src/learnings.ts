/**
 * Learnings (ADR-0040): what a repository taught its goals, kept per project folder and given to the next goals there.
 *
 * When a goal ends (done, over-delivered or failed), one session on the goal's cheap model reads how it went — what was
 * asked and decided, the escalations and how they were answered, the hints the person gave, the attempts that failed
 * and what was observed, the warnings, the final review — beside the notebook so far, and returns the notebook after
 * it: what is still true, what this goal taught, nothing that only concerned this goal. The person's own entries are
 * never changed or dropped. Clarify gets the whole notebook; every attempt gets it in short.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Goal, Learning, LearningKind as LearningKindT } from '@foundry/core';
import { jsonSchemaFor, LEARNINGS_EVERYWHERE, LEARNINGS_MAX, LEARNING_MAX_CHARS, LearningKind, getBrief, getGoal, getObservation, getRepoLearnings, isHistory, listAttemptsByGoal, listEscalations, listTasks, newId, renderDecisions } from '@foundry/core';
import { z } from 'zod';
import { tryJson } from './checks/reviewer.ts';
import type { Engine } from './engine.ts';

const DistillOutput = z.object({
  learnings: z
    .array(
      z.object({
        id: z.string().nullable().describe('The id of the learning this keeps or rewrites, exactly as given; null for a new one.'),
        kind: LearningKind,
        text: z.string().describe(`One durable fact about this repository that saves the next goal time: a command, a path, a convention, a pitfall, a preference the person stated. Concrete, at most ${LEARNING_MAX_CHARS} characters.`),
      }),
    )
    .describe(`The whole notebook after this goal, at most ${LEARNINGS_MAX}: keep what is still true, merge duplicates, add what this goal taught, drop what it proved wrong. Leave out what only concerned this goal.`),
  note: z.string().describe('One sentence for the person: what changed in the notebook, or that nothing did.'),
});
type DistillOutput = z.infer<typeof DistillOutput>;

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const ENDED = new Set(['done', 'over_delivered', 'failed']);

/** the notebook of a goal's folder, empty when it has none */
export function learningsOf(engine: Engine, repoPath: string): Learning[] {
  return getRepoLearnings(engine.store.db, repoPath)?.learnings ?? [];
}

/** the person's entries that follow them into every folder (ADR-0055); empty when they wrote none */
export function everywhereLearnings(engine: Engine): Learning[] {
  return getRepoLearnings(engine.store.db, LEARNINGS_EVERYWHERE)?.learnings ?? [];
}

/** the person's entries first (they wrote them for a reason), then Foundry's, newest first */
function ordered(ls: Learning[]): Learning[] {
  return [...ls].sort((a, b) => (a.by === b.by ? b.at.localeCompare(a.at) : a.by === 'human' ? -1 : 1));
}

/** Clarify's section: the whole notebook */
export function learningsContext(engine: Engine, goal: Pick<Goal, 'repoPath'>): string {
  const ls = learningsOf(engine, goal.repoPath);
  const everywhere = everywhereLearnings(engine);
  if (!ls.length && !everywhere.length) return '';
  const line = (l: Learning) => `- [${l.kind}]${l.by === 'human' ? ' ✎' : ''} ${l.text}`;
  return [
    '# What Foundry learned about this repository',
    'From earlier goals in this folder, and from the person (marked ✎). Trust them unless the code says otherwise, and plan with them: they cost a goal time once already.',
    ...ordered(ls).map(line),
    // the person's standing wishes come with every folder (ADR-0055)
    ...(everywhere.length ? ['', 'What the person wants in every project, whatever the folder (✎):', ...ordered(everywhere).map(line)] : []),
  ].join('\n');
}

/** an attempt's section: the notebook in short (the operational kinds first), at most `max` characters */
export function learningsForWorker(engine: Engine, goal: Pick<Goal, 'repoPath'>, max = 1_500): string {
  // the person's everywhere entries ride along (they are theirs, so they sort first)
  const ls = [...everywhereLearnings(engine), ...learningsOf(engine, goal.repoPath)];
  if (!ls.length) return '';
  const first: LearningKindT[] = ['build', 'test', 'run', 'pitfall'];
  const sorted = ordered(ls).sort((a, b) => Number(!first.includes(a.kind)) - Number(!first.includes(b.kind)));
  const lines: string[] = [];
  let used = 0;
  for (const l of sorted) {
    const line = `- ${l.text}`;
    if (used + line.length > max) break;
    lines.push(line);
    used += line.length + 1;
  }
  return `# Notes on this repository\nWhat earlier goals here learned, and what the person wants everywhere. Follow them unless the code says otherwise.\n${lines.join('\n')}`;
}

/** how the goal went, for the session that learns from it (and for the folder's Memory, ADR-0072) */
export function goalRecord(engine: Engine, goal: Goal): string {
  const db = engine.store.db;
  const brief = getBrief(db, goal.id)?.brief;
  const tasks = listTasks(db, goal.id);
  const attempts = listAttemptsByGoal(db, goal.id);
  const ended = engine.store.listByGoalOfTypes(goal.id, ['goal.state_changed']).filter((e) => e.type === 'goal.state_changed' && e.payload.to === goal.state).at(-1);
  const reason = ended?.type === 'goal.state_changed' ? ended.payload.reason : '';
  const parts = [`# The goal\n"${goal.title}" ended ${goal.state.replace(/_/g, ' ')}${reason ? `: ${clip(reason, 300)}` : ''}.\n\n${clip(goal.prompt.trim(), 1_500)}`];
  if (brief?.understanding.trim()) parts.push(`# What was understood\n${clip(brief.understanding.trim(), 1_500)}`);
  if (brief) {
    const decisions = renderDecisions(brief);
    if (decisions) parts.push(clip(decisions, 2_000));
  }
  const taskLines = tasks.map((t) => {
    const mine = attempts.filter((a) => a.taskId === t.id);
    const failed = mine.filter((a) => a.state !== 'passed');
    const last = failed.at(-1);
    const observed = last ? getObservation(db, last.id)?.summary : null;
    return [
      `- ${t.title}: ${t.state}, ${mine.length} attempt${mine.length === 1 ? '' : 's'}`,
      t.hint ? `  hint from the person: ${clip(t.hint, 400)}` : '',
      observed && failed.length ? `  what a failed attempt ran into: ${clip(observed.replace(/\s+/g, ' '), 500)}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  });
  if (taskLines.length) parts.push(`# Tasks\n${taskLines.join('\n')}`);
  const escs = listEscalations(db, { goalId: goal.id }).map((e) => {
    const answer = e.answer ? ` → ${e.answer.action}${e.answer.hint ? `: ${clip(e.answer.hint, 300)}` : ''}${e.answer.feedback ? `: ${clip(e.answer.feedback, 300)}` : ''}` : ' (not answered)';
    return `- ${e.trigger}: ${clip((e.message.split('\n')[0] ?? '').trim(), 300)}${answer}`;
  });
  if (escs.length) parts.push(`# Where it stopped for the person, and the answers\n${escs.join('\n')}`);
  const warnings = engine.store
    .listByGoalOfTypes(goal.id, ['engine.note'])
    .flatMap((e) => (e.type === 'engine.note' && e.payload.level !== 'info' ? [`- ${clip(e.payload.message.replace(/\s+/g, ' '), 240)}`] : []))
    .slice(-10);
  if (warnings.length) parts.push(`# Warnings\n${warnings.join('\n')}`);
  const review = engine.store.listByGoalOfTypes(goal.id, ['review.goal.finished']).at(-1);
  if (review?.type === 'review.goal.finished' && review.payload.notes?.trim()) parts.push(`# The final review\n${clip(review.payload.notes.trim(), 1_200)}`);
  return parts.join('\n\n');
}

/** the retro skill's categories, kept as the lens of the session whether or not the skill itself is installed */
const RETRO_LENS = 'navigation, automated checks, coding standards, global AGENTS.md, tool economy, no-ops, information access';
/**
 * pstack's reflect, in one session: its three reviewers' lenses and its structural check as text — the skill itself
 * spawns subagents and edits skills, which a housekeeping session must not (ADR-0050)
 */
const REFLECT_LENS = 'judgment (a call the sessions got wrong, or right for a reason worth keeping), tooling (a tool, command or check the sessions lacked or misused), the divergent view (what another approach would have avoided), structure (what a lint rule, script or check would enforce more reliably than a note)';

/** the transcripts of the goal's sessions on this computer: what the retrospective may read beyond the record below */
function transcriptsOf(engine: Engine, goal: Goal): string[] {
  const dir = join(engine.config.dataDir, 'transcripts');
  const named = [`clarify-${goal.id}.jsonl`, `planner-${goal.id}.jsonl`, ...Array.from({ length: goal.fixCycles + 1 }, (_, i) => `goal-review-${goal.id}-${i}.jsonl`)];
  const attempts = listAttemptsByGoal(engine.store.db, goal.id).map((a) => a.transcriptPath ?? join(dir, `${a.id}.jsonl`));
  return [...named.map((n) => join(dir, n)), ...attempts].filter((p) => existsSync(p)).slice(0, 12);
}

/**
 * The session's prompt. With the retro skill installed (Claude), it opens with the skill's slash name, which starts the
 * skill headlessly: the session is a retrospective of the goal, its findings written into the notebook instead of
 * presented to a person. `section` is the Learnings role's workflow skills (writing-for-agents, when installed).
 */
function buildPrompt(engine: Engine, goal: Goal, existing: Learning[], extra: { retro: string | null; section: string | null; lens?: 'retro' | 'reflect' } = { retro: null, section: null }): string {
  const notebook = existing.map((l) => ({ id: l.id, kind: l.kind, text: l.text, by: l.by }));
  const transcripts = transcriptsOf(engine, goal);
  const reflect = extra.lens === 'reflect';
  const lens = reflect
    ? `Look through reflect's lenses (${REFLECT_LENS}): a judgment to repeat or to avoid, a tool or check the sessions lacked, what a different approach would have avoided, what structure should enforce instead of a note.`
    : `Look through the retrospective's lens (${RETRO_LENS}): a navigation pointer the sessions lacked, a check that would have caught a mistake, a rule the reviewer should enforce, an instruction that changed nothing, a tool call that cost more than it gave, information a session could not reach.`;
  return [
    extra.retro
      ? `${extra.retro} A retrospective of the Foundry goal below, for the folder's notebook: there is no person to present to, so what you would present becomes notebook entries.`
      : reflect
        ? "In the manner of pstack's reflect — its judgment, tooling and divergent reviewers and their synthesis — but in this one session, reading the transcripts yourself and editing no skill: what reflect would route into a skill becomes an entry of the folder's notebook instead."
        : '',
    goalRecord(engine, goal),
    `# Primary sources\nThe record above is the summary. ${transcripts.length ? `The sessions' transcripts (NDJSON, one event per line) are on this computer, readable when a detail matters:\n${transcripts.map((p) => `- ${p}`).join('\n')}` : `The transcripts live under ${join(engine.config.dataDir, 'transcripts')}; none of this goal's is on this computer.`}\nRead sparingly: a few turns is all you have.`,
    `# The notebook of this repository so far\n${notebook.length ? `\`\`\`json\n${JSON.stringify(notebook, null, 1)}\n\`\`\`\nEntries by "human" are the person's: keep them word for word.` : '(empty)'}`,
    extra.section ?? '',
    `# Your job\nReturn the notebook after this goal: durable, repository-specific facts that would save the next goal in this folder time — how to build, test and run it, where things live, its conventions, what the person prefers, what goes wrong and how to get past it. ${lens} Keep what is still true; merge duplicates; add what this goal taught; drop what it proved wrong. Leave out what only concerned this goal (its feature, its files, its outcome) and anything a reader of the code sees at once. Short, concrete entries with the exact command, path or name; paths relative to the repository root, never a session's workspace folder or a transcript. An empty addition is fine: most goals teach nothing new. Output JSON matching the schema, nothing else.`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

/**
 * The notebook after the session's answer: the person's entries as they were, then the session's (an entry that names
 * a known id keeps its origin, a new one is this goal's), clipped, without empty or repeated text, at most the cap.
 */
export function mergeLearnings(existing: Learning[], out: DistillOutput['learnings'], goal: Pick<Goal, 'id' | 'title'>, now = new Date().toISOString()): Learning[] {
  const byId = new Map(existing.map((l) => [l.id, l]));
  const human = existing.filter((l) => l.by === 'human');
  const seen = new Set(human.map((l) => l.text.trim().toLowerCase()));
  const result = [...human];
  for (const o of out) {
    const text = clip(o.text.trim().replace(/\s+/g, ' '), LEARNING_MAX_CHARS);
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    const before = o.id ? byId.get(o.id) : undefined;
    // a person's entry is theirs: a rewrite of it is ignored
    if (before?.by === 'human') continue;
    seen.add(key);
    result.push(before && before.text === text && before.kind === o.kind ? before : { id: before?.id ?? newId('lrn'), kind: o.kind, text, by: 'foundry', goalId: before?.goalId ?? goal.id, goalTitle: before?.goalTitle ?? goal.title, at: before && before.text === text ? before.at : now });
    if (result.length >= LEARNINGS_MAX) break;
  }
  return result;
}

/** what changed between two notebooks, for the goal's activity: "+2 ~1 −1" */
export function learningsDiff(before: Learning[], after: Learning[]): { added: number; changed: number; dropped: number } {
  const old = new Map(before.map((l) => [l.id, l]));
  const now = new Set(after.map((l) => l.id));
  let added = 0;
  let changed = 0;
  for (const l of after) {
    const b = old.get(l.id);
    if (!b) added++;
    else if (b.text !== l.text || b.kind !== l.kind) changed++;
  }
  return { added, changed, dropped: before.filter((l) => !now.has(l.id)).length };
}

/** one learning session per folder at a time: two goals ending together would each write over the other's notebook */
const chains = new Map<string, Promise<unknown>>();

/**
 * Learn from a goal that ended. Bounded (one session, eight turns, half a dollar, four minutes); it never fails the goal,
 * and a session that returns nothing usable leaves the notebook as it was.
 */
export function learnFromGoal(engine: Engine, goalId: string, opts: { force?: boolean } = {}): Promise<void> {
  const goal = getGoal(engine.store.db, goalId);
  if (!goal) return Promise.resolve();
  const key = goal.repoPath;
  const next = (chains.get(key) ?? Promise.resolve()).then(() => distill(engine, goalId, opts)).catch((err) => engine.config.log(`[learnings] ${goalId}: ${String(err)}`));
  chains.set(key, next);
  void next.finally(() => chains.get(key) === next && chains.delete(key));
  return next;
}

async function distill(engine: Engine, goalId: string, opts: { force?: boolean }): Promise<void> {
  const { store, config } = engine;
  const goal = getGoal(store.db, goalId);
  if (!goal || isHistory(goal) || engine.isStopped) return;
  // asked for by the person (`force`), it runs with learning switched off, but still only on a goal that ended
  if (!ENDED.has(goal.state) || (!opts.force && !engine.settings.values().workflow.learnings)) return;
  // a goal that never got to work (it failed before its Brief) has nothing to say about the repository
  if (!listTasks(store.db, goal.id).length && !listEscalations(store.db, { goalId: goal.id }).length) return;
  const existing = learningsOf(engine, goal.repoPath);
  // the retro skill opens the session when it is installed (a Claude slash command; Codex has none), writing-for-agents shapes
  // the entries; on the pstack suite the session reflects instead, with reflect's lenses as text (ADR-0050)
  const hints = engine.skillsFor(goal).hints;
  const profile = engine.workflowProfileOf(goal);
  const retro = (goal.provider ?? config.provider) !== 'claude' || profile === 'pstack' ? null : await hints.invokeFor('retro');
  const prompt = buildPrompt(engine, goal, existing, { retro, section: await hints.sectionFor('learnings', { profile }), lens: profile === 'pstack' ? 'reflect' : 'retro' });
  const transcriptPath = join(config.dataDir, 'transcripts', `learnings-${goal.id}.jsonl`);
  mkdirSync(dirname(transcriptPath), { recursive: true });
  writeFileSync(transcriptPath.replace(/\.jsonl$/, '.prompt.md'), prompt);
  const handle = await engine.runner.run({
    prompt,
    cwd: config.dataDir,
    model: goal.models.cheap,
    meta: { goalId: goal.id },
    maxTurns: 8,
    maxBudgetUsd: 0.5,
    permissionMode: 'dontAsk',
    // it may read the transcripts and call a skill (the retro asks for writing-for-agents), nothing else
    allowedTools: ['Read', 'Skill'],
    disallowedTools: ['Bash', 'Write', 'Edit', 'Glob', 'Grep', 'Task', 'WebFetch', 'WebSearch'],
    jsonSchema: jsonSchemaFor(DistillOutput),
    timeoutMs: 4 * 60_000,
    transcriptPath,
    label: `learnings ${goal.title}`,
  });
  const untrack = engine.trackBackground(goal.id, handle);
  let result;
  try {
    for await (const _ of handle.events) void _;
    result = await handle.result;
  } finally {
    untrack();
  }
  if (result.costUsd > 0) store.append({ type: 'goal.cost_added', goalId: goal.id, payload: { costUsd: result.costUsd, source: 'learnings' } });
  engine.recordSessionUsage(result, { goalId: goal.id, kind: 'learnings', model: goal.models.cheap });
  const parsed = DistillOutput.safeParse(result.structuredOutput ?? tryJson(result.finalText));
  if (!parsed.success || result.isError) {
    store.append({ type: 'engine.note', goalId: goal.id, payload: { level: 'info', message: `nothing learned for this folder: the session returned nothing usable (${result.errorMessage ?? result.subtype})` } });
    return;
  }
  // the notebook may have changed while the session ran (the person edited it): merge into what is there now
  const now = learningsOf(engine, goal.repoPath);
  const merged = mergeLearnings(now, parsed.data.learnings, goal);
  const d = learningsDiff(now, merged);
  const note = parsed.data.note.trim().slice(0, 300) || null;
  if (d.added || d.changed || d.dropped) store.append({ type: 'learnings.set', goalId: null, payload: { repoPath: goal.repoPath, learnings: merged, source: 'distill', goalId: goal.id, note } });
  store.append({
    type: 'engine.note',
    goalId: goal.id,
    payload: { level: 'info', message: d.added || d.changed || d.dropped ? `Learnings for this folder: ${[d.added && `+${d.added}`, d.changed && `~${d.changed}`, d.dropped && `−${d.dropped}`].filter(Boolean).join(' ')}${note ? ` — ${note}` : ''}` : `Learnings for this folder: nothing new${note ? ` — ${note}` : ''}` },
  });
}

/** the person's edit of a folder's notebook: what they wrote or changed becomes theirs, what they removed goes */
export function setLearnings(engine: Engine, repoPath: string, entries: { id?: string | null; kind: LearningKindT; text: string }[]): Learning[] {
  const before = new Map(learningsOf(engine, repoPath).map((l) => [l.id, l]));
  const now = new Date().toISOString();
  const seen = new Set<string>();
  const next: Learning[] = [];
  for (const e of entries) {
    const text = e.text.trim().replace(/\s+/g, ' ');
    if (!text) continue;
    if (text.length > LEARNING_MAX_CHARS) throw new Error(`a learning is at most ${LEARNING_MAX_CHARS} characters: "${clip(text, 60)}"`);
    if (seen.has(text.toLowerCase())) continue;
    seen.add(text.toLowerCase());
    const old = e.id ? before.get(e.id) : undefined;
    next.push(old && old.text === text && old.kind === e.kind ? old : { id: old?.id ?? newId('lrn'), kind: e.kind, text, by: 'human', goalId: old?.goalId ?? null, goalTitle: old?.goalTitle ?? null, at: now });
  }
  if (next.length > LEARNINGS_MAX) throw new Error(`${repoPath === LEARNINGS_EVERYWHERE ? 'the everywhere notebook keeps' : 'a folder keeps'} at most ${LEARNINGS_MAX} learnings`);
  engine.store.append({ type: 'learnings.set', goalId: null, payload: { repoPath, learnings: next, source: 'human', goalId: null, note: null } });
  return next;
}

/** a goal can teach its folder once it ended done, over-delivered or failed */
export const endedForLearning = (state: string) => ENDED.has(state);

/** learn when a goal ends; the engine wires this to its event log */
export function learnOnEnd(engine: Engine, goalId: string | null, to: string): void {
  if (goalId && ENDED.has(to)) void learnFromGoal(engine, goalId);
}

/** the learning sessions still running (the engine waits for them when it stops) */
export const learningWork = () => [...chains.values()];
