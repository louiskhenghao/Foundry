import { expect, test } from 'bun:test';
import type { ClaudeRunner } from '@ai-engine/runner';
import { SUMMARIZE_ABOVE_BYTES, summarizeOutput } from './summarize.ts';

test('small outputs never call the model', async () => {
  let called = 0;
  const runner: ClaudeRunner = {
    active: () => 0,
    run: async () => {
      called++;
      throw new Error('should not run');
    },
  };
  const out = await summarizeOutput(runner, 'short failure\nError: x', { model: 'haiku', cwd: '/tmp' });
  expect(called).toBe(0);
  expect(out).toContain('Error: x');
});

test('huge outputs fall back to structural truncation when the model fails', async () => {
  const runner: ClaudeRunner = {
    active: () => 0,
    run: async () => {
      throw new Error('offline');
    },
  };
  const raw = 'line\n'.repeat(SUMMARIZE_ABOVE_BYTES) + 'Error: boom\n' + 'tail\n'.repeat(50);
  const out = await summarizeOutput(runner, raw, { model: 'haiku', cwd: '/tmp' });
  expect(out.length).toBeLessThan(5000);
  expect(out).toContain('Error: boom');
});
