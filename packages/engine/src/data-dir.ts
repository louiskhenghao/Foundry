/**
 * The data folder (ADR-0082): where a Foundry keeps its event log, settings, transcripts, uploads, accounts and templates.
 * Which folder a launch profile opens is decided here — the environment, then the person's choice kept in
 * ~/.foundry/config.json, then the checkout's data/ (data-<provider>/) — and so are the checks a folder passes before
 * Foundry switches to it, the copy a switch may make, and the gate the serve loop waits at for a restart.
 */
import { EventStore, knownMigrationIds, openDatabase, type AgentProvider } from '@foundry/core';
import { Database } from 'bun:sqlite';
import { accessSync, constants, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, statfsSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { z } from 'zod';

export const HOME_CONFIG_FILE = 'config.json';
/** written at every start: which Foundry last opened the folder */
export const VERSION_FILE = 'version';

/** ~/.foundry: what belongs to the person and not to one data folder; FOUNDRY_HOME moves it */
export function foundryHome(env: NodeJS.ProcessEnv = process.env): string {
  return resolve(env.FOUNDRY_HOME || join(homedir(), '.foundry'));
}

export const HomeConfig = z
  .object({
    /** the data folder each launch profile opens, chosen in Settings → Engine */
    dataDirs: z.record(z.string(), z.string()).default({}),
    /** data folders this Foundry had before, newest first: offered again in Settings */
    recent: z.array(z.string()).default([]),
  })
  .passthrough();
export type HomeConfig = z.infer<typeof HomeConfig>;

export function readHomeConfig(home: string, log?: (m: string) => void): HomeConfig {
  const file = join(home, HOME_CONFIG_FILE);
  if (!existsSync(file)) return HomeConfig.parse({});
  try {
    const parsed = HomeConfig.safeParse(JSON.parse(readFileSync(file, 'utf8')));
    if (parsed.success) return parsed.data;
    log?.(`[data-dir] ${file} has invalid entries, ignoring it: ${parsed.error.issues.map((i) => i.path.join('.') + ': ' + i.message).join('; ')}`);
  } catch (err) {
    log?.(`[data-dir] could not read ${file}: ${String(err)}`);
  }
  return HomeConfig.parse({});
}

export function writeHomeConfig(home: string, config: HomeConfig): void {
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, HOME_CONFIG_FILE), JSON.stringify(config, null, 2) + '\n');
}

const RECENT_MAX = 8;
/** the folders a Foundry had before, newest first, without the one it has now */
export function rememberRecent(recent: string[], left: string, now: string): string[] {
  return [left, ...recent.filter((p) => p !== left)].filter((p) => p !== now).slice(0, RECENT_MAX);
}

export type DataDirSource = 'env' | 'config' | 'default';

export function defaultDataDir(root: string, provider: AgentProvider): string {
  return resolve(root, provider === 'claude' ? 'data' : `data-${provider}`);
}

/**
 * The folder this launch profile opens: FOUNDRY_DATA_DIR, else the choice kept under `home`, else the checkout's default.
 * A chosen folder that is not there (a disk not mounted) is not made: the default opens instead and `missing` says so, so
 * the next start finds the chosen one again once it is back.
 */
export function resolveDataDir(opts: { root: string; provider: AgentProvider; env?: NodeJS.ProcessEnv; home: string | null; log?: (m: string) => void }): { path: string; source: DataDirSource; missing: string | null } {
  const env = opts.env ?? process.env;
  if (env.FOUNDRY_DATA_DIR) return { path: resolve(env.FOUNDRY_DATA_DIR), source: 'env', missing: null };
  const chosen = opts.home ? readHomeConfig(opts.home, opts.log).dataDirs[opts.provider] : undefined;
  if (chosen) {
    const path = resolve(chosen);
    if (existsSync(path)) return { path, source: 'config', missing: null };
    opts.log?.(`[data-dir] the data folder chosen in Settings is not there: ${path}; opening the default instead`);
    return { path: defaultDataDir(opts.root, opts.provider), source: 'default', missing: path };
  }
  return { path: defaultDataDir(opts.root, opts.provider), source: 'default', missing: null };
}

/** the root package.json version: the product version every package shares */
export function productVersion(root: string): string {
  try {
    return String(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version ?? '0.0.0');
  } catch {
    return '0.0.0';
  }
}

export function writeVersionMarker(dataDir: string, version: string): void {
  try {
    writeFileSync(join(dataDir, VERSION_FILE), version + '\n');
  } catch {}
}

// ---------- the test a folder passes before Foundry switches to it ----------

export type DataDirKind = 'current' | 'foundry' | 'empty' | 'other';
export type DataDirMode = 'open' | 'blank' | 'clone';
export interface DataDirCheck {
  id: 'path' | 'kind' | 'writable' | 'space' | 'provider' | 'version';
  ok: boolean;
  label: string;
  detail: string;
}
export interface DataDirFolder {
  provider: string | null;
  /** the Foundry that last opened it, when it said */
  version: string | null;
  goals: number | null;
  events: number | null;
}
export interface DataDirTest {
  /** as typed */
  input: string;
  /** resolved */
  path: string;
  kind: DataDirKind;
  ok: boolean;
  checks: DataDirCheck[];
  folder: DataDirFolder | null;
  current: { path: string; bytes: number };
  freeBytes: number | null;
  /** an empty folder with room for a copy of the current data */
  canClone: boolean;
  /** how the switch may open it: a Foundry folder is opened; an empty one starts blank or takes a copy */
  modes: DataDirMode[];
}

const expandHome = (p: string) => (p === '~' ? homedir() : p.startsWith('~/') ? join(homedir(), p.slice(2)) : p);
const within = (a: string, b: string) => a === b || a.startsWith(b.endsWith('/') ? b : b + '/');
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const MIN_FREE = 200 * 1024 * 1024;

export function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  if (n < 1024 * 1024 * 1024) return `${Math.round(n / (1024 * 1024))} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/** every file under a folder, symbolic links not followed */
export function folderBytes(dir: string): number {
  let total = 0;
  const walk = (d: string) => {
    let entries: import('node:fs').Dirent[];
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(d, e.name);
      try {
        if (e.isSymbolicLink()) continue;
        if (e.isDirectory()) walk(p);
        else if (e.isFile()) total += statSync(p).size;
      } catch {}
    }
  };
  walk(dir);
  return total;
}

const nearestExisting = (p: string): string => {
  let cur = p;
  while (!existsSync(cur)) {
    const up = dirname(cur);
    if (up === cur) break;
    cur = up;
  }
  return cur;
};

/** what a Foundry folder's database says, read without opening it for writing (no migration runs) */
function readFolderDb(file: string): { migrations: string[]; goals: number | null; events: number | null } | { error: string } {
  let db: Database | null = null;
  try {
    db = new Database(file, { readonly: true });
    const migrations = (db.query('SELECT id FROM _migrations').all() as { id: string }[]).map((r) => r.id);
    const count = (table: string) => {
      try {
        return (db!.query(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
      } catch {
        return null;
      }
    };
    return { migrations, goals: count('goals'), events: count('events') };
  } catch (err) {
    return { error: String((err as Error).message ?? err) };
  } finally {
    db?.close();
  }
}

export function testDataDir(input: string, opts: { current: string; provider: AgentProvider; currentBytes?: number; knownMigrations?: string[] }): DataDirTest {
  const typed = input.trim();
  const path = typed ? resolve(expandHome(typed)) : '';
  const current = resolve(opts.current);
  const checks: DataDirCheck[] = [];
  let kind: DataDirKind = 'other';
  let folder: DataDirFolder | null = null;
  let freeBytes: number | null = null;
  let canClone = false;
  const currentBytes = opts.currentBytes ?? folderBytes(current);

  if (!typed || !isAbsolute(expandHome(typed))) checks.push({ id: 'path', ok: false, label: 'Path', detail: 'an absolute path, like /Volumes/Work/foundry-data' });
  else if (path === current) (kind = 'current'), checks.push({ id: 'path', ok: false, label: 'Path', detail: 'the data folder in use' });
  else if (within(path, current)) checks.push({ id: 'path', ok: false, label: 'Path', detail: 'inside the data folder in use' });
  else if (within(current, path)) checks.push({ id: 'path', ok: false, label: 'Path', detail: 'holds the data folder in use' });
  else checks.push({ id: 'path', ok: true, label: 'Path', detail: path });

  if (path && kind !== 'current' && checks[0]!.ok) {
    const exists = existsSync(path);
    const isDir = exists && statSync(path).isDirectory();
    if (exists && !isDir) checks.push({ id: 'kind', ok: false, label: 'Folder', detail: 'a file, not a folder' });
    else {
      const entries = isDir ? readdirSync(path).filter((n) => n !== '.DS_Store') : [];
      const foundry = isDir && (existsSync(join(path, 'provider')) || existsSync(join(path, 'engine.db')));
      kind = foundry ? 'foundry' : entries.length === 0 ? 'empty' : 'other';
      checks.push({
        id: 'kind',
        ok: kind !== 'other',
        label: 'Folder',
        detail: kind === 'foundry' ? 'a Foundry data folder' : !exists ? 'not there yet: it is created' : kind === 'empty' ? 'empty' : `holds ${plural(entries.length, 'entry', 'entries')} that ${entries.length === 1 ? 'is' : 'are'} not Foundry's (${entries.slice(0, 3).join(', ')}${entries.length > 3 ? ', …' : ''}): choose an empty folder or a Foundry data folder`,
      });
    }
    const anchor = nearestExisting(path);
    try {
      accessSync(anchor, constants.W_OK);
      checks.push({ id: 'writable', ok: true, label: 'Writable', detail: exists ? 'yes' : `yes (${anchor})` });
    } catch {
      checks.push({ id: 'writable', ok: false, label: 'Writable', detail: `no: ${anchor} cannot be written to` });
    }
    try {
      const s = statfsSync(anchor);
      freeBytes = Number(s.bavail) * Number(s.bsize);
    } catch {}
    canClone = kind === 'empty' && freeBytes != null && freeBytes > currentBytes * 1.1 + MIN_FREE;
    checks.push({
      id: 'space',
      ok: freeBytes == null || freeBytes > MIN_FREE,
      label: 'Disk space',
      detail: freeBytes == null ? 'unknown' : `${formatBytes(freeBytes)} free${kind === 'empty' ? (canClone ? `; room for a copy of the current ${formatBytes(currentBytes)}` : `; not enough for a copy of the current ${formatBytes(currentBytes)}`) : freeBytes > MIN_FREE ? '' : ': too little to work in'}`,
    });
    if (kind === 'foundry') {
      const markerFile = join(path, 'provider');
      const marker = existsSync(markerFile) ? readFileSync(markerFile, 'utf8').trim() : 'claude';
      const versionFile = join(path, VERSION_FILE);
      const version = existsSync(versionFile) ? readFileSync(versionFile, 'utf8').trim() || null : null;
      folder = { provider: marker, version, goals: null, events: null };
      checks.push({ id: 'provider', ok: marker === opts.provider, label: 'Coding agent', detail: marker === opts.provider ? `${marker}, like this Foundry` : `belongs to ${marker}; this Foundry runs as ${opts.provider} (its launch profile)` });
      const dbFile = join(path, 'engine.db');
      if (!existsSync(dbFile)) checks.push({ id: 'version', ok: true, label: 'Version', detail: 'no database yet' });
      else {
        const read = readFolderDb(dbFile);
        if ('error' in read) checks.push({ id: 'version', ok: false, label: 'Version', detail: `engine.db could not be read: ${read.error}` });
        else {
          folder.goals = read.goals;
          folder.events = read.events;
          const known = new Set(opts.knownMigrations ?? knownMigrationIds());
          const unknown = read.migrations.filter((id) => !known.has(id));
          checks.push({
            id: 'version',
            ok: !unknown.length,
            label: 'Version',
            detail: unknown.length ? `written by a newer Foundry${version ? ` (${version})` : ''}: its database has ${unknown[0]}, which this one does not know` : `${read.goals == null ? '?' : plural(read.goals, 'goal')}, ${read.events == null ? '?' : plural(read.events, 'event')}${version ? `, last opened by Foundry ${version}` : ''}`,
          });
        }
      }
    }
  }
  const ok = checks.every((c) => c.ok);
  const modes: DataDirMode[] = !ok ? [] : kind === 'foundry' ? ['open'] : kind === 'empty' ? (canClone ? ['blank', 'clone'] : ['blank']) : [];
  return { input, path, kind, ok, checks, folder, current: { path: current, bytes: currentBytes }, freeBytes, canClone, modes };
}

// ---------- making the folder a switch opens ----------

/** folders under a data folder that hold no JSON Foundry wrote with its own paths in (and the big ones) */
const REWRITE_SKIP = new Set(['transcripts', 'claude-home', 'codex-home', 'accounts', 'suites', 'skills-cache', 'skills-trash', 'code-server', 'worktrees', 'artifacts', 'attachments', 'subjects', 'screenshots', 'media', 'generated-images', 'check-output', 'backups', 'transfer', 'live-test-repos', 'releases-repo', 'node_modules', '.git']);
const REWRITE_MAX_BYTES = 4 * 1024 * 1024;

/**
 * A copy of a data folder keeps the paths the original wrote about itself (transcripts, check output): in the copy they
 * are made to point into the copy — in the event log (the read models are rebuilt from it) and in the JSON files beside
 * it. Paths outside the data folder (repositories, progress folders) are shared by both and stay.
 */
export function rewriteDataDirPaths(dir: string, from: string, to: string): { events: number; files: number } {
  const forms: [string, string][] = [
    [from + '/', to + '/'],
    [`"${from}"`, `"${to}"`],
  ];
  let events = 0;
  const dbFile = join(dir, 'engine.db');
  if (existsSync(dbFile)) {
    const db = openDatabase(dbFile);
    try {
      const r = db.run('UPDATE events SET payload = replace(replace(payload, ?1, ?2), ?3, ?4) WHERE instr(payload, ?5) > 0', [forms[0]![0], forms[0]![1], forms[1]![0], forms[1]![1], from]);
      events = r.changes;
      if (events) new EventStore(db).replay();
    } finally {
      db.close();
    }
  }
  let files = 0;
  const walk = (d: string) => {
    let entries: import('node:fs').Dirent[];
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(d, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) {
        if (!REWRITE_SKIP.has(e.name)) walk(p);
        continue;
      }
      if (!e.isFile() || !e.name.endsWith('.json')) continue;
      try {
        if (statSync(p).size > REWRITE_MAX_BYTES) continue;
        const text = readFileSync(p, 'utf8');
        if (!text.includes(from)) continue;
        let out = text;
        for (const [a, b] of forms) out = out.split(a).join(b);
        if (out !== text) {
          writeFileSync(p, out);
          files++;
        }
      } catch {}
    }
  };
  walk(dir);
  return { events, files };
}

/** make the folder a switch opens, with the engine stopped: nothing for a Foundry folder, an empty one, or a copy of the current data */
export async function prepareDataDir(from: string, to: string, mode: DataDirMode, log: (m: string) => void): Promise<{ rewrote: { events: number; files: number } | null }> {
  if (mode === 'open') return { rewrote: null };
  mkdirSync(to, { recursive: true });
  if (mode === 'blank') return { rewrote: null };
  const t0 = Date.now();
  log(`[data-dir] copying ${from} to ${to}…`);
  cpSync(from, to, { recursive: true, preserveTimestamps: true, errorOnExist: false, force: true });
  const rewrote = rewriteDataDirPaths(to, from, to);
  log(`[data-dir] copied in ${Math.round((Date.now() - t0) / 1000)} s; ${rewrote.events} event(s) and ${rewrote.files} file(s) now point into the copy`);
  return { rewrote };
}

// ---------- the gate a serve loop waits at ----------

export type RestartRequest = { kind: 'restart'; why: string } | { kind: 'data-dir'; to: string; mode: DataDirMode } | { kind: 'exit' };

/** what the serve loop leaves for the engine that comes after a switch, for the Settings page to show */
export type DataDirNotice =
  /** the folder switched to could not be opened: this Foundry is back on the one before */
  | { kind: 'fell-back'; from: string; to: string; error: string; at: string }
  /** the copy or the choice could not be made: still on the folder before */
  | { kind: 'switch-failed'; to: string; error: string; at: string }
  /** the folder chosen in Settings is not there (a disk not mounted?): the default is open instead */
  | { kind: 'missing'; chosen: string; at: string };

/** A restart request waits here for the serve loop (ADR-0082); without a loop attached it has no taker. */
export class RestartGate {
  attached = false;
  private pending: RestartRequest | null = null;
  private waiters: ((r: RestartRequest) => void)[] = [];
  request(r: RestartRequest): void {
    if (this.pending) return;
    this.pending = r;
    for (const w of this.waiters.splice(0)) w(r);
  }
  wait(): Promise<RestartRequest> {
    if (this.pending) return Promise.resolve(this.pending);
    return new Promise((r) => this.waiters.push(r));
  }
  pendingRequest(): RestartRequest | null {
    return this.pending;
  }
}

export interface DataDirStatus {
  current: string;
  source: DataDirSource | 'override';
  default: string;
  provider: AgentProvider;
  version: string;
  /** when this engine started: another value after a restart */
  startedAt: string;
  /** under Docker, or with FOUNDRY_DATA_DIR set, the folder is not chosen here */
  readOnly: { reason: 'docker' | 'env'; detail: string } | null;
  /** folders this Foundry had before, newest first, that are still there */
  recent: string[];
  configFile: string | null;
  notice: DataDirNotice | null;
  restart: { attached: boolean; pending: RestartRequest | null };
}
