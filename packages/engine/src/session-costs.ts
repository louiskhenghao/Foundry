import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { RunHandle, RunResult, RunSpec, RunnerEvent } from '@foundry/runner';

const KEEP = 2000;

/** what the CLI said a session had cost, and how many output tokens its model usage counted, when it last finished: the state a resume restores */
interface Total {
  cost: number;
  out: number;
}

/**
 * What each Claude Code session has cost so far. A resumed session (`--resume`) usually reports the session's whole
 * cost, not the turn's, and checks `--max-budget-usd` against that whole, so a session resumed for a second interview
 * round or a retry would be booked twice and run out of budget early. Not always: the CLI restores the earlier cost only
 * when the session was the last one to finish in its folder, and otherwise reports the run's own. Which one a result
 * is shows in its model usage, restored along with the cost: it then counts the earlier output tokens on top of this
 * run's. Kept in the data folder, so a resume after a restart is still booked right.
 */
export class SessionCosts {
  private totals: Record<string, Total | number>;
  private file: string;

  constructor(dataDir: string) {
    this.file = join(dataDir, 'session-costs.json');
    try {
      this.totals = existsSync(this.file) ? JSON.parse(readFileSync(this.file, 'utf8')) : {};
    } catch {
      this.totals = {};
    }
  }

  private total(sessionId: string | undefined): Total | null {
    const t = sessionId ? this.totals[sessionId] : undefined;
    return t == null ? null : typeof t === 'number' ? { cost: t, out: 0 } : t;
  }

  /**
   * Run through `run`, with a resumed session's budget raised by what it already spent and its cost reported as what
   * this run added; the session's new total is remembered.
   */
  async run(spec: RunSpec, run: (spec: RunSpec) => Promise<RunHandle>): Promise<RunHandle> {
    const prior = this.total(spec.resumeSessionId);
    const handle = await run(prior && spec.maxBudgetUsd != null ? { ...spec, maxBudgetUsd: prior.cost + spec.maxBudgetUsd } : spec);
    const own = (r: RunResult): RunResult => (prior && restored(r, prior) ? { ...r, costUsd: Math.max(0, r.costUsd - prior.cost) } : r);
    // the CLI's own view of the session as of this result, restored or not: what its next resume restores
    const remember = (r: RunResult) => r.sessionId && this.remember(r.sessionId, { cost: r.costUsd, out: modelOut(r) });
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

  private remember(sessionId: string, total: Total): void {
    if (!(total.cost > 0)) return;
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

const outOf = (usage: unknown): number => {
  const n = Number((usage as { output_tokens?: unknown } | null)?.output_tokens);
  return Number.isFinite(n) ? n : 0;
};
/** output tokens the result's model usage counts (the session's whole when the CLI restored it) */
const modelOut = (r: RunResult): number => {
  const mu = r.modelUsage as Record<string, { outputTokens?: number }> | null;
  return mu && typeof mu === 'object' ? Object.values(mu).reduce((n, m) => n + (Number(m?.outputTokens) || 0), 0) : outOf(r.usage);
};

/** did this resumed run report the session's whole cost (restored), or only its own? */
export function restored(r: RunResult, prior: Total): boolean {
  // restored model usage holds the earlier output on top of this run's own (its `usage`)
  if (prior.out > 0 && r.modelUsage && typeof r.modelUsage === 'object') return modelOut(r) >= prior.out + outOf(r.usage) - 1;
  // without token counts, a total below what the session already cost cannot be the whole
  return r.costUsd >= prior.cost;
}
