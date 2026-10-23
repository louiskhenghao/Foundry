import { expect, test } from 'bun:test';
import { CHECK_RESULT } from '../src/pages/goal/CompletionCard.tsx';
import { stateLabel } from '../src/ui.tsx';

test("a check's result is said in the words an attempt's is", () => {
  expect(Object.fromEntries(Object.entries(CHECK_RESULT).map(([status, r]) => [status, r.word]))).toEqual({ pass: 'passed', fail: 'failed', error: 'error', skipped: 'skipped', none: 'pending' });
  // a check's run in the dialog, and a merge's checks, go through the shared badge
  expect(stateLabel('pass')).toBe('passed');
  expect(stateLabel('fail')).toBe('failed');
});
