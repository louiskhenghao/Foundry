/**
 * The move (ADR-0107): an earlier install's goals, settings and history brought into this one. Pause what runs there,
 * stop it, copy each data folder into a staging folder beside this install's own, point its paths at where it will
 * live, carry what it read from its environment, verify, then swap it in: at once when no engine has this install's
 * folders open, else by the serve loop while this engine is stopped. Until the swap nothing of this install changes,
 * and a failure puts the old one back as it was.
 */
import { type AgentProvider, knownMigrationIds } from '@foundry/core';
import { Database } from 'bun:sqlite';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statfsSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { folderBytesAsync, formatBytes, rewriteDataDirPaths } from '../data-dir.ts';
import { isFoundryFolder, stopProcess, stopSourceService } from '../migrate.ts';
import { carrySettings, settingsFromEnv } from '../settings.ts';
import { CHECKOUT_ENTRY, commandOf, CONTAINER_DATA, countFolder, type DockerFacts, type EarlierInstall, type FolderCounts } from './find.ts';
import { localProbe, type Probe } from './probe.ts';

export const STAGING_SUFFIX = '.moving';
/** left in the copy for the engine that opens it first: what to finish there (repairs, resumes) */
export const HANDOFF_FILE = 'move-handoff.json';
/** what a finished move leaves in the folder it made, for the page: where the goals came from */
export const MOVED_FROM_FILE = 'moved-from.json';
const AT_WORK = ['clarifying', 'running', 'goal_review'];
/** the old engine's lock and notes are not the copy's */
const NOT_COPIED = ['engine.pid', 'MOVED.md', HANDOFF_FILE, MOVED_FROM_FILE];
/** a path that only meant something inside the container */
const CONTAINER_ONLY = /^(\/app\/|\/home\/node\/|\/root\/)/;

export class MoveError extends Error {}

export interface MoveItem {
  provider: AgentProvider;
  from: string;
  to: string;
  /** copy: into an empty place · replace: this install's own folder is set aside first · keep: opened where it is · conflict: this install has goals there */
  action: 'copy' | 'replace' | 'keep' | 'conflict';
  why: string;
  counts: FolderCounts | null;
}

export interface Staged {
  provider: AgentProvider;
  staging: string;
  target: string;
}

export interface Handoff {
  from: { kind: 'source' | 'docker'; where: string; version: string | null; folder: string };
  at: string;
  /** the goals the move paused there, resumed here */
  paused: string[];
  goals: number;
  events: number;
  /** the settings written from its environment */
  carried: string[];
  /** old path → new path, longest first: what the worktrees' links are mapped with */
  pathMap: [string, string][];
}

export interface MoveDone {
  staged: Staged[];
  kept: MoveItem[];
  port: number | null;
  paused: string[];
  /** this install's own folders, renamed aside by a swap made here */
  setAside: string[];
  goals: number;
}

/**
 * What a move of `install` would do with each of its folders: copied where this install keeps that provider's data, a
 * folder chosen in Settings opened where it is. A place that holds this install's own folder is set aside when it has
 * no goals (the folder the app made when it first opened), and with goals only when the person chose to.
 */
export function planMove(install: EarlierInstall, opts: { targetFor: (p: AgentProvider) => string; replace?: boolean; here?: (dir: string) => FolderCounts | null }): MoveItem[] {
  const here = opts.here ?? countFolder;
  const items: MoveItem[] = [];
  const taken = new Set<AgentProvider>();
  // one folder per provider: the one with the most history (a FOUNDRY_DATA_DIR in use over an old default beside it)
  const folders = install.folders.filter((f) => !f.moved).sort((a, b) => (b.counts?.events ?? -1) - (a.counts?.events ?? -1));
  for (const f of folders) {
    if (taken.has(f.provider)) continue;
    taken.add(f.provider);
    if (f.chosen) {
      items.push({ provider: f.provider, from: f.path, to: f.path, action: 'keep', why: 'chosen in Settings: opened where it is', counts: f.counts });
      continue;
    }
    const to = opts.targetFor(f.provider);
    if (!isFoundryFolder(to)) {
      items.push({ provider: f.provider, from: f.path, to, action: 'copy', why: '', counts: f.counts });
      continue;
    }
    const mine = here(to);
    if (!mine || mine.goals === 0) items.push({ provider: f.provider, from: f.path, to, action: 'replace', why: 'this install has no goals yet: its folder is set aside', counts: f.counts });
    else if (opts.replace) items.push({ provider: f.provider, from: f.path, to, action: 'replace', why: `this install's ${mine.goals} goal${mine.goals === 1 ? '' : 's'} are set aside as a backup`, counts: f.counts });
    else items.push({ provider: f.provider, from: f.path, to, action: 'conflict', why: `this install already has ${mine.goals} goal${mine.goals === 1 ? '' : 's'}`, counts: f.counts });
  }
  return items;
}

/** old path → new path: each copied folder, and for a container each bind mount back to its source; longest first */
export function pathMap(install: EarlierInstall, copies: MoveItem[]): [string, string][] {
  const pairs: [string, string][] = copies.map((i) => [i.from, i.to]);
  for (const m of install.docker?.mounts ?? []) {
    if (m.type === 'bind' && m.source && m.destination !== m.source && !(m.destination in CONTAINER_DATA)) pairs.push([m.destination, m.source]);
  }
  return pairs.sort((a, b) => b[0].length - a[0].length);
}

const mapPath = (p: string, map: [string, string][]) => {
  for (const [a, b] of map) if (p === a || p.startsWith(a + '/')) return b + p.slice(a.length);
  return p;
};

/** the settings an install read from its environment, as this computer can use them: container paths mapped or left out */
export function carriedLeaves(install: EarlierInstall, map: [string, string][]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [path, value] of Object.entries(settingsFromEnv(install.env))) {
    if (path === 'engine.port' || path === 'engine.host') continue;
    if (typeof value !== 'string') {
      out[path] = value;
      continue;
    }
    // compose's own name for the memory container is not one this computer resolves: its published port is
    let v = value.replace(/^http:\/\/hindsight:(\d+)/, 'http://127.0.0.1:$1');
    if (v.startsWith('/')) v = mapPath(v, map);
    if (install.kind === 'docker' && CONTAINER_ONLY.test(v)) continue;
    out[path] = v;
  }
  return out;
}

/** the worktrees under a data folder: <folder>/[providers/<p>/]worktrees/<goal>/<name> with a .git file */
export function worktreesIn(dataDir: string): string[] {
  const roots = [join(dataDir, 'worktrees')];
  try {
    for (const p of readdirSync(join(dataDir, 'providers'))) roots.push(join(dataDir, 'providers', p, 'worktrees'));
  } catch {}
  const out: string[] = [];
  for (const root of roots) {
    let goals: string[] = [];
    try {
      goals = readdirSync(root);
    } catch {
      continue;
    }
    for (const g of goals) {
      let names: string[] = [];
      try {
        names = readdirSync(join(root, g));
      } catch {
        continue;
      }
      for (const n of names) {
        const dir = join(root, g, n);
        try {
          if (statSync(join(dir, '.git')).isFile()) out.push(dir);
        } catch {}
      }
    }
  }
  return out;
}

/** each worktree's link to its repository (`gitdir: …` in its .git file), with the container's paths mapped to this computer's */
export function mapWorktreeLinks(dataDir: string, map: [string, string][]): number {
  let changed = 0;
  for (const dir of worktreesIn(dataDir)) {
    const file = join(dir, '.git');
    const text = readFileSync(file, 'utf8');
    const m = /^gitdir:\s*(.+?)\s*$/m.exec(text);
    if (!m) continue;
    const to = mapPath(m[1]!, map);
    if (to !== m[1]) {
      writeFileSync(file, `gitdir: ${to}\n`);
      changed++;
    }
  }
  return changed;
}

/** a copy this Foundry can open: its migrations all known here (an older Foundry cannot open a newer one's folder) */
function checkMigrations(dir: string): void {
  const known = new Set(knownMigrationIds());
  let ids: string[] = [];
  if (!existsSync(join(dir, 'engine.db'))) throw new MoveError(`${dir} holds no Foundry database: nothing in it to move`);
  const db = new Database(join(dir, 'engine.db'), { readonly: true });
  try {
    ids = (db.query('SELECT id FROM _migrations').all() as { id: string }[]).map((r) => r.id);
  } catch {
    ids = [];
  } finally {
    db.close();
  }
  const unknown = ids.filter((id) => !known.has(id));
  if (unknown.length) throw new MoveError(`the old Foundry is newer than this one (it has ${unknown.length} change${unknown.length === 1 ? '' : 's'} to its database this version does not know): update this one first, then move`);
}

/** the copy passes SQLite's own check and holds what the folder it came from held */
export function verifyCopy(dir: string, expected: FolderCounts | null): FolderCounts {
  const db = new Database(join(dir, 'engine.db'), { readonly: true });
  try {
    const check = (db.query('PRAGMA quick_check').get() as { quick_check?: string } | null)?.quick_check;
    if (check !== 'ok') throw new MoveError(`the copy in ${dir} failed SQLite's check: ${check}`);
  } finally {
    db.close();
  }
  const got = countFolder(dir);
  if (!got) throw new MoveError(`the copy in ${dir} has no goals table`);
  if (expected && (got.goals !== expected.goals || got.events !== expected.events)) {
    throw new MoveError(`the copy has ${got.goals} goals and ${got.events} events, and the folder it came from ${expected.goals} and ${expected.events}`);
  }
  return got;
}

/** a name nothing has yet: the second move within a second gets -2 */
const freeName = (base: string) => {
  let name = base;
  for (let n = 2; existsSync(name); n++) name = `${base}-${n}`;
  return name;
};

const stamp = (d = new Date()) => d.toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-');

/**
 * Put each staged copy where this install keeps its data, its own folder (if any) renamed aside first. All or none: a
 * rename that fails takes back the ones made. The folders set aside.
 */
export function swapIn(staged: Staged[], log: (m: string) => void, at = stamp()): string[] {
  const done: { s: Staged; aside: string | null }[] = [];
  try {
    for (const s of staged) {
      const aside = existsSync(s.target) ? freeName(`${s.target}.before-move-${at}`) : null;
      if (aside) renameSync(s.target, aside);
      try {
        renameSync(s.staging, s.target);
      } catch (err) {
        if (aside) renameSync(aside, s.target);
        throw err;
      }
      done.push({ s, aside });
      if (aside) log(`this install's own folder is kept as ${aside}`);
    }
  } catch (err) {
    for (const { s, aside } of done.reverse()) {
      try {
        renameSync(s.target, s.staging);
        if (aside) renameSync(aside, s.target);
      } catch {}
    }
    throw err;
  }
  return done.flatMap((d) => (d.aside ? [d.aside] : []));
}

/** take back a swap: the copy goes back to staging, this install's own folder back in its place */
export function swapOut(staged: Staged[], setAside: string[]): void {
  for (const s of staged) {
    const aside = setAside.find((a) => a.startsWith(`${s.target}.before-move-`));
    try {
      renameSync(s.target, s.staging);
      if (aside) renameSync(aside, s.target);
    } catch {}
  }
}

export interface Stopper {
  /** start it again its own way: the move failed */
  restore(): Promise<void>;
  /** the move is made: it never starts again by itself, and stays as the backup */
  retire(): Promise<void>;
}

const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** the processes that have these files open: lsof, or /proc where there is no lsof */
export async function openers(files: string[], probe: Probe): Promise<number[]> {
  const present = files.filter((f) => probe.exists(f));
  if (!present.length) return [];
  const r = await probe.run(['lsof', '-t', '--', ...present], { timeoutMs: 15_000 });
  if (r.code !== 127) return [...new Set(r.stdout.split('\n').map((s) => Number(s.trim())).filter((n) => n > 0))];
  if (probe.platform !== 'linux') return [];
  const script = `for p in /proc/[0-9]*; do for f in "$p"/fd/*; do t=$(readlink "$f" 2>/dev/null) || continue; case "$t" in ${present.map(shq).join('|')}) echo "\${p#/proc/}";; esac; done; done | sort -u`;
  const s = await probe.run(['sh', '-c', script], { timeoutMs: 60_000 });
  return s.stdout.split('\n').map((x) => Number(x.trim())).filter((n) => n > 0);
}

async function waitClosed(files: string[], probe: Probe, timeoutMs: number, sleep: (ms: number) => Promise<void>): Promise<string | null> {
  const t0 = Date.now();
  for (;;) {
    const pids = (await openers(files, probe)).filter((p) => !probe.self.includes(p));
    if (!pids.length) return null;
    if (Date.now() - t0 > timeoutMs) {
      const cmd = await commandOf(probe, pids[0]!);
      return `pid ${pids[0]}${cmd ? ` (${cmd.slice(0, 160)})` : ''}`;
    }
    await sleep(1000);
  }
}

async function stopCheckout(install: EarlierInstall, o: { probe: Probe; log: (m: string) => void; stopPid?: number; sleep: (ms: number) => Promise<void> }): Promise<Stopper> {
  const { probe, log } = o;
  const run = (argv: string[]) => probe.run(argv, { timeoutMs: 30_000 });
  const svc = await stopSourceService({ checkout: install.where, home: probe.home, env: probe.env, run, log, platform: probe.platform, uid: probe.uid });
  if (o.stopPid) {
    log(`stopping the Foundry that asked for the switch (pid ${o.stopPid})`);
    await stopProcess(o.stopPid, { timeoutMs: 120_000 });
  }
  const files = install.folders.filter((f) => !f.moved).map((f) => join(f.path, 'engine.db'));
  let byHand = false;
  for (const pid of await openers(files, probe)) {
    if (probe.self.includes(pid)) continue;
    const cmd = await commandOf(probe, pid);
    if (!cmd) continue;
    if (!cmd.includes(CHECKOUT_ENTRY)) {
      await svc.restore();
      throw new MoveError(`its database is open in pid ${pid} (${cmd.slice(0, 120)}), which is not a Foundry: close that, then move again`);
    }
    log(`stopping the Foundry running from ${install.where} (pid ${pid})`);
    await stopProcess(pid, { timeoutMs: 120_000 });
    byHand = true;
  }
  const holder = await waitClosed(files, probe, 90_000, o.sleep);
  if (holder) {
    await svc.restore();
    throw new MoveError(`its database is still open in ${holder}: stop that, then move again`);
  }
  return {
    restore: async () => {
      await svc.restore();
      if (byHand && svc.kind === 'none') log(`start the old Foundry again in ${install.where} with: bun run serve`);
    },
    retire: () => svc.retire(),
  };
}

async function stopContainer(d: DockerFacts, o: { probe: Probe; log: (m: string) => void }): Promise<Stopper> {
  const { probe, log } = o;
  const names = [d.container, ...(d.watchtower ? [d.watchtower] : [])];
  const before = await probe.run(['docker', 'inspect', '-f', '{{.Name}} {{.State.Running}} {{.HostConfig.RestartPolicy.Name}}', ...names], { timeoutMs: 15_000 });
  const was = new Map(before.stdout.trim().split('\n').map((l) => l.trim().split(' ')).filter((p) => p.length >= 3).map(([n, running, policy]) => [n!.replace(/^\//, ''), { running: running === 'true', policy: policy || 'no' }]));
  const restore = async () => {
    for (const [n, w] of was) await probe.run(['docker', 'update', `--restart=${w.policy}`, n], { timeoutMs: 30_000 });
    const start = [...was].filter(([, w]) => w.running).map(([n]) => n);
    if (start.length) await probe.run(['docker', 'start', ...start], { timeoutMs: 120_000 });
  };
  // its restart policy first: once stopped, neither Docker nor the watchtower brings it back
  const u = await probe.run(['docker', 'update', '--restart=no', ...names], { timeoutMs: 30_000 });
  if (u.code !== 0) throw new MoveError(`docker update failed: ${u.stderr.trim()}`);
  log(`stopping the container ${d.container}${d.watchtower ? ` and ${d.watchtower}` : ''}`);
  const s = await probe.run(['docker', 'stop', '-t', '60', ...names], { timeoutMs: 180_000 });
  if (s.code !== 0) {
    await restore();
    throw new MoveError(`docker stop failed: ${s.stderr.trim()}`);
  }
  return { restore, retire: async () => {} };
}

const tail = (s: string) => s.trim().split('\n').slice(-3).join(' ');

async function ensureRoom(from: string, parent: string): Promise<void> {
  const need = await folderBytesAsync(from);
  let free: number | null = null;
  try {
    const s = statfsSync(parent);
    free = Number(s.bavail) * Number(s.bsize);
  } catch {}
  if (free != null && free < need * 1.05 + 256 * 1024 * 1024) throw new MoveError(`not enough room: the copy needs ${formatBytes(need)} and ${parent} has ${formatBytes(free)} free`);
}

/** one data folder into the staging folder: an APFS clone or a reflink where the disk has them (instant, no room taken), else a copy */
async function copyFolder(install: EarlierInstall, from: string, staging: string, probe: Probe): Promise<string> {
  const fresh = () => {
    rmSync(staging, { recursive: true, force: true });
    mkdirSync(staging, { recursive: true });
  };
  fresh();
  const long = { timeoutMs: 6 * 3600_000 };
  if (install.kind === 'docker') {
    const r = await probe.run(['docker', 'cp', `${install.docker!.container}:${from}/.`, staging], long);
    if (r.code !== 0) throw new MoveError(`docker cp ${install.where}:${from} failed: ${tail(r.stderr)}`);
    return 'with docker cp';
  }
  if (probe.platform === 'darwin') {
    const c = await probe.run(['cp', '-c', '-R', '-p', `${from}/.`, staging], long);
    if (c.code === 0) return 'as an APFS clone';
    fresh();
  }
  await ensureRoom(from, dirname(staging));
  const r = await probe.run(probe.platform === 'darwin' ? ['cp', '-R', '-p', `${from}/.`, staging] : ['cp', '-a', '--reflink=auto', `${from}/.`, staging], long);
  if (r.code !== 0) throw new MoveError(`the copy of ${from} failed: ${tail(r.stderr)}`);
  return probe.platform === 'darwin' ? 'in full' : 'in full, or as a reflink where the disk has them';
}

/** pause the goals at work in the old Foundry, through its page, and wait until nothing runs there */
export async function pauseOldWork(url: string, o: { probe: Probe; log: (m: string) => void; now?: () => boolean; waitMs?: number; sleep: (ms: number) => Promise<void> }): Promise<string[]> {
  const { probe, log } = o;
  const goals = await probe.json(`${url}/api/goals`, { timeoutMs: 10_000 });
  if (!Array.isArray(goals)) {
    log('the old Foundry did not list its goals: it is stopped as it is');
    return [];
  }
  const paused: string[] = [];
  for (const g of goals.filter((x: { state?: string }) => AT_WORK.includes(String(x.state)))) {
    const r = await probe.json(`${url}/api/goals/${encodeURIComponent(g.id)}/pause`, { method: 'POST', body: {}, timeoutMs: 10_000 });
    if (r) {
      paused.push(g.id);
      log(`pausing "${g.title ?? g.id}" there; it goes on here`);
    }
  }
  const t0 = Date.now();
  let said = 0;
  for (;;) {
    const health = await probe.json(`${url}/api/health`, { timeoutMs: 5000 });
    const list = await probe.json(`${url}/api/goals`, { timeoutMs: 10_000 });
    const busy = Number(health?.busy?.total ?? 0);
    const still = Array.isArray(list) ? list.filter((x: { state?: string }) => AT_WORK.includes(String(x.state))).length : 0;
    if (!health || (busy === 0 && still === 0)) break;
    if (o.now?.()) {
      log('moving now: the steps in flight there start again here');
      break;
    }
    if (Date.now() - t0 > (o.waitMs ?? 30 * 60_000)) {
      log('still at work after the wait: moving now, the steps in flight start again here');
      break;
    }
    if (Date.now() - said > 30_000) {
      said = Date.now();
      log(`waiting for the work in flight there to land (${busy} session${busy === 1 ? '' : 's'})`);
    }
    await o.sleep(2000);
  }
  return paused;
}

/** the old Foundry is back: the goals the move paused go on there */
async function resumeOld(url: string, ids: string[], o: { probe: Probe; log: (m: string) => void; sleep: (ms: number) => Promise<void> }): Promise<void> {
  for (let i = 0; i < 60 && !(await o.probe.json(`${url}/api/health`)); i++) await o.sleep(1000);
  for (const id of ids) {
    if (!(await o.probe.json(`${url}/api/goals/${encodeURIComponent(id)}/resume`, { method: 'POST', body: {}, timeoutMs: 10_000 }))) o.log(`resume ${id} there by hand: it was paused for the move`);
  }
}

/** the note a moved folder keeps: where it went, and the way back */
export function movedNoteFor(install: EarlierInstall, from: string, to: string, at = new Date()): string {
  const back =
    install.kind === 'docker'
      ? `quit the app, then start the container again:\n\n    docker update --restart=${install.docker?.restart ?? 'unless-stopped'} ${install.where} && docker start ${install.where}`
      : `quit the app, then start this checkout again (\`bun run serve\` in ${install.where}).`;
  return `# This data folder moved\n\nFoundry copied it to\n\n    ${to}\n\non ${at.toISOString().slice(0, 10)}, and the Foundry app (or the foundry binary) opens that copy. This folder is the\nbackup of that day: nothing here changes any more.\n\nTo go back, ${back}\n\nIts goals are as they were on the day of the move. Once the app shows your goals, you can delete this.\n`;
}

async function markMoved(install: EarlierInstall, copies: MoveItem[], o: { probe: Probe; log: (m: string) => void }): Promise<void> {
  for (const it of copies) {
    try {
      const note = movedNoteFor(install, it.from, it.to);
      if (install.kind === 'docker') {
        const dir = mkdtempSync(join(tmpdir(), 'foundry-moved-'));
        writeFileSync(join(dir, 'MOVED.md'), note);
        await o.probe.run(['docker', 'cp', join(dir, 'MOVED.md'), `${install.where}:${it.from}/MOVED.md`], { timeoutMs: 60_000 });
        rmSync(dir, { recursive: true, force: true });
      } else writeFileSync(join(it.from, 'MOVED.md'), note);
    } catch (err) {
      o.log(`the note in ${it.from} could not be written: ${(err as Error).message}`);
    }
  }
}

export interface MoveRunOptions {
  install: EarlierInstall;
  items: MoveItem[];
  /** swap now (no engine has this install's folders open), or leave the copies staged for the serve loop */
  swap: boolean;
  /** asked while waiting: stop waiting for the goals at work there */
  now?: () => boolean;
  /** the switch: the Foundry that asked, which drained itself already */
  stopPid?: number;
  log: (m: string) => void;
  probe?: Probe;
  /** how long to wait for the goals at work to pause (default 30 min) */
  waitMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export async function runMove(o: MoveRunOptions): Promise<MoveDone> {
  const probe = o.probe ?? localProbe();
  const sleep = o.sleep ?? ((ms: number) => Bun.sleep(ms));
  const { install, log } = o;
  const conflict = o.items.find((i) => i.action === 'conflict');
  if (conflict) throw new MoveError(`${conflict.to}: ${conflict.why}. Choose to set them aside, or move nothing`);
  const copies = o.items.filter((i) => i.action === 'copy' || i.action === 'replace');
  const kept = o.items.filter((i) => i.action === 'keep');
  if (!copies.length && !kept.length) throw new MoveError('nothing to move');
  const paused = install.url && !o.stopPid ? await pauseOldWork(install.url, { probe, log, now: o.now, waitMs: o.waitMs, sleep }) : [];
  const staged: Staged[] = [];
  let stopper: Stopper | null = null;
  try {
    stopper = install.kind === 'docker' ? await stopContainer(install.docker!, { probe, log }) : await stopCheckout(install, { probe, log, stopPid: o.stopPid, sleep });
    const map = pathMap(install, copies);
    const main = copies.find((i) => i.provider === (install.env.FOUNDRY_PROVIDER ?? 'claude')) ?? copies[0];
    let goals = 0;
    for (const it of copies) {
      const staging = it.to + STAGING_SUFFIX;
      // known before anything is copied: a copy that fails half way is taken away with the rest
      staged.push({ provider: it.provider, staging, target: it.to });
      log(`copying ${install.kind === 'docker' ? `${install.where}:${it.from}` : it.from}`);
      const how = await copyFolder(install, it.from, staging, probe);
      for (const f of NOT_COPIED) rmSync(join(staging, f), { force: true });
      checkMigrations(staging);
      log(`copied ${how}; pointing its paths at ${it.to}`);
      let rewrote = 0;
      for (const [a, b] of map) rewrote += rewriteDataDirPaths(staging, a, b).events;
      const links = mapWorktreeLinks(staging, map);
      if (rewrote || links) log(`${rewrote} event${rewrote === 1 ? '' : 's'} and ${links} worktree link${links === 1 ? '' : 's'} now point where they live`);
      const carried = it === main ? carrySettings(staging, carriedLeaves(install, map), log) : [];
      if (carried.length) log(`kept the settings it read from its environment: ${carried.join(', ')}`);
      // after the stop the original holds still: the copy must hold the same
      const got = verifyCopy(staging, install.kind === 'docker' ? null : countFolder(it.from));
      goals += got.goals;
      const handoff: Handoff = { from: { kind: install.kind, where: install.where, version: install.version, folder: it.from }, at: new Date().toISOString(), paused: it === main ? paused : [], goals: got.goals, events: got.events, carried, pathMap: map };
      writeFileSync(join(staging, HANDOFF_FILE), JSON.stringify(handoff, null, 2) + '\n');
      log(`checked: ${got.goals} goal${got.goals === 1 ? '' : 's'} and ${got.events} events, as in the original`);
    }
    const setAside = o.swap && staged.length ? swapIn(staged, log) : [];
    // from here the move is made: what follows cannot undo it
    await markMoved(install, copies, { probe, log });
    try {
      await stopper.retire();
    } catch (err) {
      log(`the old service could not be turned off: ${(err as Error).message}`);
    }
    return { staged, kept, port: install.port, paused, setAside, goals };
  } catch (err) {
    for (const s of staged) rmSync(s.staging, { recursive: true, force: true });
    if (stopper) await stopper.restore();
    if (paused.length && install.url) await resumeOld(install.url, paused, { probe, log, sleep });
    throw err;
  }
}
