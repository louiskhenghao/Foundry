/**
 * The Editor on video goals (ADR-0086, beta): HyperFrames' browser editor opened from the goal page, Foundry starting
 * it as a preview app of the goal (one per HyperFrames project folder of the goal's workspace, while the goal runs and
 * after it finished); the scrubber page a motion-studio film gets instead (served by the server, no process); and
 * Re-render on a finished HyperFrames goal: the result as it stands kept aside, every project rendered again by
 * Foundry itself after the person's edits, the edits committed as one of the goal's own commits, the new files
 * delivered. No session takes part in a Re-render: it costs nothing.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { Adjustment, BriefApp, Goal } from '@foundry/core';
import { IdPrefix, editorKey, getGoal, newId } from '@foundry/core';
import { finishedRefusal, snapshotResult, versionFiles } from './adjust.ts';
import type { Engine } from './engine.ts';
import { ccHeader } from './git/conventional.ts';
import { commitAll } from './git/git.ts';
import { previewBindHost } from './preview/detect.ts';
import { excludeFromGit } from './skills/autoskills.ts';
import { spawnStreaming } from './skills/updaters.ts';
import { ARTIFACTS_DIR, goalWorkspacePath } from './workspace.ts';

/** the HyperFrames CLI Foundry runs for a project whose own scripts pin none: the release the catalog's skills were checked against */
export const HYPERFRAMES_PIN = '0.9.8';
/** where a Re-render writes a project's film, under artifacts/: `video/<project>/final.mp4` */
export const RERENDER_DIR = 'video';
/** the folders of a project the editor, its thumbnails and its exports write, never the goal's to commit */
export const HYPERFRAMES_SCRATCH = ['renders/', '.hyperframes/', '.thumbnails/'];
/** folders never searched for projects or films */
const SKIP = new Set(['node_modules', '.git', '.hyperframes', 'renders', 'artifacts', 'dist', 'build', '.foundry', 'motion']);
const DEPTH = 4;
/** a render of a long film on a slow machine; the person sees its output meanwhile */
const RENDER_TIMEOUT_MS = 30 * 60_000;

export class EditorError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 404 | 409 | 500 = 400,
  ) {
    super(message);
  }
}

/** a HyperFrames project of the goal's workspace: the folder `hyperframes init` made, found by its hyperframes.json */
export interface HyperframesProject {
  /** workspace-relative, '' = the root */
  dir: string;
  name: string;
  /** the CLI release the project's own scripts pin (`npx --yes hyperframes@0.9.8 preview`), else Foundry's */
  version: string;
  pinned: boolean;
}

/** a motion-studio film of the goal's workspace: `motion/<slug>/` with its film.json and index.html (ADR-0077) */
export interface MotionFilm {
  slug: string;
  title: string;
  duration: number;
  fps: number;
  formats: string[];
}

export interface EditorView {
  /** Settings → Beta → Editor is on */
  enabled: boolean;
  /** the HyperFrames projects, each an Editor row of the preview card under its app key */
  projects: (HyperframesProject & { key: string })[];
  /** the motion-studio films, each with its scrubber page */
  films: (MotionFilm & { url: string })[];
  /** Re-render, on a goal with HyperFrames projects; null = nothing to render */
  rerender: {
    can: boolean;
    /** why not, when `can` is false */
    reason: string | null;
    running: boolean;
    /** the number the next edit gets (shared with the Adjustments) */
    next: number;
    /** the last Re-render's record */
    last: { n: number; at: string; files: string[]; commit: string | null; errors: { dir: string; error: string }[] } | null;
    /** the edits rendered so far, oldest first, each with the files of the version kept before it */
    history: (Adjustment & { files: string[] })[];
  } | null;
}

/** what a test puts in place of the CLI: the render of one project, and the probe of the file it wrote (its duration in seconds, null = could not tell) */
export interface EditorDeps {
  render?: (o: { dir: string; out: string; version: string; log: (line: string) => void }) => Promise<void>;
  probe?: (file: string) => Promise<number | null>;
}

const readJson = (file: string): Record<string, unknown> | null => {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
};

/** the release a project's scripts pin: `npx --yes hyperframes@<version> …` as `hyperframes init` writes them */
function versionOf(dir: string): { version: string; pinned: boolean } {
  const pkg = readJson(join(dir, 'package.json'));
  const scripts = (pkg?.scripts ?? {}) as Record<string, string>;
  for (const s of Object.values(scripts)) {
    const m = /\bhyperframes@([\w.-]+)/.exec(s ?? '');
    if (m) return { version: m[1]!, pinned: true };
  }
  return { version: HYPERFRAMES_PIN, pinned: false };
}

/** every folder of the workspace with a hyperframes.json, up to four levels down, nearest first; the root counts */
export function hyperframesProjects(ws: string): HyperframesProject[] {
  if (!existsSync(ws)) return [];
  const out: HyperframesProject[] = [];
  const walk = (dir: string, rel: string, depth: number) => {
    if (existsSync(join(dir, 'hyperframes.json'))) {
      const meta = readJson(join(dir, 'meta.json'));
      const name = typeof meta?.name === 'string' && meta.name.trim() ? meta.name.trim() : basename(dir);
      out.push({ dir: rel, name, ...versionOf(dir) });
      return;
    }
    if (depth >= DEPTH) return;
    let entries: string[];
    try {
      entries = readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory() && !SKIP.has(e.name) && !e.name.startsWith('.'))
        .map((e) => e.name)
        .sort();
    } catch {
      return;
    }
    for (const e of entries) walk(join(dir, e), rel ? `${rel}/${e}` : e, depth + 1);
  };
  walk(ws, '', 0);
  return out;
}

/** the motion-studio films of the workspace: motion/<slug>/ with film.json and index.html */
export function motionFilms(ws: string): MotionFilm[] {
  const root = join(ws, 'motion');
  if (!existsSync(root)) return [];
  const out: MotionFilm[] = [];
  let entries: string[];
  try {
    entries = readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name !== 'lib' && /^[a-z0-9][a-z0-9-]*$/.test(e.name))
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
  for (const slug of entries) {
    const dir = join(root, slug);
    if (!existsSync(join(dir, 'index.html'))) continue;
    const film = readJson(join(dir, 'film.json'));
    if (!film) continue;
    const formats = Array.isArray(film.formats) ? film.formats.filter((f): f is string => typeof f === 'string') : [];
    out.push({ slug, title: typeof film.title === 'string' && film.title.trim() ? film.title : slug, duration: Number(film.duration) || 0, fps: Number(film.fps) || 60, formats: formats.length ? formats : ['16x9'] });
  }
  return out;
}

/** the CLI invocation for a project: its pinned release, and in Docker the editor listening on every interface (the range is published, not the loopback) */
export function hyperframesCommand(version: string, args: string): string {
  const host = previewBindHost();
  return `${host ? `HYPERFRAMES_PREVIEW_HOST=${host} ` : ''}npx --yes hyperframes@${version} ${args}`;
}

/** the goal has an Editor: a video goal with the beta on, and a workspace to look in */
const applies = (engine: Engine, goal: Goal): boolean => engine.config.betaEditor && goal.nature === 'video';

/**
 * The Editor apps of a video goal, one per HyperFrames project: `npx hyperframes preview` on a preview port, in the
 * project's folder, never opening a browser of its own. Started by the person only (preview manager); on the tailnet
 * like any app. Empty while the beta is off, on other goals, and before a project exists.
 */
export function editorApps(engine: Engine, goal: Goal): BriefApp[] {
  if (!applies(engine, goal)) return [];
  return engine.editorProjects(goal).map((p) => ({
    key: editorKey(p.dir),
    name: `Editor · ${p.name}`,
    dir: p.dir,
    install: null,
    command: hyperframesCommand(p.version, 'preview --port {port} --no-open --foreground'),
    url: 'http://localhost:{port}/',
    platform: 'web',
  }));
}

/** why a finished goal's films cannot be rendered again now; null = they can */
export function rerenderRefusal(engine: Engine, goal: Goal): string | null {
  const refused = finishedRefusal(engine, goal);
  if (refused) return refused;
  if (engine.rerendering.has(goal.id)) return 'its films are being rendered now';
  if (!hyperframesProjects(goalWorkspacePath(engine.config.dataDir, goal)).length) return "no HyperFrames project in the goal's folder";
  return null;
}

/** the goal page's view of the Editor (ADR-0086) */
export function editorView(engine: Engine, goal: Goal): EditorView {
  const enabled = engine.config.betaEditor;
  if (!applies(engine, goal)) return { enabled, projects: [], films: [], rerender: null };
  const ws = goalWorkspacePath(engine.config.dataDir, goal);
  const projects = engine.editorProjects(goal).map((p) => ({ ...p, key: editorKey(p.dir) }));
  const films = motionFilms(ws).map((f) => ({ ...f, url: `/api/goals/${goal.id}/film/${f.slug}` }));
  if (!projects.length) return { enabled, projects, films, rerender: null };
  const reason = rerenderRefusal(engine, goal);
  const last = engine.store.listByGoalOfTypes(goal.id, ['goal.rerendered']).at(-1);
  const edits = (goal.adjustments ?? []).filter((a) => a.mode === 'rerender');
  return {
    enabled,
    projects,
    films,
    rerender: {
      can: !reason,
      reason,
      running: engine.rerendering.has(goal.id),
      next: (goal.adjustments ?? []).length + 1,
      last: last ? { ...(last.payload as { n: number; files: string[]; commit: string | null; errors: { dir: string; error: string }[] }), at: last.ts } : null,
      history: edits.map((a) => ({ ...a, files: versionFiles(ws, a.n) })),
    },
  };
}

/** the CLI's render of one project into `out`, its output streamed; a non-zero exit is the error with its last lines */
async function renderWithCli(o: { dir: string; out: string; version: string; log: (line: string) => void }): Promise<void> {
  const tail: string[] = [];
  const say = (l: string) => {
    tail.push(l);
    if (tail.length > 20) tail.shift();
    o.log(l);
  };
  const command = hyperframesCommand(o.version, `render --quality delivery --quiet -o '${o.out.replace(/'/g, `'\\''`)}'`);
  say(`$ ${command}  (in ${o.dir})`);
  const r = await spawnStreaming(['sh', '-lc', command], o.dir, say, { timeoutMs: RENDER_TIMEOUT_MS });
  if (r.code !== 0) throw new Error(`hyperframes render exited ${r.code}${tail.length ? `: ${tail.slice(-3).join(' | ')}` : ''}`);
}

/** the duration ffprobe reads from the file, null without ffprobe */
async function probeWithFfprobe(file: string): Promise<number | null> {
  const bin = Bun.which('ffprobe');
  if (!bin) return null;
  const p = Bun.spawn([bin, '-v', 'error', '-show_entries', 'format=duration', '-of', 'json', file], { stdout: 'pipe', stderr: 'pipe' });
  const text = await new Response(p.stdout).text();
  await p.exited;
  const d = Number((JSON.parse(text || '{}') as { format?: { duration?: string } }).format?.duration);
  return Number.isFinite(d) ? d : 0;
}

/**
 * Re-render a finished HyperFrames goal's films after the person's edits in the Editor (ADR-0086). Refused like an
 * Adjustment is (a goal at work, merged, cleaned up, delegated, imported), and while one runs. The checks are made
 * here; the work goes on in the background under the goal's workspace lock: the result as it stands kept aside under
 * artifacts/.history/<n>/, each project rendered to artifacts/video/<project>/final.mp4, the file probed, the edits
 * committed as `chore(video): edits in the editor (edit n)`, then `goal.adjusted` (mode rerender) and `goal.rerendered`
 * — on which the goal's tick delivers the new files to the output folder and a pushed branch or open pull request
 * carries on with the commit, as after any Adjustment.
 */
export function rerenderGoal(engine: Engine, goalId: string, opts: { by?: string | null } = {}): { n: number } {
  const { store, config } = engine;
  if (!config.betaEditor) throw new EditorError('The Editor is a beta feature: turn on Settings → Beta → Editor first', 400);
  const goal = getGoal(store.db, goalId);
  if (!goal) throw new EditorError('goal not found', 404);
  if (goal.nature !== 'video') throw new EditorError('only a video goal has films to render', 409);
  const refused = rerenderRefusal(engine, goal);
  if (refused) throw new EditorError(refused, 409);
  const ws = goalWorkspacePath(config.dataDir, goal);
  const projects = hyperframesProjects(ws);
  const n = (goal.adjustments ?? []).length + 1;
  const id = newId(IdPrefix.adjust);
  const at = new Date().toISOString();
  const channel = `rerender-${goalId}`;
  const log = (line: string) => engine.broadcast({ goalId, taskId: null, attemptId: channel, event: { kind: 'text', text: line }, ts: new Date().toISOString() });
  engine.rerendering.add(goalId);
  const job = async () => {
    const errors: { dir: string; error: string }[] = [];
    const files: string[] = [];
    let commit: string | null = null;
    try {
      await snapshotResult(ws, n, { adjustment: { id, text: 'Edits in the editor, rendered again', at } });
      await excludeFromGit(ws, HYPERFRAMES_SCRATCH.map((p) => `/${p}`).concat(HYPERFRAMES_SCRATCH), config.log);
      const render = engine.editorDeps.render ?? renderWithCli;
      const probe = engine.editorDeps.probe ?? probeWithFfprobe;
      for (const p of projects) {
        const rel = `${RERENDER_DIR}/${p.name}/final.mp4`;
        const out = join(ws, ARTIFACTS_DIR, rel);
        mkdirSync(join(ws, ARTIFACTS_DIR, RERENDER_DIR, p.name), { recursive: true });
        log(`[rerender] ${p.name}: rendering edit ${n}`);
        try {
          await render({ dir: join(ws, p.dir), out, version: p.version, log });
          if (!existsSync(out)) throw new Error('the render wrote no file');
          const duration = await probe(out);
          if (duration !== null && !(duration > 0)) throw new Error('the render is empty (ffprobe reads no duration)');
          files.push(rel);
          log(`[rerender] ${p.name}: ${rel}${duration ? ` (${duration.toFixed(1)} s)` : ''}`);
        } catch (err) {
          const error = String((err as Error).message ?? err);
          errors.push({ dir: p.dir, error });
          log(`[rerender] ${p.name}: failed — ${error}`);
        }
      }
      const c = await commitAll(ws, `${ccHeader({ type: 'chore', scope: 'video', subject: `edits in the editor (edit ${n})` })}\n\nAdjustment: ${n}`);
      commit = c.committed ? c.ref : null;
      log(commit ? `[rerender] committed the edits as ${commit.slice(0, 7)}` : '[rerender] nothing new to commit');
    } catch (err) {
      errors.push({ dir: '', error: String((err as Error).message ?? err) });
      log(`[rerender] failed — ${String((err as Error).message ?? err)}`);
    } finally {
      engine.rerendering.delete(goalId);
    }
    const adjustment: Adjustment = { id, n, text: 'Edits in the editor, rendered again', mode: 'rerender', taskId: null, attachmentIds: [], at, by: opts.by ?? null };
    store.append({ type: 'goal.adjusted', goalId, payload: { adjustment } });
    store.append({ type: 'goal.rerendered', goalId, payload: { n, files, commit, errors } });
    if (errors.length) store.append({ type: 'engine.note', goalId, payload: { level: 'warn', message: `Re-render ${n}: ${errors.map((e) => `${e.dir || 'the goal'}: ${e.error}`).join('; ')}` } });
    log(`[rerender] done: ${files.length} file(s), ${errors.length} error(s)`);
  };
  void engine.withGoalWsLock(goalId, job).catch((err) => {
    engine.rerendering.delete(goalId);
    config.log(`[rerender] ${goalId}: ${String((err as Error).message ?? err)}`);
  });
  return { n };
}
