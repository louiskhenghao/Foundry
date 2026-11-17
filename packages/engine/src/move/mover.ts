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
import { findEarlierInstalls, type EarlierInstall, type Found } from './find.ts';
import { MoveError, type MoveItem, openers, planMove, runMove } from './move.ts';
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
  probe?: Probe;
}

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
    };
  }

  private async find(fresh?: boolean): Promise<Found> {
    if (!fresh && this.found && Date.now() - this.found.at < FIND_FOR_MS) return this.found.value;
    const value = await findEarlierInstalls({ probe: this.d.probe, exclude: [this.d.dataDir()] });
    this.found = { at: Date.now(), value };
    return value;
  }

  /** start moving `id` here; the job runs on, and the page follows it */
  start(opts: { id: string; now?: boolean; replace?: boolean; onLine: (line: string) => void }): MoveJob {
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
        const install = found.installs.find((i) => i.id === opts.id);
        if (!install) throw new MoveError(`${job.where} is not on this computer any more`);
        const items = planMove(install, { targetFor: this.d.targetFor, replace: opts.replace });
        const done = await runMove({ install, items, swap: false, now: () => this.skipWait, log, probe: this.d.probe });
        // the old one's address, when it is free now: bookmarks and the CLI keep working
        const port = done.port && done.port !== this.d.port() && isPortFree(done.port) ? done.port : null;
        job.nextUrl = `http://127.0.0.1:${port ?? this.d.port()}`;
        job.state = 'restarting';
        this.found = null;
        log(done.staged.length ? `starting again on the moved data${port ? `, at ${job.nextUrl}` : ''}` : 'starting again on the folder chosen in Settings');
        this.d.restart(done.staged.length ? { kind: 'move', staged: done.staged.map((s) => ({ staging: s.staging, target: s.target })), port } : { kind: 'restart', why: 'the move: the folder chosen in Settings is free now' });
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

/** who else has this data folder's database open (a pid and its command), for a Foundry older than 2.36 claims nothing */
export async function openedByOther(dataDir: string, probe: Probe = localProbe()): Promise<string | null> {
  const pids = (await openers([`${dataDir}/engine.db`], probe)).filter((p) => !probe.self.includes(p));
  if (!pids.length) return null;
  const cmd = (await probe.run(['ps', '-o', 'command=', '-p', String(pids[0])], { timeoutMs: 5000 })).stdout.trim();
  return `pid ${pids[0]}${cmd ? ` (${cmd.slice(0, 120)})` : ''}`;
}
