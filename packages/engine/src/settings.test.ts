import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { defaultConfig } from './config.ts';
import { Engine } from './engine.ts';
import { SettingsStore, applySettingsToConfig, resolveSettings } from './settings.ts';
import { FakeRunner } from './test-helpers.ts';

const ROOT = resolve(import.meta.dir, '../../..');

describe('settings resolution', () => {
  test('file > env > default, with per-field source; invalid values fall back', () => {
    const r = resolveSettings({ sessions: { attemptMaxTurns: 42 }, workflow: { designPack: 'impeccable' } }, { FOUNDRY_ATTEMPT_MAX_TURNS: '99', FOUNDRY_MODEL_STRONG: 'sonnet', FOUNDRY_PORT: 'not-a-number', FOUNDRY_AUTOSKILLS: '0' });
    expect(r.values.sessions.attemptMaxTurns).toBe(42);
    expect(r.meta['sessions.attemptMaxTurns']).toMatchObject({ source: 'file', env: 'FOUNDRY_ATTEMPT_MAX_TURNS', default: 150 });
    expect(r.values.models.strong).toBe('sonnet');
    expect(r.meta['models.strong']!.source).toBe('env');
    expect(r.values.engine.port).toBe(4111);
    expect(r.meta['engine.port']).toMatchObject({ source: 'default', restart: true });
    expect(r.values.workflow.autoskills).toBe(false);
    expect(r.values.workflow.designPack).toBe('impeccable');
    expect(r.meta['models.cheap']!.source).toBe('default');
  });

  test('store persists only changed leaves, reports restartNeeded, resets per path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'foundry-settings-'));
    const s = new SettingsStore(dir, { FOUNDRY_PORT: '5000' });
    expect(s.view().fileExists).toBe(false);
    const u = s.update({ engine: { port: 6000, maxConcurrent: 5 }, models: { worker: 'sonnet' } });
    expect(u.changed.sort()).toEqual(['engine.maxConcurrent', 'engine.port', 'models.worker']);
    expect(u.view.restartNeeded).toEqual(['engine.port']);
    expect(JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'))).toEqual({ engine: { port: 6000, maxConcurrent: 5 }, models: { worker: 'sonnet' } });
    // same value again → nothing changed
    expect(s.update({ models: { worker: 'sonnet' } }).changed).toEqual([]);
    const r = s.reset('engine.port');
    expect(r.changed).toEqual(['engine.port']);
    expect(r.view.values.engine.port).toBe(5000);
    expect(r.view.meta['engine.port']!.source).toBe('env');
    expect(r.view.restartNeeded).toEqual([]);
    expect(() => s.update({ engine: { maxConcurrent: 0 } })).toThrow();
    // a fresh store reads the file back and treats it as the boot baseline
    const s2 = new SettingsStore(dir, { FOUNDRY_PORT: '5000' });
    expect(s2.values().engine.maxConcurrent).toBe(5);
    expect(s2.restartNeeded()).toEqual([]);
    s2.reset();
    expect(JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'))).toEqual({});
  });

  test('applySettingsToConfig maps leaves onto the engine config (only the requested ones)', () => {
    const cfg = defaultConfig(ROOT, { log: () => {} });
    const { values } = resolveSettings({ sessions: { attemptTimeoutMin: 7 }, delivery: { defaultMode: 'pr', pollSec: 5 }, safety: { allowedRoots: ['/tmp'] } }, {});
    applySettingsToConfig(cfg, values, new Set(['sessions.attemptTimeoutMin', 'delivery.defaultMode', 'delivery.pollSec', 'safety.allowedRoots']));
    expect(cfg.attemptTimeoutMs).toBe(7 * 60_000);
    expect(cfg.defaultDelivery).toMatchObject({ mode: 'pr', unit: 'task' });
    expect(cfg.delivery.pollMs).toBe(5000);
    expect(cfg.allowedRoots).toEqual(['/tmp']);
    expect(cfg.attemptMaxTurns).toBe(150); // untouched
  });
});

describe('engine + settings', () => {
  test('file settings override env at boot; runtime updates hot-apply and are audited', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'foundry-settings-engine-'));
    writeFileSync(join(dataDir, 'settings.json'), JSON.stringify({ engine: { maxConcurrent: 4 }, workflow: { designPack: 'bencium', autoskills: false } }));
    const runner = new FakeRunner(() => {});
    const engine = new Engine(defaultConfig(ROOT, { dataDir, claudeHome: join(dataDir, 'ch'), log: () => {}, maxConcurrent: 2 }), runner);
    // file wins over the code override for leaves present in the file; absent leaves keep the config value
    expect(engine.config.maxConcurrent).toBe(4);
    expect(engine.config.designPack).toBe('bencium');
    expect(engine.config.autoskills).toBe(false);
    expect(engine.config.alwaysReviewTasks).toBe(true);
    const v = engine.updateSettings({ engine: { maxConcurrent: 6, port: 4999 }, models: { strong: 'sonnet' }, reviews: { maxFixCycles: 2 } });
    expect(engine.config.maxConcurrent).toBe(6);
    expect(runner.maxConcurrent).toBe(6);
    expect(engine.config.models.strong).toBe('sonnet');
    expect(engine.config.maxFixCycles).toBe(2);
    expect(v.restartNeeded).toEqual(['engine.port']);
    expect(engine.config.port).toBe(4999); // persisted + applied to config; the listener only picks it up after a restart
    const ev = engine.store.listByType('settings.changed', 10);
    expect(ev.length).toBe(1);
    expect((ev[0]!.payload as any).keys.sort()).toEqual(['engine.maxConcurrent', 'engine.port', 'models.strong', 'reviews.maxFixCycles']);
    expect(existsSync(join(dataDir, 'settings.json'))).toBe(true);
    engine.resetSettings('engine.port');
    expect(engine.settingsView().restartNeeded).toEqual([]);
  });
});
