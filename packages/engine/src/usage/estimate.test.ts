import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import type { EngineEvent } from '@foundry/core';
import { estimateCutSessions, estimateSession, measuredRates, modelFamily, weighted } from './estimate.ts';

/** a usage ledger with the rows given: [model, cost, input, output, cache read, cache write, status] */
function ledger(rows: [string | null, number, number, number, number, number, string | null][]): Database {
  const db = new Database(':memory:');
  db.run(`CREATE TABLE usage_ledger (event_id TEXT PRIMARY KEY, ts TEXT NOT NULL, goal_id TEXT, kind TEXT NOT NULL, model TEXT, input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL, cache_read_tokens INTEGER NOT NULL, cache_create_tokens INTEGER NOT NULL, cost_usd REAL NOT NULL, duration_ms INTEGER NOT NULL, subtype TEXT NOT NULL, cost_status TEXT)`);
  rows.forEach(([model, cost, i, o, r, c, status], n) => db.run('INSERT INTO usage_ledger VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [`e${n}`, '2026-10-19T00:00:00Z', 'g1', 'attempt', model, i, o, r, c, cost, 1000, 'success', status]));
  return db;
}
const usage = (sessionId: string, model: string, tokens: [number, number, number, number], status: 'reported' | 'unavailable' = 'unavailable', costUsd = 0) =>
  ({ id: sessionId, ts: '2026-10-19T00:00:00Z', goalId: 'g1', type: 'session.usage', payload: { sessionId, kind: 'attempt', model, inputTokens: tokens[0], outputTokens: tokens[1], cacheReadTokens: tokens[2], cacheCreateTokens: tokens[3], costUsd, durationMs: 1, subtype: 'killed_timeout', rateLimit: null, skillsUsed: [], costStatus: status } }) as EngineEvent;

describe('the cost of a session cut before it reported one', () => {
  test('tokens count as input-token equivalents at the price ratios', () => {
    expect(weighted({ inputTokens: 100, outputTokens: 10, cacheReadTokens: 1000, cacheCreateTokens: 40 })).toBe(100 + 50 + 100 + 50);
    expect(modelFamily('claude-opus-5-5')).toBe('opus');
    expect(modelFamily('fable')).toBe('fable');
    expect(modelFamily('gpt-6')).toBeNull();
  });

  test('a rate per model comes from the sessions that reported their cost; unmeasured and free rows do not count', () => {
    // 1,000 input-token equivalents for $0.01 → $0.00001 each; the cut row and the zero-cost row are left out
    const rates = measuredRates(ledger([
      ['claude-opus-5-5', 0.006, 500, 50, 1000, 0, 'reported'],
      ['claude-opus-5-5', 0.004, 400, 0, 1000, 0, null],
      ['claude-opus-5-5', 0, 999999, 999, 0, 0, 'unavailable'],
      ['codex-default', 0, 5000, 500, 0, 0, null],
    ]));
    expect(rates.byModel.get('claude-opus-5-5')).toBeCloseTo(0.01 / (500 + 250 + 100 + 400 + 100), 12);
    expect(rates.byModel.has('codex-default')).toBe(false);
    expect(rates.byFamily.get('opus')).toBeCloseTo(rates.byModel.get('claude-opus-5-5')!, 12);
    // another model of the family is priced at the family's rate; a model never measured has no estimate
    expect(estimateSession(rates, 'opus', { inputTokens: 1350, outputTokens: 0, cacheReadTokens: 0, cacheCreateTokens: 0 })).toBeCloseTo(0.01, 12);
    expect(estimateSession(rates, 'claude-haiku-5-5', { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheCreateTokens: 0 })).toBeNull();
  });

  test("a goal's cut sessions are estimated one by one; a reported one is not, and an unmeasurable one stays unknown", () => {
    const rates = measuredRates(ledger([['claude-fable-5-1', 0.02, 2000, 0, 0, 0, 'reported']]));
    const est = estimateCutSessions(rates, [
      usage('s1', 'claude-fable-5-1', [1000, 100, 5000, 0]),
      usage('s2', 'claude-fable-5-1', [9, 9, 9, 9], 'reported', 0.5),
      usage('s3', 'claude-haiku-5-5', [10, 10, 0, 0]),
    ]);
    // s1: 1000 + 500 + 500 = 2000 equivalents at $0.00001
    expect(est).toEqual({ usd: 0.02, sessions: 2, estimated: 1, bySession: { s1: 0.02 } });
  });
});
