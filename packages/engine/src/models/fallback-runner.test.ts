import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { ClaudeRunner, RunHandle, RunResult, RunSpec, RunnerEvent } from '@foundry/runner';
import { getGoal } from '@foundry/core';
import { defaultConfig } from '../config.ts';
import { Engine } from '../engine.ts';
import { makeRepo, terminal, waitFor } from '../test-helpers.ts';
import { ModelFallbackRunner, isModelUnavailable } from './fallback-runner.ts';
import { ModelRegistry, isPinnedId } from './registry.ts';

const base = (over: Partial<RunResult>): RunResult => ({ sessionId: 's', subtype: 'success', isError: false, costUsd: 0.01, numTurns: 1, durationMs: 1, usage: null, modelUsage: null, permissionDenials: [], finalText: 'ok', structuredOutput: null, exitCode: 0, pid: null, rateLimit: null, errorMessage: null, failureClass: null, skillsUsed: [], toolsUsed: {}, ...over });
const unavailable = (model: string): RunResult => base({ subtype: 'error_during_execution', isError: true, costUsd: 0, numTurns: 0, errorMessage: `model: ${model} not found`, failureClass: 'model_unavailable', finalText: null, sessionId: null });

/** scripted inner runner: a map of model → result (missing = success) */
class ScriptRunner implements ClaudeRunner {
  calls: string[] = [];
  specs: RunSpec[] = [];
  constructor(private byModel: Record<string, RunResult>, private eventsByModel: Record<string, RunnerEvent[]> = {}) {}
  active() {
    return 0;
  }
  async run(spec: RunSpec): Promise<RunHandle> {
    this.calls.push(spec.model ?? '?');
    this.specs.push(spec);
    const result = this.byModel[spec.model ?? ''] ?? base({ modelUsage: { [`resolved-${spec.model}`]: {} } });
    const events: RunnerEvent[] = this.eventsByModel[spec.model ?? ''] ?? (result.failureClass === 'model_unavailable' ? [{ kind: 'result', result }] : [{ kind: 'init', sessionId: 's', model: `resolved-${spec.model}`, tools: [], raw: {} }, { kind: 'text', text: 'hi' }, { kind: 'result', result }]);
    return { pid: null, events: (async function* () { for (const e of events) yield e; })(), kill() {}, result: Promise.resolve(result) };
  }
}

describe('model fallback runner', () => {
  test('unavailable model → next fallback, events merged, registry learns both', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mf-'));
    const inner = new ScriptRunner({ 'old-alias': unavailable('old-alias'), sonnet: unavailable('sonnet') });
    const registry = new ModelRegistry(dir);
    const seen: string[] = [];
    const runner = new ModelFallbackRunner(inner, { fallbacks: () => ['sonnet', 'haiku'], registry, onFallback: (i) => seen.push(`${i.from}→${i.to}`) });
    const h = await runner.run({ prompt: 'x', cwd: dir, model: 'old-alias' });
    const kinds: string[] = [];
    for await (const ev of h.events) kinds.push(ev.kind);
    const r = await h.result;
    expect(r.subtype).toBe('success');
    expect(inner.calls).toEqual(['old-alias', 'sonnet', 'haiku']);
    expect(seen).toEqual(['old-alias→sonnet', 'sonnet→haiku']);
    // the consumer saw the failed results pass by, then the real stream
    expect(kinds.filter((k) => k === 'init').length).toBe(1);
    expect(kinds.at(-1)).toBe('result');
    expect(registry.get('old-alias')).toMatchObject({ lastOkAt: null });
    expect(registry.get('old-alias')!.lastFailAt).toBeTruthy();
    expect(registry.get('haiku')).toMatchObject({ resolvedId: 'resolved-haiku', seed: true });
    expect(registry.get('haiku')!.lastOkAt).toBeTruthy();
    expect(registry.known('haiku')).toBe(true);
    expect(registry.known('old-alias')).toBe(false);
    // persisted
    expect(new ModelRegistry(dir).get('haiku')!.resolvedId).toBe('resolved-haiku');
  });

  test('no fallback for sessions that already did work, or when every candidate fails', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mf-'));
    const busy = base({ subtype: 'error_during_execution', isError: true, costUsd: 0.3, numTurns: 4, errorMessage: 'model: x not found', failureClass: 'model_unavailable' });
    expect(isModelUnavailable(busy)).toBe(false);
    const inner = new ScriptRunner({ x: busy, y: unavailable('y'), z: unavailable('z') });
    const seen: string[] = [];
    const runner = new ModelFallbackRunner(inner, { fallbacks: () => ['y', 'z'], onFallback: (i) => seen.push(i.to) });
    const h1 = await runner.run({ prompt: 'x', cwd: dir, model: 'x' });
    for await (const _ of h1.events) {
      /* drain */
    }
    expect((await h1.result).numTurns).toBe(4);
    expect(seen).toEqual([]);
    const h2 = await runner.run({ prompt: 'x', cwd: dir, model: 'y' });
    for await (const _ of h2.events) {
      /* drain */
    }
    const r2 = await h2.result;
    expect(r2.failureClass).toBe('model_unavailable');
    expect(inner.calls).toEqual(['x', 'y', 'z']);
    // result settles even when nobody iterates the events
    const h3 = await runner.run({ prompt: 'x', cwd: dir, model: 'fresh' });
    expect((await h3.result).subtype).toBe('success');
  });

  test('isPinnedId', () => {
    expect(isPinnedId('opus')).toBe(false);
    expect(isPinnedId('claude-opus-5')).toBe(true);
    expect(isPinnedId('claude-haiku-4-5-20251001')).toBe(true);
  });

  test('safely falls back for an unused Codex model and passes goal metadata into selection and replacement', async () => {
    const unavailableCodex = { ...unavailable('retired'), costStatus: 'unavailable' as const, usage: { input_tokens: 0, output_tokens: 0 } };
    const inner = new ScriptRunner({ retired: unavailableCodex });
    const selected: RunSpec[] = [];
    const runner = new ModelFallbackRunner(inner, { fallbacks: (spec) => { selected.push(spec); return spec.meta?.goalId === 'goal-one' ? ['replacement'] : []; } });
    const handle = await runner.run({ prompt: 'x', cwd: tmpdir(), model: 'retired', meta: { goalId: 'goal-one', modelAction: 'standard' } });
    expect((await handle.result).subtype).toBe('success');
    expect(inner.calls).toEqual(['retired', 'replacement']);
    expect(selected[0]!.model).toBe('retired');
    expect(inner.specs[1]!.meta).toEqual({ goalId: 'goal-one', modelAction: 'standard', modelFallback: '1' });
  });

  test('never replays Codex sessions after text, reasoning, tools or usage despite zero reported turns and dollars', async () => {
    const codex = { ...unavailable('retired'), costStatus: 'unavailable' as const };
    const cases: { event?: RunnerEvent; result?: Partial<RunResult> }[] = [
      { event: { kind: 'text', text: 'Already started work' } },
      { event: { kind: 'thinking', text: 'Reasoned about the task' } },
      { event: { kind: 'tool_use', id: 'tool-one', name: 'Bash', input: {} } },
      { event: { kind: 'tool_result', toolUseId: 'tool-one', isError: false, content: '' } },
      { event: { kind: 'unknown', raw: { type: 'item.completed', item: { type: 'new-native-tool' } } } },
      { result: { usage: { input_tokens: 1 } } },
      { result: { modelUsage: { model: { outputTokens: 1 } } } },
      { result: { toolsUsed: { Bash: 1 } } },
      { result: { finalText: 'Already wrote the file' } },
      { result: { structuredOutput: { done: true } } },
    ];
    for (const entry of cases) {
      const result = { ...codex, ...entry.result };
      const events: RunnerEvent[] = [...(entry.event ? [entry.event] : []), { kind: 'result', result }];
      const inner = new ScriptRunner({ retired: result }, { retired: events });
      const runner = new ModelFallbackRunner(inner, { fallbacks: () => ['replacement'] });
      const handle = await runner.run({ prompt: 'x', cwd: tmpdir(), model: 'retired' });
      expect((await handle.result).failureClass).toBe('model_unavailable');
      expect(inner.calls).toEqual(['retired']);
    }
  });

  test('a model probe cannot succeed by silently testing a different model', async () => {
    const inner = new ScriptRunner({ retired: unavailable('retired') });
    const runner = new ModelFallbackRunner(inner, { fallbacks: () => { throw new Error('Probe must not request fallbacks'); } });
    const handle = await runner.run({ prompt: 'x', cwd: tmpdir(), model: 'retired', meta: { tier: 'probe' } });
    expect((await handle.result).failureClass).toBe('model_unavailable');
    expect(inner.calls).toEqual(['retired']);
  });

  test('replacement spawn rejection settles result and events, including the unattended safety drain', async () => {
    for (const readEvents of [true, false]) {
      const inner = new ScriptRunner({ retired: unavailable('retired') });
      const original = inner.run.bind(inner);
      inner.run = async (spec) => {
        if (spec.model === 'replacement') throw new Error('Replacement binary could not start');
        return original(spec);
      };
      const runner = new ModelFallbackRunner(inner, { fallbacks: () => ['replacement'] });
      const handle = await runner.run({ prompt: 'x', cwd: tmpdir(), model: 'retired' });
      const events: RunnerEvent[] = [];
      if (readEvents) for await (const event of handle.events) events.push(event);
      expect(await handle.result).toMatchObject({ subtype: 'spawn_error', failureClass: 'other', errorMessage: 'Replacement binary could not start', isError: true });
      if (readEvents) expect(events.at(-1)).toMatchObject({ kind: 'result', result: { subtype: 'spawn_error' } });
    }
  });

  test('cancellation and killAll prevent a replacement from starting', async () => {
    for (const cancelAll of [true, false]) {
      const inner = new ScriptRunner({ retired: unavailable('retired') });
      const runner = new ModelFallbackRunner(inner, { fallbacks: () => ['replacement'] });
      const handle = await runner.run({ prompt: 'x', cwd: tmpdir(), model: 'retired' });
      if (cancelAll) expect(runner.killAll()).toBe(1);
      else handle.kill('user stopped');
      await handle.result;
      expect(inner.calls).toEqual(['retired']);
    }
  });

  test('a failed event stream terminates its child and settles without retrying', async () => {
    const killed: string[] = [];
    const inner: ClaudeRunner = {
      active: () => 1,
      run: async () => ({ pid: null, events: (async function* () { throw new Error('Broken event stream'); })(), kill: (reason) => { killed.push(reason); }, result: Promise.resolve(unavailable('retired')) }),
    };
    const runner = new ModelFallbackRunner(inner, { fallbacks: () => { throw new Error('Must not retry after stream failure'); } });
    const handle = await runner.run({ prompt: 'x', cwd: tmpdir(), model: 'retired' });
    expect(await handle.result).toMatchObject({ subtype: 'error_during_execution', errorMessage: 'Broken event stream' });
    expect(killed).toEqual(['runner_error']);
  });

  test('cancellation kills a replacement that was already queued and prevents another fallback', async () => {
    let release!: (handle: RunHandle) => void;
    const queued = new Promise<RunHandle>((resolve) => { release = resolve; });
    const inner = new ScriptRunner({ retired: unavailable('retired') });
    const original = inner.run.bind(inner);
    inner.run = async (spec) => {
      if (spec.model === 'replacement') { inner.calls.push('replacement'); return queued; }
      return original(spec);
    };
    const runner = new ModelFallbackRunner(inner, { fallbacks: () => ['replacement', 'another'] });
    const handle = await runner.run({ prompt: 'x', cwd: tmpdir(), model: 'retired' });
    await waitFor(() => inner.calls.includes('replacement'));
    handle.kill('cancel queued');
    const killed: string[] = [];
    const result = unavailable('replacement');
    release({ pid: null, events: (async function* () { yield { kind: 'result', result } as RunnerEvent; })(), kill: (reason) => { killed.push(reason); }, result: Promise.resolve(result) });
    await handle.result;
    expect(killed).toEqual(['cancel queued']);
    expect(inner.calls).toEqual(['retired', 'replacement']);
  });

  test('engine: a goal whose worker model is gone falls back, records goal.models_changed and updates the snapshot; doctor warns', async () => {
    const ROOT = resolve(import.meta.dir, '../../../..');
    const dataDir = mkdtempSync(join(tmpdir(), 'mf-engine-'));
    const repo = await makeRepo();
    const inner = new ScriptRunner({ 'retired-model': unavailable('retired-model') });
    // the scripted runner does no work; make the success path write the check file
    inner.run = (async function (this: ScriptRunner, spec: RunSpec) {
      this.calls.push(spec.model ?? '?');
      if (spec.model === 'retired-model') {
        const result = unavailable('retired-model');
        return { pid: null, events: (async function* () { yield { kind: 'result', result } as RunnerEvent; })(), kill() {}, result: Promise.resolve(result) };
      }
      writeFileSync(join(spec.cwd, 'done.txt'), 'ok');
      const result = base({ modelUsage: { 'claude-sonnet-5': {} } });
      const events: RunnerEvent[] = [{ kind: 'hook', name: 'SessionStart:startup', outcome: 'success' }, { kind: 'init', sessionId: 's', model: 'claude-sonnet-5', tools: [], raw: {} }, { kind: 'result', result }];
      return { pid: null, events: (async function* () { for (const e of events) yield e; })(), kill() {}, result: Promise.resolve(result) };
    }).bind(inner);
    const { BUILTIN_PRESETS } = await import('@foundry/core');
    const all = (m: string) => Object.fromEntries(Object.keys(BUILTIN_PRESETS.economy!.tables.code).map((k) => [k, m])) as import('@foundry/core').PresetTable;
    // every action on sonnet except the Standard-task row, which names a retired model
    const retired = { label: 'Retired', description: '', basedOn: null, tables: { code: { ...all('sonnet'), standard: 'retired-model' }, docs: all('sonnet'), media: all('sonnet') } };
    const engine = new Engine(defaultConfig(ROOT, { dataDir, claudeHome: join(dataDir, 'ch'), alwaysReviewTasks: false, log: () => {}, modelFallbacks: ['sonnet'], modelPresets: { retired } }), inner);
    const goal = await engine.createGoal({ prompt: 'retired', repoPath: repo, modelPreset: 'retired', autoBrief: { mustChecks: ['test -f done.txt'] } });
    await waitFor(() => terminal(getGoal(engine.store.db, goal.id)!.state), 20_000);
    const g = getGoal(engine.store.db, goal.id)!;
    expect(g.state).toBe('done');
    // the replacement is remembered on the goal, so the dead model is asked for only once
    expect(g.modelSubstitutions).toEqual({ 'retired-model': 'sonnet' });
    const ev = engine.store.listByGoal(goal.id, 5000).filter((e) => e.type === 'goal.models_changed').map((e) => e.payload as any);
    expect(ev).toEqual([{ tier: null, from: 'retired-model', to: 'sonnet', reason: 'model: retired-model not found' }]);
    expect(inner.calls.filter((c) => c === 'retired-model').length).toBe(1);
    const models = engine.listModels();
    expect(models.find((m) => m.name === 'retired-model')).toMatchObject({ seed: false, inUse: [] });
    expect(models.find((m) => m.name === 'sonnet')).toMatchObject({ resolvedId: 'claude-sonnet-5' });
    const doctor = await engine.doctor();
    const check = doctor.checks.find((c) => c.id === 'models')!;
    expect(check.ok).toBe(true);
    engine.config.naturePreset.code = 'retired';
    const again = (await engine.doctor()).checks.find((c) => c.id === 'models')!;
    expect(again.ok).toBe(false);
    expect(again.detail).toContain('retired-model');
    expect(again.fix?.action).toBe('test-models');
    const before = engine.store.snapshotReadModels();
    engine.store.replay();
    expect(engine.store.snapshotReadModels()).toEqual(before);
  }, 30_000);
});
