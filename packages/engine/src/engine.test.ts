import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { getGoal, listAttempts, listEscalations, listTasks } from '@ai-engine/core';
import type { ClaudeRunner, RunHandle, RunResult, RunSpec, RunnerEvent } from '@ai-engine/runner';
import { defaultConfig } from './config.ts';
import { Engine } from './engine.ts';

/** Scripted stand-in for claude: runs `behave(spec, callIndex)` then returns a success result. */
class FakeRunner implements ClaudeRunner {
  calls: RunSpec[] = [];
  /** optional rate-limit info attached to every result */
  rateLimit: RunResult['rateLimit'] = null;
  constructor(private behave: (spec: RunSpec, n: number) => void | Promise<void>) {}
  active() {
    return 0;
  }
  async run(spec: RunSpec): Promise<RunHandle> {
    this.calls.push(spec);
    const n = this.calls.filter((c) => c.cwd === spec.cwd && c.label?.startsWith('attempt')).length;
    await this.behave(spec, n);
    const result: RunResult = {
      sessionId: `fake-${this.calls.length}`,
      subtype: 'success',
      isError: false,
      costUsd: 0.01,
      numTurns: 1,
      durationMs: 1,
      usage: null,
      modelUsage: null,
      permissionDenials: [],
      finalText: 'done',
      structuredOutput: null,
      exitCode: 0,
      pid: null,
      rateLimit: this.rateLimit,
      errorMessage: null,
      skillsUsed: [],
      toolsUsed: {},
    };
    const events: RunnerEvent[] = [
      { kind: 'hook', name: 'SessionStart:startup', outcome: 'success' },
      { kind: 'init', sessionId: result.sessionId!, model: 'fake', tools: [], raw: {} },
      { kind: 'text', text: 'plan: do it' },
      { kind: 'result', result },
    ];
    return {
      pid: null,
      events: (async function* () {
        for (const e of events) yield e;
      })(),
      kill() {},
      result: Promise.resolve(result),
    };
  }
}

async function makeRepo(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'ai-engine-test-repo-'));
  writeFileSync(join(dir, 'README.md'), 'fixture\n');
  await Bun.$`git -C ${dir} init -q -b main && git -C ${dir} -c user.name=t -c user.email=t@t add -A && git -C ${dir} -c user.name=t -c user.email=t@t commit -q -m init`.quiet();
  return dir;
}

async function waitFor(pred: () => boolean, ms = 15_000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error('timeout waiting for condition');
    await Bun.sleep(25);
  }
}

const ROOT = resolve(import.meta.dir, '../../..');
let dataDir: string;
let repo: string;
beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'ai-engine-test-data-'));
  repo = await makeRepo();
});
afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(repo, { recursive: true, force: true });
});

const cfg = (extra: Partial<ReturnType<typeof defaultConfig>> = {}) => defaultConfig(ROOT, { dataDir, claudeHome: join(dataDir, 'claude-home'), alwaysReviewTasks: false, log: () => {}, ...extra });
const terminal = (s: string) => ['done', 'over_delivered', 'failed', 'cancelled'].includes(s);

describe('Engine loop (fake runner)', () => {
  test('retries until the must check passes, then goal review → done', async () => {
    const runner = new FakeRunner((spec, n) => {
      if (n >= 2) writeFileSync(join(spec.cwd, 'done.txt'), 'ok');
    });
    const engine = new Engine(cfg(), runner);
    const goal = await engine.createGoal({ prompt: 'create done.txt', repoPath: repo, autoBrief: { mustChecks: ['test -f done.txt'] } });
    await waitFor(() => terminal(getGoal(engine.store.db, goal.id)!.state));
    const g = getGoal(engine.store.db, goal.id)!;
    expect(g.state).toBe('done');
    const tasks = listTasks(engine.store.db, goal.id);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.state).toBe('done');
    const attempts = listAttempts(engine.store.db, tasks[0]!.id);
    expect(attempts.map((a) => a.state)).toEqual(['failed', 'passed']);
    // second attempt received the observation report of the first
    expect(runner.calls[1]!.prompt).toContain('What happened in the previous attempt');
    expect(g.costUsd).toBeGreaterThan(0);
  });

  test('exhausted retries → escalation; skip_task → task skipped, goal moves on', async () => {
    const engine = new Engine(cfg(), new FakeRunner(() => {}));
    const goal = await engine.createGoal({ prompt: 'impossible', repoPath: repo, budgets: { attemptsPerTask: 2 }, autoBrief: { mustChecks: ['test -f never.txt'] } });
    await waitFor(() => listEscalations(engine.store.db, { goalId: goal.id, openOnly: true }).length > 0);
    const esc = listEscalations(engine.store.db, { goalId: goal.id, openOnly: true })[0]!;
    expect(esc.trigger).toBe('retries_exhausted');
    expect(listTasks(engine.store.db, goal.id)[0]!.state).toBe('blocked');
    await engine.answerEscalation(esc.id, { action: 'skip_task' });
    // skipped ≠ failed: the task is marked skipped and the goal moves on to its review instead of failing
    await waitFor(() => listTasks(engine.store.db, goal.id)[0]!.state === 'skipped');
    await Bun.sleep(300);
    expect(['running', 'goal_review', 'blocked', 'done']).toContain(getGoal(engine.store.db, goal.id)!.state);
  });

  test('retry_with_hint grants an extra attempt and injects the hint', async () => {
    let allow = false;
    const runner = new FakeRunner((spec) => {
      if (allow) writeFileSync(join(spec.cwd, 'done.txt'), 'ok');
    });
    const engine = new Engine(cfg(), runner);
    const goal = await engine.createGoal({ prompt: 'needs hint', repoPath: repo, budgets: { attemptsPerTask: 1 }, autoBrief: { mustChecks: ['test -f done.txt'] } });
    await waitFor(() => listEscalations(engine.store.db, { goalId: goal.id, openOnly: true }).length > 0);
    allow = true;
    const esc = listEscalations(engine.store.db, { goalId: goal.id, openOnly: true })[0]!;
    await engine.answerEscalation(esc.id, { action: 'retry_with_hint', hint: 'just touch the file', extraAttempts: 1 });
    await waitFor(() => terminal(getGoal(engine.store.db, goal.id)!.state));
    expect(getGoal(engine.store.db, goal.id)!.state).toBe('done');
    expect(runner.calls.at(-1)!.prompt).toContain('just touch the file');
  });

  test('budget exceeded → budget_exceeded escalation blocks the goal; raise_budget resumes', async () => {
    const engine = new Engine(
      cfg(),
      new FakeRunner((spec, n) => {
        if (n >= 2) writeFileSync(join(spec.cwd, 'done.txt'), 'ok');
      }),
    );
    const goal = await engine.createGoal({ prompt: 'tiny budget', repoPath: repo, budgets: { maxCostUsd: 0.015 }, autoBrief: { mustChecks: ['test -f done.txt'] } });
    await waitFor(() => listEscalations(engine.store.db, { goalId: goal.id, openOnly: true }).some((e) => e.trigger === 'budget_exceeded'));
    expect(getGoal(engine.store.db, goal.id)!.state).toBe('blocked');
    const esc = listEscalations(engine.store.db, { goalId: goal.id, openOnly: true }).find((e) => e.trigger === 'budget_exceeded')!;
    await engine.answerEscalation(esc.id, { action: 'raise_budget', newMaxCostUsd: 5 });
    await waitFor(() => terminal(getGoal(engine.store.db, goal.id)!.state));
    expect(getGoal(engine.store.db, goal.id)!.state).toBe('done');
  });

  test('installed catalog skills are hinted to the worker; every session kind is booked in the usage ledger', async () => {
    const claudeHome = join(dataDir, 'claude-home');
    const { mkdirSync, writeFileSync } = await import('node:fs');
    mkdirSync(join(claudeHome, 'skills', 'tdd'), { recursive: true });
    writeFileSync(join(claudeHome, 'skills', 'tdd', 'SKILL.md'), '---\nname: tdd\ndescription: t\n---\n');
    const catalogPath = join(dataDir, 'catalog.json');
    writeFileSync(catalogPath, JSON.stringify({ version: 1, entries: [{ id: 'tdd', name: 'tdd', summary: '', why: '', tier: 'recommended', source: { type: 'git', repo: 'o/r' }, roles: ['worker'] }] }));
    const runner = new FakeRunner((spec) => writeFileSync(join(spec.cwd, 'done.txt'), 'ok'));
    runner.rateLimit = { status: 'allowed', resetsAt: Math.floor(Date.now() / 1000) + 3600, rateLimitType: 'five_hour', isUsingOverage: false, raw: {} };
    const engine = new Engine(cfg({ catalogPath }), runner);
    const goal = await engine.createGoal({ prompt: 'hinted', repoPath: repo, autoBrief: { mustChecks: ['test -f done.txt'] } });
    await waitFor(() => terminal(getGoal(engine.store.db, goal.id)!.state));
    expect(runner.calls[0]!.prompt).toContain('# Workflow skills');
    expect(runner.calls[0]!.prompt).toContain('/tdd');
    const u = engine.usage();
    expect(u.fiveHour.sessions).toBeGreaterThanOrEqual(1);
    expect(u.fiveHour.status).toBe('allowed');
    expect(u.byKind.map((k) => k.kind)).toContain('attempt');
    expect(engine.isRateLimited()).toBe(false);
  });

  test('a rejected rate-limit signal pauses scheduling until resetsAt, then the goal completes', async () => {
    let n = 0;
    const runner = new FakeRunner((spec) => {
      n++;
      if (n >= 2) writeFileSync(join(spec.cwd, 'done.txt'), 'ok');
    });
    runner.rateLimit = { status: 'rejected', resetsAt: Math.floor(Date.now() / 1000) + 2, rateLimitType: 'five_hour', isUsingOverage: false, raw: {} };
    const engine = new Engine(cfg(), runner);
    const goal = await engine.createGoal({ prompt: 'limited', repoPath: repo, autoBrief: { mustChecks: ['test -f done.txt'] } });
    await waitFor(() => engine.isRateLimited());
    const pausedAt = n;
    expect(engine.usage().pausedUntil).not.toBeNull();
    await Bun.sleep(800);
    expect(n).toBe(pausedAt); // nothing spawned while paused
    runner.rateLimit = { status: 'allowed', resetsAt: Math.floor(Date.now() / 1000) + 3600, rateLimitType: 'five_hour', isUsingOverage: false, raw: {} };
    await waitFor(() => terminal(getGoal(engine.store.db, goal.id)!.state), 20_000);
    expect(getGoal(engine.store.db, goal.id)!.state).toBe('done');
    expect(engine.store.listByGoal(goal.id).length).toBeGreaterThan(0);
    const kinds = [...engine.store.iterate(0)].filter((e) => e.type === 'rate_limit.paused' || e.type === 'rate_limit.resumed').map((e) => e.type);
    expect(kinds).toEqual(['rate_limit.paused', 'rate_limit.resumed']);
  });

  test('event log replay reproduces the read models', async () => {
    const engine = new Engine(cfg(), new FakeRunner((spec) => writeFileSync(join(spec.cwd, 'done.txt'), 'ok')));
    const goal = await engine.createGoal({ prompt: 'replay', repoPath: repo, autoBrief: { mustChecks: ['test -f done.txt'] } });
    await waitFor(() => terminal(getGoal(engine.store.db, goal.id)!.state));
    const before = engine.store.snapshotReadModels();
    engine.store.replay();
    expect(engine.store.snapshotReadModels()).toEqual(before);
  });
});

describe('skip and restart', () => {
  /** two-task chain: T1 can never pass; T2 needs T1 */
  const chain = (engine: Engine, repo: string) =>
    engine.createGoal({
      prompt: 'chain',
      repoPath: repo,
      budgets: { attemptsPerTask: 1 },
      brief: {
        title: '',
        understanding: 'u',
        areas: [],
        assumptions: [],
        questions: [],
        costEstimateUsd: 0,
        timeEstimateMin: 0,
        tasks: [
          { key: 'T1', title: 'first', spec: 's', kind: 'feature', scope: null, scenario: 'general', areaKey: null, dependsOnKeys: [], parallelizable: false, relevantFiles: [] },
          { key: 'T2', title: 'second', spec: 's', kind: 'feature', scope: null, scenario: 'general', areaKey: null, dependsOnKeys: ['T1'], parallelizable: false, relevantFiles: [] },
        ],
        checks: [
          { key: 'C1', name: 'never', tier: 'must', taskKey: 'T1', areaKey: null, spec: { type: 'command', cmd: 'test -f never.txt', timeoutMs: 60_000, expectExitCode: 0 } },
          { key: 'C2', name: 'second', tier: 'must', taskKey: 'T2', areaKey: null, spec: { type: 'command', cmd: 'test -f second.txt', timeoutMs: 60_000, expectExitCode: 0 } },
          { key: 'G', name: 'goal', tier: 'must', taskKey: null, areaKey: null, spec: { type: 'command', cmd: 'test -f second.txt', timeoutMs: 60_000, expectExitCode: 0 } },
        ],
      },
    });

  test('skip_task lets dependents run; the goal finishes with the task marked skipped', async () => {
    const runner = new FakeRunner((spec) => {
      if (spec.prompt.includes('# Your task (second)')) writeFileSync(join(spec.cwd, 'second.txt'), 'ok');
    });
    const engine = new Engine(cfg(), runner);
    const goal = await chain(engine, repo);
    await waitFor(() => listEscalations(engine.store.db, { goalId: goal.id, openOnly: true }).length > 0);
    const esc = listEscalations(engine.store.db, { goalId: goal.id, openOnly: true })[0]!;
    await engine.answerEscalation(esc.id, { action: 'skip_task' });
    await waitFor(() => terminal(getGoal(engine.store.db, goal.id)!.state));
    const tasks = listTasks(engine.store.db, goal.id);
    expect(tasks.find((t) => t.title === 'first')!.state).toBe('skipped');
    expect(tasks.find((t) => t.title === 'second')!.state).toBe('done');
    expect(getGoal(engine.store.db, goal.id)!.state).toBe('done');
  });

  test('restart from a task resets it and its dependents with a fresh budget', async () => {
    let pass = false;
    const runner = new FakeRunner((spec) => {
      if (pass && spec.prompt.includes('# Your task (first)')) writeFileSync(join(spec.cwd, 'never.txt'), 'ok');
      if (spec.prompt.includes('# Your task (second)')) writeFileSync(join(spec.cwd, 'second.txt'), 'ok');
    });
    const engine = new Engine(cfg(), runner);
    const goal = await chain(engine, repo);
    await waitFor(() => listEscalations(engine.store.db, { goalId: goal.id, openOnly: true }).length > 0);
    const esc = listEscalations(engine.store.db, { goalId: goal.id, openOnly: true })[0]!;
    await engine.answerEscalation(esc.id, { action: 'abort_goal' });
    await waitFor(() => getGoal(engine.store.db, goal.id)!.state === 'failed');
    pass = true;
    const first = listTasks(engine.store.db, goal.id).find((t) => t.title === 'first')!;
    const r = await engine.restartGoal(goal.id, { fromTaskId: first.id });
    expect(r.restarted.length).toBe(2);
    await waitFor(() => terminal(getGoal(engine.store.db, goal.id)!.state), 20_000);
    expect(getGoal(engine.store.db, goal.id)!.state).toBe('done');
    expect(listTasks(engine.store.db, goal.id).every((t) => t.state === 'done')).toBe(true);
    // the first task ran twice in total (1 before abort + 1 after restart) without tripping the budget
    expect(listAttempts(engine.store.db, first.id).length).toBe(2);
  });
});
