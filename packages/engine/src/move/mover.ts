/**
 * The move as the page asks for it (ADR-0107): the earlier installs on this computer, and one move at a time. Its copies
 * are made while this engine still serves (the page shows each step), then the serve loop swaps them in while the engine
 * is stopped, on the old install's port when it is free.
 */
import type { AgentProvider } from '@foundry/core';
import { isPortFree } from '../app-shell.ts';
import type { RestartRequest } from '../data-dir.ts';
import type { InstallKind } from '../install-root.ts';
import { readMovedFrom, type MovedFrom } from './finish.ts';
import { rmSync } from 'node:fs';
import { CHECKOUT_ENTRY, commandOf, findEarlierInstalls, sourceInstallAt, type EarlierInstall, type Found } from './find.ts';
import { MoveError, type MoveItem, MOVING_SUFFIX, openers, planMove, restoreOld, runMove } from './move.ts';
import { localProbe, type Probe } from './probe.ts';

export interface MoveJob {
  /** the install moved: source:<checkout> or docker:<container> */
  id: string;
  where: string;
  state: 'running' | 'restarting' | 'failed';
  lines: string[];
  error: string | null;
  /** the address this Foundry answers on once the move is in place */
  nextUrl: string | null;
  startedAt: string;
}

export interface MoveStatus {
  kind: InstallKind;
  here: { goals: number; dataDir: string };
  /** an app or binary install with no goals yet, and an earlier install with some: the Goals page offers the move */
  offer: boolean;
  installs: (EarlierInstall & { plan: MoveItem[] })[];
  notes: string[];
  job: MoveJob | null;
  /** the move this install's data came from, once finished */
  last: MovedFrom | null;
  /** a move whose copy could not be opened here: this install is back on its own folder, the old one runs again */
  failed: { error: string; at: string } | null;
}

export interface MoverDeps {
  kind: InstallKind;
  dataDir: () => string;
  /** where this install keeps a provider's data */
  targetFor: (p: AgentProvider) => string;
  /** this install's goals */
  goals: () => number;
  port: () => number;
  restart: (req: RestartRequest) => void;
  log: (m: string) => void;
  /** how long the job says `restarting` before the restart (default 1.5 s): a page or a CLI polling once a second sees it */
  restartAfterMs?: number;
  /** a release install: the installer's record and the foundry command follow the goals here */
  adopt?: (log: (m: string) => void) => Promise<unknown>;
  /** the notice a move that did not take left (the serve loop's) */
  failed?: () => { error: string; at: string } | null;
  probe?: Probe;
}

const PROVIDERS: AgentProvider[] = ['claude', 'codex', 'agy'];

const FIND_FOR_MS = 30_000;

export class Mover {
  job: MoveJob | null = null;
  private found: { at: number; value: Found } | null = null;
  private skipWait = false;
  constructor(private readonly d: MoverDeps) {}

  async status(opts: { fresh?: boolean } = {}): Promise<MoveStatus> {
    const here = { goals: this.d.goals(), dataDir: this.d.dataDir() };
    const found = this.d.kind === 'checkout' ? { installs: [], notes: [] } : await this.find(opts.fresh);
    const installs = found.installs.map((i) => ({ ...i, plan: planMove(i, { targetFor: this.d.targetFor, replace: here.goals > 0 }) }));
    return {
      kind: this.d.kind,
      here,
      offer: this.d.kind !== 'checkout' && here.goals === 0 && installs.some((i) => i.goals > 0),
      installs,
      notes: found.notes,
      job: this.job,
      last: readMovedFrom(here.dataDir),
      failed: this.d.failed?.() ?? null,
    };
  }

  private async find(fresh?: boolean): Promise<Found> {
    if (!fresh && this.found && Date.now() - this.found.at < FIND_FOR_MS) return this.found.value;
    // never this install's own folders: the one open now, and where it keeps each provider's (as foundry migrate does)
    const value = await findEarlierInstalls({ probe: this.d.probe, exclude: [this.d.dataDir(), ...PROVIDERS.map((p) => this.d.targetFor(p))] });
    this.found = { at: Date.now(), value };
    return value;
  }

  /** start moving `id` here; the job runs on, and the page follows it */
  start(opts: { id: string; now?: boolean; replace?: boolean; onLine: (line: string) => void; from?: string; data?: string | null }): MoveJob {
    if (this.job && this.job.state !== 'failed') throw new MoveError('a move is under way');
    if (this.d.kind === 'checkout') throw new MoveError('a checkout does not take a move: install the app or the binary, and move there');
    const job: MoveJob = { id: opts.id, where: opts.id.replace(/^(source|docker):/, ''), state: 'running', lines: [], error: null, nextUrl: null, startedAt: new Date().toISOString() };
    this.job = job;
    this.skipWait = !!opts.now;
    const log = (m: string) => {
      job.lines.push(m);
      if (job.lines.length > 400) job.lines.shift();
      opts.onLine(m);
      this.d.log(`[move] ${m}`);
    };
    void (async () => {
      try {
        const found = await this.find(true);
        const seen = found.installs.find((i) => i.id === opts.id);
        // a checkout named by path (foundry migrate --from, --data) is moved as named, found or not
        const install = opts.from ? sourceInstallAt(opts.from, { data: opts.data, found: seen }) : seen;
        if (!install) throw new MoveError(`${job.where} is not on this computer any more`);
        // where Foundry will answer once the move is in place: told before anything stops, so a page that loses this
        // server mid-move knows where to look (the old one's port, when it has one)
        job.nextUrl = `http://127.0.0.1:${install.port && install.port !== this.d.port() ? install.port : this.d.port()}`;
        const items = planMove(install, { targetFor: this.d.targetFor, replace: opts.replace });
        const done = await runMove({ install, items, swap: false, now: () => this.skipWait, log, probe: this.d.probe });
        // a goal made here while the move waited would be set aside with this install's folder: put the old one back instead
        const mine = this.d.goals();
        if (mine > 0 && items.some((i) => i.action === 'replace') && !opts.replace) {
          for (const s of done.staged) rmSync(s.staging, { recursive: true, force: true });
          for (const s of done.staged) rmSync(s.target + MOVING_SUFFIX, { force: true });
          if (done.old) await restoreOld(done.old, { probe: this.d.probe, log });
          throw new MoveError(`this install has ${mine} goal${mine === 1 ? '' : 's'} now, made while the move ran; nothing moved, and the old Foundry runs again`);
        }
        // a folder chosen in Settings: the same folder, opened here once its old Foundry stopped; nothing to finish later
        if (!done.staged.length) await this.d.adopt?.(log).catch((err) => log(`the foundry command still names the old install: ${(err as Error).message}`));
        // the old one's address, when it is free now: bookmarks and the CLI keep working
        const port = done.port && done.port !== this.d.port() && isPortFree(done.port) ? done.port : null;
        job.nextUrl = `http://127.0.0.1:${port ?? this.d.port()}`;
        job.state = 'restarting';
        this.found = null;
        log(done.staged.length ? `starting again on the moved data${port ? `, at ${job.nextUrl}` : ''}` : 'starting again on the folder chosen in Settings');
        await Bun.sleep(this.d.restartAfterMs ?? 1500);
        this.d.restart(done.staged.length ? { kind: 'move', staged: done.staged.map((s) => ({ provider: s.provider, staging: s.staging, target: s.target })), port } : { kind: 'restart', why: 'the move: the folder chosen in Settings is free now' });
      } catch (err) {
        job.state = 'failed';
        job.error = (err as Error).message;
        log(`the move stopped: ${job.error}. Nothing here changed, and the old Foundry is as it was.`);
      }
    })();
    return job;
  }

  /** stop waiting for the goals at work in the old Foundry: their steps in flight start again here */
  moveNow(): void {
    this.skipWait = true;
  }
}

/**
 * Another Foundry that has this data folder's database open (its pid and command), for one older than 2.36 claims
 * nothing. Only a Foundry counts: a database browser reading the file is no reason not to start.
 */
export async function openedByOther(dataDir: string, probe: Probe = localProbe()): Promise<string | null> {
  for (const pid of (await openers([`${dataDir}/engine.db`], probe)).filter((p) => !probe.self.includes(p))) {
    const cmd = await commandOf(probe, pid);
    if (cmd.includes(CHECKOUT_ENTRY) || /foundry(-engine)?\s+serve\b/.test(cmd)) return `pid ${pid} (${cmd.slice(0, 120)})`;
  }
  return null;
}
