import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCommandCheck } from './checks/command.ts';
import { PLAYWRIGHT_PACKAGE_DIR, playwrightEnv } from './playwright-dir.ts';

describe("the engine's Playwright, handed to sessions and to command checks (ADR-0077)", () => {
  test('resolves to the package the engine imports', () => {
    expect(PLAYWRIGHT_PACKAGE_DIR).toBeTruthy();
    expect(existsSync(join(PLAYWRIGHT_PACKAGE_DIR!, 'package.json'))).toBe(true);
    expect(playwrightEnv()).toEqual({ FOUNDRY_PLAYWRIGHT: PLAYWRIGHT_PACKAGE_DIR! });
  });
  test('a command check sees FOUNDRY_PLAYWRIGHT, so a film can be rendered by a check', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'check-'));
    const r = await runCommandCheck({ id: 'chk', goalId: 'g', taskId: null, name: 'env', tier: 'must', spec: { type: 'command', cmd: 'test -f "$FOUNDRY_PLAYWRIGHT/package.json" && echo "$FOUNDRY_PLAYWRIGHT"', timeoutMs: 10_000, expectExitCode: 0 } }, { cwd: dir, outputDir: dir, attemptId: null });
    expect(r.status).toBe('pass');
    expect(r.summary).toContain(PLAYWRIGHT_PACKAGE_DIR!);
    rmSync(dir, { recursive: true, force: true });
  });
});
