/**
 * Subjects (ADR-0042): the real things a goal depicts, and their pictures. Pictures live under
 * `<dataDir>/subjects/<goal>/`, outside the repository and the workspace: they never land, are never delivered, survive a
 * Re-run Clarify and travel with a Transfer. While the Brief waits, Foundry searches pictures for a Subject that has none
 * (once, by itself; again on the person's request), and the person adds and removes their own on the Brief page.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { Brief, BriefSubject, Goal, LikenessVerdict, OutputSubject, SubjectPicture } from '@foundry/core';
import { SUBJECT_LIMITS, attachmentKindLabel, getBrief, getGoal, nextSubjectKey, subjectSearchDue, subjectsApply } from '@foundry/core';
import { attachmentAbsPath } from './attachments.ts';
import type { Engine } from './engine.ts';
import { boundarySettings } from './guards/boundary.ts';
import { metaFor, modelFor } from './models/roles.ts';
import { goalWorkspacePath } from './workspace.ts';

/** a session's answer as JSON when it wrote it as text */
const tryJson = (s: string | null): unknown => {
  try {
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
};

/** a search runs on the Style samples model: a few web searches, downloads and looks; capped per Subject */
export const SUBJECT_SEARCH_BUDGET_USD = 1.5;
/** the pictures a search keeps at most, of the Subject's limit */
const SEARCH_KEEPS = 4;
/** smaller than this is a thumbnail or an error page, not a picture to build from */
const MIN_PICTURE_BYTES = 4 * 1024;

export class SubjectError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 404 | 409 = 400,
  ) {
    super(message);
  }
}

export const subjectsDir = (dataDir: string, goalId: string) => join(dataDir, 'subjects', goalId);
/** where a search downloads to; the engine keeps from it only what is a picture */
const incomingDir = (dataDir: string, goalId: string, key: string) => join(subjectsDir(dataDir, goalId), '.incoming', key);

/** a picture's path in the goal's subjects folder; null for anything but a plain file name there */
export function subjectPicturePath(dataDir: string, goalId: string, file: string): string | null {
  return /^[\w-][\w.-]*$/.test(file) && !file.includes('..') ? join(subjectsDir(dataDir, goalId), file) : null;
}

/** what a picture is by its first bytes; null for anything that is not a PNG, JPEG, WebP or GIF */
export function imageType(b: Uint8Array): 'png' | 'jpg' | 'webp' | 'gif' | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
  if (b.length >= 8 && b[0] === 0x89 && ascii(1, 4) === 'PNG') return 'png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'webp';
  if (b.length >= 6 && ascii(0, 4) === 'GIF8') return 'gif';
  return null;
}

/** keep picture bytes for a Subject under its next free name, `<key>-<n>.<type>`; throws for what is not a picture */
export function storePicture(dataDir: string, goalId: string, key: string, bytes: Uint8Array): string {
  if (bytes.byteLength > SUBJECT_LIMITS.pictureBytes) throw new SubjectError(`the picture is ${(bytes.byteLength / 1048576).toFixed(1)} MB; the limit is ${SUBJECT_LIMITS.pictureBytes / 1048576} MB`);
  const type = imageType(bytes);
  if (!type) throw new SubjectError('not a picture: a PNG, JPEG, WebP or GIF file is needed');
  const dir = subjectsDir(dataDir, goalId);
  mkdirSync(dir, { recursive: true });
  const taken = new Set(readdirSync(dir).map((f) => f.replace(/\.[^.]+$/, '')));
  let n = 1;
  while (taken.has(`${key}-${n}`)) n++;
  const file = `${key}-${n}.${type}`;
  writeFileSync(join(dir, file), bytes);
  return file;
}

function waitingBrief(engine: Engine, goalId: string): { goal: Goal; brief: Brief; subjects: BriefSubject[] } {
  const goal = getGoal(engine.store.db, goalId);
  if (!goal) throw new SubjectError(`goal ${goalId} not found`, 404);
  if (goal.state !== 'awaiting_brief_approval') throw new SubjectError(`goal is ${goal.state}; Subjects change while the Brief awaits approval`, 409);
  const brief = getBrief(engine.store.db, goalId)?.brief;
  if (!brief) throw new SubjectError('this goal has no Brief yet', 409);
  return { goal, brief, subjects: brief.subjects ?? [] };
}

function subjectOf(subjects: BriefSubject[], key: string): BriefSubject {
  const s = subjects.find((x) => x.key === key);
  if (!s) throw new SubjectError(`no Subject ${key} on this Brief`, 404);
  return s;
}

/** name a Subject on the waiting Brief; Foundry looks for its pictures right away unless `search` is false */
export function addSubject(engine: Engine, goalId: string, input: { name: string; lookFor?: string; search?: boolean }): BriefSubject {
  const { subjects } = waitingBrief(engine, goalId);
  const name = input.name.trim();
  if (!name) throw new SubjectError('a Subject needs a name');
  if (subjects.length >= SUBJECT_LIMITS.subjects) throw new SubjectError(`a Brief has at most ${SUBJECT_LIMITS.subjects} Subjects`, 409);
  const key = nextSubjectKey(subjects);
  engine.store.append({ type: 'brief.subject_set', goalId, payload: { subject: { key, name, lookFor: input.lookFor?.trim() ?? '' } } });
  if (input.search !== false) startSubjectSearch(engine, goalId, key);
  return subjectOf(getBrief(engine.store.db, goalId)!.brief.subjects ?? [], key);
}

export function updateSubject(engine: Engine, goalId: string, key: string, input: { name?: string; lookFor?: string }): void {
  const s = subjectOf(waitingBrief(engine, goalId).subjects, key);
  const name = input.name?.trim() || s.name;
  engine.store.append({ type: 'brief.subject_set', goalId, payload: { subject: { key, name, lookFor: input.lookFor?.trim() ?? s.lookFor } } });
}

export function removeSubject(engine: Engine, goalId: string, key: string): void {
  subjectOf(waitingBrief(engine, goalId).subjects, key);
  engine.store.append({ type: 'brief.subject_removed', goalId, payload: { subjectKey: key } });
}

/** the person's own picture of a Subject (an upload on the Brief page) */
export function addSubjectPicture(engine: Engine, goalId: string, key: string, bytes: Uint8Array, caption = ''): SubjectPicture {
  const s = subjectOf(waitingBrief(engine, goalId).subjects, key);
  if (s.pictures.length >= SUBJECT_LIMITS.pictures) throw new SubjectError(`a Subject has at most ${SUBJECT_LIMITS.pictures} pictures; remove one first`, 409);
  const picture: SubjectPicture = { file: storePicture(engine.config.dataDir, goalId, key, bytes), source: 'person', url: null, caption: caption.trim().slice(0, 200) };
  engine.store.append({ type: 'brief.subject_pictures', goalId, payload: { subjectKey: key, added: [picture], removed: [] } });
  return picture;
}

/** a picture leaves the Subject; its file stays in the folder (it may be shown in an earlier recording's review) */
export function removeSubjectPicture(engine: Engine, goalId: string, key: string, file: string): void {
  const s = subjectOf(waitingBrief(engine, goalId).subjects, key);
  if (!s.pictures.some((p) => p.file === file)) throw new SubjectError(`${file} is not a picture of ${s.name}`, 404);
  engine.store.append({ type: 'brief.subject_pictures', goalId, payload: { subjectKey: key, added: [], removed: [file] } });
}

/** the searches running now, as `<goalId>:<key>` */
const searching = new Set<string>();

/** the Subjects of a goal whose pictures are being searched now */
export function subjectSearchesFor(goalId: string): string[] {
  return [...searching].filter((k) => k.startsWith(`${goalId}:`)).map((k) => k.slice(goalId.length + 1));
}

/** search pictures of one Subject (fire-and-forget): the result arrives as a `brief.subject_searched` event */
export function startSubjectSearch(engine: Engine, goalId: string, key: string): void {
  const s = subjectOf(waitingBrief(engine, goalId).subjects, key);
  if (s.pictures.length >= SUBJECT_LIMITS.pictures) throw new SubjectError(`${s.name} has ${SUBJECT_LIMITS.pictures} pictures already; remove some first`, 409);
  const id = `${goalId}:${key}`;
  if (searching.has(id)) throw new SubjectError(`pictures of ${s.name} are being searched now`, 409);
  searching.add(id);
  void search(engine, goalId, s)
    .catch((err) => engine.store.append({ type: 'brief.subject_searched', goalId, payload: { subjectKey: key, status: 'failed', pictures: [], costUsd: 0, detail: String((err as Error).message ?? err).slice(0, 300) } }))
    .finally(() => {
      searching.delete(id);
      engine.tick(goalId);
    });
}

/**
 * While the Brief waits: search, once, for every Subject that has no pictures and was never searched. True while a
 * search of the goal runs: the Brief cannot be approved until its pictures are in.
 */
export function startDueSearches(engine: Engine, goal: Goal): boolean {
  if (goal.state !== 'awaiting_brief_approval') return false;
  for (const s of getBrief(engine.store.db, goal.id)?.brief.subjects ?? []) {
    if (!subjectSearchDue(s) || searching.has(`${goal.id}:${s.key}`)) continue;
    try {
      startSubjectSearch(engine, goal.id, s.key);
    } catch (err) {
      engine.config.log(`[subjects] ${goal.id} ${s.key}: ${String((err as Error).message ?? err)}`);
    }
  }
  return subjectSearchesFor(goal.id).length > 0;
}

const SearchOutput = z.object({
  pictures: z
    .array(
      z.object({
        file: z.string().describe('The file name in the download folder, e.g. 1.jpg'),
        url: z.string().describe('The page the picture was found on'),
        caption: z.string().describe('What it shows: the view, e.g. "front three-quarter", "side profile", "the dashboard"'),
      }),
    )
    .describe('The pictures you kept, the best first.'),
  note: z.string().describe('One sentence: what you found, or why nothing.'),
});

export function searchPrompt(goal: Goal, s: BriefSubject, folder: string, room: number): string {
  return [
    `# Goal (for context)\n${goal.prompt.slice(0, 1500)}`,
    `# Find pictures of a real thing\nSubject: ${s.name}${s.lookFor ? `\nWhat must match: ${s.lookFor}` : ''}${s.pictures.length ? `\nIt has ${s.pictures.length} picture(s) already (${s.pictures.map((p) => p.caption || p.file).join(', ')}): find other views.` : ''}`,
    `# Your job\nSearch the web for up to ${Math.min(room, SEARCH_KEEPS)} pictures of exactly this subject: this model, this generation or year, not a similar one. Official press pictures and renders first, then good photos. Together they show it the way the result will be seen: front three-quarter, side, rear three-quarter, and any detail named above. Each one at least 800 px wide, at most 5 MB, PNG, JPEG or WebP, with no text or heavy watermark across it.\n- Download each with curl (\`curl -fsSL -A "Mozilla/5.0" -o <file> "<image URL>"\`) into \`${folder}\` as \`1.jpg\`, \`2.png\`… (the picture's own type).\n- Open every file with the Read tool. Delete one that does not show exactly this subject, is an error page, a thumbnail, or mostly text.\n- Create, change or commit nothing else.\n\nOutput: the pictures you kept, each with its file name, the page it was found on, and what it shows.`,
  ].join('\n\n');
}

async function search(engine: Engine, goalId: string, s: BriefSubject): Promise<void> {
  const { store, config } = engine;
  const goal = getGoal(store.db, goalId)!;
  const folder = incomingDir(config.dataDir, goalId, s.key);
  rmSync(folder, { recursive: true, force: true });
  mkdirSync(folder, { recursive: true });
  const room = SUBJECT_LIMITS.pictures - s.pictures.length;
  const ws = goalWorkspacePath(config.dataDir, goal);
  const role = modelFor(config, goal, 'styleSample');
  const handle = await engine.runner.run({
    prompt: searchPrompt(goal, s, folder, room),
    cwd: existsSync(ws) ? ws : folder,
    model: role.model,
    meta: metaFor(goalId, role),
    maxTurns: 30,
    maxBudgetUsd: SUBJECT_SEARCH_BUDGET_USD,
    permissionMode: 'dontAsk',
    ...engine.workerToolPolicy(goal),
    addDirs: [folder],
    jsonSchema: zodToJsonSchema(SearchOutput, { $refStrategy: 'none' }),
    settings: boundarySettings(config.hooksDir),
    settingSources: config.settingSources,
    timeoutMs: 6 * 60_000,
    transcriptPath: join(config.dataDir, 'transcripts', `subject-search-${goalId}-${s.key}.jsonl`),
    label: `subject pictures ${s.name}`,
  });
  for await (const ev of handle.events) engine.broadcast({ goalId, taskId: null, attemptId: `subject-search-${goalId}`, event: ev, ts: new Date().toISOString() });
  const r = await handle.result;
  store.append({ type: 'goal.cost_added', goalId, payload: { costUsd: r.costUsd, source: 'subject-search' } });
  engine.recordSessionUsage(r, { goalId, kind: 'subject-search', model: role.model });
  const out = SearchOutput.safeParse(r.structuredOutput ?? tryJson(r.finalText));
  // a session that ran out before answering still leaves its downloads: those are looked at the same way, uncaptioned
  const listed = out.success ? out.data.pictures : readdirSync(folder).sort().map((file) => ({ file, url: '', caption: '' }));
  const kept: SubjectPicture[] = [];
  const skipped: string[] = [];
  for (const p of listed) {
    if (kept.length >= Math.min(room, SEARCH_KEEPS)) break;
    const src = join(folder, basename(p.file));
    try {
      const bytes = readFileSync(src);
      if (!imageType(bytes)) throw new SubjectError('not a picture');
      if (bytes.byteLength < MIN_PICTURE_BYTES) throw new SubjectError('too small to build from');
      kept.push({ file: storePicture(config.dataDir, goalId, s.key, bytes), source: 'web', url: /^https?:\/\//.test(p.url) ? p.url : null, caption: p.caption.slice(0, 200) });
    } catch (err) {
      skipped.push(`${basename(p.file)}: ${String((err as Error).message ?? err).slice(0, 80)}`);
    }
  }
  rmSync(folder, { recursive: true, force: true });
  const ended = r.subtype === 'success' ? '' : ` (the session ended: ${r.subtype}${r.errorMessage ? `, ${r.errorMessage.slice(0, 120)}` : ''})`;
  const detail = kept.length
    ? `${kept.length} picture${kept.length > 1 ? 's' : ''} kept${skipped.length ? `; left out ${skipped.join('; ')}` : ''}`
    : `no picture kept${out.success && out.data.note ? `: ${out.data.note}` : ''}${skipped.length ? `; left out ${skipped.join('; ')}` : ''}${ended}`;
  store.append({ type: 'brief.subject_searched', goalId, payload: { subjectKey: s.key, status: kept.length || (out.success && r.subtype === 'success') ? 'ok' : 'failed', pictures: kept, costUsd: r.costUsd, detail: detail.slice(0, 500) } });
  config.log(`[subjects] ${goalId} ${s.key}: ${detail}`);
}

/**
 * The Clarifier's Subjects as Brief Subjects: the user's attached images it named are copied in as the person's
 * pictures (an image the goal does not have, or that is not a picture, is left out).
 */
export function subjectsFromClarifier(engine: Engine, goal: Goal, out: OutputSubject[] | null | undefined): BriefSubject[] {
  return (out ?? []).slice(0, SUBJECT_LIMITS.subjects).map((o) => {
    const pictures: SubjectPicture[] = [];
    for (const name of o.pictures ?? []) {
      const a = goal.attachments.find((x) => x.name === name || x.name === basename(name));
      const abs = a && attachmentKindLabel(a) === 'image' ? attachmentAbsPath(engine.config.dataDir, goal.id, a) : null;
      if (!abs || pictures.length >= SUBJECT_LIMITS.pictures) continue;
      try {
        pictures.push({ file: storePicture(engine.config.dataDir, goal.id, o.key, readFileSync(abs)), source: 'person', url: null, caption: a!.note?.slice(0, 200) ?? a!.name });
      } catch (err) {
        engine.config.log(`[subjects] ${goal.id}: attachment ${name} left out: ${String((err as Error).message ?? err)}`);
      }
    }
    return { key: o.key, name: o.name.trim(), lookFor: o.lookFor.trim(), pictures, search: null };
  });
}

/** copy another goal's Subjects with their pictures into this goal's subjects folder (a Delegated goal, a Follow-up) */
export function inheritSubjects(dataDir: string, fromGoalId: string, toGoalId: string, subjects: BriefSubject[]): BriefSubject[] {
  const to = subjectsDir(dataDir, toGoalId);
  return subjects.map((s) => ({
    ...s,
    // a picture whose file is gone is left out; the Subject stays, named
    pictures: s.pictures.filter((p) => {
      const src = subjectPicturePath(dataDir, fromGoalId, p.file);
      if (!src || !existsSync(src)) return false;
      mkdirSync(to, { recursive: true });
      copyFileSync(src, join(to, p.file));
      return true;
    }),
  }));
}

/** a deleted goal's pictures go to the attachments' trash, as its attachments do: a person's upload may be their only copy */
export function trashSubjects(dataDir: string, goalId: string): void {
  const dir = subjectsDir(dataDir, goalId);
  if (!existsSync(dir)) return;
  const trash = join(dataDir, 'attachments', '_trash');
  mkdirSync(trash, { recursive: true });
  renameSync(dir, join(trash, `${goalId}-subjects`));
}

/** a session's extra folders: none is undefined, not an empty list */
export const sessionDirs = (dirs: string[]): string[] | undefined => (dirs.length ? dirs : undefined);

/** the goal's subjects folder when a session needs it (its pictures are read from there), else nothing */
export function subjectsAddDirs(dataDir: string, goalId: string, brief: Brief | null | undefined): string[] {
  return (brief?.subjects ?? []).some((s) => s.pictures.length) && existsSync(subjectsDir(dataDir, goalId)) ? [subjectsDir(dataDir, goalId)] : [];
}

const host = (url: string | null) => {
  try {
    return url ? new URL(url).hostname.replace(/^www\./, '') : '';
  } catch {
    return '';
  }
};

function listSubjects(dataDir: string, goalId: string, subjects: BriefSubject[]): string {
  return subjects
    .map((s) => {
      const pics = s.pictures.map((p) => `  - \`${join(subjectsDir(dataDir, goalId), p.file)}\`${p.caption ? ` — ${p.caption}` : ''}${p.source === 'person' ? ' (from the person)' : host(p.url) ? ` (${host(p.url)})` : ''}`);
      return [`- **${s.name}**${s.lookFor ? ` — ${s.lookFor}` : ''}`, ...(pics.length ? pics : ['  - (no picture: go by the name and what must match)'])].join('\n');
    })
    .join('\n');
}

/** how a worker on this scenario compares what it made with the pictures */
function workerCompare(scenario: string): string {
  if (scenario === 'image') return 'Before you finish, open each image you made next to the pictures and fix what differs.';
  if (scenario === 'video') return 'Before you finish, take a few frames of each clip (`ffmpeg -i <clip> -vf fps=1 -frames:v 3 /tmp/frame%d.png`), open them next to the pictures and fix what differs.';
  if (scenario === 'cad') return 'Your snapshots show the model: before you finish, open them next to the pictures from the matching views and fix what differs.';
  return 'When this task makes a Subject itself (a 3D model, a scene, an illustration), save renders of it from the views of the pictures under `artifacts/renders/` (PNG: a headless browser, the project\'s own renderer) before you finish, open them next to the pictures, fix what differs, and name the renders in your summary: the reviewer compares the same pairs.';
}

/** what the task reviewer opens to compare, per scenario */
function reviewerCompare(scenario: string): string {
  if (scenario === 'image') return 'the images the task made under `artifacts/`';
  if (scenario === 'video') return 'a few frames of each clip under `artifacts/` (`ffmpeg -i <clip> -vf fps=1 -frames:v 3 /tmp/frame%d.png`)';
  if (scenario === 'cad') return 'its snapshots under `artifacts/`, from the views that match the pictures';
  return 'the renders it saved under `artifacts/renders/`';
}

/**
 * The `# Subjects` section for a session: the pictures by absolute path (the folder is added to the session), and what
 * to do with them. '' when the Brief has no Subjects, or the scenario has no look.
 */
export function renderSubjects(dataDir: string, goalId: string, brief: Brief | null | undefined, who: 'worker' | 'task-reviewer' | 'goal-reviewer', scenario: string, likeness: string = ''): string {
  const subjects = brief?.subjects ?? [];
  if (!subjects.length || (who !== 'goal-reviewer' && !subjectsApply(scenario))) return '';
  const list = listSubjects(dataDir, goalId, subjects);
  const forOnly = 'The pictures are for comparison only: never copy, trace or embed them in what is made, and never commit them.';
  if (who === 'worker')
    return `# Subjects: what the result must look like (pictures approved by the human)\n${list}\nOpen each picture with the Read tool before you start. Match the proportions and the silhouette first, then the distinctive features, then colours and materials; where the spec asks for something else (stylised, low-poly, another colour), the spec wins. ${forOnly}\n${workerCompare(scenario)}`;
  if (who === 'task-reviewer')
    return `# Subjects: what the result must look like\n${list}\nWhere this task made something that shows a Subject, open its pictures next to ${reviewerCompare(scenario)}, and compare the proportions and silhouette, the distinctive features, colours and materials. A difference someone who knows the subject would notice at a glance is a BLOCKER: say what differs and how to fix it. So is a task that made a Subject (a model, an image, a scene) and left nothing to compare. A Subject this task does not touch is not your concern, and the spec wins where it asks for something else (stylised, low-poly).`;
  return `# Subjects: what the result must look like\n${list}${likeness ? `\n${likeness}` : ''}\nWhere a check concerns how the result looks, judge it against these pictures too: open them next to what you can see of the result (images, snapshots, renders under \`artifacts/\`).`;
}

/** the Likeness reviews of a goal's milestones, one line each, for the goal reviewer */
export function likenessLines(verdicts: { title: string; verdict: LikenessVerdict }[], subjects: BriefSubject[]): string {
  const name = (k: string) => subjects.find((s) => s.key === k)?.name ?? k;
  const lines = verdicts.flatMap(({ title, verdict }) =>
    verdict.subjects.filter((s) => s.shown).map((s) => `- "${title}": ${name(s.key)} ${s.score ?? '?'}/10${s.differences.length ? ` — ${s.differences.slice(0, 3).map((d) => `${d.major ? '(major) ' : ''}${d.what}`).join('; ')}` : ''}`),
  );
  return lines.length ? `Likeness reviews of the milestones (the latest recording of each):\n${lines.join('\n')}` : '';
}
