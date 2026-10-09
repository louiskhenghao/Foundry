import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Check } from '@foundry/core';
import { runCommandCheck } from './command.ts';

const check = (cmd: string, timeoutMs = 60_000): Check => ({ id: 'c1', goalId: 'g1', taskId: 't1', name: 'e2e', tier: 'must', spec: { type: 'command', cmd, timeoutMs, expectExitCode: 0 } });

describe('command check', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cmdcheck-'));
  const ctx = { cwd: dir, outputDir: join(dir, 'out'), attemptId: null };

  test('a timed-out test runner whose dev server holds the output still ends the check', async () => {
    const started = Date.now();
    const r = await runCommandCheck(check('sleep 30 | cat', 300), ctx);
    expect(r.status).toBe('error');
    expect(r.summary).toContain('killed: timeout');
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  test('a server left running after the command passed does not keep the check open', async () => {
    const started = Date.now();
    const r = await runCommandCheck(check('sleep 30 & echo ok'), ctx);
    expect(r.status).toBe('pass');
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});
