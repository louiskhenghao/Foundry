import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { getGoal } from '@foundry/core';
import { defaultConfig } from './config.ts';
import { Engine } from './engine.ts';
import { capWithin, sessionCap, sessionScale } from './session-limits.ts';
import { FakeRunner, makeRepo } from './test-helpers.ts';

const ROOT = resolve(import.meta.dir, '../../..');
const config = (over: Partial<ReturnType<typeof defaultConfig>> = {}) => ({ provider: 'claude' as const, modelPresets: {}, naturePreset: { code: 'production', docs: 'balanced', media: 'balanced' }, effort: null, ...over });
const goal = (over: Record<string, unknown> = {}) => ({ nature: 'code' as const, modelPreset: null, effort: null, ...over });

describe('session limits: how far a goal\'s sessions may go past their dollar caps', () => {
  test('auto follows the preset: Max ×3, Production ×2, Balanced and Economy ×1; a custom preset counts as the one it was made from', () => {
    expect(sessionScale(config(), goal({ modelPreset: 'max' }))).toBe(3);
    expect(sessionScale(config(), goal({ modelPreset: 'production' }))).toBe(2);
    expect(sessionScale(config(), goal({ modelPreset: 'balanced' }))).toBe(1);
    expect(sessionScale(config(), goal({ modelPreset: 'economy' }))).toBe(1);
    // no preset on the goal: the one Settings picks for its nature
    expect(sessionScale(config(), goal())).toBe(2);
    expect(sessionScale(config(), goal({ nature: 'docs' }))).toBe(1);
    const mine = { label: 'Mine', description: 'max, cheaper review', basedOn: 'max', tables: { code: {}, docs: {}, media: {} } } as never;
    expect(sessionScale(config({ modelPresets: { mine } }), goal({ modelPreset: 'mine' }))).toBe(3);
  });

  test('an effort that thinks the longest adds ×1.5, the goal\'s own or the Settings default', () => {
    expect(sessionScale(config(), goal({ modelPreset: 'production', effort: 'xhigh' }))).toBe(3);
    expect(sessionScale(config(), goal({ modelPreset: 'max', effort: 'max' }))).toBe(4.5);
    expect(sessionScale(config({ effort: 'xhigh' }), goal({ modelPreset: 'balanced' }))).toBe(1.5);
    expect(sessionScale(config({ effort: 'xhigh' }), goal({ modelPreset: 'balanced', effort: 'high' }))).toBe(1);
  });

  test('a number the goal was made with multiplies every cap as it is; Codex and Antigravity report no dollars and stay at ×1', () => {
    expect(sessionScale(config(), goal({ modelPreset: 'max', effort: 'max', sessionLimits: 1 }))).toBe(1);
    expect(sessionScale(config(), goal({ sessionLimits: 1.5 }))).toBe(1.5);
    expect(sessionScale(config(), goal({ provider: 'codex', sessionLimits: 3 }))).toBe(1);
    expect(sessionScale(config({ provider: 'agy' }), goal())).toBe(1);
    // a goal from before session limits has none: auto
    expect(sessionScale(config(), goal({ modelPreset: 'max' }))).toBe(3);
  });

  test('a cap is the base times the scale, to the cent, and stays within what the goal has left above its floor', () => {
    expect(sessionCap(config(), goal({ modelPreset: 'max', effort: 'xhigh' }), 0.8)).toBe(3.6);
    expect(sessionCap(config(), goal({ sessionLimits: 1 }), 10)).toBe(10);
    expect(capWithin(20, null, 0.05)).toBe(20);
    expect(capWithin(20, 7.5, 0.05)).toBe(7.5);
    expect(capWithin(20, 0, 6)).toBe(6);
  });
});

describe('a goal captures its session limits when it is made', () => {
  let dataDir = '';
  let repo = '';
  let engine: Engine | undefined;
  afterEach(async () => {
    await engine?.stop();
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
    rmSync(`${repo}-foundry`, { recursive: true, force: true });
  });
  test('Settings gives the default, the New goal form may set its own', async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'foundry-session-limits-'));
    repo = await makeRepo();
    engine = new Engine(defaultConfig(ROOT, { dataDir, claudeHome: join(dataDir, 'claude-home'), log: () => {} }), new FakeRunner(() => {}));
    const plain = await engine.createGoal({ prompt: 'a', repoPath: repo, interview: 'never' });
    expect(getGoal(engine.store.db, plain.id)!.sessionLimits).toBe('auto');
    engine.updateSettings({ sessions: { limitScale: 1.5 } });
    const fromSettings = await engine.createGoal({ prompt: 'b', repoPath: repo, interview: 'never' });
    expect(getGoal(engine.store.db, fromSettings.id)!.sessionLimits).toBe(1.5);
    const own = await engine.createGoal({ prompt: 'c', repoPath: repo, interview: 'never', sessionLimits: 3 });
    expect(getGoal(engine.store.db, own.id)!.sessionLimits).toBe(3);
  });
});
