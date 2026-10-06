import { metaFor, modelFor } from '../models/roles.ts';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Attempt, Check, Goal, ReviewerVerdict, Task } from '@foundry/core';
import { ReviewerVerdict as ReviewerVerdictSchema, chosenStyle, getBrief } from '@foundry/core';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { renderStyle } from '../attempt-prompt.ts';
import type { Engine } from '../engine.ts';
import { diff } from '../git/git.ts';
import { READONLY_DISALLOWED, READONLY_TOOLS, boundarySettings } from '../guards/boundary.ts';
import { reviewDiffDir } from '../workspace.ts';

/**
 * Task-level lightweight review: cheap model, diff + spec only, blockers only.
 * Runs only after objective checks passed (decision 14).
 */
export interface WorkflowObservation {
  /** skills the worker was required to invoke for this task kind */
  mandated: { name: string; invoke: string }[];
  /** skills the worker actually invoked (observed) */
  used: string[];
  observable?: boolean;
}

/** Did the session invoke this skill? Matches bare names and plugin-qualified names. */
export const usedSkill = (used: string[], name: string): boolean => used.some((u) => u === name || u.endsWith(`:${name}`) || u === name.replace(/^\//, ''));

export function formatWorkflowObservation(w: WorkflowObservation | null | undefined): string {
  if (!w?.mandated.length) return '';
  if (w.observable === false) return '# Workflow\nSkill invocation telemetry is unavailable for this backend. Do not infer that required skills were skipped. Review the diff and test evidence on their merits.';
  const lines = w.mandated.map((m) => `- ${m.invoke}: ${usedSkill(w.used, m.name) ? 'invoked ✓' : 'NOT invoked'}`);
  return `# Workflow\nThe worker was required to invoke these skills for this kind of task; observed Skill-tool invocations: ${w.used.length ? w.used.join(', ') : 'none'}.\n${lines.join('\n')}\nA missing invocation is worth a note (the next attempt will read it), not a blocker — judge the diff on its merits.`;
}

/** How much of a task's diff is pasted into the review prompt. A longer diff is pasted file by file up to this size and saved whole. */
export const TASK_REVIEW_INLINE_CHARS = 20_000;
/** Below this much room left, the next file is not started: a few lines of it would only be noise. */
const PART_MIN_CHARS = 1_000;
const CUT_MARK = '[… cut here: the rest of this file is in the saved diff]\n';
/** A diff touching more files than this lists only the files not pasted whole. */
const LIST_MAX = 100;

export interface DiffFile {
  path: string;
  /** null for a binary file, or one a `-diff` attribute hides */
  insertions: number | null;
  deletions: number | null;
  /** how much of this file's diff is pasted */
  shown: 'whole' | 'part' | 'none';
}

/** One `diff --git` section per changed file, in git's order. */
export function diffSections(d: string): string[] {
  return d.split(/^(?=diff --git )/m).filter((s) => s.startsWith('diff --git '));
}

export function sectionPath(s: string): string {
  const moved = s.match(/^(?:rename|copy) to (.+)$/m);
  if (moved?.[1]) return moved[1];
  const eol = s.indexOf('\n');
  const head = s.slice('diff --git '.length, eol < 0 ? s.length : eol);
  // `a/<path> b/<path>` names the same path twice when the file did not move, so split it in the middle: a path may contain spaces
  const half = (head.length - 1) / 2;
  const side = (x: string, p: string) => x.replace(new RegExp(`^"?${p}/`), '').replace(/"$/, '');
  if (Number.isInteger(half) && side(head.slice(0, half), 'a') === side(head.slice(half + 1), 'b')) return side(head.slice(0, half), 'a');
  return head;
}

export function sectionCounts(s: string): Pick<DiffFile, 'insertions' | 'deletions'> {
  const at = s.search(/^@@ /m);
  if (at < 0) return /^Binary files /m.test(s) ? { insertions: null, deletions: null } : { insertions: 0, deletions: 0 };
  let insertions = 0;
  let deletions = 0;
  for (const l of s.slice(at).split('\n')) {
    if (l.startsWith('+')) insertions++;
    else if (l.startsWith('-')) deletions++;
  }
  return { insertions, deletions };
}

/**
 * Fit a diff into `maxChars` without passing a cut file off as a complete one. Whole files go in, in git's order, while
 * they fit (a small file after a large one still gets in); the first file left out then gets the room that is left, cut
 * at a line boundary and marked. `files` is null when the whole diff fits, otherwise every file with how much is pasted.
 */
export function fitDiff(d: string, maxChars: number): { text: string; files: DiffFile[] | null } {
  if (d.length <= maxChars) return { text: d, files: null };
  const sections = diffSections(d);
  if (!sections.length) return { text: d.slice(0, maxChars) + `\n${CUT_MARK}`, files: [] };
  const shown: DiffFile['shown'][] = sections.map(() => 'none');
  let used = 0;
  sections.forEach((s, i) => {
    if (used + s.length > maxChars) return;
    shown[i] = 'whole';
    used += s.length;
  });
  const first = shown.indexOf('none');
  const room = maxChars - used - CUT_MARK.length;
  let part = '';
  if (first >= 0 && (room >= PART_MIN_CHARS || (used === 0 && room > 0))) {
    const s = sections[first]!;
    const nl = s.lastIndexOf('\n', room - 1);
    part = (nl > 0 ? s.slice(0, nl + 1) : s.slice(0, room - 1) + '\n') + CUT_MARK;
    shown[first] = 'part';
  }
  const text = sections.map((s, i) => (shown[i] === 'whole' ? s : shown[i] === 'part' ? part : '')).join('');
  return { text, files: sections.map((s, i) => ({ path: sectionPath(s), ...sectionCounts(s), shown: shown[i]! })) };
}

const SHOWN_LABEL: Record<DiffFile['shown'], string> = { whole: 'whole', part: 'first part only, cut at a line boundary', none: 'not shown' };
function fmtChange(f: DiffFile): string {
  if (f.insertions === null) return 'binary';
  const parts = [f.insertions ? `+${f.insertions}` : '', f.deletions ? `−${f.deletions}` : ''].filter(Boolean);
  return parts.length ? parts.join(' ') : 'no line changes';
}

/** The prompt's Diff section: the diff itself, or — when it was cut — what was left out and where to read it. */
export function renderDiffSection(fit: { text: string; files: DiffFile[] | null }, totalChars: number, savedAt: string | null): string {
  const block = `\`\`\`diff\n${fit.text}\n\`\`\``;
  if (!fit.files) return `# Diff\n${block}`;
  const listed = fit.files.length <= LIST_MAX ? fit.files : fit.files.filter((f) => f.shown !== 'whole').slice(0, LIST_MAX);
  const lines = listed.map((f) => `- \`${f.path}\` (${fmtChange(f)}): ${SHOWN_LABEL[f.shown]}`);
  if (listed.length < fit.files.length) lines.push(`- … ${fit.files.length - listed.length} more files: the ones pasted whole are below, the rest only in the saved diff`);
  const where = savedAt
    ? `The complete diff is saved at \`${savedAt}\`. Before you say anything about a file that is cut or not shown, read its part of that file (Grep for its path, then Read with an offset) or open the file itself.`
    : 'Before you say anything about a file that is cut or not shown, open the file itself.';
  return [
    `# Diff (partial)`,
    `This task's diff is ${totalChars.toLocaleString('en-US')} characters, too long to paste whole: below are whole files while they fit, then the first part of one more. Every changed file, with how much of it is below:`,
    lines.join('\n'),
    `${where} A file that stops at a cut or is missing from the pasted part is NOT incomplete and NOT missing from the change.`,
    block,
  ].join('\n');
}

function saveTaskDiff(engine: Engine, goal: Goal, attempt: Attempt, d: string): string | null {
  try {
    const dir = reviewDiffDir(engine.config.dataDir, goal);
    mkdirSync(dir, { recursive: true });
    const p = join(dir, `task-diff-${attempt.id}.patch`);
    writeFileSync(p, d);
    return p;
  } catch {
    return null;
  }
}

export async function reviewTaskDiff(engine: Engine, goal: Goal, task: Task, attempt: Attempt, cwd: string, baseRef: string, checks: Check[], workflow?: WorkflowObservation | null): Promise<ReviewerVerdict | null> {
  const d = await diff(cwd, baseRef, 'HEAD', Number.POSITIVE_INFINITY);
  if (!d.trim()) return { pass: false, blockers: ['No changes were made in this attempt.'] };
  const fit = fitDiff(d, TASK_REVIEW_INLINE_CHARS);
  const savedAt = fit.files ? saveTaskDiff(engine, goal, attempt, d) : null;
  const rubric = checks
    .map((c) => (c.spec.type === 'reviewer' ? `- ${c.name}: ${c.spec.rubric}` : ''))
    .filter(Boolean)
    .join('\n');
  const reviewerHint = await engine.skillsFor(goal).hints.sectionFor('reviewer-task', { scenario: task.scenario });
  const media =
    task.scenario === 'image'
      ? `# Media review\nThe artifacts themselves are the deliverable and they are NOT in the diff (the \`artifacts/\` folder is kept out of git). Read the task's manifest (\`docs/artifacts/…\` in the diff), then open each listed image under \`artifacts/\` with the Read tool — it renders images — and judge what you see against the task and rubric. An artifact listed in the manifest but missing on disk, or clearly not matching its description, is a blocker.`
      : task.scenario === 'video'
        ? `# Media review\nThe artifacts themselves are the deliverable and they are NOT in the diff (the \`artifacts/\` folder is kept out of git). Read the task's manifest (\`docs/artifacts/…\` in the diff) and verify each listed file exists under \`artifacts/\`. You cannot watch video: verify metadata with \`ffprobe\` if available, and if \`ffmpeg\` is available extract 2–3 frames (\`ffmpeg -i <file> -vf "select=gt(scene\\,0.3)" -frames:v 3 /tmp/frame%d.png\`) and view them with the Read tool. A file listed but missing, or metadata contradicting the spec (duration, resolution), is a blocker; final visual quality stays with the human.`
        : '';
  const brief = getBrief(engine.store.db, goal.id)?.brief;
  const style = brief && ['image', 'video', 'frontend', 'fullstack'].includes(task.scenario) ? renderStyle(chosenStyle(brief), { forReviewer: true }) : '';
  const prompt = [
    `# Task (${task.kind}${task.scenario !== 'general' ? `, ${task.scenario}` : ''})\n${task.title}\n\n${task.spec}`,
    rubric ? `# Rubric (verify each)\n${rubric}` : '',
    style,
    media,
    reviewerHint ?? '',
    formatWorkflowObservation(workflow),
    renderDiffSection(fit, d.length, savedAt),
    `${fit.files ? 'The diff above is partial — judge what it shows, and read the rest of every file it lists as cut or not shown before you say anything about that file; never report a file as incomplete or a change as missing only because it is not in the pasted part.' : 'The diff is above — judge from it; open at most a few files, only when the diff cannot answer.'} Review it against the task on two axes — Spec (does it do what the task and rubric ask?) and Standards (does it follow this repository's conventions?). Report BLOCKERS only: correctness bugs, security issues, scope violations (changes clearly outside the task), destroyed functionality, hard-coded secrets, or rubric items not met. Style nits are not blockers. If there are no blockers, pass.\n\nOutput: call the structured-output tool with the verdict object itself as its arguments — top-level keys \`pass\` (boolean), \`blockers\` (string[]), \`notes\` (string) and nothing else. Do NOT wrap it in a string or under a \`parameters\` key; that fails validation and costs a retry.`,
  ]
    .filter(Boolean)
    .join('\n\n');

  const handle = await engine.runner.run({
    prompt,
    cwd,
    model: modelFor(engine.config, goal, 'taskReviewer').model,
    meta: metaFor(goal.id, modelFor(engine.config, goal, 'taskReviewer')),
    // the cheap model sometimes spends its turns reading files; give it room, and nudge once below if it still returns no JSON
    maxTurns: 20,
    maxBudgetUsd: 0.8,
    permissionMode: 'dontAsk',
    allowedTools: READONLY_TOOLS,
    disallowedTools: READONLY_DISALLOWED,
    appendSystemPromptFile: engine.roles.path('reviewer-task'),
    jsonSchema: zodToJsonSchema(ReviewerVerdictSchema, { $refStrategy: 'none' }),
    settings: boundarySettings(engine.config.hooksDir),
    settingSources: engine.config.settingSources,
    timeoutMs: 5 * 60_000,
    transcriptPath: join(engine.config.dataDir, 'transcripts', `${attempt.id}.review.jsonl`),
    label: `review ${task.title}`,
  });
  const started = new Date().toISOString();
  let initModel: string | null = null;
  for await (const ev of handle.events) {
    if (ev.kind === 'init') initModel = ev.model;
    engine.broadcast({ goalId: goal.id, taskId: task.id, attemptId: attempt.id, event: ev, ts: new Date().toISOString(), role: 'reviewer' });
  }
  const r = await handle.result;
  engine.store.append({ type: 'goal.cost_added', goalId: goal.id, payload: { costUsd: r.costUsd, source: `review-task:${attempt.id}` } });
  engine.recordSessionUsage(r, { goalId: goal.id, kind: 'review-task', model: modelFor(engine.config, goal, 'taskReviewer').model });
  engine.store.append({ type: 'attempt.session_finished', goalId: goal.id, payload: { attemptId: attempt.id, session: { role: 'reviewer', segment: attempt.continuations, sessionId: r.sessionId, model: initModel ?? modelFor(engine.config, goal, 'taskReviewer').model, costUsd: r.costUsd, numTurns: r.numTurns, durationMs: r.durationMs, subtype: r.subtype, startedAt: started, endedAt: new Date().toISOString() } } });
  let parsed = ReviewerVerdictSchema.safeParse(r.structuredOutput ?? tryJson(r.finalText));
  if (!parsed.success && r.sessionId) {
    // one nudge in the same session: "stop reading, answer now"
    const again = await engine.runner.run({
      prompt: 'Stop exploring. Reply now with ONLY the JSON verdict matching the schema (pass, blockers, notes). If you are unsure, pass with a note.',
      cwd,
      model: modelFor(engine.config, goal, 'taskReviewer').model,
      meta: metaFor(goal.id, modelFor(engine.config, goal, 'taskReviewer')),
      maxTurns: 2,
      maxBudgetUsd: 0.2,
      permissionMode: 'dontAsk',
      allowedTools: READONLY_TOOLS,
      disallowedTools: READONLY_DISALLOWED,
      jsonSchema: zodToJsonSchema(ReviewerVerdictSchema, { $refStrategy: 'none' }),
      settings: boundarySettings(engine.config.hooksDir),
      settingSources: engine.config.settingSources,
      resumeSessionId: r.sessionId,
      timeoutMs: 3 * 60_000,
      transcriptPath: join(engine.config.dataDir, 'transcripts', `${attempt.id}.review.jsonl`),
      label: `review ${task.title} (nudge)`,
    });
    const started2 = new Date().toISOString();
    for await (const ev of again.events) engine.broadcast({ goalId: goal.id, taskId: task.id, attemptId: attempt.id, event: ev, ts: new Date().toISOString(), role: 'reviewer' });
    const r2 = await again.result;
    engine.store.append({ type: 'goal.cost_added', goalId: goal.id, payload: { costUsd: r2.costUsd, source: `review-task:${attempt.id}` } });
    engine.recordSessionUsage(r2, { goalId: goal.id, kind: 'review-task', model: modelFor(engine.config, goal, 'taskReviewer').model });
    engine.store.append({ type: 'attempt.session_finished', goalId: goal.id, payload: { attemptId: attempt.id, session: { role: 'reviewer', segment: attempt.continuations, sessionId: r2.sessionId, model: initModel ?? modelFor(engine.config, goal, 'taskReviewer').model, costUsd: r2.costUsd, numTurns: r2.numTurns, durationMs: r2.durationMs, subtype: r2.subtype, startedAt: started2, endedAt: new Date().toISOString() } } });
    parsed = ReviewerVerdictSchema.safeParse(r2.structuredOutput ?? tryJson(r2.finalText));
  }
  if (!parsed.success) {
    engine.store.append({ type: 'engine.note', goalId: goal.id, payload: { level: 'warn', message: `task reviewer returned no verdict for attempt ${attempt.id} (${r.subtype}${r.errorMessage ? `: ${r.errorMessage.slice(0, 120)}` : ''}) — objective checks decide this attempt` } });
    return null;
  }
  return parsed.data;
}

export function tryJson(s: string | null): unknown {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    const m = s.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]);
      } catch {}
    }
    return null;
  }
}
