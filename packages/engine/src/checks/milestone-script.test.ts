import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { IDLE_DELIVERY, getGoal, type Goal, type Task } from '@foundry/core';
import { defaultConfig } from '../config.ts';
import { Engine } from '../engine.ts';
import type { GroupResult } from '../proc.ts';
import { goalWorkspacePath, screenshotsDir } from '../workspace.ts';
import { milestoneCheckSpec, runMilestoneScript, type ScriptDeps } from './milestone-script.ts';

const ROOT = resolve(import.meta.dir, '../../../..');
let dataDir: string;
const engines: Engine[] = [];
beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'foundry-milestone-script-'));
});
afterEach(async () => {
  for (const e of engines.splice(0)) await e.stop();
  rmSync(dataDir, { recursive: true, force: true });
});

const SCRIPT = 'e2e/milestones/users.spec.ts';

const setup = (files: Record<string, string> = { [SCRIPT]: 'test', 'playwright.config.ts': 'export default {}' }) => {
  // a data folder of its own: one test may set up several computers
  const data = mkdtempSync(join(dataDir, 'run-'));
  const engine = new Engine(defaultConfig(ROOT, { dataDir: data, claudeHome: join(data, 'claude-home'), log: () => {} }));
  engines.push(engine);
  const now = new Date().toISOString();
  const g = {
    id: 'g_ms1', title: 'Users', prompt: 'p', workspaceDir: join(data, 'ws'), checkpoint: null, selfCheck: false, previewRef: null, previewPlace: 'auto', milestonePause: true, clarifyStage: null, references: [], investigation: null, revise: null, interview: null, effort: null, modelPreset: null, modelSubstitutions: {}, repoPath: join(data, 'repo'), baseBranch: 'main', branch: 'goal/g_ms1',
    budgets: { maxCostUsd: 5, maxDurationMin: 120, maxConcurrent: 3, attemptsPerTask: 3 }, budgetPreset: 'custom', mode: 'expert', workflow: { tdd: 'off', pace: 'thorough', ponytail: 'on' },
    models: { strong: 'opus', cheap: 'haiku', worker: 'opus' }, state: 'running', stateBeforeBlock: null, costUsd: 0, fixCycles: 0, delivery: IDLE_DELIVERY, attachments: [], baseSync: null, autoskills: null, follows: null, delegation: { allow: false, autoApprove: false }, delegatedFrom: null,
    completion: { graphRefresh: false, docs: [], audit: false, auditRun: null, docsRun: null, graphRun: null, artifactsRun: null }, nature: 'auto', outputDir: null, runningSince: null, createdAt: now, updatedAt: now,
  } as Goal;
  engine.store.append({ type: 'goal.created', goalId: g.id, payload: { goal: g } });
  const goal = getGoal(engine.store.db, g.id)!;
  const ws = goalWorkspacePath(data, goal);
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(join(ws, rel, '..'), { recursive: true });
    writeFileSync(join(ws, rel), text);
  }
  const task = { id: 't_ms1', goalId: g.id, title: 'add the user list', milestone: 'open Users', milestoneScript: SCRIPT } as Task;
  return { engine, goal, task, ws, data };
};

/** a stand-in for `npx playwright test`: reads the report path from Foundry's config and writes the report it is given */
const fakeRun = (report: (dir: string) => unknown, result: Partial<GroupResult> = {}, seen: { argv: string[]; env: Record<string, string | undefined>; wrapper: string }[] = []): ScriptDeps => ({
  run: async (argv, opts) => {
    const name = /--config '([^']+)'/.exec(argv.join(' '))?.[1];
    const wrapper = join(opts.cwd, name ?? 'none');
    const text = existsSync(wrapper) ? readFileSync(wrapper, 'utf8') : '';
    seen.push({ argv, env: opts.env, wrapper: text });
    const out = /outputFile: ("[^"]+")/.exec(text)?.[1];
    if (out && result.code !== 127) {
      const dir = mkdtempSync(join(tmpdir(), 'foundry-fake-pw-'));
      writeFileSync(JSON.parse(out), JSON.stringify(report(dir)));
    }
    return { code: 0, stdout: 'ok', stderr: '', timedOut: false, ...result };
  },
});

describe('a milestone script', () => {
  test("is its task's must check, on free ports", () => {
    expect(milestoneCheckSpec(SCRIPT)).toMatchObject({ type: 'command', cmd: `npx --no-install playwright test '${SCRIPT}'`, ports: true, milestone: SCRIPT });
  });

  test('records every test: its video, its captioned screenshots and what an API answered', async () => {
    const { engine, goal, task, ws, data } = setup();
    const seen: Parameters<typeof fakeRun>[2] = [];
    const run = await runMilestoneScript(engine, goal, task, 'p-', fakeRun((dir) => {
      writeFileSync(join(dir, 'v.webm'), 'video');
      writeFileSync(join(dir, 'end.png'), 'png');
      return {
        suites: [{ title: SCRIPT, specs: [
          { title: 'filters the list', tests: [{ projectName: 'chromium', results: [{ status: 'passed', attachments: [
            { name: 'the empty list', contentType: 'image/png', body: Buffer.from('a').toString('base64') },
            { name: 'screenshot', contentType: 'image/png', path: join(dir, 'end.png') },
            { name: 'video', contentType: 'video/webm', path: join(dir, 'v.webm') },
          ] }] }] },
          { title: 'creates a user', tests: [{ results: [{ status: 'passed', attachments: [
            { name: 'POST /api/users → 201', contentType: 'application/json', body: Buffer.from('{"id":1}').toString('base64') },
            { name: 'screenshot', contentType: 'image/png', path: join(dir, 'end.png') },
          ] }] }] },
        ] }],
      };
    }, {}, seen));
    expect(run.status).toBe('pass');
    expect(run.error).toBeNull();
    expect(run.clips).toEqual([{ file: 'p-02.webm', caption: 'filters the list (chromium)' }]);
    // a test that attached its own screenshots does not get Playwright's last one as well
    expect(run.shots).toEqual([{ file: 'p-01.png', caption: 'the empty list' }, { file: 'p-04.png', caption: 'creates a user: the end' }]);
    expect(run.outputs).toEqual([{ file: 'p-03.json', caption: 'POST /api/users → 201' }]);
    expect(run.summary).toBe('2 tests: filters the list (chromium); creates a user');
    const dir = screenshotsDir(data, goal);
    expect(readFileSync(join(dir, 'p-03.json'), 'utf8')).toBe('{"id":1}');
    expect(readFileSync(join(dir, run.log!), 'utf8')).toContain(`npx --no-install playwright test '${SCRIPT}'`);
    // the project's own config, recorded and reported to Foundry; gone afterwards
    expect(seen[0]!.argv.join(' ')).toMatch(/--config 'playwright\.foundry-\w+\.config\.ts'/);
    expect(seen[0]!.wrapper).toContain('import base from "./playwright.config"');
    expect(seen[0]!.wrapper).toContain("video: 'on'");
    expect(Number(seen[0]!.env.PORT)).toBeGreaterThan(0);
    expect(seen[0]!.env.PORT).not.toBe(seen[0]!.env.API_PORT);
    expect(readdirSync(ws).filter((f) => f.startsWith('playwright.foundry-'))).toEqual([]);
  });

  test('a failing test fails the run with its message', async () => {
    const { engine, goal, task } = setup();
    const run = await runMilestoneScript(engine, goal, task, 'p-', fakeRun(() => ({ suites: [{ title: SCRIPT, specs: [{ title: 'shows the users', tests: [{ results: [{ status: 'failed', error: { message: '\u001b[31mexpect(locator).toBeVisible()\u001b[39m\nLocator: getByText("Users")' }, attachments: [] }] }] }] }] }), { code: 1 }));
    expect(run.status).toBe('fail');
    expect(run.error).toBe('"shows the users" failed: expect(locator).toBeVisible()\nLocator: getByText("Users")');
  });

  test('says why it could not run: no script, no config, a command not found', async () => {
    const none = setup({ 'playwright.config.ts': 'export default {}' });
    expect((await runMilestoneScript(none.engine, none.goal, none.task, 'p-', fakeRun(() => ({})))).error).toBe(`${SCRIPT} is not on the goal branch`);
    const bare = setup({ [SCRIPT]: 'test' });
    expect((await runMilestoneScript(bare.engine, bare.goal, bare.task, 'p-', fakeRun(() => ({})))).error).toBe('there is no playwright.config at the root of the repository');
    const missing = setup();
    const run = await runMilestoneScript(missing.engine, missing.goal, missing.task, 'p-', fakeRun(() => ({}), { code: 127, stderr: 'sh: npx: command not found' }));
    expect(run).toMatchObject({ status: 'fail', error: 'a command was not found: sh: npx: command not found' });
  });
});
