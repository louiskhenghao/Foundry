import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import {
  SealedSecrets,
  SettingsPatch,
  TRANSFER_FORMAT,
  TRANSFER_FORMAT_VERSION,
  TransferManifest,
  getGoal,
  getTask,
  listAttemptsByGoal,
  listEscalations,
  listTasks,
  maskSecret,
  newId,
  transferableSettings,
  type TransferGoalEntry,
} from '@foundry/core';
import type { Engine } from '../engine.ts';
import { git } from '../git/git.ts';
import { attachmentsDir } from '../attachments.ts';
import { unpackTransfer } from './archive.ts';
import { TransferError } from './errors.ts';
import { transferGoalDir } from './paths.ts';
import { openSecrets } from './secrets.ts';

/** A received Transfer file waits here, unpacked, until it is applied or discarded */
const incomingRoot = (dataDir: string) => join(dataDir, 'transfer', 'incoming');
const UPLOAD_ID = /^in_[a-z0-9]+$/;
/** an unpacked file nobody applied is removed after a day */
const INCOMING_TTL_MS = 24 * 3_600_000;

function incomingDir(dataDir: string, uploadId: string): string {
  if (!UPLOAD_ID.test(uploadId)) throw new TransferError('unknown upload', 404);
  const dir = join(incomingRoot(dataDir), uploadId);
  if (!existsSync(join(dir, 'manifest.json'))) throw new TransferError('this upload is gone; choose the Transfer file again', 404);
  return dir;
}

/** a release is newer only when both are plain x.y.z (a development build compares as no newer) */
export function newerRelease(a: string, b: string): boolean {
  const pa = /^(\d+)\.(\d+)\.(\d+)$/.exec(a);
  const pb = /^(\d+)\.(\d+)\.(\d+)$/.exec(b);
  if (!pa || !pb) return false;
  for (let i = 1; i <= 3; i++) if (Number(pa[i]) !== Number(pb[i])) return Number(pa[i]) > Number(pb[i]);
  return false;
}

/** The manifest of a received file; a file from a newer Foundry is refused until this one is updated */
function readManifest(dir: string, current: string): TransferManifest {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  } catch {
    throw new TransferError('this is not a Transfer file: it has no manifest', 422);
  }
  const head = z.object({ format: z.string(), formatVersion: z.number(), release: z.string() }).safeParse(raw);
  if (!head.success || head.data.format !== TRANSFER_FORMAT) throw new TransferError('this is not a Transfer file', 422);
  if (head.data.formatVersion > TRANSFER_FORMAT_VERSION || newerRelease(head.data.release, current)) {
    throw new TransferError(`this Transfer file was made by Foundry ${head.data.release}, newer than this one (${current}); update Foundry here first`, 422);
  }
  // older formats are read with today's defaults, the way old events replay
  return TransferManifest.parse(raw);
}

/** git remotes compare by host and path: `git@github.com:a/b.git` is `https://github.com/a/b` */
export function sameRemote(a: string, b: string): boolean {
  const norm = (u: string) =>
    u.trim().replace(/^[a-z+]+:\/\//i, '').replace(/^[^@/]+@/, '').replace(/^([^/:]+):(?!\d)/, '$1/').replace(/\.git$/, '').replace(/\/+$/, '').toLowerCase();
  return norm(a) === norm(b);
}

/**
 * The checkout here that is the repository a goal knew on the other computer: the same path, a git repository, whose
 * remote is the same one (a path with no remote counts only when the goal's had none either). null = ask the person.
 */
export async function matchRepo(original: string, remoteUrl: string | null, remote = 'origin'): Promise<string | null> {
  if (!existsSync(original) || (await git(['rev-parse', '--show-toplevel'], original)).code !== 0) return null;
  const here = await git(['remote', 'get-url', remote], original);
  const url = here.code === 0 ? here.stdout.trim() : '';
  if (!remoteUrl) return url ? null : original;
  return url && sameRemote(url, remoteUrl) ? original : null;
}

export interface IncomingGoal extends TransferGoalEntry {
  /** new here, already here, or deleted here (its history stays in the log, so it cannot come back) */
  status: 'new' | 'here' | 'deleted-here';
  follows: (TransferGoalEntry['follows'] & { inFile: boolean; here: boolean }) | null;
}
export interface IncomingRepo {
  original: string;
  remoteUrl: string | null;
  goals: string[];
  /** the checkout here found to be the same repository, or null */
  match: string | null;
}
export interface IncomingReport {
  uploadId: string;
  release: string;
  exportedAt: string;
  hostname: string;
  categories: TransferManifest['categories'];
  goals: IncomingGoal[];
  repos: IncomingRepo[];
  /** settings sections that differ from what is saved here, with the leaves that would change */
  settings: { section: keyof SettingsPatch; keys: string[] }[];
  secrets: boolean;
}

/** Unpack a received Transfer file and say what it holds and how it meets this Foundry */
export async function receiveTransfer(engine: Engine, file: string): Promise<IncomingReport> {
  const dataDir = engine.config.dataDir;
  sweepIncoming(dataDir);
  const uploadId = newId('in');
  const dir = join(incomingRoot(dataDir), uploadId);
  try {
    await unpackTransfer(file, dir);
    readManifest(dir, engine.updater.current());
  } catch (err) {
    rmSync(dir, { recursive: true, force: true });
    throw err;
  }
  return inspectIncoming(engine, uploadId);
}

export async function inspectIncoming(engine: Engine, uploadId: string): Promise<IncomingReport> {
  const dir = incomingDir(engine.config.dataDir, uploadId);
  const m = readManifest(dir, engine.updater.current());
  const ids = new Set(m.goals.map((g) => g.id));
  const status = (id: string): IncomingGoal['status'] => (getGoal(engine.store.db, id) ? 'here' : engine.store.hasGoalEvents(id) ? 'deleted-here' : 'new');
  const goals: IncomingGoal[] = m.goals.map((g) => ({ ...g, status: status(g.id), follows: g.follows ? { ...g.follows, inFile: ids.has(g.follows.goalId), here: !!getGoal(engine.store.db, g.follows.goalId) } : null }));
  const repos = new Map<string, IncomingRepo>();
  for (const g of m.goals) {
    const r = repos.get(g.repoPath) ?? { original: g.repoPath, remoteUrl: g.remoteUrl, goals: [], match: null };
    r.goals.push(g.id);
    r.remoteUrl ??= g.remoteUrl;
    repos.set(g.repoPath, r);
  }
  for (const r of repos.values()) r.match = await matchRepo(r.original, r.remoteUrl);
  return {
    uploadId,
    release: m.release,
    exportedAt: m.exportedAt,
    hostname: m.source.hostname,
    categories: m.categories,
    goals,
    repos: [...repos.values()],
    settings: m.categories.settings ? settingsDiff(engine, importedSettings(dir)) : [],
    secrets: !!m.categories.secrets && existsSync(join(dir, 'secrets.json')),
  };
}

function importedSettings(dir: string): SettingsPatch {
  const p = join(dir, 'settings.json');
  if (!existsSync(p)) return {};
  // filtered again here: whatever a file claims, local leaves and credentials never come in as Settings
  return transferableSettings(SettingsPatch.parse(JSON.parse(readFileSync(p, 'utf8'))));
}

function settingsDiff(engine: Engine, imported: SettingsPatch): IncomingReport['settings'] {
  const mine = transferableSettings(engine.settings.fileSnapshot());
  const out: IncomingReport['settings'] = [];
  for (const section of Object.keys(SettingsPatch.shape) as (keyof SettingsPatch)[]) {
    if (section === 'engine') continue;
    const a = (imported[section] ?? {}) as Record<string, unknown>;
    const b = (mine[section] ?? {}) as Record<string, unknown>;
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k])).map((k) => `${section}.${k}`);
    if (keys.length) out.push({ section, keys: keys.sort() });
  }
  return out;
}

export interface SecretsPreview {
  /** each credential the file holds, masked, beside what is saved here */
  settings: { key: string; imported: string; mine: string | null; same: boolean }[];
  /** the repositories whose preview variables it holds, and their names */
  previewEnv: { repo: string; keys: string[] }[];
}

/** Open the file's Keys & secrets with the password, to show what they would change (masked) */
export function unlockIncomingSecrets(engine: Engine, uploadId: string, password: string): SecretsPreview {
  const s = readSecrets(engine, uploadId, password);
  const mine = engine.settings.fileSnapshot() as Record<string, Record<string, unknown>>;
  return {
    settings: Object.entries(s.settings).map(([key, value]) => {
      const [section, leaf] = key.split('.') as [string, string];
      const here = mine[section]?.[leaf];
      return { key, imported: maskSecret(value), mine: typeof here === 'string' && here ? maskSecret(here) : null, same: here === value };
    }),
    previewEnv: Object.entries(s.previewEnv).map(([repo, vars]) => ({ repo, keys: Object.keys(vars).sort() })),
  };
}

function readSecrets(engine: Engine, uploadId: string, password: string) {
  const dir = incomingDir(engine.config.dataDir, uploadId);
  const m = readManifest(dir, engine.updater.current());
  const p = join(dir, 'secrets.json');
  if (!existsSync(p)) throw new TransferError('this Transfer file has no Keys & secrets', 404);
  return openSecrets(SealedSecrets.parse(JSON.parse(readFileSync(p, 'utf8'))), password, m.transferId);
}

export const ImportChoices = z.object({
  /** the goals to bring in; absent = every goal that is new here */
  goals: z.array(z.string()).optional(),
  /** per differing section, whose settings win; absent = the imported ones */
  settings: z.record(z.string(), z.enum(['imported', 'mine'])).optional(),
  /** bring Keys & secrets in (credentials listed in keepMine stay as they are here); absent = leave them out */
  secrets: z.object({ password: z.string(), keepMine: z.array(z.string()).default([]) }).nullable().optional(),
  /** the checkout here for each repository the file names; null = leave it unmapped; absent = what matched */
  repos: z.record(z.string(), z.string().nullable()).optional(),
});
export type ImportChoices = z.infer<typeof ImportChoices>;

export interface ImportReport {
  imported: { id: string; title: string }[];
  skipped: { id: string; title: string; reason: string }[];
  settings: string[];
  secrets: string[];
  previewEnv: { applied: string[]; waiting: string[] };
}

/**
 * Bring a received Transfer file in (ADR-0030). Import merges: goals are added as history and a goal this Foundry
 * already knows is skipped, never replaced; settings sections and credentials change only as chosen. Goals that came
 * cut off mid-work are closed the way an engine restart closes what it cannot resume, with the retry given back.
 */
export async function applyIncoming(engine: Engine, uploadId: string, choicesIn: ImportChoices = {}): Promise<ImportReport> {
  const choices = ImportChoices.parse(choicesIn);
  const { dataDir } = engine.config;
  const dir = incomingDir(dataDir, uploadId);
  const m = readManifest(dir, engine.updater.current());
  // a wrong password stops the import before anything is written
  const secrets = choices.secrets && m.categories.secrets ? readSecrets(engine, uploadId, choices.secrets.password) : null;
  const report: ImportReport = { imported: [], skipped: [], settings: [], secrets: [], previewEnv: { applied: [], waiting: [] } };

  const wanted = choices.goals ? new Set(choices.goals) : null;
  for (const entry of m.goals) {
    if (wanted && !wanted.has(entry.id)) continue;
    if (getGoal(engine.store.db, entry.id) || engine.store.hasGoalEvents(entry.id)) {
      report.skipped.push({ id: entry.id, title: entry.title, reason: getGoal(engine.store.db, entry.id) ? 'already here' : 'deleted here' });
      continue;
    }
    importGoal(engine, dir, m, entry);
    report.imported.push({ id: entry.id, title: entry.title });
  }

  if (m.categories.settings) {
    const imported = importedSettings(dir);
    const sections = settingsDiff(engine, imported).map((d) => d.section).filter((s) => (choices.settings?.[s] ?? 'imported') === 'imported');
    if (sections.length) report.settings = engine.replaceSettingsSections(imported, sections);
  }

  if (secrets) {
    const keep = new Set(choices.secrets!.keepMine);
    const patch: Record<string, Record<string, string>> = {};
    for (const [key, value] of Object.entries(secrets.settings)) {
      if (keep.has(key)) continue;
      const [section, leaf] = key.split('.') as [string, string];
      (patch[section] ??= {})[leaf] = value;
      report.secrets.push(key);
    }
    if (report.secrets.length) engine.updateSettings(SettingsPatch.parse(patch));
    for (const [original, vars] of Object.entries(secrets.previewEnv)) {
      const here = choices.repos && original in choices.repos ? choices.repos[original] : await matchRepo(original, m.goals.find((g) => g.repoPath === original)?.remoteUrl ?? null);
      if (here) (engine.preview.env.merge(resolve(here), vars), report.previewEnv.applied.push(original));
      else (holdPreviewEnv(dataDir, original, vars), report.previewEnv.waiting.push(original));
    }
  }

  rmSync(dir, { recursive: true, force: true });
  return report;
}

/** one goal: its files first, then its events, then what marks it as history and closes what was cut off */
function importGoal(engine: Engine, dir: string, m: TransferManifest, entry: TransferGoalEntry): void {
  const { dataDir } = engine.config;
  const src = join(dir, 'goals', entry.id);
  const keep = (from: string, to: string) => existsSync(from) && cpSync(from, to, { recursive: true, force: false, errorOnExist: false });
  keep(join(dir, 'attachments', entry.id), join(dataDir, 'attachments', entry.id));
  keep(join(src, 'screenshots'), join(dataDir, 'screenshots', entry.id));
  const own = transferGoalDir(dataDir, entry.id);
  const rel = (p: string) => p.slice(dataDir.length + 1);
  let bundle: string | null = null;
  let artifacts: string | null = null;
  if (entry.bundle && existsSync(join(src, 'branch.bundle'))) (mkdirSync(own, { recursive: true }), cpSync(join(src, 'branch.bundle'), join(own, 'branch.bundle')), (bundle = rel(join(own, 'branch.bundle'))));
  if (entry.artifacts && existsSync(join(src, 'artifacts'))) (keep(join(src, 'artifacts'), join(own, 'artifacts')), (artifacts = rel(join(own, 'artifacts'))));

  const rows = readFileSync(join(src, 'events.jsonl'), 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
  try {
    engine.store.importGoalEvents(entry.id, rows);
  } catch (err) {
    throw new TransferError(`"${entry.title}" could not be read in (${String((err as Error).message ?? err).slice(0, 200)}); it may come from a newer Foundry`, 422);
  }
  const goal = getGoal(engine.store.db, entry.id)!;

  // its logs, by the ids of the goal and its tasks, attempts and escalations
  let logs = false;
  if (m.categories.transcripts) {
    const ids = [goal.id, ...listTasks(engine.store.db, goal.id).map((t) => t.id), ...listAttemptsByGoal(engine.store.db, goal.id).map((a) => a.id), ...listEscalations(engine.store.db, { goalId: goal.id }).map((e) => e.id)];
    for (const sub of ['transcripts', 'check-output']) {
      const from = join(dir, sub);
      if (!existsSync(from)) continue;
      mkdirSync(join(dataDir, sub), { recursive: true });
      for (const name of readdirSync(from)) if (ids.some((id) => name.includes(id)) && statSync(join(from, name)).isFile()) (keep(join(from, name), join(dataDir, sub, name)), (logs = true));
    }
  }

  const append = engine.store.append.bind(engine.store);
  if (!goal.provider) append({ type: 'goal.provider_assigned', goalId: goal.id, payload: { provider: entry.provider ?? m.source.provider } });
  const remap = { [join(m.source.dataDir, 'transcripts')]: join(dataDir, 'transcripts'), [join(m.source.dataDir, 'check-output')]: join(dataDir, 'check-output') };
  append({ type: 'goal.imported', goalId: goal.id, payload: { transferId: m.transferId, from: { release: m.release, hostname: m.source.hostname, exportedAt: m.exportedAt }, unfinished: entry.unfinished, bundle, artifacts, transcripts: logs, remap } });
  closeCutOff(engine, goal.id);
}

/**
 * Sessions do not travel: an attempt the Transfer cut off is concluded, its task goes back to ready and, for a work
 * attempt, the retry it used is given back — the next one is fresh, never a Continuation. A delivery in progress stops.
 */
function closeCutOff(engine: Engine, goalId: string): void {
  const append = engine.store.append.bind(engine.store);
  for (const a of listAttemptsByGoal(engine.store.db, goalId)) {
    if (!['created', 'running', 'observing', 'interrupted'].includes(a.state)) continue;
    append({ type: 'attempt.finished', goalId, payload: { attemptId: a.id, state: 'error', resultSubtype: 'transferred', costUsd: a.costUsd, numTurns: a.numTurns, endRef: a.endRef, permissionDenials: [], skillsUsed: [], toolsUsed: {} } });
    append({ type: 'attempt.concluded', goalId, payload: { attemptId: a.id, state: 'error', reason: 'cut off by the Transfer: sessions do not travel between computers' } });
    const t = getTask(engine.store.db, a.taskId);
    if (t && ['running', 'observing', 'merging'].includes(t.state)) {
      if (t.state === 'merging') append({ type: 'task.state_changed', goalId, payload: { taskId: t.id, from: 'merging', to: 'observing', reason: 'cut off by the Transfer' } });
      append({ type: 'task.state_changed', goalId, payload: { taskId: t.id, from: t.state === 'merging' ? 'observing' : t.state, to: 'ready', reason: 'cut off by the Transfer' } });
    }
    if (t && a.kind === 'work') append({ type: 'task.hint_set', goalId, payload: { taskId: t.id, hint: t.hint, extraAttempts: 1 } });
  }
  const g = getGoal(engine.store.db, goalId)!;
  if (g.delivery.status === 'running') append({ type: 'delivery.failed', goalId, payload: { step: g.delivery.step ?? 'preflight', reason: 'cut off by the Transfer — run Deliver again once the goal is Reattached' } });
}

/** preview variables for a repository not mapped yet wait here (owner-only) until it is */
const pendingEnvFile = (dataDir: string) => join(dataDir, 'transfer', 'pending-preview-env.json');

function holdPreviewEnv(dataDir: string, original: string, vars: Record<string, string>): void {
  const p = pendingEnvFile(dataDir);
  const doc = existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as Record<string, Record<string, string>>) : {};
  doc[original] = { ...vars, ...(doc[original] ?? {}) };
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, JSON.stringify(doc, null, 2), { mode: 0o600 });
}

/** hand the waiting preview variables of a repository to the checkout it was mapped to; returns the keys added */
export function releasePreviewEnv(engine: Engine, original: string, to: string): string[] {
  const p = pendingEnvFile(engine.config.dataDir);
  if (!existsSync(p)) return [];
  const doc = JSON.parse(readFileSync(p, 'utf8')) as Record<string, Record<string, string>>;
  const vars = doc[original];
  if (!vars) return [];
  const added = engine.preview.env.merge(resolve(to), vars);
  delete doc[original];
  writeFileSync(p, JSON.stringify(doc, null, 2), { mode: 0o600 });
  return added;
}

export function discardIncoming(dataDir: string, uploadId: string): void {
  if (UPLOAD_ID.test(uploadId)) rmSync(join(incomingRoot(dataDir), uploadId), { recursive: true, force: true });
}

/** remove received files nobody applied within a day */
export function sweepIncoming(dataDir: string, now = Date.now()): number {
  const root = incomingRoot(dataDir);
  if (!existsSync(root)) return 0;
  let n = 0;
  for (const name of readdirSync(root)) {
    const p = join(root, name);
    if (now - statSync(p).mtimeMs > INCOMING_TTL_MS) (rmSync(p, { recursive: true, force: true }), n++);
  }
  return n;
}
