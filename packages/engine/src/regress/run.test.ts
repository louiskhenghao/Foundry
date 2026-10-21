import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { FakeRunner } from '../test-helpers.ts';
import { CASES, makeFixture, pickCases, type RegressCase } from './cases.ts';
import { compare, renderMarkdown, runSuite, type RegressRun } from './run.ts';

const ROOT = resolve(import.meta.dir, '../../../..');

describe('role-prompt regression set (ADR-0062)', () => {
  test('every case names a fixture, checks and allowed files, and the fixtures build as repositories whose planted bug fails the tests', async () => {
    expect(CASES.map((c) => c.name)).toEqual(['fix-failing-test', 'add-feature-with-tests', 'docs-only', 'refactor-keeps-behaviour', 'static-page-feature']);
    for (const c of CASES) {
      expect(c.checks.length).toBeGreaterThan(0);
      expect(c.allowed.length).toBeGreaterThan(0);
      expect(c.maxCostUsd).toBeGreaterThan(0);
    }
    expect(pickCases(['docs-only']).map((c) => c.name)).toEqual(['docs-only']);
    expect(() => pickCases(['nope'])).toThrow('no regression case named nope');
    const dir = mkdtempSync(join(tmpdir(), 'foundry-regress-fixture-'));
    const sha = await makeFixture('bun-lib', join(dir, 'lib'));
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
    expect(existsSync(join(dir, 'lib', '.git'))).toBe(true);
    const tests = await Bun.$`bun test`.cwd(join(dir, 'lib')).quiet().nothrow();
    expect(tests.exitCode).not.toBe(0);
    await makeFixture('static-page', join(dir, 'page'));
    expect(readFileSync(join(dir, 'page', 'index.html'), 'utf8')).toContain('<h1>');
  });

  test('a run judges each case on its checks and the files it touched, sums the suite up, and compares with a baseline', async () => {
    const workDir = mkdtempSync(join(tmpdir(), 'foundry-regress-run-'));
    // the stand-in coding agent: mends add for the first case; for the second it also edits a file it may not
    const runner = new FakeRunner((spec) => {
      const math = join(spec.cwd, 'src/math.ts');
      if (existsSync(math)) writeFileSync(math, readFileSync(math, 'utf8').replace('a - b; // BUG: should add', 'a + b;'));
      if (spec.prompt.includes('ALSO-TOUCH-README')) writeFileSync(join(spec.cwd, 'README.md'), '# changed\n');
    });
    const strays: RegressCase = { ...CASES[0]!, name: 'strays-outside', title: 'touches a file it may not', prompt: 'Fix add. ALSO-TOUCH-README', checks: ['bun test'] };
    const run = await runSuite({ cases: [CASES[0]!, strays], workDir, root: ROOT, clarify: false, runner, label: 'fake', config: { claudeHome: join(workDir, 'claude-home'), alwaysReviewTasks: false } });
    expect(run).toMatchObject({ label: 'fake', provider: 'claude', clarify: false });
    expect(run.foundry).toMatch(/^\d+\.\d+\.\d+/);
    expect(run.summary).toMatchObject({ total: 2, passed: 1, passRate: 0.5 });
    const [fixed, stray] = run.cases;
    expect(fixed).toMatchObject({ name: 'fix-failing-test', state: 'done', passed: true, tasks: 1, attempts: 1, retries: 0, touched: ['src/math.ts'], disallowed: [], detail: null });
    expect(fixed!.checks).toEqual([{ cmd: 'bun test', ok: true, output: expect.any(String) }]);
    expect(stray).toMatchObject({ name: 'strays-outside', state: 'done', passed: false, disallowed: ['README.md'] });
    expect(stray!.touched.sort()).toEqual(['README.md', 'src/math.ts']);
    expect(stray!.detail).toBe('changed outside the allowed files: README.md');
    // the page says what passed and what went wrong; a baseline comparison names the regressions and the improvements
    const md = renderMarkdown(run);
    expect(md).toContain('1 of 2 passed (50%)');
    expect(md).toContain('| fix-failing-test | ✅ pass |');
    expect(md).toContain('| strays-outside | ❌ done |');
    const baseline: RegressRun = { ...run, label: 'before', cases: run.cases.map((c) => ({ ...c, passed: !c.passed, costUsd: c.name === 'fix-failing-test' ? 0.01 : 2 })) };
    const cmp = compare({ ...run, cases: run.cases.map((c) => (c.name === 'fix-failing-test' ? { ...c, costUsd: 0.9 } : c)) }, baseline);
    expect(cmp.regressions).toEqual(['strays-outside']);
    expect(cmp.improvements).toEqual(['fix-failing-test']);
    expect(cmp.costlier).toEqual(['fix-failing-test']);
    expect(cmp.lines[0]).toContain('Against before');
    expect(cmp.lines.join('\n')).toContain('Regressions: strays-outside');
    expect(renderMarkdown(run, cmp)).toContain('## Against the baseline');
    expect(compare(run, run).lines).toContain('Nothing got worse.');
    expect(compare(run, { ...run, cases: run.cases.slice(0, 1) }).onlyHere).toEqual(['strays-outside']);
  }, 60_000);
});
