import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import type { Brief, BriefOutput, Goal } from '@foundry/core';
import { getGoal, listDelegatedGoals, listTasks } from '@foundry/core';
import type { ClaudeRunner, RunHandle, RunResult, RunSpec, RunnerEvent } from '@foundry/runner';
import { companionExtras, companionOverview, renderCompanions } from './companions.ts';
import { defaultConfig } from './config.ts';
import { FakeGh } from './delivery/gh.fake.ts';
import { Engine } from './engine.ts';
import { makeRepoWithRemote, sh, terminal, waitFor } from './test-helpers.ts';
import { goalWorkspacePath } from './workspace.ts';

const ROOT = resolve(import.meta.dir, '../../..');
let dataDir: string;
let repo: string;
let bare: string;
let other: string;
let otherBare: string;
beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'foundry-companions-'));
  ({ repo, bare } = await makeRepoWithRemote());
  ({ repo: other, bare: otherBare } = await makeRepoWithRemote());
  writeFileSync(join(other, 'README.md'), '# the api\n\nThe backend the site calls.\n');
  await sh('git -c user.name=t -c user.email=t@t commit -qam readme && git push -q origin main', other);
});
const engines: Engine[] = [];
const track = <T extends Engine>(e: T): T => (engines.push(e), e);
afterEach(async () => {
  for (const e of engines.splice(0)) await e.stop().catch(() => {});
  for (const d of [dataDir, repo, `${repo}-foundry`, other, `${other}-foundry`]) rmSync(d, { recursive: true, force: true });
});

const cfg = () => defaultConfig(ROOT, { dataDir, claudeHome: join(dataDir, 'claude-home'), alwaysReviewTasks: false, log: () => {}, delivery: { pollMs: 10, noChecksGraceMs: 30, checksTimeoutMs: 3000, automergeWaitMs: 200, updateLocalBase: false, prWatchMs: 60_000 } });

/** the Brief a delegated goal's Clarifier answers with: one task whose worker writes `file` */
const subBrief = (file: string): BriefOutput => ({
  title: `feat: make ${file}`,
  understanding: `Make ${file}.`,
  nature: 'code',
  areas: [{ key: 'A1', name: 'General', slug: 'general', description: '' }],
  assumptions: ['nothing else is needed'],
  tasks: [{ key: 'T1', title: `create ${file}`, spec: `create ${file}`, kind: 'feature', scope: null, scenario: 'general', difficulty: 'standard', areaKey: 'A1', dependsOnKeys: [], parallelizable: false, relevantFiles: [], milestone: null }],
  checks: [{ key: 'C1', name: `${file} exists`, tier: 'must', taskKey: 'T1', areaKey: null, type: 'command', cmd: `test -f ${file}`, rubric: null }],
  costEstimateUsd: 1,
  timeEstimateMin: 10,
  openQuestions: [],
  styleOptions: [],
  run: null,
  apps: null,
});

/** workers create the file their task names (`create <file>`); a Clarify answers with a Brief whose one task creates the file the prompt names */
class ScriptedRunner implements ClaudeRunner {
  calls: RunSpec[] = [];
  active() {
    return 0;
  }
  async run(spec: RunSpec): Promise<RunHandle> {
    this.calls.push(spec);
    const label = spec.label ?? '';
    let structuredOutput: unknown = null;
    if (label.startsWith('classify nature')) structuredOutput = { nature: 'code' };
    else if (label.startsWith('clarify')) structuredOutput = subBrief(/# Goal from the user\n[^\n]*?create ([\w.-]+)/.exec(spec.prompt)?.[1] ?? 'sub.txt');
    else if (label.startsWith('replan')) structuredOutput = { revisions: [], note: 'nothing to change' };
    else if (label.startsWith('attempt')) {
      const file = /create ([\w.-]+)/.exec(spec.prompt)?.[1];
      if (file) writeFileSync(join(spec.cwd, file), `made by ${label}\n`);
    }
    const result: RunResult = { sessionId: `s${this.calls.length}`, subtype: 'success', isError: false, costUsd: 0.01, numTurns: 1, durationMs: 1, usage: null, modelUsage: null, permissionDenials: [], finalText: JSON.stringify(structuredOutput ?? 'done'), structuredOutput, exitCode: 0, pid: null, rateLimit: null, errorMessage: null, failureClass: null, skillsUsed: [], toolsUsed: {} };
    const events: RunnerEvent[] = [{ kind: 'hook', name: 'SessionStart:startup', outcome: 'success' }, { kind: 'init', sessionId: result.sessionId!, model: 'fake', tools: [], raw: {} }, { kind: 'result', result }];
    return { pid: null, events: (async function* () { for (const e of events) yield e; })(), kill() {}, result: Promise.resolve(result) };
  }
}

/** a main goal with a ready Brief: T1 is the companion's part (a goal task bound to it), T2 builds on its summary here */
const mainBrief = (companion: string): Omit<Brief, 'goalId'> => ({
  title: 'feat: site with its api',
  understanding: 'A site whose api lives in another repository.',
  areas: [{ key: 'A1', name: 'Site', slug: 'site', description: 'the site' }],
  assumptions: [],
  checks: [{ key: 'G1', name: 'main landed', tier: 'must', taskKey: null, areaKey: null, spec: { type: 'command', cmd: 'test -f main.txt', timeoutMs: 60_000, expectExitCode: 0 } }],
  tasks: [
    { key: 'T1', title: 'make the api', spec: 'create api.md: the contract the site calls', kind: 'goal', repo: companion, scope: null, scenario: 'general', areaKey: 'A1', tdd: 'inherit', dependsOnKeys: [], parallelizable: false, relevantFiles: [], delivers: ['api.md'], milestone: null, difficulty: 'standard' },
    { key: 'T2', title: 'use the api', spec: 'create main.txt that calls the api', kind: 'feature', scope: null, scenario: 'general', areaKey: 'A1', tdd: 'inherit', dependsOnKeys: ['T1'], parallelizable: false, relevantFiles: [], delivers: ['main.txt'], milestone: null, difficulty: 'standard' },
  ],
  costEstimateUsd: 2,
  timeEstimateMin: 20,
  questions: [],
  styleOptions: [],
  run: null,
  apps: null,
});

const delegatedOf = (engine: Engine, main: Goal): Goal | undefined => listDelegatedGoals(engine.store.db, main.id)[0];

describe('companion repositories (ADR-0063)', () => {
  test('a companion is named once and checked; a goal with one has delegation on; the prompts describe it', async () => {
    const engine = track(new Engine(cfg(), new ScriptedRunner()));
    await expect(engine.createGoal({ prompt: 'p', repoPath: repo, companions: [{ repoPath: repo }] })).rejects.toThrow("is the goal's own repository, or named twice");
    await expect(engine.createGoal({ prompt: 'p', repoPath: repo, companions: [{ repoPath: other }, { repoPath: `${other}/` }] })).rejects.toThrow('named twice');
    await expect(engine.createGoal({ prompt: 'p', repoPath: repo, companions: [{ repoPath: join(dataDir, 'nowhere') }] })).rejects.toThrow('does not exist');
    await expect(engine.createGoal({ prompt: 'p', repoPath: repo, companions: [{ repoPath: dataDir }] })).rejects.toThrow('is not a git repository');
    const g = await engine.createGoal({ prompt: 'p', repoPath: repo, companions: [{ repoPath: other }], interview: 'never' });
    expect(g.companions).toEqual([{ repoPath: other, baseBranch: 'main' }]);
    expect(g.delegation.allow).toBe(true);
    const section = renderCompanions(g);
    expect(section).toContain('# Companion repositories');
    expect(section).toContain(`\`${other}\` (branch main)`);
    expect(section).toContain('kind `goal` whose `repo` is that companion');
    expect(section).toContain('The backend the site calls.');
    expect(companionOverview(other)).toContain('Top level: README.md');
    expect(renderCompanions({ repoPath: repo, companions: [] })).toBe('');
    engine.cancelGoal(g.id);
  }, 20_000);

  test("the companion's part is done by a delegated goal in that repository on its own base branch, lands nothing here, feeds its summary to the next task, and is delivered with the main goal as a push of its own", async () => {
    const runner = new ScriptedRunner();
    const engine = track(new Engine(cfg(), runner, new FakeGh(bare)));
    const main = await engine.createGoal({ prompt: 'a site with its api', repoPath: repo, companions: [{ repoPath: other }], brief: mainBrief(other), workflow: { pace: 'fast' }, delegation: { autoApprove: true }, budgets: { maxCostUsd: 20 } });
    expect(main.delegation).toEqual({ allow: true, autoApprove: true });
    const t1 = listTasks(engine.store.db, main.id).find((t) => t.title === 'make the api')!;
    expect(t1).toMatchObject({ kind: 'goal', repo: other });

    // the delegated goal: in the companion, from its own branch, told it is a companion of the main repository
    await waitFor(() => !!delegatedOf(engine, main), 30_000);
    const d = delegatedOf(engine, main)!;
    expect(d.repoPath).toBe(other);
    expect(d.baseBranch).toBe('main');
    expect(d.branch).toStartWith('goal/');
    expect(d.companions ?? []).toEqual([]);
    await waitFor(() => runner.calls.some((c) => c.label?.startsWith('clarify') && c.cwd.startsWith(`${other}-foundry`)), 30_000);
    const clarify = runner.calls.find((c) => c.label?.startsWith('clarify'))!;
    expect(clarify.prompt).toContain(`This repository (\`${other}\`) is a companion of the main goal's own (\`${repo}\``);
    expect(clarify.prompt).toContain('change only this repository');

    // the main goal finishes: the companion's task is done with a summary, nothing of it landed on the main branch
    await waitFor(() => terminal(getGoal(engine.store.db, main.id)!.state), 90_000);
    expect(getGoal(engine.store.db, main.id)!.state).toBe('done');
    const done = listTasks(engine.store.db, main.id).find((t) => t.id === t1.id)!;
    expect(done.state).toBe('done');
    expect(done.summary).toContain(`companion repository ${other}`);
    expect(done.summary).toContain('nothing of it is on this goal\'s branch');
    const events = engine.store.listByGoal(main.id, 5000);
    expect(events.some((e) => e.type === 'merge.started' && (e.payload as { taskId: string }).taskId === t1.id)).toBe(false);
    expect(events.find((e) => e.type === 'task.state_changed' && (e.payload as { taskId: string; to: string }).taskId === t1.id && (e.payload as { to: string }).to === 'done')).toMatchObject({ payload: { reason: expect.stringContaining(`finished in ${basename(other)}`) } });
    expect(existsSync(join(goalWorkspacePath(dataDir, getGoal(engine.store.db, main.id)!), 'api.md'))).toBe(false);
    expect(existsSync(join(goalWorkspacePath(dataDir, main), 'main.txt'))).toBe(true);
    expect(await sh(`git show ${d.branch}:api.md`, other)).toContain('made by');
    // the next task read the companion's summary
    const t2 = runner.calls.find((c) => c.label?.startsWith('attempt') && c.prompt.includes('create main.txt'))!;
    expect(t2.prompt).toContain('make the api');
    expect(t2.prompt).toContain(`companion repository ${other}`);

    // delivered together: the companion's goal gets the same policy and pushes its branch to its own remote
    expect(companionExtras(engine, getGoal(engine.store.db, main.id)!)).toEqual({ companions: [`${basename(other)}: "make the api" on \`${d.branch}\` — its pull request is opened with this one`] });
    expect(companionExtras(engine, getGoal(engine.store.db, d.id)!).partOf).toContain(`Part of the goal "a site with its api", whose main repository is ${basename(repo)}`);
    await engine.deliver(main.id, { mode: 'push' });
    await waitFor(() => getGoal(engine.store.db, d.id)!.delivery.status === 'delivered', 30_000);
    expect(getGoal(engine.store.db, d.id)!.delivery).toMatchObject({ policy: { mode: 'push', remote: 'origin' }, outcome: 'pushed' });
    expect((await sh("git branch --format='%(refname:short)'", otherBare)).split('\n')).toContain(d.branch);
    await waitFor(() => getGoal(engine.store.db, main.id)!.delivery.status === 'delivered', 30_000);
    expect((await sh("git branch --format='%(refname:short)'", bare)).split('\n')).toContain(main.branch);
    expect(engine.store.listByGoal(main.id, 5000).some((e) => e.type === 'delivery.note' && String((e.payload as { message: string }).message).includes(`the companion ${basename(other)} is delivered with this goal`))).toBe(true);
  }, 120_000);
});
