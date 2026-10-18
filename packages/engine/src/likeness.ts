/**
 * The Likeness review (ADR-0042): when a milestone is recorded in a goal whose Subjects have pictures, one read-only
 * session puts the recording's pictures (its screenshots, a milestone of files' images, frames of its clips) next to the
 * Subjects' pictures and says how close each Subject is and what differs. Major differences become one fix task per
 * milestone, which re-opens it like a feedback fix; the recording after it lands is reviewed again, and only reported.
 */
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { BriefSubject, EngineEvent, Goal, LikenessVerdict, Task } from '@foundry/core';
import { LikenessVerdict as LikenessVerdictSchema, getBrief, getGoal, getTask, listTasks, majorDifferences } from '@foundry/core';
import type { MilestoneEvidence } from './checks/walkthrough.ts';
import type { Engine } from './engine.ts';
import { createFixTasks } from './fix-tasks.ts';
import { READONLY_DISALLOWED, READONLY_TOOLS, boundarySettings } from './guards/boundary.ts';
import { metaFor, modelFor } from './models/roles.ts';
import { subjectsDir } from './subjects.ts';
import { goalWorkspacePath, screenshotsDir } from './workspace.ts';

export const LIKENESS_BUDGET_USD = 0.8;
/** the recording's pictures one review looks at, at most */
const MAX_SHOTS = 8;
const IMAGE = /\.(png|jpe?g|webp|gif)$/i;
/** the goal states in which a fix task is added: the goal still works (a pause for a look included) */
const WORKING = new Set(['running', 'awaiting_feedback']);

/** the reviews running now, as `<goalId>:<taskId>` */
const reviewing = new Set<string>();

/** the milestones (task ids) of a goal whose recording is being compared with the pictures now */
export function likenessRunsFor(goalId: string): string[] {
  return [...reviewing].filter((k) => k.startsWith(`${goalId}:`)).map((k) => k.slice(goalId.length + 1));
}

/** the Subjects with pictures: what a review compares against */
const withPictures = (goalId: string, engine: Engine): BriefSubject[] => (getBrief(engine.store.db, goalId)?.brief.subjects ?? []).filter((s) => s.pictures.length > 0);

/**
 * A milestone was recorded: review it when its goal has Subject pictures and the recording has pictures of its own. The
 * final walkthrough's recordings are not reviewed (each milestone was, when it landed). Never throws.
 */
export function onMilestoneEvidence(engine: Engine, e: Extract<EngineEvent, { type: 'milestone.evidence' }>): void {
  const ev = e.payload;
  if (!e.goalId || ev.final || ev.status === 'fail') return;
  const goal = getGoal(engine.store.db, e.goalId);
  const task = getTask(engine.store.db, ev.taskId);
  if (!goal || !task || !withPictures(goal.id, engine).length) return;
  if (!ev.shots.some((s) => IMAGE.test(s.file)) && !(ev.kind === 'files' && ev.clips?.length)) return;
  const key = `${goal.id}:${task.id}`;
  if (reviewing.has(key)) return;
  reviewing.add(key);
  void reviewLikeness(engine, goal, task, ev as MilestoneEvidence, e.ts)
    .catch((err) => engine.store.append({ type: 'milestone.likeness', goalId: goal.id, payload: { taskId: task.id, evidenceAt: e.ts, status: 'failed', verdict: null, detail: String((err as Error).message ?? err).slice(0, 300), costUsd: 0, fixTaskId: null } }))
    .finally(() => reviewing.delete(key));
}

/** a few frames of each clip of a milestone of files (video), when ffmpeg is here; [] otherwise */
async function framesOf(clips: { file: string; caption: string }[], shots: string, into: string): Promise<{ file: string; caption: string }[]> {
  const ffmpeg = Bun.which('ffmpeg');
  if (!ffmpeg) return [];
  const out: { file: string; caption: string }[] = [];
  for (const [i, c] of clips.slice(0, 2).entries()) {
    const src = join(shots, c.file);
    if (!existsSync(src)) continue;
    const r = Bun.spawnSync([ffmpeg, '-v', 'error', '-i', src, '-vf', 'fps=1/2', '-frames:v', '3', join(into, `clip${i + 1}-%d.png`)], { stdout: 'ignore', stderr: 'ignore' });
    if (r.exitCode !== 0) continue;
    for (const f of readdirSync(into).filter((f) => f.startsWith(`clip${i + 1}-`)).sort()) out.push({ file: join(into, f), caption: `${c.caption || c.file}, a frame` });
  }
  return out;
}

export function likenessPrompt(goal: Goal, task: Task, subjects: BriefSubject[], dataDir: string, shots: { file: string; caption: string }[], summary: string): string {
  const pictures = subjects
    .map((s) => [`- **${s.name}** (key ${s.key})${s.lookFor ? ` — ${s.lookFor}` : ''}`, ...s.pictures.map((p) => `  - \`${join(subjectsDir(dataDir, goal.id), p.file)}\`${p.caption ? ` — ${p.caption}` : ''}`)].join('\n'))
    .join('\n');
  return [
    `# Goal\n${goal.title}\n\n${goal.prompt.slice(0, 1500)}`,
    `# Subjects: what the result must look like (pictures approved by the human)\n${pictures}`,
    `# The milestone's recording\n"${task.title}"${task.milestone ? `: ${task.milestone}` : ''}${summary ? `\n${summary}` : ''}\n${shots.map((s) => `- \`${s.file}\`${s.caption ? ` — ${s.caption}` : ''}`).join('\n')}`,
    `# Your job\nFor each Subject, find the shots that show it and open them with the Read tool next to its pictures. Compare the proportions and the silhouette first, then the distinctive features, then colours and materials. Score how much it looks like the pictures, list what already matches and every difference worth fixing, the most visible first, each said as the fix and marked major when someone who knows the subject would notice it at a glance. A Subject no shot shows is \`shown: false\`, with no score and no differences. Judge only the look of the Subjects, not the rest of the page; a style the goal asks for on purpose (stylised, low-poly) is not a difference, its proportions and features still are.\n\nOutput: call the structured-output tool with the verdict object itself as its arguments.`,
  ].join('\n\n');
}

/** compare one milestone recording with the Subjects' pictures; records `milestone.likeness`, and the fix task when due */
export async function reviewLikeness(engine: Engine, goalIn: Goal, task: Task, ev: MilestoneEvidence, evidenceAt: string): Promise<void> {
  const { store, config } = engine;
  const subjects = withPictures(goalIn.id, engine);
  const shotsDir = screenshotsDir(config.dataDir, goalIn);
  const tmp = mkdtempSync(join(config.dataDir, 'likeness-'));
  try {
    const frames = ev.kind === 'files' && ev.clips?.length ? await framesOf(ev.clips, shotsDir, tmp) : [];
    const shots = [...ev.shots.filter((s) => IMAGE.test(s.file) && existsSync(join(shotsDir, s.file))).map((s) => ({ file: join(shotsDir, s.file), caption: s.caption })), ...frames].slice(0, MAX_SHOTS);
    if (!shots.length) return;
    const role = modelFor(config, goalIn, 'taskReviewer');
    const ws = goalWorkspacePath(config.dataDir, goalIn);
    const handle = await engine.runner.run({
      prompt: likenessPrompt(goalIn, task, subjects, config.dataDir, shots, ev.summary),
      cwd: existsSync(ws) ? ws : shotsDir,
      model: role.model,
      meta: metaFor(goalIn.id, role),
      maxTurns: 20,
      maxBudgetUsd: LIKENESS_BUDGET_USD,
      permissionMode: 'dontAsk',
      allowedTools: READONLY_TOOLS,
      disallowedTools: READONLY_DISALLOWED,
      jsonSchema: zodToJsonSchema(LikenessVerdictSchema, { $refStrategy: 'none' }),
      settings: boundarySettings(config.hooksDir),
      settingSources: config.settingSources,
      addDirs: [shotsDir, subjectsDir(config.dataDir, goalIn.id), ...(frames.length ? [tmp] : [])],
      timeoutMs: 5 * 60_000,
      transcriptPath: join(config.dataDir, 'transcripts', `likeness-${goalIn.id}-${task.id}-${Date.now()}.jsonl`),
      label: `likeness ${task.title}`,
    });
    for await (const e of handle.events) engine.broadcast({ goalId: goalIn.id, taskId: task.id, attemptId: `likeness-${goalIn.id}`, event: e, ts: new Date().toISOString() });
    const r = await handle.result;
    store.append({ type: 'goal.cost_added', goalId: goalIn.id, payload: { costUsd: r.costUsd, source: 'likeness' } });
    engine.recordSessionUsage(r, { goalId: goalIn.id, kind: 'likeness', model: role.model });
    const parsed = LikenessVerdictSchema.safeParse(r.structuredOutput ?? parseJson(r.finalText));
    if (!parsed.success) {
      store.append({ type: 'milestone.likeness', goalId: goalIn.id, payload: { taskId: task.id, evidenceAt, status: 'failed', verdict: null, detail: `no verdict (${r.subtype}${r.errorMessage ? `: ${r.errorMessage.slice(0, 120)}` : ''})`, costUsd: r.costUsd, fixTaskId: null } });
      return;
    }
    // only the Subjects of this Brief: a key the session made up is left out
    const verdict: LikenessVerdict = { ...parsed.data, subjects: parsed.data.subjects.filter((s) => subjects.some((x) => x.key === s.key)) };
    const fixTaskId = fixFor(engine, goalIn.id, task, verdict, subjects, shots);
    store.append({ type: 'milestone.likeness', goalId: goalIn.id, payload: { taskId: task.id, evidenceAt, status: 'ok', verdict, detail: '', costUsd: r.costUsd, fixTaskId } });
    config.log(`[likeness] ${goalIn.id} ${task.id}: ${verdict.subjects.map((s) => `${s.key} ${s.shown ? `${s.score ?? '?'}/10` : 'not shown'}`).join(', ')}${fixTaskId ? ` → fix ${fixTaskId}` : ''}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

const parseJson = (s: string | null): unknown => {
  try {
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
};

/**
 * One fix task per milestone for the major differences, while the goal still works; it re-opens the milestone once it
 * lands, like a feedback fix, and the recording then is reviewed again without another fix. Null when none is due.
 */
function fixFor(engine: Engine, goalId: string, task: Task, verdict: LikenessVerdict, subjects: BriefSubject[], shots: { file: string; caption: string }[]): string | null {
  const off = majorDifferences(verdict);
  const goal = getGoal(engine.store.db, goalId);
  if (!off.length || !goal || !WORKING.has(goal.state)) return null;
  if (listTasks(engine.store.db, goalId).some((t) => t.origin === 'likeness-fix' && t.checkpointOf === task.id)) return null;
  const dir = subjectsDir(engine.config.dataDir, goalId);
  const name = (k: string) => subjects.find((s) => s.key === k)?.name ?? k;
  const sections = off.map((v) => {
    const s = subjects.find((x) => x.key === v.key);
    const compared = shots.filter((x) => v.shots.some((f) => x.file.endsWith(f)));
    return [
      `## ${name(v.key)}: ${v.score ?? '?'}/10`,
      `Pictures: ${(s?.pictures ?? []).map((p) => `\`${join(dir, p.file)}\``).join(', ')}`,
      compared.length ? `Shots compared: ${compared.map((x) => `\`${x.file}\``).join(', ')}` : '',
      ...v.differences.map((d) => `- ${d.major ? '(major) ' : ''}${d.what}`),
      v.matches.length ? `Already right, keep it: ${v.matches.join('; ')}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  });
  const spec = [
    `Foundry compared the milestone "${task.title}" with the pictures of what it depicts and found differences someone who knows it would notice at a glance.`,
    ...sections,
    'Change what makes it (the model, the scene, the image) so it matches the pictures; the milestone still has to show what it showed. Open the pictures with the Read tool, render the same views again, compare them with the pictures before you finish, and name the renders in your summary.',
  ].join('\n\n');
  const title = `match ${name(off[0]!.key)} to its pictures`.slice(0, 60);
  const [id] = createFixTasks(engine, goal, [{ title, spec, relevantFiles: task.relevantFiles }], null, { origin: 'likeness-fix', checkpointOf: task.id });
  if (id) engine.store.append({ type: 'engine.note', goalId, payload: { level: 'info', message: `the Likeness review of "${task.title}" found major differences from the pictures; "${title}" fixes them` } });
  return id ?? null;
}

/** the latest reviewed recording of each milestone of a goal, with the milestone's title (for the goal reviewer) */
export function latestLikeness(engine: Engine, goalId: string): { title: string; verdict: LikenessVerdict }[] {
  const latest = new Map<string, LikenessVerdict>();
  for (const e of engine.store.listByGoalOfTypes(goalId, ['milestone.likeness'])) {
    const p = e.payload as { taskId: string; verdict: LikenessVerdict | null; status: string };
    if (p.status === 'ok' && p.verdict) latest.set(p.taskId, p.verdict);
  }
  return [...latest].map(([taskId, verdict]) => ({ title: getTask(engine.store.db, taskId)?.title ?? taskId, verdict }));
}
