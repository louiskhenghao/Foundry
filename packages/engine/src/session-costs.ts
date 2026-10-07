import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { RunHandle, RunResult, RunSpec, RunnerEvent } from '@foundry/runner';

const KEEP = 2000;

/**
 * What each Claude Code session has cost so far. A resumed session (`--resume`) reports the session's whole cost, not
 * the turn's, and checks `--max-budget-usd` against that whole, so a session resumed for a second interview round or a
 * retry would be booked twice and run out of budget early. Kept in the data folder, so a resume after a restart is
 * still booked right.
 */
export class SessionCosts {
  private totals: Record<string, number>;
  private file: string;

  constructor(dataDir: string) {
    this.file = join(dataDir, 'session-costs.json');
    try {
      this.totals = existsSync(this.file) ? JSON.parse(readFileSync(this.file, 'utf8')) : {};
    } catch {
      this.totals = {};
    }
  }

  /**
   * Run through `run`, with a resumed session's budget raised by what it already spent and its cost reported as what
   * this run added; the session's new total is remembered.
   */
  async run(spec: RunSpec, run: (spec: RunSpec) => Promise<RunHandle>): Promise<RunHandle> {
    const prior = spec.resumeSessionId ? (this.totals[spec.resumeSessionId] ?? 0) : 0;
    const handle = await run(prior && spec.maxBudgetUsd != null ? { ...spec, maxBudgetUsd: prior + spec.maxBudgetUsd } : spec);
    const own = (r: RunResult): RunResult => (prior ? { ...r, costUsd: Math.max(0, r.costUsd - prior) } : r);
    const remember = (r: RunResult) => {
      if (r.sessionId && r.costUsd >= prior) this.remember(r.sessionId, r.costUsd);
    };
    const events = handle.events;
    return {
      ...handle,
      events: (async function* () {
        for await (const ev of events) yield (ev.kind === 'result' ? { ...ev, result: own(ev.result) } : ev) as RunnerEvent;
      })(),
      result: handle.result.then((r) => {
        remember(r);
        return own(r);
      }),
    };
  }

  private remember(sessionId: string, total: number): void {
    delete this.totals[sessionId];
    this.totals[sessionId] = total;
    const ids = Object.keys(this.totals);
    for (const id of ids.slice(0, Math.max(0, ids.length - KEEP))) delete this.totals[id];
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(`${this.file}.tmp`, JSON.stringify(this.totals));
      renameSync(`${this.file}.tmp`, this.file);
    } catch {
      /* booking stays right for this run; only a later resume after a restart could be booked whole */
    }
  }
}
