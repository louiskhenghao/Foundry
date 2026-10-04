import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { BUILTIN_CODEX_PRESETS, BUILTIN_PRESETS, CODEX_MODEL_ACTIONS, CodexEffort, Goal, MODEL_ACTIONS, MODEL_NATURES, getGoal, listTasks, type CodexModelPreset } from '@foundry/core';
import type { RunHandle } from '@foundry/runner';
import { defaultConfig, type EngineConfig } from '../config.ts';
import { Engine } from '../engine.ts';
import { FakeRunner, makeRepo, waitFor } from '../test-helpers.ts';
import { metaFor, modelFor, tableFor, workerModelFor } from './roles.ts';

const ROOT = resolve(import.meta.dir, '../../../..');
let dataDir: string;
let repo: string;
const engines: Engine[] = [];
beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'foundry-codex-presets-'));
  repo = await makeRepo();
});
afterEach(async () => {
  for (const e of engines.splice(0)) await e.stop();
  for (const path of [dataDir, repo, `${repo}-foundry`]) rmSync(path, { recursive: true, force: true });
});

function setup(overrides: Partial<EngineConfig> = {}) {
  const runner = new FakeRunner(() => {});
  const config = defaultConfig(ROOT, { provider: 'codex', dataDir, codexHome: join(dataDir, 'codex-home'), claudeHome: join(dataDir, 'claude-home'), useGraphify: false, log: () => {}, ...overrides });
  const engine = new Engine(config, runner);
  engine.beginUpdateDrain(); // exercise creation/routing without scheduling model or workspace work
  engines.push(engine);
  return { engine, runner, config };
}

function distinctPreset(): CodexModelPreset {
  const p = structuredClone(BUILTIN_CODEX_PRESETS.balanced!);
  p.label = 'Distinct roles';
  for (const nature of MODEL_NATURES) for (const action of CODEX_MODEL_ACTIONS) p.tables[nature][action] = { model: `${nature}-${action}`, effort: 'medium' };
  p.tables.code.planner.effort = 'xhigh';
  p.tables.code.housekeeping.effort = 'low';
  return p;
}

function savePreset(engine: Engine, preset = distinctPreset()) {
  engine.updateSettings({ models: { codexPresets: { custom: preset }, codexPresetCode: 'custom', codexPresetDocs: 'custom', codexPresetMedia: 'custom' } });
  return preset;
}

async function drain(handle: RunHandle) {
  for await (const _event of handle.events) {}
  return handle.result;
}

describe('Codex preset integration', () => {
  test('created goal keeps its preset and fallbacks through edits, deletion, replay and restart', async () => {
    const { engine: e, config } = setup();
    const selected = savePreset(e);
    e.updateSettings({ models: { codexFallbacks: ['fallback-first', 'fallback-second'] } });
    const goal = await e.createGoal({ prompt: 'Write a guide', repoPath: repo, nature: 'docs' });
    expect(goal.modelPreset).toBe('custom');
    expect(goal.codexPreset).toEqual(selected);
    expect(goal.models).toEqual({ strong: 'docs-clarifier', worker: 'docs-standard', cheap: 'docs-housekeeping' });
    const changed = distinctPreset();
    changed.tables.docs.planner.model = 'new-planner';
    e.updateSettings({ models: { codexPresets: { custom: changed }, codexFallbacks: ['new-fallback'] } });
    e.updateSettings({ models: { codexPresets: {}, codexPresetCode: 'production', codexPresetDocs: 'balanced', codexPresetMedia: 'balanced' } });
    expect(modelFor(config, getGoal(e.store.db, goal.id)!, 'planner').model).toBe('docs-planner');
    e.store.replay();
    expect(getGoal(e.store.db, goal.id)!.codexPreset).toEqual(selected);
    expect(getGoal(e.store.db, goal.id)!.codexFallbacks).toEqual(['fallback-first', 'fallback-second']);
    await e.stop();
    const restarted = setup();
    const restored = getGoal(restarted.engine.store.db, goal.id)!;
    expect(restored.codexPreset).toEqual(selected);
    expect(modelFor(restarted.config, restored, 'planner').model).toBe('docs-planner');
    const next = await restarted.engine.createGoal({ prompt: 'New guide', repoPath: repo, nature: 'docs' });
    expect(next.modelPreset).toBe('balanced');
    expect(next.codexFallbacks).toEqual(['new-fallback']);
  });

  test('every role routes its chosen model and housekeeping uses its own row', async () => {
    const { engine: e, runner, config } = setup();
    savePreset(e);
    const goal = await e.createGoal({ prompt: 'Build a feature', repoPath: repo, nature: 'code' });
    for (const action of MODEL_ACTIONS) {
      const routed = action === 'simple' || action === 'standard' || action === 'complex'
        ? workerModelFor(config, goal, { difficulty: action, retryBudget: 3 }, 1)
        : modelFor(config, goal, action);
      await drain(await e.runner.run({ prompt: 'test', cwd: repo, model: routed.model, meta: metaFor(goal.id, routed) }));
      expect(runner.calls.at(-1)!).toMatchObject({ model: `code-${action}`, meta: { modelAction: action } });
    }
    await drain(await e.runner.run({ prompt: 'classify', cwd: repo, model: 'ignored-legacy-cheap', meta: { goalId: goal.id, tier: 'cheap' } }));
    expect(runner.calls.at(-1)!).toMatchObject({ model: 'code-housekeeping', effort: 'low' });
    expect(runner.calls).toHaveLength(CODEX_MODEL_ACTIONS.length);
  });

  test('auto goals snapshot each nature default before classification', async () => {
    const { engine: e, config } = setup();
    const code = distinctPreset(), docs = distinctPreset(), media = distinctPreset();
    code.tables.code.planner.model = 'chosen-code-planner';
    docs.tables.docs.planner.model = 'chosen-docs-planner';
    media.tables.media.planner.model = 'chosen-media-planner';
    e.updateSettings({ models: { codexPresets: { code, docs, media }, codexPresetCode: 'code', codexPresetDocs: 'docs', codexPresetMedia: 'media' } });
    const goal = await e.createGoal({ prompt: 'Classify this later', repoPath: repo, nature: 'auto' });
    expect(goal.modelPreset).toBeNull();
    expect(MODEL_NATURES.map((n) => goal.codexPreset!.tables[n].planner.model)).toEqual(['chosen-code-planner', 'chosen-docs-planner', 'chosen-media-planner']);
    e.updateSettings({ models: { codexPresetDocs: 'balanced' } });
    e.store.append({ type: 'goal.nature_set', goalId: goal.id, payload: { nature: 'docs', reason: 'test classification' } });
    expect(modelFor(config, getGoal(e.store.db, goal.id)!, 'planner').model).toBe('chosen-docs-planner');
  });

  test('last attempt escalates reasoning even when standard and complex use the same model', async () => {
    const { engine: e, runner, config } = setup();
    const selected = distinctPreset();
    selected.tables.code.standard = { model: 'shared-model', effort: 'low' };
    selected.tables.code.complex = { model: 'shared-model', effort: 'xhigh' };
    savePreset(e, selected);
    const goal = await e.createGoal({ prompt: 'Build a feature', repoPath: repo, nature: 'code' });
    const task = { difficulty: 'standard' as const, retryBudget: 2 };
    const attempts = [1, 2, 3].map((index) => workerModelFor(config, goal, task, index));
    expect(attempts.map((a) => [a.model, a.action, a.escalated])).toEqual([
      ['shared-model', 'standard', null], ['shared-model', 'complex', 'last-attempt'], ['shared-model', 'complex', 'human-retry'],
    ]);
    for (const routed of attempts) await drain(await e.runner.run({ prompt: 'test', cwd: repo, model: routed.model, meta: metaFor(goal.id, routed) }));
    expect(runner.calls.map((c) => c.effort)).toEqual(['low', 'xhigh', 'xhigh']);
  });

  test('actual worker attempt sessions carry standard and complex actions into effort routing', async () => {
    const { engine: e, runner } = setup({ alwaysReviewTasks: false, autoskills: false });
    const selected = distinctPreset();
    selected.tables.code.standard = { model: 'worker-model', effort: 'low' };
    selected.tables.code.complex = { model: 'worker-model', effort: 'xhigh' };
    savePreset(e, selected);
    const goal = await e.createGoal({ prompt: 'Create the missing file', repoPath: repo, nature: 'code', budgets: { attemptsPerTask: 2 }, workflow: { pace: 'fast' }, autoBrief: { mustChecks: ['test -f missing.txt'] } });
    e.endUpdateDrain();
    await waitFor(() => listTasks(e.store.db, goal.id).some((task) => task.state === 'blocked'));
    expect(runner.calls.filter((c) => c.label?.startsWith('attempt ')).map((c) => [c.model, c.effort, c.meta?.modelAction])).toEqual([
      ['worker-model', 'low', 'standard'], ['worker-model', 'xhigh', 'complex'],
    ]);
  }, 20_000);

  test('old Codex goals without a preset retain their single model and legacy max effort', async () => {
    const { engine: e, runner, config } = setup();
    const template = await e.createGoal({ prompt: 'Legacy goal', repoPath: repo, nature: 'code' });
    const legacy = Goal.parse({ ...template, id: 'g_legacy_preset_test', codexPreset: undefined, codexFallbacks: undefined, modelPreset: null, effort: 'max', models: { strong: 'old-model', worker: 'old-model', cheap: 'old-model' } });
    e.store.append({ type: 'goal.created', goalId: legacy.id, payload: { goal: legacy } });
    savePreset(e);
    e.store.replay();
    const restored = getGoal(e.store.db, legacy.id)!;
    expect(restored.codexPreset).toBeUndefined();
    expect(new Set(Object.values(tableFor(config, restored).table))).toEqual(new Set(['old-model']));
    const routed = modelFor(config, restored, 'planner');
    await drain(await e.runner.run({ prompt: 'test', cwd: repo, model: routed.model, meta: metaFor(restored.id, routed) }));
    expect(runner.calls.at(-1)!).toMatchObject({ model: 'old-model', effort: 'xhigh' });
  });

  test('Claude goals keep Claude aliases and live preset edits', async () => {
    const { engine: e, runner, config } = setup();
    savePreset(e);
    const goal = await e.createGoal({ prompt: 'Claude goal', repoPath: repo, provider: 'claude', nature: 'code', modelPreset: 'balanced' });
    expect(goal.codexPreset).toBeUndefined();
    expect(modelFor(config, goal, 'planner')).toEqual({ model: 'opus' });
    const changed = structuredClone(BUILTIN_PRESETS.balanced!);
    changed.tables.code.planner = 'claude-pinned';
    e.updateSettings({ models: { presets: { balanced: changed } } });
    const routed = modelFor(config, getGoal(e.store.db, goal.id)!, 'planner');
    await drain(await e.runner.run({ prompt: 'test', cwd: repo, model: routed.model, meta: metaFor(goal.id, routed) }));
    expect(runner.calls.at(-1)!.model).toBe('claude-pinned');
    expect(runner.calls.at(-1)!.meta?.modelAction).toBeUndefined();
  });

  test('custom settings persist, reject dangling defaults, and delete with replacement defaults', async () => {
    const { engine: e } = setup();
    const selected = savePreset(e);
    expect(e.settingsView().values.models.codexPresets.custom).toEqual(selected);
    expect(() => e.updateSettings({ models: { codexPresets: {} } })).toThrow('Unknown Codex preset: custom');
    expect(e.settingsView().values.models.codexPresets.custom).toEqual(selected);
    e.updateSettings({ models: { codexPresets: {}, codexPresetCode: 'production', codexPresetDocs: 'balanced', codexPresetMedia: 'balanced' } });
    await e.stop();
    const restarted = setup().engine;
    expect(restarted.settingsView().values.models.codexPresets).toEqual({});
    expect(restarted.config.codexNaturePreset).toEqual({ code: 'production', docs: 'balanced', media: 'balanced' });
    savePreset(restarted);
    restarted.resetSettings('models.codexPresets');
    expect(restarted.settingsView().values.models.codexPresets).toEqual({});
    expect(restarted.config.codexNaturePreset).toEqual({ code: 'production', docs: 'balanced', media: 'balanced' });
  });

  test('advertised unsupported effort fails before a session while an unknown model remains configurable', async () => {
    const { engine: e, runner } = setup();
    const selected = distinctPreset();
    selected.tables.code.planner = { model: 'known-model', effort: 'ultra' };
    savePreset(e, selected);
    e.providerModels.codex.noteCodexDiscovered([{ id: 'known-model', displayName: null, description: null, reasoningEfforts: ['low', 'high'], defaultReasoningEffort: 'high', isDefault: false }]);
    await expect(e.createGoal({ prompt: 'Invalid effort', repoPath: repo, nature: 'code' })).rejects.toThrow('does not advertise reasoning effort ultra');
    expect(runner.calls).toHaveLength(0);
    e.config.effort = 'max';
    await expect(e.createGoal({ prompt: 'Invalid Settings effort', repoPath: repo, nature: 'code' })).rejects.toThrow('does not advertise reasoning effort max');
    e.config.effort = null;
    const supported = await e.createGoal({ prompt: 'Override effort', repoPath: repo, nature: 'code', effort: 'high' });
    const routed = modelFor(e.config, supported, 'planner');
    await drain(await e.runner.run({ prompt: 'test', cwd: repo, model: routed.model, meta: metaFor(supported.id, routed) }));
    expect(runner.calls.at(-1)!.effort).toBe('high');
    await expect(e.runner.run({ prompt: 'test', cwd: repo, model: 'known-model', effort: 'max', meta: { provider: 'codex' } })).rejects.toThrow('does not advertise reasoning effort max');
    selected.tables.code.planner.model = 'new-custom-id';
    savePreset(e, selected);
    expect((await e.createGoal({ prompt: 'Unknown custom model', repoPath: repo, nature: 'code' })).codexPreset!.tables.code.planner.effort).toBe('ultra');
  });

  test('all eight native reasoning values survive persistence and routing without coercion', async () => {
    const { engine: e, runner } = setup();
    const selected = distinctPreset();
    for (const [i, effort] of CodexEffort.options.entries()) selected.tables.code[CODEX_MODEL_ACTIONS[i]!]!.effort = effort;
    savePreset(e, selected);
    const goal = await e.createGoal({ prompt: 'All efforts', repoPath: repo, nature: 'code' });
    e.store.replay();
    const restored = getGoal(e.store.db, goal.id)!;
    for (const [i, effort] of CodexEffort.options.entries()) {
      const action = CODEX_MODEL_ACTIONS[i]!;
      expect(restored.codexPreset!.tables.code[action].effort).toBe(effort);
      await drain(await e.runner.run({ prompt: 'test', cwd: repo, model: restored.codexPreset!.tables.code[action].model, meta: { goalId: goal.id, modelAction: action } }));
      expect(runner.calls.at(-1)!.effort).toBe(effort);
    }
  });

  test('follow-up prefill preserves role presets without an unwanted single-model override', async () => {
    const { engine: e } = setup();
    savePreset(e);
    const goal = await e.createGoal({ prompt: 'Original', repoPath: repo, nature: 'code' });
    e.store.append({ type: 'goal.state_changed', goalId: goal.id, payload: { from: 'draft', to: 'cancelled', reason: 'test fixture' } });
    const draft = await e.followUpDraft(goal.id);
    expect(draft.prefill.modelPreset).toBe('custom');
    expect(draft.prefill.codexModel).toBeUndefined();
    const follow = await e.createGoal({ ...draft.prefill, prompt: 'Follow up', follows: { goalId: goal.id, startFrom: 'base' } });
    expect(follow.codexPreset!.tables.code.planner.model).toBe('code-planner');
    expect(follow.codexPreset!.tables.code.standard.model).toBe('code-standard');
    const legacy = Goal.parse({ ...goal, id: 'g_legacy_followup_test', state: 'cancelled', effort: 'max', codexPreset: undefined, codexFallbacks: undefined, modelPreset: null, models: { strong: 'old-model', worker: 'old-model', cheap: 'old-model' } });
    e.store.append({ type: 'goal.created', goalId: legacy.id, payload: { goal: legacy } });
    expect((await e.followUpDraft(legacy.id)).prefill).toMatchObject({ codexModel: 'old-model', effort: 'xhigh' });
  });

  test('follow-up retains an explicit all-role override after settings change and event replay', async () => {
    const { engine: e } = setup();
    savePreset(e);
    const goal = await e.createGoal({ prompt:'Original override',repoPath:repo,nature:'code',codexModel:'chosen-model' });
    e.store.append({type:'goal.state_changed',goalId:goal.id,payload:{from:'draft',to:'cancelled',reason:'test fixture'}});
    e.updateSettings({models:{codexModel:'different-default'}});
    e.store.replay();
    expect(Goal.parse(getGoal(e.store.db,goal.id)).codexModelOverride).toBe('chosen-model');
    const draft = await e.followUpDraft(goal.id);
    expect(draft.prefill.codexModel).toBe('chosen-model');
    const follow = await e.createGoal({...draft.prefill,prompt:'Follow override',follows:{goalId:goal.id,startFrom:'base'}});
    for (const table of Object.values(follow.codexPreset!.tables)) for (const choice of Object.values(table)) expect(choice.model).toBe('chosen-model');
    expect(follow.codexPreset!.tables.code.planner.effort).toBe('xhigh');
    expect(follow.codexPreset!.tables.code.housekeeping.effort).toBe('low');
  });
});
