import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Brief, BriefOutput, Goal } from '@foundry/core';
import { getGoal, listDelegatedGoals, listEscalations, listTasks, planOutputSchema } from '@foundry/core';
import type { ClaudeRunner, RunHandle, RunResult, RunSpec, RunnerEvent } from '@foundry/runner';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { toBrief } from './clarify.ts';
import { defaultConfig } from './config.ts';
import { Engine } from './engine.ts';
import { makeRepo, terminal, waitFor } from './test-helpers.ts';
import { goalWorkspacePath } from './workspace.ts';

const ROOT = resolve(import.meta.dir, '../../..');
let dataDir: string;
let repo: string;
beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'foundry-delegation-'));
  repo = await makeRepo();
});
const engines: Engine[] = [];
const track = <T extends Engine>(e: T): T => (engines.push(e), e);
afterEach(async () => {
  for (const e of engines.splice(0)) await e.stop().catch(() => {});
  for (const d of [dataDir, repo, `${repo}-foundry`]) rmSync(d, { recursive: true, force: true });
});

const cfg = () => defaultConfig(ROOT, { dataDir, claudeHome: join(dataDir, 'claude-home'), alwaysReviewTasks: false, log: () => {} });

/** the Brief a Delegated goal's Clarifier answers with: one task whose worker writes `file` */
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

/**
 * Workers create the file their task spec names (`create <file>`) unless `refuse` lists it; Clarify sessions answer
 * with `clarifyAnswer`.
 */
class HybridRunner implements ClaudeRunner {
  calls: RunSpec[] = [];
  clarifyAnswer: BriefOutput = subBrief('sub.txt');
  refuse = new Set<string>();
  active() {
    return 0;
  }
  async run(spec: RunSpec): Promise<RunHandle> {
    this.calls.push(spec);
    const label = spec.label ?? '';
    let structuredOutput: unknown = null;
    if (label.startsWith('classify nature')) structuredOutput = { nature: 'code' };
    else if (label.startsWith('clarify')) structuredOutput = this.clarifyAnswer;
    else if (label.startsWith('attempt')) {
      const file = /create (\S+)/.exec(spec.prompt)?.[1];
      if (file && !this.refuse.has(file)) writeFileSync(join(spec.cwd, file), `made by ${label}\n`);
    }
    const result: RunResult = { sessionId: `s${this.calls.length}`, subtype: 'success', isError: false, costUsd: 0.01, numTurns: 1, durationMs: 1, usage: null, modelUsage: null, permissionDenials: [], finalText: JSON.stringify(structuredOutput ?? 'done'), structuredOutput, exitCode: 0, pid: null, rateLimit: null, errorMessage: null, failureClass: null, skillsUsed: [], toolsUsed: {} };
    const events: RunnerEvent[] = [{ kind: 'hook', name: 'SessionStart:startup', outcome: 'success' }, { kind: 'init', sessionId: result.sessionId!, model: 'fake', tools: [], raw: {} }, { kind: 'result', result }];
    return { pid: null, events: (async function* () { for (const e of events) yield e; })(), kill() {}, result: Promise.resolve(result) };
  }
}

/** a main goal with a ready Brief: T1 is a goal task (its spec becomes the Delegated goal's prompt), T2 builds on it */
const mainBrief = (): Omit<Brief, 'goalId'> => ({
  title: 'feat: site with a model',
  understanding: 'A site that needs a model first.',
  areas: [{ key: 'A1', name: 'Site', slug: 'site', description: 'the site' }],
  assumptions: [],
  checks: [{ key: 'G1', name: 'sub landed', tier: 'must', taskKey: null, areaKey: null, spec: { type: 'command', cmd: 'test -f sub.txt', timeoutMs: 60_000, expectExitCode: 0 } }],
  tasks: [
    { key: 'T1', title: 'make the model', spec: 'create sub.txt for the site: the model everything else uses', kind: 'goal', scope: null, scenario: 'general', areaKey: 'A1', tdd: 'inherit', dependsOnKeys: [], parallelizable: false, relevantFiles: [], milestone: null, difficulty: 'standard' },
    { key: 'T2', title: 'use the model', spec: 'create main.txt next to the model', kind: 'feature', scope: null, scenario: 'general', areaKey: 'A1', tdd: 'inherit', dependsOnKeys: ['T1'], parallelizable: false, relevantFiles: [], milestone: null, difficulty: 'standard' },
  ],
  costEstimateUsd: 2,
  timeEstimateMin: 20,
  questions: [],
  styleOptions: [],
  run: null,
  apps: null,
});

const delegatedOf = (engine: Engine, main: Goal): Goal | undefined => listDelegatedGoals(engine.store.db, main.id)[0];

describe('delegated goals', () => {
  test('a goal task is done by a Delegated goal that lands as one commit, and the tasks after it hear what it delivered', async () => {
    const runner = new HybridRunner();
    const engine = track(new Engine(cfg(), runner));
    const main = await engine.createGoal({ prompt: 'a site with a model', repoPath: repo, brief: mainBrief(), workflow: { pace: 'fast' }, delegation: { allow: true, autoApprove: true }, budgets: { maxCostUsd: 20 } });
    expect(main.delegation).toEqual({ allow: true, autoApprove: true });

    // the Delegated goal: created from the main goal's branch, with the task's spec as its prompt, and nothing of its own to deliver
    await waitFor(() => !!delegatedOf(engine, main), 30_000);
    const d0 = delegatedOf(engine, main)!;
    expect(d0.delegatedFrom?.goalId).toBe(main.id);
    expect(d0.baseBranch).toBe(main.branch);
    expect(d0.prompt).toContain('create sub.txt');
    expect(d0.delegation).toEqual({ allow: false, autoApprove: true });
    expect(d0.delivery.policy.mode).toBe('local');
    const t1 = listTasks(engine.store.db, main.id).find((t) => t.kind === 'goal')!;
    expect(t1.delegatedGoalId).toBe(d0.id);
    expect(t1.state).toBe('running');

    await waitFor(() => terminal(getGoal(engine.store.db, main.id)!.state), 90_000);
    const done = getGoal(engine.store.db, main.id)!;
    expect(done.state).toBe('done');
    const d = getGoal(engine.store.db, d0.id)!;
    expect(d.state).toBe('done');
    // its Clarify knew whose step it was, and its Brief was approved by the engine
    const clarify = runner.calls.find((c) => c.label === `clarify ${d.title}`)!;
    expect(clarify.prompt).toContain('# Part of a larger goal');
    expect(clarify.prompt).toContain('a site with a model');
    expect(engine.store.listByGoalOfTypes(d.id, ['engine.note']).some((e) => String((e.payload as { message: string }).message).includes('approved by the engine'))).toBe(true);
    // the landing: the goal task has its commit and its summary, the file is on the main goal's branch
    const tasks = listTasks(engine.store.db, main.id);
    const goalTask = tasks.find((t) => t.kind === 'goal')!;
    expect(goalTask.state).toBe('done');
    expect(goalTask.commitRef).toBeTruthy();
    expect(goalTask.summary).toContain('Done by the delegated goal');
    expect(goalTask.summary).toContain('create sub.txt');
    expect(existsSync(join(goalWorkspacePath(engine.config.dataDir, done), 'sub.txt'))).toBe(true);
    expect(existsSync(join(goalWorkspacePath(engine.config.dataDir, done), 'main.txt'))).toBe(true);
    // the task after it was told what it delivered
    const t2 = runner.calls.find((c) => c.label?.startsWith('attempt use the model'))!;
    expect(t2.prompt).toContain('# What the steps before this one delivered');
    expect(t2.prompt).toContain('Done by the delegated goal');
    // what the Delegated goal cost counts on the main goal
    expect(done.costUsd).toBeGreaterThan(d.costUsd);
    expect(engine.store.listByGoalOfTypes(main.id, ['goal.cost_added']).some((e) => String((e.payload as { source: string }).source).startsWith('delegated:'))).toBe(true);
  }, 120_000);

  test('while the Delegated goal needs the person the main goal waits as blocked, and goes on by itself afterwards', async () => {
    const runner = new HybridRunner();
    runner.refuse.add('sub.txt');
    const engine = track(new Engine(cfg(), runner));
    const main = await engine.createGoal({ prompt: 'a site with a model', repoPath: repo, brief: mainBrief(), workflow: { pace: 'fast' }, delegation: { allow: true, autoApprove: true }, budgets: { attemptsPerTask: 1, maxCostUsd: 20 } });
    await waitFor(() => !!delegatedOf(engine, main), 30_000);
    const d = delegatedOf(engine, main)!;
    // its only task cannot pass: the Delegated goal asks (blocked), so the main goal waits
    await waitFor(() => listEscalations(engine.store.db, { goalId: d.id, openOnly: true }).length > 0, 60_000);
    await waitFor(() => getGoal(engine.store.db, main.id)!.state === 'blocked', 30_000);
    const blocked = engine.store.listByGoalOfTypes(main.id, ['goal.state_changed']).filter((e) => (e.payload as { to: string }).to === 'blocked').at(-1)!;
    expect(String((blocked.payload as { reason: string }).reason)).toContain('waiting for the delegated goal');
    expect(listEscalations(engine.store.db, { goalId: main.id, openOnly: true })).toHaveLength(0);
    // the person moves the Delegated goal on without that task: it finishes, lands, and the main goal runs again
    const esc = listEscalations(engine.store.db, { goalId: d.id, openOnly: true })[0]!;
    await engine.answerEscalation(esc.id, { action: 'skip_task' });
    await waitFor(() => terminal(getGoal(engine.store.db, d.id)!.state), 60_000);
    await waitFor(() => getGoal(engine.store.db, main.id)!.state !== 'blocked', 30_000);
    await waitFor(() => listTasks(engine.store.db, main.id).find((t) => t.kind === 'goal')!.state === 'done', 60_000);
    const goalTask = listTasks(engine.store.db, main.id).find((t) => t.kind === 'goal')!;
    expect(goalTask.summary).toContain('skipped by the human');
    // the main goal's own tasks and review then run to an end, or to an Inbox item of its own (sub.txt never came): nothing is left in flight when the test ends
    await waitFor(() => terminal(getGoal(engine.store.db, main.id)!.state) || getGoal(engine.store.db, main.id)!.state === 'blocked' || listEscalations(engine.store.db, { goalId: main.id, openOnly: true }).length > 0, 60_000);
  }, 120_000);

  test('the goal kind is offered to the planner only where the goal allows it, and demoted where it does not', () => {
    const kinds = (allow: boolean) => (zodToJsonSchema(planOutputSchema(allow), { $refStrategy: 'none' }) as { properties: { tasks: { items: { properties: { kind: { enum: string[] } } } } } }).properties.tasks.items.properties.kind.enum;
    expect(kinds(true)).toContain('goal');
    expect(kinds(false)).not.toContain('goal');
    const goal = (allow: boolean) => ({ id: 'g', follows: null, delegatedFrom: null, delegation: { allow, autoApprove: false } }) as unknown as Goal;
    const out: BriefOutput = { ...subBrief('x.txt'), tasks: [{ ...subBrief('x.txt').tasks[0]!, kind: 'goal' }] };
    expect(toBrief(goal(true), out, []).tasks[0]!.kind).toBe('goal');
    expect(toBrief(goal(false), out, []).tasks[0]!.kind).toBe('feature');
  });
});
