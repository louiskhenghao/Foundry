/**
 * What a session cut before its result line probably cost (ADR-0043). Claude Code reports a session's dollars only in
 * that line, so a session killed at its time limit has none (ADR-0037: unknown, not zero); its tokens were counted as it
 * ran. They are priced at the rate this instance measured for the same model, from the sessions that did report what
 * they cost, so no price list is kept here. An estimate is shown as one (≈), and never counts against a budget.
 */
import type { Database } from 'bun:sqlite';
import type { EngineEvent } from '@foundry/core';

/** how each kind of token is priced against an input token (Anthropic's ratios: output 5×, cache read 0.1×, cache write 1.25×) */
const WEIGHT = { input: 1, output: 5, cacheRead: 0.1, cacheCreate: 1.25 } as const;

export interface Tokens {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
}

/** a session's tokens as input-token equivalents */
export const weighted = (t: Tokens): number => t.inputTokens * WEIGHT.input + t.outputTokens * WEIGHT.output + t.cacheReadTokens * WEIGHT.cacheRead + t.cacheCreateTokens * WEIGHT.cacheCreate;

/** the family of a model ('claude-opus-5-5' → 'opus'), for one this instance has not measured under its own name */
export const modelFamily = (model: string | null | undefined): string | null => model?.toLowerCase().match(/fable|opus|sonnet|haiku/)?.[0] ?? null;

export interface Rates {
  byModel: Map<string, number>;
  byFamily: Map<string, number>;
}

/** dollars per input-token equivalent, by model and by family, from every session that reported its cost */
export function measuredRates(db: Database): Rates {
  const rows = db
    .query(
      `SELECT model, SUM(cost_usd) AS cost, SUM(input_tokens) AS i, SUM(output_tokens) AS o, SUM(cache_read_tokens) AS r, SUM(cache_create_tokens) AS c
       FROM usage_ledger WHERE cost_usd > 0 AND model IS NOT NULL AND (cost_status IS NULL OR cost_status = 'reported') GROUP BY model`,
    )
    .all() as { model: string; cost: number; i: number; o: number; r: number; c: number }[];
  const byModel = new Map<string, number>();
  const fam = new Map<string, { cost: number; w: number }>();
  for (const x of rows) {
    const w = weighted({ inputTokens: x.i, outputTokens: x.o, cacheReadTokens: x.r, cacheCreateTokens: x.c });
    if (w <= 0) continue;
    byModel.set(x.model, x.cost / w);
    const f = modelFamily(x.model);
    if (!f) continue;
    const acc = fam.get(f) ?? { cost: 0, w: 0 };
    fam.set(f, { cost: acc.cost + x.cost, w: acc.w + w });
  }
  return { byModel, byFamily: new Map([...fam].map(([f, a]) => [f, a.cost / a.w])) };
}

/** a session's estimated cost at its model's measured rate; null when that model was never measured here */
export function estimateSession(rates: Rates, model: string | null | undefined, tokens: Tokens): number | null {
  const rate = (model ? rates.byModel.get(model) : undefined) ?? rates.byFamily.get(modelFamily(model) ?? '');
  return rate == null ? null : weighted(tokens) * rate;
}

export interface CostEstimate {
  /** the estimated dollars of the cut sessions that could be estimated */
  usd: number;
  /** sessions cut before they reported a cost */
  sessions: number;
  /** of those, the ones with an estimate */
  estimated: number;
  /** session id → estimated dollars */
  bySession: Record<string, number>;
}

/** the cut sessions among a goal's recorded usage, each priced at its model's measured rate */
export function estimateCutSessions(rates: Rates, usage: EngineEvent[]): CostEstimate {
  const out: CostEstimate = { usd: 0, sessions: 0, estimated: 0, bySession: {} };
  for (const e of usage) {
    if (e.type !== 'session.usage' || e.payload.costStatus !== 'unavailable') continue;
    out.sessions++;
    const usd = estimateSession(rates, e.payload.model, e.payload);
    if (usd == null) continue;
    out.estimated++;
    out.usd += usd;
    if (e.payload.sessionId) out.bySession[e.payload.sessionId] = (out.bySession[e.payload.sessionId] ?? 0) + usd;
  }
  return out;
}
