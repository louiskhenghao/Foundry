import { afterEach, describe, expect, test } from 'bun:test';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { getGoal } from '@foundry/core';
import { agentCliInstall } from './agent-cli.ts';
import { agyAuthStatus } from './auth/agy-auth.ts';
import { defaultConfig } from './config.ts';
import { Engine } from './engine.ts';
import { modelFor, tableFor } from './models/roles.ts';
import { AGY_SEED_MODELS, parseAgyModels } from './models/registry.ts';
import { fireSchedule } from './schedules.ts';
import { runDoctor } from './skills/doctor.ts';
import { catalogStatus, loadCatalog } from './skills/catalog.ts';
import { makeFakeHome, writeCatalog } from './skills/fake-home.test-helper.ts';
import { scanSkills } from './skills/scanner.ts';
import { FakeRunner, makeRepo } from './test-helpers.ts';

const ROOT = resolve(import.meta.dir, '../../..');
const dirs: string[] = [];
const engines: Engine[] = [];
afterEach(async () => {
  for (const e of engines.splice(0)) await e.stop();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('Antigravity as a coding agent (ADR-0064)', () => {
  test('a goal on it keeps one model for every role, no dollar budget, and its sessions go to its own runner', async () => {
    const repo = await makeRepo();
    dirs.push(repo);
    const dataDir = mkdtempSync(join(tmpdir(), 'foundry-agy-'));
    dirs.push(dataDir);
    const claude = new FakeRunner(() => {});
    const agy = new FakeRunner(() => {});
    const config = defaultConfig(ROOT, { provider: 'claude', dataDir, agyModel: 'gemini-3.8-flash-high', log: () => {}, useGraphify: false });
    const engine = new Engine(config, { claude, agy });
    engines.push(engine);
    const g = await engine.createGoal({ prompt: 'an Antigravity task', repoPath: repo, provider: 'agy', budgets: { maxCostUsd: 3 } });
    expect(g.provider).toBe('agy');
    expect(g.budgets.maxCostUsd).toBeNull();
    expect(g.models).toEqual({ strong: 'gemini-3.8-flash-high', cheap: 'gemini-3.8-flash-high', worker: 'gemini-3.8-flash-high' });
    expect(modelFor(config, g, 'clarifier').model).toBe('gemini-3.8-flash-high');
    const pinned = await engine.createGoal({ prompt: 'pinned', repoPath: repo, provider: 'agy', agyModel: 'claude-sonnet-4-6' });
    expect(tableFor(config, pinned).table.simple).toBe('claude-sonnet-4-6');
    const handle = await engine.runner.run({ prompt: 'test', cwd: repo, model: g.models.cheap, meta: { goalId: g.id }, resumeSessionId: 'agy-session' });
    for await (const _ of handle.events) {}
    await handle.result;
    expect(agy.calls.map((c) => c.resumeSessionId)).toEqual(['agy-session']);
    expect(claude.calls).toHaveLength(0);
    // the settings default moves on; the goal keeps its snapshot
    engine.updateSettings({ models: { agyModel: 'gemini-3.1-pro-high' } });
    expect(getGoal(engine.store.db, g.id)?.models.worker).toBe('gemini-3.8-flash-high');
    expect(engine.usage('agy').costAvailable).toBe(false);
    expect(engine.usage('agy').note).toContain('Antigravity reports tokens');
    expect(engine.listModels('agy').map((m) => m.name)).toEqual(expect.arrayContaining(AGY_SEED_MODELS.map((m) => m.name)));
    expect(engine.mcpAllowedFor(g)).toEqual([]);
    await expect(engine.createGoal({ prompt: 'x', repoPath: repo, provider: 'agy', models: { worker: 'opus' } })).rejects.toThrow('Antigravity uses its own model settings');
    await expect(engine.createGoal({ prompt: 'x', repoPath: repo, provider: 'agy', modelPreset: 'production' })).rejects.toThrow('no presets');
  });

  test('a pinned Antigravity model carries over to a follow-up and to a scheduled run', async () => {
    const repo = await makeRepo();
    dirs.push(repo);
    const dataDir = mkdtempSync(join(tmpdir(), 'foundry-agy-'));
    dirs.push(dataDir);
    const engine = new Engine(defaultConfig(ROOT, { provider: 'claude', dataDir, agyModel: 'gemini-3.8-flash-high', log: () => {}, useGraphify: false }), { claude: new FakeRunner(() => {}), agy: new FakeRunner(() => {}) });
    engines.push(engine);
    const plain = await engine.createGoal({ prompt: 'on the Settings model', repoPath: repo, provider: 'agy' });
    const pinned = await engine.createGoal({ prompt: 'pinned', repoPath: repo, provider: 'agy', agyModel: 'claude-sonnet-4-6' });
    // the Settings model is not pinned on a follow-up: it follows Settings, as the goal did
    expect((await engine.followUpDraft(plain.id)).prefill.agyModel).toBeUndefined();
    expect((await engine.followUpDraft(pinned.id)).prefill.agyModel).toBe('claude-sonnet-4-6');
    const s = engine.saveSchedule({ name: 'Nightly', cadence: { kind: 'daily', at: '03:00' }, recipe: { provider: 'agy', agyModel: 'claude-sonnet-4-6', prompt: 'nightly check', repoPath: repo, links: [] } });
    expect(s.recipe.agyModel).toBe('claude-sonnet-4-6');
    const { goalId } = await fireSchedule(engine, s, { manual: true });
    expect(getGoal(engine.store.db, goalId!)!.models.worker).toBe('claude-sonnet-4-6');
  });

  test('FOUNDRY_PROVIDER=agy selects it with its own data directory, and the models listing parses both of agy models formats', () => {
    const before = process.env.FOUNDRY_PROVIDER;
    process.env.FOUNDRY_PROVIDER = 'agy';
    try {
      const c = defaultConfig(ROOT);
      expect(c.provider).toBe('agy');
      expect(c.dataDir).toBe(resolve(ROOT, 'data-agy'));
      expect(c.agyModel).toBe('agy-default');
    } finally {
      if (before === undefined) delete process.env.FOUNDRY_PROVIDER;
      else process.env.FOUNDRY_PROVIDER = before;
    }
    // what agy 1.4.4 prints: one `slug<TAB>label` line each
    expect(parseAgyModels('gemini-3.8-flash-high\tGemini 3.8 Flash (High)\nclaude-sonnet-4-6\tClaude Sonnet 4.6 (Thinking)\ngpt-oss-120b-medium\tGPT-OSS 120B (Medium)\n')).toEqual([
      { id: 'gemini-3.8-flash-high', label: 'Gemini 3.8 Flash (High)' },
      { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 (Thinking)' },
      { id: 'gpt-oss-120b-medium', label: 'GPT-OSS 120B (Medium)' },
    ]);
    // a table spaced instead of tabbed reads the same
    expect(parseAgyModels('gemini-3.8-flash-medium   Gemini 3.8 Flash (Medium)\n')).toEqual([{ id: 'gemini-3.8-flash-medium', label: 'Gemini 3.8 Flash (Medium)' }]);
    expect(parseAgyModels(JSON.stringify({ models: [{ slug: 'gemini-3.1-pro-high', displayName: 'Gemini 3.1 Pro (High)' }, 'gemini-3.6-flash-high'] }))).toEqual([
      { id: 'gemini-3.1-pro-high', label: 'Gemini 3.1 Pro (High)' },
      { id: 'gemini-3.6-flash-high', label: null },
    ]);
    expect(parseAgyModels('')).toEqual([]);
  });

  test('the sign-in status comes from a read-only /usage run; an authentication error means signed out', async () => {
    const ok = await agyAuthStatus('/bin/agy', async () => ({ code: 0, stdout: JSON.stringify({ conversation_id: '', status: 'SUCCESS', response: 'ok', structured_output: { email: 'dev@example.com', plan: 'AI Pro' } }), stderr: '' }));
    expect(ok).toMatchObject({ provider: 'agy', loggedIn: true, email: 'dev@example.com', subscriptionType: 'AI Pro', error: null });
    const out = await agyAuthStatus('/bin/agy', async () => ({ code: 1, stdout: '', stderr: 'error: authentication required\n' }));
    expect(out).toMatchObject({ loggedIn: false, error: 'not signed in' });
    const failed = await agyAuthStatus('/bin/agy', async () => ({ code: 0, stdout: JSON.stringify({ status: 'ERROR', error: 'model down' }), stderr: '' }));
    expect(failed).toMatchObject({ loggedIn: false, error: 'model down' });
    expect(await agyAuthStatus(null)).toMatchObject({ loggedIn: false, error: 'agy not installed' });
  });

  test('Doctor checks the CLI and the sign-in for an Antigravity profile; Setup knows how to install it', async () => {
    const fake = makeFakeHome();
    dirs.push(fake.home);
    const bins = join(fake.home, 'bin');
    mkdirSync(bins, { recursive: true });
    const agy = join(bins, 'agy');
    writeFileSync(agy, `#!/bin/sh\ncase "$1" in --version) echo "agy 1.4.3";; -p) echo '{"status":"SUCCESS","response":"usage","structured_output":{"email":"dev@example.com"}}';; esac\n`);
    chmodSync(agy, 0o755);
    const catalogPath = writeCatalog(join(fake.home, 'cat'), []);
    const catalog = loadCatalog(catalogPath);
    const which = (b: string) => (b === 'git' ? '/usr/bin/git' : b === 'bun' ? '/usr/local/bin/bun' : null);
    const statuses = catalogStatus(catalog, scanSkills(fake.paths), fake.paths, which);
    const r = await runDoctor({ provider: 'agy', agyBin: agy, paths: fake.paths, catalog, statuses, which, runtimeVersion: '1.4.3' });
    const by = (id: string) => r.checks.find((c) => c.id === id)!;
    expect(by('agy-bin')).toMatchObject({ ok: true, detail: 'agy 1.4.3' });
    expect(by('agy-auth')).toMatchObject({ ok: true, detail: 'signed in as dev@example.com' });
    expect(by('agy-config').ok).toBe(true);
    expect(r.checks.some((c) => c.id === 'claude-bin' || c.id === 'codex-bin')).toBe(false);
    const missing = await runDoctor({ provider: 'agy', paths: fake.paths, catalog, statuses, which, runtimeVersion: '1.4.3' });
    expect(missing.checks.find((c) => c.id === 'agy-bin')).toMatchObject({ ok: false, fix: { url: 'https://antigravity.google/docs/cli' } });
    expect(agentCliInstall('agy', (b) => (b === 'brew' ? '/opt/homebrew/bin/brew' : null), 'darwin', 'arm64')).toEqual({ id: 'antigravity-cli', command: 'brew install --cask antigravity-cli' });
    expect(agentCliInstall('agy', (b) => (b === 'curl' ? '/usr/bin/curl' : null), 'linux', 'x64')).toEqual({ id: 'antigravity-cli', command: 'curl -fsSL https://antigravity.google/cli/install.sh | bash' });
    expect(agentCliInstall('agy', () => null, 'linux', 'x64')).toBeNull();
  });
});
