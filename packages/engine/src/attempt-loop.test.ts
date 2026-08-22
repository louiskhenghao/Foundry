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
  test('messages never restate the task', () => {
    expect(continuationMessage('orphaned')).toContain('engine restart');
    expect(continuationMessage('timeout', { timeoutMin: 20 })).toContain('20 min');
    expect(continuationMessage('checks_failed', { report: '- ❌ tests' })).toContain('- ❌ tests');
  });
});
