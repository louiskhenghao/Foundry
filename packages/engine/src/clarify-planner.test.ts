import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { BriefOutput, BUILTIN_CODEX_PRESETS, getBrief, getGoal } from '@foundry/core';
import type { ClaudeRunner, RunHandle, RunResult, RunSpec, RunnerEvent } from '@foundry/runner';
import { defaultConfig, type EngineConfig } from './config.ts';
import { Engine } from './engine.ts';
import { READONLY_DISALLOWED, READONLY_TOOLS } from './guards/boundary.ts';
import { makeRepo, waitFor } from './test-helpers.ts';

const ROOT = resolve(import.meta.dir, '../../..');
let dataDir: string;
let repo: string;
let engine: Engine | undefined;
beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'foundry-codex-planner-'));
  repo = await makeRepo();
});
afterEach(async () => {
  await engine?.stop();
  engine = undefined;
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(repo, { recursive: true, force: true });
  rmSync(`${repo}-foundry`, { recursive: true, force: true });
});

/** what the Clarifier writes: the Brief without its plan */
const skeleton = (extra: Record<string, unknown> = {}) => ({
  title: 'feat: add task', understanding: 'Add the requested task.', nature: 'code',
  areas: [{ key: 'A1', name: 'Main', slug: 'main', description: 'Main task' }], assumptions: [],
  goalChecks: [{ key: 'C1', name: 'tests pass', tier: 'must', areaKey: null, type: 'command', cmd: 'true' }],
  planningNotes: 'README.md is the only file; there is no build.', openQuestions: [], styleOptions: [], ...extra,
});
/** what the planner returns */
const plan = (title = 'Planner task', areaKey = 'A1') => ({
  tasks: [{ key: 'T1', areaKey, title, spec: 'Update README.md', kind: 'feature', difficulty: 'standard', scenario: 'general', dependsOnKeys: [], parallelizable: false, relevantFiles: ['README.md'], milestone: null }],
  checks: [{ key: 'C1', name: 'README exists', tier: 'must', taskKey: 'T1', type: 'command', cmd: 'test -f README.md' }],
  costEstimateUsd: 1, timeEstimateMin: 10,
});
/** a whole Brief, tasks included, as a model might still write one */
const brief = (title = 'Clarifier draft') => BriefOutput.parse({
  title: 'feat: add task', understanding: 'Add the requested task.', nature: 'code',
  areas: [{ key: 'A1', name: 'Main', slug: 'main', description: 'Main task' }], assumptions: [],
  tasks: plan(title).tasks, checks: [{ key: 'C1', name: 'README exists', tier: 'must', taskKey: 'T1', areaKey: 'A1', type: 'command', cmd: 'test -f README.md', rubric: null }],
  costEstimateUsd: 0, timeEstimateMin: 10, openQuestions: [], styleOptions: [], run: null, apps: null,
});
const isPlanner = (spec: RunSpec) => !!spec.label?.startsWith('planner ');

class ScriptedRunner implements ClaudeRunner {
  calls: RunSpec[] = [];
  constructor(private respond: (spec: RunSpec, index: number) => unknown, private plannerFailure = false) {}
  active() { return 0; }
  async run(spec: RunSpec): Promise<RunHandle> {
    this.calls.push(spec);
    const structuredOutput = this.respond(spec, this.calls.length);
    const failed = this.plannerFailure && spec.label?.startsWith('planner ');
    const result: RunResult = {
      sessionId: `s${this.calls.length}`, subtype: failed ? 'error' : 'success', isError: !!failed,
      costUsd: 0, costStatus: 'unavailable', numTurns: 1, durationMs: 1,
      usage: { input_tokens: 10, output_tokens: 20 }, modelUsage: null, permissionDenials: [],
      finalText: JSON.stringify(structuredOutput), structuredOutput, exitCode: failed ? 1 : 0, pid: null,
      rateLimit: null, errorMessage: failed ? 'planner model unavailable' : null, failureClass: null,
      skillsUsed: [], toolsUsed: {},
    };
    const events: RunnerEvent[] = [{ kind: 'text', text: spec.label ?? '' }, { kind: 'result', result }];
    return { pid: null, kill() {}, result: Promise.resolve(result), events: (async function* () { yield* events; })() };
  }
}

function setup(runner: ScriptedRunner, overrides: Partial<EngineConfig> = {}): Engine {
  engine = new Engine(defaultConfig(ROOT, {
    dataDir, provider: 'codex', codexModel: 'configured-codex-model',
    codexHome: join(dataDir, 'codex-home'), claudeHome: join(dataDir, 'claude-home'), log: () => {},
    ...overrides,
  }), runner);
  return engine;
}

describe('Clarify writes the Brief, a planner session writes its plan', () => {
  test.each(['codex', 'claude'] as const)('%s: one Clarifier turn, then one read-only planner session whose plan goes into the Brief as written', async (provider) => {
    const runner = new ScriptedRunner((spec) => (isPlanner(spec) ? plan('Planner task') : skeleton()));
    const e = setup(runner, { provider });
    const streamed: string[] = [];
    const broadcast = e.broadcast.bind(e);
    e.broadcast = (event) => { if (event.event.kind === 'text') streamed.push(event.event.text); broadcast(event); };
    const goal = await e.createGoal({ prompt: 'Add a task', repoPath: repo, nature: 'code', interview: 'never', ...(provider === 'codex' ? { codexModel: 'configured-codex-model' } : {}) });
    await waitFor(() => getGoal(e.store.db, goal.id)!.state === 'awaiting_brief_approval');
    expect(runner.calls.map((c) => c.label?.split(' ')[0])).toEqual(['clarify', 'planner']);
    const [clarifier, planner] = runner.calls as [RunSpec, RunSpec];
    if (provider === 'codex') expect(planner.model).toBe('configured-codex-model');
    expect(clarifier.agents).toBeUndefined();
    expect(clarifier.strictMcp && planner.strictMcp).toBe(true);
    expect(planner.allowedTools).toEqual(READONLY_TOOLS);
    expect(planner.disallowedTools).toEqual(READONLY_DISALLOWED);
    expect(planner.permissionMode).toBe('dontAsk');
    expect(planner.maxTurns).toBe(45);
    // a long answer is written without output: neither session is cut at the CLI's default 5 idle minutes
    expect([clarifier.timeoutMs, clarifier.idleTimeoutMs, planner.idleTimeoutMs]).toEqual([30 * 60_000, 10 * 60_000, 10 * 60_000]);
    expect(planner.transcriptPath).toEndWith(`planner-${goal.id}.jsonl`);
    expect(planner.appendSystemPromptFile).toEndWith('planner.md');
    expect(planner.prompt).toContain('README.md is the only file');
    expect(planner.prompt).toContain('"goalChecks"');
    const b = getBrief(e.store.db, goal.id)!.brief;
    expect(b.tasks.map((t) => t.title)).toEqual(['Planner task']);
    // the goal check keeps its place beside the task check, under a key of its own
    expect(b.checks.map((c) => [c.key, c.taskKey])).toEqual([['C1', 'T1'], ['C1-2', null]]);
    expect(b.costEstimateUsd).toBe(1);
    expect(streamed).toContain(`planner ${goal.title}`);
    const events = e.store.listByGoal(goal.id);
    expect(events.filter((ev) => ev.type === 'goal.cost_added').map((ev) => (ev.payload as { source: string }).source)).toEqual(['clarify', 'planner']);
    expect(events.filter((ev) => ev.type === 'clarify.stage').map((ev) => (ev.payload as { stage: string }).stage)).toEqual(['clarifying', 'planning']);
  });

  test('routes distinct planner and Clarifier models/efforts from the goal snapshot', async () => {
    const selected = structuredClone(BUILTIN_CODEX_PRESETS.balanced!);
    selected.tables.code.clarifier = { model: 'clarifier-specific', effort: 'medium' };
    selected.tables.code.planner = { model: 'planner-specific', effort: 'xhigh' };
    let e: Engine;
    const runner = new ScriptedRunner((spec, index) => {
      if (index === 1) {
        // Editing defaults after goal creation must not reroute its later planner session.
        const changed = structuredClone(selected);
        changed.tables.code.planner = { model: 'new-default-planner', effort: 'low' };
        e.updateSettings({ models: { codexPresets: { selected: changed } } });
      }
      return isPlanner(spec) ? plan() : skeleton();
    });
    e = setup(runner, { codexPresets: { selected }, codexNaturePreset: { code: 'selected', docs: 'balanced', media: 'balanced' } });
    const goal = await e.createGoal({ prompt: 'Add a task', repoPath: repo, nature: 'code', interview: 'never', modelPreset: 'selected' });
    await waitFor(() => getGoal(e.store.db, goal.id)!.state === 'awaiting_brief_approval');
    expect(runner.calls.map((c) => [c.model, c.effort, c.meta?.modelAction])).toEqual([
      ['clarifier-specific', 'medium', 'clarifier'],
      ['planner-specific', 'xhigh', 'planner'],
    ]);
    expect(getGoal(e.store.db, goal.id)!.codexPreset?.tables.code.planner).toEqual({ model: 'planner-specific', effort: 'xhigh' });
    expect(e.config.codexPresets.selected!.tables.code.planner.model).toBe('new-default-planner');
  });

  test('waits for human answers and carries them into the planner', async () => {
    const runner = new ScriptedRunner((spec, index) => index === 1
      ? { questions: [{ key: 'Q1', text: 'Which database?', options: ['SQLite', 'Postgres'], reason: 'No database chosen', dependsOn: null, blocking: true }], brief: null }
      : isPlanner(spec) ? plan() : { questions: [], brief: skeleton() });
    const e = setup(runner);
    const goal = await e.createGoal({ prompt: 'Add a task', repoPath: repo, nature: 'code', interview: 'always' });
    await waitFor(() => getGoal(e.store.db, goal.id)!.interview?.status === 'awaiting_answers');
    expect(runner.calls).toHaveLength(1);
    e.answerInterview(goal.id, { Q1: 'SQLite' });
    await waitFor(() => getGoal(e.store.db, goal.id)!.state === 'awaiting_brief_approval');
    const planners = runner.calls.filter(isPlanner);
    expect(planners).toHaveLength(1);
    expect(planners[0]!.prompt).toContain('A: SQLite');
    expect(getBrief(e.store.db, goal.id)!.brief.questions.some((q) => q.answer === 'SQLite' && q.applied)).toBe(true);
  });

  test('auto classification switches both Clarifier and planner to the inferred nature table', async () => {
    const selected = structuredClone(BUILTIN_CODEX_PRESETS.balanced!);
    selected.tables.code.clarifier = { model: 'code-clarifier', effort: 'high' };
    selected.tables.code.planner = { model: 'code-planner', effort: 'high' };
    selected.tables.docs.clarifier = { model: 'docs-clarifier', effort: 'medium' };
    selected.tables.docs.planner = { model: 'docs-planner', effort: 'xhigh' };
    const runner = new ScriptedRunner((spec) => spec.label?.startsWith('classify nature')
      ? { nature: 'docs' }
      : isPlanner(spec) ? plan() : skeleton({ nature: 'docs' }));
    const e = setup(runner, { codexPresets: { selected } });
    const goal = await e.createGoal({ prompt: 'Write a guide', repoPath: repo, nature: 'auto', interview: 'never', modelPreset: 'selected' });
    await waitFor(() => getGoal(e.store.db, goal.id)!.state === 'awaiting_brief_approval');
    expect(getGoal(e.store.db, goal.id)!.nature).toBe('docs');
    expect(runner.calls.filter((c) => !c.label?.startsWith('classify nature')).map((c) => [c.model, c.effort])).toEqual([
      ['docs-clarifier', 'medium'], ['docs-planner', 'xhigh'],
    ]);
  });

  test.each(['failed', 'invalid'] as const)('a %s planner gets one more try, then the Brief is published with one task per Area and a blocking question', async (failure) => {
    const runner = new ScriptedRunner((spec) => (isPlanner(spec) ? (failure === 'invalid' ? { tasks: [] } : plan()) : skeleton()), failure === 'failed');
    const e = setup(runner);
    const goal = await e.createGoal({ prompt: 'Add a task', repoPath: repo, nature: 'code', interview: 'never' });
    await waitFor(() => getGoal(e.store.db, goal.id)!.state === 'awaiting_brief_approval');
    expect(runner.calls.map((c) => c.label?.split(' ')[0])).toEqual(['clarify', 'planner', 'planner']);
    expect(runner.calls[2]!.resumeSessionId).toBe('s2');
    const b = getBrief(e.store.db, goal.id)!.brief;
    expect(b.tasks.map((t) => [t.areaKey, t.title])).toEqual([['A1', 'build Main']]);
    expect(b.questions.some((q) => q.blocking && q.text.includes('planner could not split'))).toBe(true);
  });

  test('an Area the plan left without tasks gets one repair turn in the planner session', async () => {
    const two = skeleton({ areas: [...skeleton().areas as object[], { key: 'A2', name: 'Other', slug: 'other', description: 'Other area' }] });
    const runner = new ScriptedRunner((spec, index) => (isPlanner(spec) ? (index === 2 ? plan() : { ...plan(), tasks: [...plan().tasks, { ...plan('other task', 'A2').tasks[0]!, key: 'T2' }] }) : two));
    const e = setup(runner);
    const goal = await e.createGoal({ prompt: 'Add two areas', repoPath: repo, nature: 'code', interview: 'never' });
    await waitFor(() => getGoal(e.store.db, goal.id)!.state === 'awaiting_brief_approval');
    expect(runner.calls.map((c) => c.label?.split(' ')[0])).toEqual(['clarify', 'planner', 'planner']);
    expect(runner.calls[2]!.prompt).toContain('"Other" (A2) got no task');
    expect(runner.calls[2]!.resumeSessionId).toBe('s2');
    expect(getBrief(e.store.db, goal.id)!.brief.tasks.map((t) => t.areaKey)).toEqual(['A1', 'A2']);
  });

  test('a whole Brief from the Clarifier, tasks included, is kept without a planner session', async () => {
    const runner = new ScriptedRunner(() => brief('Clarifier task'));
    const e = setup(runner);
    const goal = await e.createGoal({ prompt: 'Add a task', repoPath: repo, nature: 'code', interview: 'never' });
    await waitFor(() => getGoal(e.store.db, goal.id)!.state === 'awaiting_brief_approval');
    expect(runner.calls.map((c) => c.label?.split(' ')[0])).toEqual(['clarify']);
    expect(getBrief(e.store.db, goal.id)!.brief.tasks[0]!.title).toBe('Clarifier task');
  });
});
