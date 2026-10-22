import { describe, expect, test } from 'bun:test';
import { continuationMessage, decideNext, interruptionOf } from './attempt-loop.ts';

const base = { committed: true, failedCount: 1, prevFailedCount: null, continuations: 0, maxContinuations: 2, rolledBack: false, sessionId: 's1' };

describe('decideNext (continuation vs fresh attempt)', () => {
  test('cut sessions resume whatever the checks say', () => {
    for (const subtype of ['error_max_turns', 'error_max_budget_usd', 'killed_timeout', 'killed_idle']) {
      expect(decideNext({ ...base, result: { subtype }, committed: false, failedCount: 3 })).toEqual({ kind: 'continue', reason: interruptionOf({ subtype })! });
    }
  });
  test('checks failed: resume when the segment committed and is not getting worse', () => {
    expect(decideNext({ ...base, result: { subtype: 'success' } })).toEqual({ kind: 'continue', reason: 'checks_failed' });
    expect(decideNext({ ...base, result: { subtype: 'success' }, prevFailedCount: 2, failedCount: 2 })).toEqual({ kind: 'continue', reason: 'checks_failed' });
    expect(decideNext({ ...base, result: { subtype: 'success' }, prevFailedCount: 1, failedCount: 2 })).toEqual({ kind: 'new-attempt' });
    expect(decideNext({ ...base, result: { subtype: 'success' }, committed: false })).toEqual({ kind: 'new-attempt' });
  });
  test('never beyond the cap, after a rollback, or without a session', () => {
    expect(decideNext({ ...base, result: { subtype: 'error_max_turns' }, continuations: 2 })).toEqual({ kind: 'new-attempt' });
    expect(decideNext({ ...base, result: { subtype: 'error_max_turns' }, maxContinuations: 0 })).toEqual({ kind: 'new-attempt' });
    expect(decideNext({ ...base, result: { subtype: 'success' }, rolledBack: true })).toEqual({ kind: 'new-attempt' });
    expect(decideNext({ ...base, result: { subtype: 'error_max_turns' }, sessionId: null })).toEqual({ kind: 'new-attempt' });
  });
  test('a session a usage limit cut resumes whatever the checks say, past the cap; an exhausted extra usage it did not run on is no cut', () => {
    const limited = { subtype: 'error_during_execution', isError: true, errorMessage: "You've hit your session limit · resets 3:45pm" };
    expect(decideNext({ ...base, result: limited, committed: false, failedCount: 3, continuations: 2 })).toEqual({ kind: 'continue', reason: 'usage_limit' });
    const rejected = (rateLimitType: string, isUsingOverage = false) => ({ subtype: 'success', rateLimit: { status: 'rejected', resetsAt: 1, rateLimitType, isUsingOverage, raw: {} } });
    expect(interruptionOf(rejected('five_hour'))).toBe('usage_limit');
    expect(interruptionOf(rejected('overage', true))).toBe('usage_limit');
    expect(interruptionOf(rejected('overage'))).toBeNull();
    expect(interruptionOf({ subtype: 'success', isError: false, errorMessage: 'rate limit' })).toBeNull();
    expect(decideNext({ ...base, result: limited, sessionId: null })).toEqual({ kind: 'new-attempt' });
  });
  test('messages never restate the task', () => {
    expect(continuationMessage('usage_limit')).toContain('usage limit');
    expect(continuationMessage('orphaned')).toContain('engine restart');
    expect(continuationMessage('timeout', { timeoutMin: 20 })).toContain('20 min');
    expect(continuationMessage('checks_failed', { report: '- ❌ tests' })).toContain('- ❌ tests');
  });
});
