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
  constructor(private byModel: Record<string, RunResult>) {}
  active() {
    return 0;
  }
  async run(spec: RunSpec): Promise<RunHandle> {
    this.calls.push(spec.model ?? '?');
    const result = this.byModel[spec.model ?? ''] ?? base({ modelUsage: { [`resolved-${spec.model}`]: {} } });
    const events: RunnerEvent[] = result.failureClass === 'model_unavailable' ? [{ kind: 'result', result }] : [{ kind: 'init', sessionId: 's', model: `resolved-${spec.model}`, tools: [], raw: {} }, { kind: 'text', text: 'hi' }, { kind: 'result', result }];
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
