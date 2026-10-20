import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Brief, Goal } from '@foundry/core';
import { getGoal, listTasks } from '@foundry/core';
import { defaultConfig } from './config.ts';
import { Engine } from './engine.ts';
import { QA_DIR, realShots, revertOutsideScratch, runQa, type QaDeps } from './qa.ts';
import { FakeRunner, makeRepo, sh, waitFor } from './test-helpers.ts';
import { goalWorkspacePath, screenshotsDir } from './workspace.ts';

const ROOT = resolve(import.meta.dir, '../../..');
let dataDir: string;
let repo: string;
const engines: Engine[] = [];
beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'foundry-qa-'));
  repo = await makeRepo();
});
// temp dirs are intentionally not removed: a finished goal's completion work (docs, graph refresh) may still be writing when a test ends
afterEach(async () => {
  for (const e of engines.splice(0)) await e.stop().catch(() => {});
});
const track = (e: Engine) => {
  engines.push(e);
  // no learning session when a goal ends: it would outlive the test's data folder
  e.updateSettings({ workflow: { learnings: false } });
  return e;
};
const cfg = (over: Record<string, unknown> = {}) => defaultConfig(ROOT, { dataDir, claudeHome: join(dataDir, 'claude-home'), alwaysReviewTasks: false, useGraphify: false, log: () => {}, ...over });

/** the engine's parts QA needs, faked: a browser that is there, a preview that answers */
const deps = (over: Partial<QaDeps> = {}): QaDeps => ({
  playwright: async () => ({ installed: true, browser: true, detail: 'ok' }),
  startPreview: async () => ({ ready: true, error: null, apps: [{ key: 'web', name: 'web', url: 'http://127.0.0.1:4555', ready: true }] }),
  playwrightPath: () => '/fake/playwright/index.mjs',
  ...over,
});

/** a one-task web Brief: the task writes done.txt; the must check reads it; the app is named so the QA has something to open */
const webBrief = (): Omit<Brief, 'goalId'> =>
  ({
    title: 'feat(site): newsletter sign-up',
    understanding: 'A sign-up form.',
    areas: [],
    assumptions: [],
    questions: [],
    styleOptions: [],
    costEstimateUsd: 1,
    timeEstimateMin: 10,
    tasks: [{ key: 'T1', title: 'add the form', spec: 'write done.txt', kind: 'feature', scope: null, scenario: 'frontend', areaKey: null, tdd: 'inherit', dependsOnKeys: [], parallelizable: false, relevantFiles: [] }],
    checks: [
      { key: 'C1', name: 'done file', tier: 'must', taskKey: 'T1', areaKey: null, spec: { type: 'command', cmd: 'test -f done.txt', timeoutMs: 60_000, expectExitCode: 0 } },
      // goal-level checks a browser can try are named by what they show; commands keep the fake run short
      { key: 'G1', name: 'the form accepts an address', tier: 'must', taskKey: null, areaKey: null, spec: { type: 'command', cmd: 'true', timeoutMs: 60_000, expectExitCode: 0 } },
      { key: 'G2', name: 'the footer links work', tier: 'stretch', taskKey: null, areaKey: null, spec: { type: 'command', cmd: 'true', timeoutMs: 60_000, expectExitCode: 0 } },
    ],
    run: { install: null, command: 'bun run start', url: 'http://localhost:{port}', platform: 'web' },
    apps: null,
  }) as unknown as Omit<Brief, 'goalId'>;

/** a runner that answers the QA session with a scripted report and every attempt by writing the file; `touch` makes the tester leave a change outside its scratch folder */
class QaRunner extends FakeRunner {
  constructor(
    private report: unknown,
    opts: { touch?: boolean; shot?: boolean } = {},
  ) {
    super((spec) => {
      if (spec.label?.startsWith('qa ')) {
        if (opts.shot) writeFileSync(join(spec.env!.FOUNDRY_QA_SHOTS!, `${spec.env!.FOUNDRY_QA_PREFIX}form.png`), 'png');
        mkdirSync(join(spec.cwd, QA_DIR), { recursive: true });
        writeFileSync(join(spec.cwd, QA_DIR, 'form.ts'), '// a script');
        if (opts.touch) {
          writeFileSync(join(spec.cwd, 'touched.txt'), 'left by the tester');
          if (existsSync(join(spec.cwd, 'README.md'))) writeFileSync(join(spec.cwd, 'README.md'), 'changed by the tester');
        }
        return;
      }
      if (spec.label?.startsWith('attempt')) writeFileSync(join(spec.cwd, 'done.txt'), 'ok');
    });
  }
  override async run(spec: Parameters<FakeRunner['run']>[0]) {
    const handle = await super.run(spec);
    if (!spec.label?.startsWith('qa ') || !this.report) return handle;
    const result = { ...(await handle.result), structuredOutput: this.report, finalText: JSON.stringify(this.report) };
    return { ...handle, result: Promise.resolve(result), events: (async function* () { yield { kind: 'result' as const, result }; })() };
  }
}
const qaRunner = (report: unknown, opts: { touch?: boolean; shot?: boolean } = {}) => new QaRunner(report, opts);

describe('browser QA (ADR-0057)', () => {
  test('a goal with a web app and the setting on gets the QA chosen; it runs once every task is done, before the review; a failed must check becomes a fix task; the session’s other changes are put back', async () => {
    const report = { summary: 'The form shows a thank-you; the footer has a dead link.', results: [{ check: 'the form accepts an address', status: 'fail', evidence: 'Submitted ada@example.com: the page reloaded with no message.', problem: 'No thank-you message after submit.', fix: 'Render the status after the POST.', files: ['src/App.tsx'], shots: ['form.png'] }, { check: 'done file', status: 'skipped', evidence: 'a command, not a page', problem: null, fix: null, files: [], shots: [] }, { check: 'the footer links work', status: 'pass', evidence: 'three links, three pages', problem: null, fix: null, files: [], shots: [] }] };
    const runner = qaRunner(report, { touch: true, shot: true });
    const engine = track(new Engine(cfg({ workflowQa: true }), runner));
    engine.qaDeps = deps();
    const goal = await engine.createGoal({ prompt: 'newsletter sign-up', repoPath: repo, brief: webBrief() });
    expect(getGoal(engine.store.db, goal.id)!.completion.qa).toBe(true);
    await waitFor(() => getGoal(engine.store.db, goal.id)!.completion.qaRun != null, 30_000);
    const run = getGoal(engine.store.db, goal.id)!.completion.qaRun!;
    expect(run.status).toBe('ok');
    expect(run.detail).toContain('1 passed, 1 failed, 1 skipped');
    expect(run.fixTaskIds.length).toBe(1);
    const failed = run.results.find((r) => r.status === 'fail')!;
    expect(failed).toMatchObject({ must: true, fixTaskId: run.fixTaskIds[0] });
    // the screenshot it saved is kept by its real name; a name it did not save is dropped
    const prefix = runner.calls.find((c) => c.label?.startsWith('qa '))!.env!.FOUNDRY_QA_PREFIX!;
    expect(failed.shots).toEqual([`${prefix}form.png`]);
    expect(existsSync(join(screenshotsDir(dataDir, goal), `${prefix}form.png`))).toBe(true);
    const fix = listTasks(engine.store.db, goal.id).find((t) => t.origin === 'qa-fix')!;
    expect(fix.title).toBe('qa: the form accepts an address');
    expect(fix.spec).toContain('No thank-you message after submit.');
    expect(fix.relevantFiles).toEqual(['src/App.tsx']);
    // the README the tester touched was put back; its scripts stay, out of git
    const ws = goalWorkspacePath(dataDir, goal);
    expect(existsSync(join(ws, 'touched.txt'))).toBe(false);
    if (existsSync(join(ws, 'README.md'))) expect(readFileSync(join(ws, 'README.md'), 'utf8')).not.toContain('changed by the tester');
    expect(existsSync(join(ws, QA_DIR, 'form.ts'))).toBe(true);
    expect(await sh('git status --porcelain', ws)).toBe('');
    expect(engine.store.listByGoal(goal.id, 500).some((e) => e.type === 'engine.note' && String((e.payload as { message: string }).message).includes('put back'))).toBe(true);
    // the goal goes on: the fix task runs and the goal finishes
    await waitFor(() => ['done', 'over_delivered', 'failed'].includes(getGoal(engine.store.db, goal.id)!.state), 40_000);
    expect(getGoal(engine.store.db, goal.id)!.completion.qaRun!.at).toBe(run.at);
    const qaCall = runner.calls.find((c) => c.label?.startsWith('qa '))!;
    expect(qaCall.prompt).toContain('- [must, goal-level] the form accepts an address: the command `true` passes');
    expect(qaCall.prompt).toContain('- [stretch, goal-level] the footer links work');
    expect(qaCall.prompt).toContain('http://127.0.0.1:4555');
    expect(qaCall.env?.FOUNDRY_QA_PLAYWRIGHT).toBe('/fake/playwright/index.mjs');
  }, 90_000);

  test('no web app, no browser or no budget skips the QA with the reason; a goal whose Brief names no app is never given one', async () => {
    const engine = track(new Engine(cfg({ workflowQa: true }), qaRunner({ summary: '', results: [] })));
    const noApp = await engine.createGoal({ prompt: 'a script', repoPath: repo, brief: { ...webBrief(), run: null, apps: null } });
    expect(getGoal(engine.store.db, noApp.id)!.completion.qa).toBe(false);
    // one goal at a time in the folder: the next starts once this one is over
    await waitFor(() => ['done', 'over_delivered', 'failed'].includes(getGoal(engine.store.db, noApp.id)!.state), 40_000);

    engine.qaDeps = deps({ playwright: async () => ({ installed: true, browser: false, detail: 'no Chromium' }) });
    const goal = await engine.createGoal({ prompt: 'newsletter', repoPath: repo, brief: webBrief() });
    await waitFor(() => getGoal(engine.store.db, goal.id)!.completion.qaRun != null, 30_000);
    expect(getGoal(engine.store.db, goal.id)!.completion.qaRun).toMatchObject({ status: 'skipped', detail: expect.stringContaining('Chromium for Playwright is not installed') });
    await waitFor(() => ['done', 'over_delivered', 'failed'].includes(getGoal(engine.store.db, goal.id)!.state), 40_000);

    const g2 = await engine.createGoal({ prompt: 'newsletter', repoPath: repo, brief: webBrief(), budgets: { maxCostUsd: 0.001 } });
    engine.qaDeps = deps();
    const fresh = { ...getGoal(engine.store.db, g2.id)!, costUsd: 5 } as Goal;
    await runQa(engine, fresh, deps());
    expect(getGoal(engine.store.db, g2.id)!.completion.qaRun).toMatchObject({ status: 'skipped', detail: 'the goal has no budget left for the browser QA' });
    // nothing of this goal outlives the test
    await engine.cancelGoal(g2.id);
    await waitFor(() => getGoal(engine.store.db, g2.id)!.state === 'cancelled', 20_000);
  }, 90_000);

  test('a report the session never gave is a failed QA, said in words; the helpers keep real screenshots and put back what was changed', async () => {
    // the attempts write their file; the QA session answers with no report at all
    const engine = track(new Engine(cfg(), qaRunner(null)));
    const goal = await engine.createGoal({ prompt: 'newsletter', repoPath: repo, brief: webBrief() });
    // as in the scheduler: the QA runs once the goal's tasks are over, never beside a running attempt in the same folder
    await waitFor(() => ['done', 'over_delivered', 'failed'].includes(getGoal(engine.store.db, goal.id)!.state), 40_000);
    await runQa(engine, getGoal(engine.store.db, goal.id)!, deps());
    expect(getGoal(engine.store.db, goal.id)!.completion.qaRun).toMatchObject({ status: 'failed', detail: expect.stringContaining('no JSON report') });
    const dir = mkdtempSync(join(tmpdir(), 'shots-'));
    writeFileSync(join(dir, 'qa-1-a.png'), '');
    expect(realShots(dir, 'qa-1-', ['qa-1-a.png', 'sub/qa-1-a.png', 'a.png', 'qa-1-b.png', 'other.png'])).toEqual(['qa-1-a.png']);
    const ws = goalWorkspacePath(dataDir, goal);
    mkdirSync(join(ws, QA_DIR), { recursive: true });
    writeFileSync(join(ws, QA_DIR, 'x.ts'), '');
    writeFileSync(join(ws, 'new.txt'), 'new');
    expect(await revertOutsideScratch(ws)).toContain('new.txt');
    expect(existsSync(join(ws, 'new.txt'))).toBe(false);
    expect(existsSync(join(ws, QA_DIR, 'x.ts'))).toBe(true);
  }, 90_000);
});
