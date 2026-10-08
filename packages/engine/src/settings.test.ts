import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { defaultConfig } from './config.ts';
import { Engine } from './engine.ts';
import { SECRET_SETTINGS } from '@foundry/core';
import { writeMmxConfig } from './mmx.ts';
import { SETTING_PATHS, SettingsStore, applySettingsToConfig, resolveSettings } from './settings.ts';
import { FakeRunner } from './test-helpers.ts';

const ROOT = resolve(import.meta.dir, '../../..');

describe('settings resolution', () => {
  test('file > env > default, with per-field source; invalid values fall back', () => {
    const r = resolveSettings({ sessions: { attemptMaxTurns: 42 }, workflow: { designPack: 'impeccable' } }, { FOUNDRY_ATTEMPT_MAX_TURNS: '99', FOUNDRY_MODEL_CHEAP: 'sonnet', FOUNDRY_PORT: 'not-a-number', FOUNDRY_AUTOSKILLS: '0' });
    expect(r.values.sessions.attemptMaxTurns).toBe(42);
    expect(r.meta['sessions.attemptMaxTurns']).toMatchObject({ source: 'file', env: 'FOUNDRY_ATTEMPT_MAX_TURNS', default: 150 });
    expect(r.values.models.cheap).toBe('sonnet');
    expect(r.meta['models.cheap']!.source).toBe('env');
    expect(r.values.engine.port).toBe(4111);
    expect(r.meta['engine.port']).toMatchObject({ source: 'default', restart: true });
    expect(r.values.workflow.autoskills).toBe(false);
    expect(r.values.workflow.designPack).toBe('impeccable');
    expect(r.meta['models.presetCode']!.source).toBe('default');
  });

  test('store persists only changed leaves, reports restartNeeded, resets per path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'foundry-settings-'));
    const s = new SettingsStore(dir, { FOUNDRY_PORT: '5000' });
    expect(s.view().fileExists).toBe(false);
    const u = s.update({ engine: { port: 6000, maxConcurrent: 5 }, models: { presetCode: 'economy' } });
    expect(u.changed.sort()).toEqual(['engine.maxConcurrent', 'engine.port', 'models.presetCode']);
    expect(u.view.restartNeeded).toEqual(['engine.port']);
    expect(JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'))).toEqual({ engine: { port: 6000, maxConcurrent: 5 }, models: { presetCode: 'economy' } });
    // same value again → nothing changed
    expect(s.update({ models: { presetCode: 'economy' } }).changed).toEqual([]);
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

  test('a section taken from another Foundry replaces what was saved here, except this computer\'s leaves and credentials', () => {
    const dir = mkdtempSync(join(tmpdir(), 'foundry-settings-'));
    const s = new SettingsStore(dir, {});
    s.update({ models: { cheap: 'haiku', presetDocs: 'economy' }, tools: { openaiApiKey: 'sk-here-0123456789', markitdownBin: '/here/markitdown', useGraphify: false }, delivery: { defaultMode: 'pr' } });
    const r = s.replaceSections({ models: { cheap: 'sonnet' }, tools: { useGraphify: true, openaiApiKey: 'sk-there-012345678', markitdownBin: '/there/m' }, delivery: { defaultMode: 'push' } }, ['models', 'tools']);
    expect(r.changed.sort()).toEqual(['models.cheap', 'models.presetDocs', 'tools.useGraphify']);
    expect(JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'))).toEqual({ models: { cheap: 'sonnet' }, tools: { useGraphify: true, openaiApiKey: 'sk-here-0123456789', markitdownBin: '/here/markitdown' }, delivery: { defaultMode: 'pr' } });
    expect(() => s.replaceSections({ models: { cheap: '' } }, ['models'])).toThrow();
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
    const v = engine.updateSettings({ engine: { maxConcurrent: 6, port: 4999 }, models: { cheap: 'sonnet' }, reviews: { maxFixCycles: 2 } });
    expect(engine.config.maxConcurrent).toBe(6);
    expect(runner.maxConcurrent).toBe(6);
    expect(engine.config.models.cheap).toBe('sonnet');
    expect(engine.config.maxFixCycles).toBe(2);
    expect(v.restartNeeded).toEqual(['engine.port']);
    expect(engine.config.port).toBe(4999); // persisted + applied to config; the listener only picks it up after a restart
    const ev = engine.store.listByType('settings.changed', 10);
    expect(ev.length).toBe(1);
    expect((ev[0]!.payload as any).keys.sort()).toEqual(['engine.maxConcurrent', 'engine.port', 'models.cheap', 'reviews.maxFixCycles']);
    expect(existsSync(join(dataDir, 'settings.json'))).toBe(true);
    engine.resetSettings('engine.port');
    expect(engine.settingsView().restartNeeded).toEqual([]);
  });

  test('API keys reach sessions via sessionEnvExtra (Kimi under both conventional names)', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'foundry-settings-keys-'));
    const engine = new Engine(defaultConfig(ROOT, { dataDir, claudeHome: join(dataDir, 'ch'), log: () => {} }), new FakeRunner(() => {}));
    expect(engine.sessionEnvExtra()).toEqual({});
    engine.updateSettings({ tools: { openaiApiKey: 'sk-o', kimiApiKey: 'sk-k', geminiApiKey: 'g-1' } });
    expect(engine.sessionEnvExtra()).toEqual({ OPENAI_API_KEY: 'sk-o', MOONSHOT_API_KEY: 'sk-k', KIMI_API_KEY: 'sk-k', GEMINI_API_KEY: 'g-1' });
    engine.updateSettings({ tools: { kimiApiKey: null, geminiApiKey: null } });
    expect(engine.sessionEnvExtra()).toEqual({ OPENAI_API_KEY: 'sk-o' });
    engine.updateSettings({ tools: { elevenlabsApiKey: 'el-1', groqApiKey: 'gsk-1' } });
    expect(engine.sessionEnvExtra()).toEqual({ OPENAI_API_KEY: 'sk-o', ELEVENLABS_API_KEY: 'el-1', GROQ_API_KEY: 'gsk-1' });
  });

  test('a MiniMax key is written where mmx reads it, and removed with the setting', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'foundry-settings-mmx-'));
    const engine = new Engine(defaultConfig(ROOT, { dataDir, claudeHome: join(dataDir, 'ch'), log: () => {} }), new FakeRunner(() => {}));
    const file = join(dataDir, 'mmx', 'config.json');
    const saved = process.env.MINIMAX_API_KEY;
    delete process.env.MINIMAX_API_KEY;
    try {
      engine.updateSettings({ tools: { minimaxApiKey: 'sk-cp-1' } });
      expect(engine.sessionEnvExtra()).toEqual({ MINIMAX_API_KEY: 'sk-cp-1', MMX_CONFIG_DIR: join(dataDir, 'mmx') });
      expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ api_key: 'sk-cp-1' });
      expect(statSync(file).mode & 0o777).toBe(0o600);
      engine.updateSettings({ tools: { minimaxApiKey: null } });
      expect(engine.sessionEnvExtra()).toEqual({});
      expect(existsSync(file)).toBe(false);
    } finally {
      if (saved !== undefined) process.env.MINIMAX_API_KEY = saved;
    }
  });

  test('the settings view never carries a saved credential, only whether it is set and a masked hint', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'foundry-settings-secrets-'));
    const engine = new Engine(defaultConfig(ROOT, { dataDir, claudeHome: join(dataDir, 'ch'), log: () => {} }), new FakeRunner(() => {}));
    const v = engine.updateSettings({ tools: { openaiApiKey: 'sk-proj-abcdefghijklmnop1234', kimiApiKey: 'short' }, notifications: { discordWebhookUrl: 'https://discord.com/api/webhooks/1/secret-part' } });
    const json = JSON.stringify(v);
    for (const s of ['sk-proj-abcdefghijklmnop1234', 'short', 'secret-part']) expect(json).not.toContain(s);
    expect(v.values.tools.openaiApiKey).toBeNull();
    expect(v.secrets['tools.openaiApiKey']).toEqual({ set: true, hint: 'sk-p…1234' });
    expect(v.secrets['tools.kimiApiKey']).toEqual({ set: true, hint: '••••' });
    expect(v.secrets['tools.geminiApiKey']).toEqual({ set: false, hint: null });
    expect(JSON.stringify(engine.settingsView())).not.toContain('sk-proj-abcdefghijklmnop1234');
    // the engine itself still has them
    expect(engine.sessionEnvExtra().OPENAI_API_KEY).toBe('sk-proj-abcdefghijklmnop1234');
    // an unrelated save leaves a saved key alone
    engine.updateSettings({ engine: { maxConcurrent: 2 } });
    expect(engine.sessionEnvExtra().OPENAI_API_KEY).toBe('sk-proj-abcdefghijklmnop1234');
  });

  test('every setting that looks like a credential is listed as secret', () => {
    const looksSecret = SETTING_PATHS.filter((p) => /(ApiKey|Token|Secret|Password|WebhookUrl)$/.test(p));
    expect(looksSecret.filter((p) => !(SECRET_SETTINGS as readonly string[]).includes(p))).toEqual([]);
  });

  test('settings.json, which holds the keys, is readable by its owner only', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'foundry-settings-mode-'));
    const engine = new Engine(defaultConfig(ROOT, { dataDir, claudeHome: join(dataDir, 'ch'), log: () => {} }), new FakeRunner(() => {}));
    engine.updateSettings({ tools: { openaiApiKey: 'sk-1' } });
    expect(statSync(join(dataDir, 'settings.json')).mode & 0o777).toBe(0o600);
  });

  test('the mmx config keeps the region mmx saved while the key stays, and a new key carries over only the user\'s own non-secret settings', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'foundry-mmx-keep-'));
    const own = mkdtempSync(join(tmpdir(), 'foundry-mmx-own-'));
    writeFileSync(join(own, 'config.json'), JSON.stringify({ api_key: 'sk-theirs', proxy: 'http://proxy:8080', default_video_model: 'hailuo', oauth: { t: 1 } }));
    const file = join(dataDir, 'mmx', 'config.json');
    expect(writeMmxConfig(dataDir, 'sk-cp-1', () => {}, own)).toBe(true);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ proxy: 'http://proxy:8080', default_video_model: 'hailuo', api_key: 'sk-cp-1' });
    // mmx detects the region and saves it: the same key must not wipe it
    writeFileSync(file, JSON.stringify({ api_key: 'sk-cp-1', region: 'cn' }));
    expect(writeMmxConfig(dataDir, 'sk-cp-1', () => {}, own)).toBe(true);
    expect(JSON.parse(readFileSync(file, 'utf8')).region).toBe('cn');
    expect(writeMmxConfig(dataDir, 'sk-cp-2', () => {}, own)).toBe(true);
    expect(JSON.parse(readFileSync(file, 'utf8')).region).toBeUndefined();
  });

  test('sessions are only pointed at the mmx config when it could be written', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'foundry-mmx-fail-'));
    writeFileSync(join(dataDir, 'mmx'), 'a file where the directory should be');
    const saved = process.env.MINIMAX_API_KEY;
    delete process.env.MINIMAX_API_KEY;
    try {
      const engine = new Engine(defaultConfig(ROOT, { dataDir, claudeHome: join(dataDir, 'ch'), log: () => {} }), new FakeRunner(() => {}));
      engine.updateSettings({ tools: { minimaxApiKey: 'sk-cp-1' } });
      expect(engine.sessionEnvExtra()).toEqual({ MINIMAX_API_KEY: 'sk-cp-1' });
    } finally {
      if (saved !== undefined) process.env.MINIMAX_API_KEY = saved;
    }
  });

  test('an empty variable in the engine\'s environment does not hide a key from Settings', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'foundry-empty-env-'));
    const saved = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = '';
    try {
      const engine = new Engine(defaultConfig(ROOT, { dataDir, claudeHome: join(dataDir, 'ch'), log: () => {} }), new FakeRunner(() => {}));
      engine.updateSettings({ tools: { openaiApiKey: 'sk-o', geminiApiKey: null } });
      expect(engine.imageGenAvailable()).toBe(true);
    } finally {
      if (saved === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = saved;
    }
  });
});
