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

const brief = (title = 'Clarifier draft') => BriefOutput.parse({
  title: 'feat: add task', understanding: 'Add the requested task.', nature: 'code',
  areas: [{ key: 'A1', name: 'Main', slug: 'main', description: 'Main task' }], assumptions: [],
  tasks: [{ key: 'T1', areaKey: 'A1', title, spec: 'Update README.md', kind: 'feature', difficulty: 'standard', scenario: 'general', scope: null, dependsOnKeys: [], parallelizable: false, relevantFiles: ['README.md'], milestone: null }],
  checks: [{ key: 'C1', name: 'README exists', tier: 'must', taskKey: 'T1', areaKey: 'A1', type: 'command', cmd: 'test -f README.md', rubric: null }],
  costEstimateUsd: 0, timeEstimateMin: 10, questions: [], styleOptions: [], run: null,
});

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

describe('Foundry-managed Codex planner', () => {
  test('runs a bounded read-only planner, then lets Clarifier decide the final Brief', async () => {
    const runner = new ScriptedRunner((spec, index) => spec.label?.startsWith('planner ')
      ? { tasks: brief('Planner proposal').tasks }
      : brief(index === 1 ? 'Clarifier draft' : 'Clarifier final decision'));
    const e = setup(runner);
    const streamed: string[] = [];
    const broadcast = e.broadcast.bind(e);
    e.broadcast = (event) => { if (event.event.kind === 'text') streamed.push(event.event.text); broadcast(event); };
    const goal = await e.createGoal({ prompt: 'Add a task', repoPath: repo, nature: 'code', interview: 'never', codexModel: 'configured-codex-model' });
    await waitFor(() => getGoal(e.store.db, goal.id)!.state === 'awaiting_brief_approval');
    expect(runner.calls.map((c) => c.label?.split(' ')[0])).toEqual(['clarify', 'planner', 'clarify']);
    const planner = runner.calls[1]!;
    expect(planner.model).toBe('configured-codex-model');
    expect(planner.allowedTools).toEqual(READONLY_TOOLS);
    expect(planner.disallowedTools).toEqual(READONLY_DISALLOWED);
    expect(planner.permissionMode).toBe('dontAsk');
    expect(planner.settings).toBeDefined();
    expect(planner.maxTurns).toBe(45);
    expect(planner.timeoutMs).toBe(10 * 60_000);
    expect(planner.transcriptPath).toEndWith(`planner-${goal.id}.jsonl`);
    expect(planner.appendSystemPromptFile).toEndWith('planner.md');
    expect(planner.prompt).toContain('Clarifier draft');
    expect(planner.agents).toBeUndefined();
    expect(runner.calls[0]!.agents).toBeUndefined();
    expect(runner.calls[2]!.prompt).toContain('Planner proposal');
    expect(runner.calls[2]!.resumeSessionId).toBe('s1');
    expect(getBrief(e.store.db, goal.id)!.brief.tasks[0]!.title).toBe('Clarifier final decision');
    expect(streamed).toContain(`planner ${goal.title}`);
    const sources = e.store.listByGoal(goal.id).filter((ev) => ev.type === 'goal.cost_added').map((ev) => (ev.payload as { source: string }).source);
    expect(sources).toEqual(['clarify', 'planner', 'clarify-planner-review']);
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
      return spec.label?.startsWith('planner ') ? { tasks: brief().tasks } : brief();
    });
    e = setup(runner, { codexPresets: { selected }, codexNaturePreset: { code: 'selected', docs: 'balanced', media: 'balanced' } });
    const goal = await e.createGoal({ prompt: 'Add a task', repoPath: repo, nature: 'code', interview: 'never', modelPreset: 'selected' });
    await waitFor(() => getGoal(e.store.db, goal.id)!.state === 'awaiting_brief_approval');
    expect(runner.calls.map((c) => [c.model, c.effort, c.meta?.modelAction])).toEqual([
      ['clarifier-specific', 'medium', 'clarifier'],
      ['planner-specific', 'xhigh', 'planner'],
      ['clarifier-specific', 'medium', 'clarifier'],
    ]);
    expect(getGoal(e.store.db, goal.id)!.codexPreset?.tables.code.planner).toEqual({ model: 'planner-specific', effort: 'xhigh' });
    expect(e.config.codexPresets.selected!.tables.code.planner.model).toBe('new-default-planner');
  });

  test('waits for human answers and carries them into the planner', async () => {
    const runner = new ScriptedRunner((spec, index) => index === 1
      ? { questions: [{ key: 'Q1', text: 'Which database?', options: ['SQLite', 'Postgres'], reason: 'No database chosen', dependsOn: null, blocking: true }], brief: null }
      : spec.label?.startsWith('planner ') ? { tasks: brief().tasks } : { questions: [], brief: brief() });
    const e = setup(runner);
    const goal = await e.createGoal({ prompt: 'Add a task', repoPath: repo, nature: 'code', interview: 'always' });
    await waitFor(() => getGoal(e.store.db, goal.id)!.interview?.status === 'awaiting_answers');
    expect(runner.calls).toHaveLength(1);
    e.answerInterview(goal.id, { Q1: 'SQLite' });
    await waitFor(() => getGoal(e.store.db, goal.id)!.state === 'awaiting_brief_approval');
    const planners = runner.calls.filter((c) => c.label?.startsWith('planner '));
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
      : spec.label?.startsWith('planner ') ? { tasks: brief().tasks } : { ...brief(), nature: 'docs' });
    const e = setup(runner, { codexPresets: { selected } });
    const goal = await e.createGoal({ prompt: 'Write a guide', repoPath: repo, nature: 'auto', interview: 'never', modelPreset: 'selected' });
    await waitFor(() => getGoal(e.store.db, goal.id)!.state === 'awaiting_brief_approval');
    expect(getGoal(e.store.db, goal.id)!.nature).toBe('docs');
    expect(runner.calls.filter((c) => !c.label?.startsWith('classify nature')).map((c) => [c.model, c.effort])).toEqual([
      ['docs-clarifier', 'medium'], ['docs-planner', 'xhigh'], ['docs-clarifier', 'medium'],
    ]);
  });

  test.each(['failed', 'invalid'] as const)('a %s planner fails visibly without publishing a Brief', async (failure) => {
    const runner = new ScriptedRunner((spec) => spec.label?.startsWith('planner ')
      ? failure === 'invalid' ? { tasks: [] } : { tasks: brief().tasks }
      : brief(), failure === 'failed');
    const e = setup(runner);
    const goal = await e.createGoal({ prompt: 'Add a task', repoPath: repo, nature: 'code', interview: 'never' });
    await waitFor(() => getGoal(e.store.db, goal.id)!.state === 'failed');
    expect(runner.calls).toHaveLength(2);
    expect(getBrief(e.store.db, goal.id)).toBeNull();
    expect(e.store.listByGoal(goal.id).some((ev) => ev.type === 'engine.note' && JSON.stringify(ev.payload).includes('Codex planner'))).toBe(true);
  });

  test('a coverage repair after planner review does not invoke the planner again', async () => {
    const uncovered = { ...brief(), areas: [...brief().areas, { key: 'A2', name: 'Other', slug: 'other', description: 'Other area' }] };
    const runner = new ScriptedRunner((spec) => spec.label?.startsWith('planner ') ? { tasks: brief().tasks } : uncovered);
    const e = setup(runner);
    const goal = await e.createGoal({ prompt: 'Add two areas', repoPath: repo, nature: 'code', interview: 'never' });
    await waitFor(() => getGoal(e.store.db, goal.id)!.state === 'awaiting_brief_approval');
    expect(runner.calls.filter((c) => c.label?.startsWith('planner '))).toHaveLength(1);
    expect(runner.calls).toHaveLength(4);
    expect(runner.calls.at(-1)!.prompt).toContain('advisory task proposal already provided');
    expect(runner.calls.at(-1)!.prompt).not.toContain('use the planner agent');
  });

  test('does not publish the candidate Brief when Clarifier cannot review the proposal', async () => {
    const runner = new ScriptedRunner((spec, index) => spec.label?.startsWith('planner ')
      ? { tasks: brief().tasks }
      : index === 1 ? brief() : { invalid: true });
    const e = setup(runner);
    const goal = await e.createGoal({ prompt: 'Add a task', repoPath: repo, nature: 'code', interview: 'never' });
    await waitFor(() => getGoal(e.store.db, goal.id)!.state === 'failed');
    expect(runner.calls).toHaveLength(3);
    expect(getBrief(e.store.db, goal.id)).toBeNull();
    expect(e.store.listByGoal(goal.id).some((ev) => ev.type === 'engine.note' && JSON.stringify(ev.payload).includes('could not review the planner proposal'))).toBe(true);
  });
});
