import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CodexDiscoveredModel } from './codex-discover.ts';
import { ModelRegistry, SEED_MODELS } from './registry.ts';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function directory() {
  const dir = mkdtempSync(join(tmpdir(), 'foundry-codex-registry-'));
  dirs.push(dir);
  return dir;
}
function model(id: string, overrides: Partial<CodexDiscoveredModel> = {}): CodexDiscoveredModel {
  return { id, displayName: `Display ${id}`, description: 'Native model', reasoningEfforts: ['low', 'max', 'ultra'], defaultReasoningEffort: 'low', isDefault: false, ...overrides };
}

describe('Codex model registry', () => {
  test('persists native metadata without claiming successful access or inference', () => {
    const dir = directory();
    const registry = new ModelRegistry(dir, 'codex');
    const found = model('native-model', { isDefault: true });
    registry.noteCodexDiscovered([found]);
    found.reasoningEfforts.push('caller-mutation');
    const record = new ModelRegistry(dir, 'codex').get('native-model')!;
    expect(record.codex).toEqual({ displayName: 'Display native-model', description: 'Native model', reasoningEfforts: ['low', 'max', 'ultra'], defaultReasoningEffort: 'low', isDefault: true, available: true });
    expect(registry.get('native-model')!.codex!.reasoningEfforts).toEqual(['low', 'max', 'ultra']);
    expect(record.lastOkAt).toBeNull();
    expect(record.resolvedId).toBeNull();
    expect(record.sessions).toBe(0);
    expect(registry.known('native-model')).toBe(false);
    expect(record.seed).toBe(false);
    expect(registry.get('codex-default')!.seed).toBe(true);
  });

  test('refreshes capabilities while keeping removed models and their session history', () => {
    const dir = directory();
    const registry = new ModelRegistry(dir, 'codex');
    registry.noteCodexDiscovered([model('retired'), model('current')]);
    registry.noteResult('retired', { subtype: 'success', numTurns: 1, modelUsage: null, errorMessage: null });
    registry.noteResult('current', { subtype: 'error', numTurns: 0, modelUsage: null, failureClass: 'model_unavailable', errorMessage: 'Account cannot use this model' });
    const previous = structuredClone(registry.get('retired')!);
    const failedAt = registry.get('current')!.lastFailAt;
    registry.noteCodexDiscovered([model('current', { description: 'Updated catalog', reasoningEfforts: ['high'], defaultReasoningEffort: 'high', isDefault: true })]);
    const restored = new ModelRegistry(dir, 'codex');
    expect(restored.get('retired')).toEqual({ ...previous, codex: { ...previous.codex!, available: false } });
    expect(restored.get('current')!.codex).toMatchObject({ available: true, description: 'Updated catalog', reasoningEfforts: ['high'], defaultReasoningEffort: 'high', isDefault: true });
    expect(restored.get('current')!.lastFailAt).toBe(failedAt);
    expect(restored.get('current')!.lastError).toBe('Account cannot use this model');
    expect(restored.get('current')!.lastOkAt).toBeNull();
    expect(restored.get('current')!.sessions).toBe(1);
    registry.noteCodexDiscovered([]);
    expect(registry.list().filter((record) => record.codex?.available)).toHaveLength(0);
    registry.noteCodexDiscovered([model('retired')]);
    expect(registry.get('retired')!.codex!.available).toBe(true);
    expect(registry.get('retired')!.lastOkAt).toBe(previous.lastOkAt);
  });

  test('keeps provider registries and Claude discovery metadata independent', () => {
    const dir = directory();
    const claude = new ModelRegistry(join(dir, 'claude'));
    const codex = new ModelRegistry(join(dir, 'codex'), 'codex');
    claude.noteDiscovered([{ id: 'claude-opus-5', family: 'opus', newest: true }]);
    const before = structuredClone(claude.list());
    codex.noteCodexDiscovered([model('native-model')]);
    codex.noteCodexDiscovered([]);
    expect(new ModelRegistry(join(dir, 'claude')).list()).toEqual(before);
    expect(claude.list().some((record) => record.codex)).toBe(false);
    expect(codex.get('claude-opus-5')).toBeNull();
    expect(claude.get('native-model')).toBeNull();
    for (const seed of SEED_MODELS) expect(codex.get(seed.name)).toBeNull();
    // Discovery methods update their own metadata even when reading a legacy mixed registry.
    claude.noteCodexDiscovered([model('native-model')]);
    claude.noteCodexDiscovered([]);
    expect(claude.get('claude-opus-5')!.discovered).toEqual(before.find((r) => r.name === 'claude-opus-5')!.discovered);
  });
});
