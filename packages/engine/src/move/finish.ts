/**
 * What a move leaves for the engine that opens its copy first (ADR-0107): each worktree's repository pointed back at
 * where the worktree lives now (`git worktree repair` in it), and the goals the move paused resumed. The handoff then
 * becomes the record the page shows: where the goals came from.
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Handoff, HANDOFF_FILE, MOVED_FROM_FILE, MOVING_SUFFIX, retireOld, worktreesIn } from './move.ts';
import { localProbe, type Probe } from './probe.ts';

export interface MovedFrom extends Handoff {
  finishedAt: string;
  /** worktrees whose repository now points at them */
  repaired: number;
  /** worktrees whose repository is not on this computer: left as they are */
  unrepaired: string[];
}

export async function finishMove(o: { dataDir: string; resume: (goalId: string) => Promise<void>; log: (m: string) => void; probe?: Probe; adopt?: (log: (m: string) => void) => Promise<unknown> }): Promise<MovedFrom | null> {
  const file = join(o.dataDir, HANDOFF_FILE);
  if (!existsSync(file)) return null;
  let h: Handoff;
  try {
    h = JSON.parse(readFileSync(file, 'utf8')) as Handoff;
  } catch {
    rmSync(file, { force: true });
    return null;
  }
  const probe = o.probe ?? localProbe();
  // the copy runs here: only now does the install it came from retire (a move from the page leaves that to this start)
  if (h.old && !h.retired) {
    await retireOld(h.old, { probe, log: (m) => o.log(`[move] ${m}`) });
    await o.adopt?.((m) => o.log(`[move] ${m}`)).catch((err) => o.log(`[move] the foundry command still names the old install: ${(err as Error).message}`));
  }
  rmSync(o.dataDir + MOVING_SUFFIX, { force: true });
  let repaired = 0;
  const unrepaired: string[] = [];
  for (const dir of worktreesIn(o.dataDir)) {
    const r = await probe.run(['git', '-C', dir, 'worktree', 'repair'], { timeoutMs: 30_000 });
    if (r.code === 0) repaired++;
    else unrepaired.push(dir);
  }
  if (repaired || unrepaired.length) o.log(`[move] ${repaired} worktree${repaired === 1 ? '' : 's'} linked to their repository again${unrepaired.length ? `; ${unrepaired.length} whose repository is not on this computer left as they are` : ''}`);
  for (const id of h.paused) {
    try {
      await o.resume(id);
      o.log(`[move] resumed ${id}, paused for the move`);
    } catch (err) {
      o.log(`[move] ${id} stays paused: ${(err as Error).message}`);
    }
  }
  const record: MovedFrom = { ...h, finishedAt: new Date().toISOString(), repaired, unrepaired };
  writeFileSync(join(o.dataDir, MOVED_FROM_FILE), JSON.stringify(record, null, 2) + '\n');
  rmSync(file, { force: true });
  return record;
}

export function readMovedFrom(dataDir: string): MovedFrom | null {
  try {
    return JSON.parse(readFileSync(join(dataDir, MOVED_FROM_FILE), 'utf8')) as MovedFrom;
  } catch {
    return null;
  }
}
