import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { hostname, platform } from 'node:os';
import { basename, join } from 'node:path';
import {
  FOLLOWABLE_STATES,
  TRANSFER_FORMAT,
  TRANSFER_FORMAT_VERSION,
  getGoal,
  listAttemptsByGoal,
  listCheckResultsByGoal,
  listEscalations,
  listGoals,
  listTasks,
  newId,
  repoHere,
  secretSettings,
  transferableSettings,
  type EventStore,
  type Goal,
  type SettingsPatch,
  type TransferCategory,
  type TransferGoalEntry,
  type TransferManifest,
} from '@foundry/core';
import type { Engine } from '../engine.ts';
import { git } from '../git/git.ts';
import { attachmentsDir } from '../attachments.ts';
import { ARTIFACTS_DIR, goalWorkspacePath, screenshotsDir } from '../workspace.ts';
import { packTransfer } from './archive.ts';
import { TransferError } from './errors.ts';
import { transferGoalDir } from './paths.ts';
import { sealSecrets } from './secrets.ts';

/** What a Transfer needs of a Foundry: the export side runs with or without a live engine (the CLI) */
export interface TransferHost {
  store: EventStore;
  dataDir: string;
  provider: 'claude' | 'codex';
  /** the Release this Foundry runs */
  release: string;
  settingsFile(): SettingsPatch;
  previewEnv(): Record<string, Record<string, string>>;
}

/** the live engine as a TransferHost */
export function engineTransferHost(engine: Engine): TransferHost {
  return {
    store: engine.store,
    dataDir: engine.config.dataDir,
    provider: engine.config.provider,
    release: engine.updater.current(),
    settingsFile: () => engine.settings.fileSnapshot(),
    previewEnv: () => engine.preview.env.all(),
  };
}

export interface ExportOptions {
  categories: Partial<Record<TransferCategory, boolean>>;
  /** the goals to carry when Goals is ticked: chosen one by one, or all of them */
  goalIds?: string[] | 'all';
  /** required when Keys & secrets is ticked */
  password?: string;
  /** where the Transfer file is written */
  out: string;
}

export interface ExportResult {
  file: string;
  bytes: number;
  manifest: TransferManifest;
}

/**
 * Write a Transfer file (ADR-0030): a snapshot of the ticked categories. Nothing on this instance changes — goals carry
 * on, nothing is paused, no event is written.
 */
export async function exportTransfer(host: TransferHost, opts: ExportOptions): Promise<ExportResult> {
  const cat = (c: TransferCategory) => !!opts.categories[c];
  if (!(['settings', 'secrets', 'goals'] as const).some(cat)) throw new TransferError('tick at least one of Settings, Keys & secrets or Goals');
  if (cat('transcripts') && !cat('goals')) throw new TransferError('session transcripts travel with their goals: tick Goals too');
  if (cat('secrets') && !opts.password) throw new TransferError('Keys & secrets need a password');
  const goals = cat('goals') ? pickGoals(host, opts.goalIds ?? 'all') : [];
  if (cat('goals') && !goals.length) throw new TransferError('there are no goals to transfer');

  const transferId = newId('tr');
  const stageRoot = join(host.dataDir, 'transfer', 'staging');
  mkdirSync(stageRoot, { recursive: true });
  const stage = mkdtempSync(join(stageRoot, 'export-'));
  try {
    const file = host.settingsFile();
    if (cat('settings')) writeFileSync(join(stage, 'settings.json'), JSON.stringify(transferableSettings(file), null, 2));
    if (cat('secrets')) writeFileSync(join(stage, 'secrets.json'), JSON.stringify(sealSecrets({ settings: secretSettings(file), previewEnv: host.previewEnv() }, opts.password!, transferId)), { mode: 0o600 });
    const entries: TransferGoalEntry[] = [];
    for (const g of goals) entries.push(await stageGoal(host, g, stage, cat('transcripts')));
    const manifest: TransferManifest = {
      format: TRANSFER_FORMAT,
      formatVersion: TRANSFER_FORMAT_VERSION,
      release: host.release,
      transferId,
      exportedAt: new Date().toISOString(),
      source: { hostname: hostname(), platform: platform(), provider: host.provider, dataDir: host.dataDir },
      categories: { settings: cat('settings'), secrets: cat('secrets'), goals: cat('goals'), transcripts: cat('transcripts') },
      goals: entries,
    };
    writeFileSync(join(stage, 'manifest.json'), JSON.stringify(manifest, null, 2));
    await packTransfer(stage, opts.out);
    return { file: opts.out, bytes: statSync(opts.out).size, manifest };
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

function pickGoals(host: TransferHost, ids: string[] | 'all'): Goal[] {
  if (ids === 'all') return listGoals(host.store.db).reverse(); // oldest first, as they were made
  return ids.map((id) => {
    const g = getGoal(host.store.db, id);
    if (!g) throw new TransferError(`goal ${id} not found`, 404);
    return g;
  });
}

/** link a file or folder of this computer into the staging folder; the archive stores what the link points at */
function link(stage: string, rel: string, target: string): void {
  const at = join(stage, rel);
  mkdirSync(join(at, '..'), { recursive: true });
  symlinkSync(target, at);
}

const hasFiles = (dir: string) => existsSync(dir) && readdirSync(dir, { recursive: true }).length > 0;

async function stageGoal(host: TransferHost, g: Goal, stage: string, transcripts: boolean): Promise<TransferGoalEntry> {
  const { store, dataDir } = host;
  const dir = join('goals', g.id);
  mkdirSync(join(stage, dir), { recursive: true });
  // a goal reads in one go: its events, oldest first, as the log holds them
  const events = store.listByGoal(g.id, -1);
  writeFileSync(join(stage, dir, 'events.jsonl'), events.map(({ seq: _seq, ...e }) => JSON.stringify(e)).join('\n') + '\n');
  const unfinished = !FOLLOWABLE_STATES.includes(g.state);

  let remoteUrl: string | null = null;
  let bundle = false;
  let artifacts = false;
  if (repoHere(g) && existsSync(g.repoPath)) {
    const remote = g.delivery.policy.remote || 'origin';
    const url = await git(['remote', 'get-url', remote], g.repoPath);
    remoteUrl = url.code === 0 ? url.stdout.trim() || null : null;
    bundle = await bundleBranch(g, remote, join(stage, dir, 'branch.bundle'));
    const ws = goalWorkspacePath(dataDir, g);
    if (unfinished && hasFiles(join(ws, ARTIFACTS_DIR))) (link(stage, join(dir, 'artifacts'), join(ws, ARTIFACTS_DIR)), (artifacts = true));
  } else if (g.transfer) {
    // an Imported Goal sent on again carries what reached this computer for it
    remoteUrl = null;
    if (g.transfer.bundle && existsSync(join(dataDir, g.transfer.bundle))) (link(stage, join(dir, 'branch.bundle'), join(dataDir, g.transfer.bundle)), (bundle = true));
    if (g.transfer.artifacts && hasFiles(join(dataDir, g.transfer.artifacts))) (link(stage, join(dir, 'artifacts'), join(dataDir, g.transfer.artifacts)), (artifacts = true));
  }
  const shots = screenshotsDir(dataDir, g);
  if (hasFiles(shots)) link(stage, join(dir, 'screenshots'), shots);
  if (hasFiles(attachmentsDir(dataDir, g.id))) link(stage, join('attachments', g.id), attachmentsDir(dataDir, g.id));
  if (transcripts) stageLogs(host, g, stage);

  return {
    id: g.id,
    title: g.title,
    state: g.state,
    provider: g.provider ?? null,
    createdAt: g.createdAt,
    costUsd: g.costUsd,
    repoPath: g.transfer && !g.transfer.repoMapped ? g.transfer.original.repoPath : g.repoPath,
    remoteUrl,
    baseBranch: g.baseBranch,
    branch: g.branch,
    unfinished,
    follows: g.follows ? { goalId: g.follows.goalId, title: g.follows.title } : null,
    events: events.length,
    bundle,
    artifacts,
  };
}

/**
 * The goal branch as a git bundle when it holds commits the base branch lacks, finished or not: the base branch's
 * remote-tracking ref is left out (the other computer fetches it), a branch with no remote travels whole.
 */
async function bundleBranch(g: Goal, remote: string, out: string): Promise<boolean> {
  const branch = `refs/heads/${g.branch}`;
  if ((await git(['rev-parse', '--verify', '--quiet', branch], g.repoPath)).code !== 0) return false;
  const tracking = `refs/remotes/${remote}/${g.baseBranch}`;
  const local = `refs/heads/${g.baseBranch}`;
  const base = (await git(['rev-parse', '--verify', '--quiet', tracking], g.repoPath)).code === 0 ? tracking : (await git(['rev-parse', '--verify', '--quiet', local], g.repoPath)).code === 0 ? local : null;
  if (base) {
    const ahead = await git(['rev-list', '--count', `${base}..${branch}`], g.repoPath);
    if (ahead.code === 0 && Number(ahead.stdout.trim()) === 0) return false;
  }
  const args = base === tracking ? ['bundle', 'create', out, branch, `^${tracking}`] : ['bundle', 'create', out, branch];
  const r = await git(args, g.repoPath);
  if (r.code !== 0) throw new TransferError(`could not bundle the branch of "${g.title}": ${r.stderr.trim()}`);
  return true;
}

/** session transcripts (named after the goal or one of its tasks, attempts or escalations) and raw check output */
function stageLogs(host: TransferHost, g: Goal, stage: string): void {
  const { store, dataDir } = host;
  const ids = [g.id, ...listTasks(store.db, g.id).map((t) => t.id), ...listAttemptsByGoal(store.db, g.id).map((a) => a.id), ...listEscalations(store.db, { goalId: g.id }).map((e) => e.id)];
  const tdir = join(dataDir, 'transcripts');
  if (existsSync(tdir)) for (const name of readdirSync(tdir)) if (ids.some((id) => name.includes(id))) link(stage, join('transcripts', name), join(tdir, name));
  const odir = join(dataDir, 'check-output');
  const refs = new Set(listCheckResultsByGoal(store.db, g.id).map((r) => r.rawRef));
  for (const e of store.listByGoalOfTypes(g.id, ['review.goal.finished'])) if (e.type === 'review.goal.finished') for (const r of [...e.payload.mustResults, ...e.payload.stretchResults]) refs.add(r.rawRef);
  for (const ref of refs) if (ref && ref.startsWith(`${odir}/`) && existsSync(ref) && !existsSync(join(stage, 'check-output', basename(ref)))) link(stage, join('check-output', basename(ref)), ref);
}
