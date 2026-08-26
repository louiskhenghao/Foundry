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
const engines: Engine[] = [];
/** every Engine a test makes is stopped (background ticks drained) before the dataDir is deleted */
const track = <T extends Engine>(e: T): T => {
  engines.push(e);
  return e;
};
afterEach(async () => {
  for (const e of engines.splice(0)) await e.stop().catch(() => {});
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
    const engine = track(new Engine(cfg(), runner));
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
    const engine = track(new Engine(cfg(), new FakeRunner(() => {})));
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
    const engine = track(new Engine(cfg(), runner));
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
    const engine = track(
      new Engine(
        cfg(),
        new FakeRunner((spec, n) => {
          if (n >= 2) writeFileSync(join(spec.cwd, 'done.txt'), 'ok');
        }),
      ),
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
    const engine = track(new Engine(cfg({ catalogPath }), runner));
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
    const engine = track(new Engine(cfg(), runner));
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
    const engine = track(new Engine(cfg(), new FakeRunner((spec) => writeFileSync(join(spec.cwd, 'done.txt'), 'ok'))));
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
          { key: 'T1', title: 'first', spec: 's', kind: 'feature', scope: null, scenario: 'general', areaKey: null, tdd: 'inherit' as const, dependsOnKeys: [], parallelizable: false, relevantFiles: [] },
          { key: 'T2', title: 'second', spec: 's', kind: 'feature', scope: null, scenario: 'general', areaKey: null, tdd: 'inherit' as const, dependsOnKeys: ['T1'], parallelizable: false, relevantFiles: [] },
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
    const engine = track(new Engine(cfg(), runner));
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
    const engine = track(new Engine(cfg(), runner));
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

describe('goal mode and discipline', () => {
  test('tdd required / preferred (simple mode) / off changes what the worker is told', async () => {
    const claudeHome = join(dataDir, 'claude-home');
    const { mkdirSync, writeFileSync: wf } = await import('node:fs');
    mkdirSync(join(claudeHome, 'skills', 'tdd'), { recursive: true });
    wf(join(claudeHome, 'skills', 'tdd', 'SKILL.md'), '---\nname: tdd\ndescription: t\n---\n');
    const catalogPath = join(dataDir, 'catalog.json');
    wf(catalogPath, JSON.stringify({ version: 1, entries: [{ id: 'tdd', name: 'tdd', summary: '', why: '', tier: 'recommended', source: { type: 'git', repo: 'o/r' }, roles: ['worker'], workflow: [{ role: 'worker', mandate: 'must', when: 'feature', instruction: 'tests first' }] }] }));
    const runner = new FakeRunner((spec) => writeFileSync(join(spec.cwd, 'done.txt'), 'ok'));
    const engine = track(new Engine(cfg({ catalogPath }), runner));
    const run = async (input: Parameters<typeof engine.createGoal>[0]) => {
      const before = runner.calls.length;
      const goal = await engine.createGoal(input);
      await waitFor(() => terminal(getGoal(engine.store.db, goal.id)!.state));
      return { goal: getGoal(engine.store.db, goal.id)!, prompt: runner.calls.slice(before).find((c) => c.label?.startsWith('attempt'))!.prompt };
    };
    const a = await run({ prompt: 'required', repoPath: repo, autoBrief: { mustChecks: ['test -f done.txt'] } });
    expect(a.goal.mode).toBe('expert');
    expect(a.goal.workflow.tdd).toBe('required');
    expect(a.prompt).toContain('MUST: invoke `/tdd`');
    const b = await run({ prompt: 'off', repoPath: repo, workflow: { tdd: 'off' }, autoBrief: { mustChecks: ['test -f done.txt'] } });
    expect(b.prompt).not.toContain('invoke `/tdd`');
    const c = await run({ prompt: 'simple', repoPath: repo, mode: 'simple', autoBrief: { mustChecks: ['test -f done.txt'] } });
    expect(c.goal.mode).toBe('simple');
    expect(c.goal.workflow.tdd).toBe('preferred');
    expect(c.prompt).toContain('Prefer: invoke `/tdd`');
    expect(c.prompt).not.toContain('MUST: invoke `/tdd`');
    const before = engine.store.snapshotReadModels();
    engine.store.replay();
    expect(engine.store.snapshotReadModels()).toEqual(before);
  }, 40_000);
});

describe('continuations', () => {
  /** runner whose first session is cut (max turns) after half the work; the resumed session finishes */
  class CutRunner extends FakeRunner {
    constructor() {
      super(() => {});
    }
    override async run(spec: RunSpec): Promise<RunHandle> {
      const first = !spec.resumeSessionId && spec.label?.startsWith('attempt');
      if (first) writeFileSync(join(spec.cwd, 'half.txt'), 'ok');
      if (spec.resumeSessionId) writeFileSync(join(spec.cwd, 'done.txt'), 'ok');
      const h = await super.run(spec);
      if (!first) return h;
      const r = await h.result;
      const cut: RunResult = { ...r, subtype: 'error_max_turns', isError: true, finalText: null };
      return { ...h, result: Promise.resolve(cut) };
    }
  }
  test('a session cut by its turn cap is resumed (same attempt, same session), not replaced', async () => {
    const runner = new CutRunner();
    const engine = track(new Engine(cfg(), runner));
    const goal = await engine.createGoal({ prompt: 'continue me', repoPath: repo, autoBrief: { mustChecks: ['test -f half.txt && test -f done.txt'] } });
    await waitFor(() => terminal(getGoal(engine.store.db, goal.id)!.state));
    expect(getGoal(engine.store.db, goal.id)!.state).toBe('done');
    const task = listTasks(engine.store.db, goal.id)[0]!;
    const attempts = listAttempts(engine.store.db, task.id).filter((a) => a.kind === 'work');
    expect(attempts).toHaveLength(1);
    expect(attempts[0]!.continuations).toBe(1);
    expect(attempts[0]!.state).toBe('passed');
    expect(attempts[0]!.costUsd).toBeCloseTo(0.02, 5); // two segments, cumulative
    const calls = runner.calls.filter((c) => c.label?.startsWith('attempt'));
    expect(calls).toHaveLength(2);
    // the fake hands out a new id per process; the resume flag must name the FIRST segment's session
    expect(calls[1]!.resumeSessionId).toBe('fake-1');
    expect(calls[1]!.prompt).toContain('turn cap');
    expect(calls[1]!.prompt).not.toContain('# Your task');
    const ev = engine.store.listByGoal(goal.id, 5000).map((e) => e.type);
    expect(ev.filter((t) => t === 'attempt.started')).toHaveLength(1);
    expect(ev.filter((t) => t === 'attempt.continued')).toHaveLength(1);
    const before = engine.store.snapshotReadModels();
    engine.store.replay();
    expect(engine.store.snapshotReadModels()).toEqual(before);
  });

  test('checks failed with progress → resumed with the check report; no progress → fresh attempt', async () => {
    let segment = 0;
    const runner = new FakeRunner((spec) => {
      segment++;
      if (segment === 1) writeFileSync(join(spec.cwd, 'a.txt'), 'ok'); // progress, but b.txt missing
      if (segment === 2) writeFileSync(join(spec.cwd, 'b.txt'), 'ok'); // resumed: finishes
    });
    const engine = track(new Engine(cfg(), runner));
    const goal = await engine.createGoal({ prompt: 'progress', repoPath: repo, autoBrief: { mustChecks: ['test -f a.txt', 'test -f b.txt'] } });
    await waitFor(() => terminal(getGoal(engine.store.db, goal.id)!.state));
    expect(getGoal(engine.store.db, goal.id)!.state).toBe('done');
    const attempts = listAttempts(engine.store.db, listTasks(engine.store.db, goal.id)[0]!.id).filter((a) => a.kind === 'work');
    expect(attempts.map((a) => [a.continuations, a.state])).toEqual([[1, 'passed']]);
    const second = runner.calls.filter((c) => c.label?.startsWith('attempt'))[1]!;
    expect(second.resumeSessionId).toBeTruthy();
    expect(second.prompt).toContain('These still fail');
    expect(second.prompt).toContain('b.txt');

    // no progress (nothing written): a fresh attempt, with the observation report, as before
    const idle = new FakeRunner(() => {});
    const engine2 = track(new Engine(cfg(), idle));
    const g2 = await engine2.createGoal({ prompt: 'idle', repoPath: repo, budgets: { attemptsPerTask: 2 }, autoBrief: { mustChecks: ['test -f never.txt'] } });
    await waitFor(() => listEscalations(engine2.store.db, { goalId: g2.id, openOnly: true }).length > 0);
    const a2 = listAttempts(engine2.store.db, listTasks(engine2.store.db, g2.id)[0]!.id);
    expect(a2).toHaveLength(2);
    expect(a2.every((a) => a.continuations === 0)).toBe(true);
    expect(idle.calls.every((c) => !c.resumeSessionId)).toBe(true);
  });

  test('maxContinuations 0 restores the old behaviour', async () => {
    const runner = new CutRunner();
    const engine = track(new Engine(cfg({ maxContinuations: 0 }), runner));
    const goal = await engine.createGoal({ prompt: 'no continuation', repoPath: repo, autoBrief: { mustChecks: ['test -f half.txt && test -f done.txt'] } });
    await waitFor(() => ['done', 'blocked', 'failed'].includes(getGoal(engine.store.db, goal.id)!.state) || listEscalations(engine.store.db, { goalId: goal.id, openOnly: true }).length > 0);
    const attempts = listAttempts(engine.store.db, listTasks(engine.store.db, goal.id)[0]!.id).filter((a) => a.kind === 'work');
    expect(attempts.length).toBeGreaterThanOrEqual(2);
    expect(attempts.every((a) => a.continuations === 0)).toBe(true);
    expect(runner.calls.every((c) => !c.resumeSessionId)).toBe(true);
  });
});

describe('sessions per attempt and AI suggestions', () => {
  test('every session of an attempt is recorded (worker segments + reviewer) and the task usage sums them', async () => {
    const runner = new FakeRunner((spec) => {
      if (spec.label?.startsWith('attempt')) writeFileSync(join(spec.cwd, 'done.txt'), 'ok');
    });
    const engine = track(new Engine(cfg({ alwaysReviewTasks: true }), runner));
    const goal = await engine.createGoal({ prompt: 'sessions', repoPath: repo, autoBrief: { mustChecks: ['test -f done.txt'] } });
    await waitFor(() => terminal(getGoal(engine.store.db, goal.id)!.state));
    const task = listTasks(engine.store.db, goal.id)[0]!;
    const a = listAttempts(engine.store.db, task.id)[0]!;
    // the fake reviewer returns no JSON, so the engine nudges it once: a second reviewer session on the same attempt
    expect(a.sessions.map((s) => s.role)).toEqual(['worker', 'reviewer', 'reviewer']);
    expect(a.sessions[0]).toMatchObject({ segment: 0, model: 'fake', numTurns: 1, subtype: 'success' });
    expect(a.sessions[0]!.costUsd).toBeCloseTo(0.01, 5);
    const { taskUsage } = await import('@ai-engine/core');
    const u = taskUsage(listAttempts(engine.store.db, task.id));
    expect(u.attempts).toBe(1);
    expect(u.byRole.worker.sessions).toBe(1);
    expect(u.byRole.reviewer.sessions).toBe(2);
    expect(u.costUsd).toBeCloseTo(0.03, 5);
    const before = engine.store.snapshotReadModels();
    engine.store.replay();
    expect(engine.store.snapshotReadModels()).toEqual(before);
  });

  test('suggest: the AI diagnoses a blocked task; apply answers retry_with_hint, other actions are never applied', async () => {
    let mode: 'retry' | 'skip' = 'retry';
    const runner = new FakeRunner(() => {});
    const orig = runner.run.bind(runner);
    runner.run = async (spec) => {
      const h = await orig(spec);
      if (!spec.label?.startsWith('suggest')) return h;
      const r = await h.result;
      const structuredOutput = mode === 'retry' ? { diagnosis: 'never.txt is never created; the worker looked in the wrong folder', action: 'retry_with_hint', hint: 'Create never.txt at the repo root with `touch never.txt`.', confidence: 'high' } : { diagnosis: 'out of scope', action: 'skip_task', hint: '', confidence: 'medium' };
      return { ...h, result: Promise.resolve({ ...r, structuredOutput }) };
    };
    const engine = track(new Engine(cfg(), runner));
    const goal = await engine.createGoal({ prompt: 'stuck', repoPath: repo, budgets: { attemptsPerTask: 1 }, autoBrief: { mustChecks: ['test -f never.txt'] } });
    await waitFor(() => listEscalations(engine.store.db, { goalId: goal.id, openOnly: true }).length > 0);
    const esc = listEscalations(engine.store.db, { goalId: goal.id, openOnly: true })[0]!;
    const s = await engine.suggestForEscalation(esc.id);
    expect(s.action).toBe('retry_with_hint');
    expect(s.hint).toContain('touch never.txt');
    const stored = listEscalations(engine.store.db, { goalId: goal.id, openOnly: true })[0]!;
    expect(stored.suggestion?.diagnosis).toContain('wrong folder');
    const prompt = runner.calls.find((c) => c.label?.startsWith('suggest'))!.prompt;
    expect(prompt).toContain('# Why it is blocked');
    expect(prompt).toContain('never.txt');
    expect(engine.store.listByGoal(goal.id, 5000).some((e) => e.type === 'goal.cost_added' && (e.payload as { source: string }).source === 'suggest')).toBe(true);
    // apply = answer with the hint
    await engine.answerEscalation(esc.id, { action: 'retry_with_hint', hint: s.hint, extraAttempts: 1 });
    await waitFor(() => runner.calls.filter((c) => c.label?.startsWith('attempt')).length >= 2);
    expect(runner.calls.filter((c) => c.label?.startsWith('attempt')).at(-1)!.prompt).toContain('touch never.txt');
    // a skip suggestion is only recorded
    mode = 'skip';
    await waitFor(() => listEscalations(engine.store.db, { goalId: goal.id, openOnly: true }).length > 0, 20_000);
    const esc2 = listEscalations(engine.store.db, { goalId: goal.id, openOnly: true })[0]!;
    const s2 = await engine.suggestForEscalation(esc2.id);
    expect(s2.action).toBe('skip_task');
    expect(listEscalations(engine.store.db, { goalId: goal.id, openOnly: true })[0]!.state).toBe('open');
  }, 30_000);
});
