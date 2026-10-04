import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { defaultConfig } from './config.ts';
import { Engine } from './engine.ts';
import { FakeRunner } from './test-helpers.ts';
import { modelFor, workerModelFor } from './models/roles.ts';
import { resolveSettings } from './settings.ts';
import { codexAuthStatus } from './auth/claude-auth.ts';
import { runDoctor } from './skills/doctor.ts';
import { skillsPaths } from './skills/paths.ts';
import { scanSkills } from './skills/scanner.ts';

const ROOT = resolve(import.meta.dir, '../../..');
const dirs: string[] = [];
const temp = () => { const d = mkdtempSync(join(tmpdir(), 'foundry-codex-engine-')); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe('Codex engine integration', () => {
  test('settings and role routing never pass Claude aliases to Codex', () => {
    const resolved = resolveSettings({ models: { codexModel: 'my-codex-model' } }, { FOUNDRY_PROVIDER: 'codex', FOUNDRY_CODEX_MODEL: 'env-model' });
    expect(resolved.values.engine.provider).toBe('codex');
    expect(resolved.values.models.codexModel).toBe('my-codex-model');
    const cfg = defaultConfig(ROOT, { provider: 'codex', codexModel: 'my-codex-model' });
    const goal = { nature: 'code' as const, modelPreset: 'production' };
    expect(modelFor(cfg, goal, 'clarifier').model).toBe('my-codex-model');
    expect(workerModelFor(cfg, goal, { difficulty: 'complex', retryBudget: 2 }, 2).model).toBe('my-codex-model');
    expect(modelFor({ ...cfg, provider: 'claude' }, goal, 'clarifier').model).toBe('fable');
  });
  test('engine keeps its backend until restart and refuses incompatible session databases', async () => {
    const dataDir = temp();
    const cfg = defaultConfig(ROOT, { provider: 'codex', dataDir, codexHome: join(dataDir, 'home'), log: () => {} });
    const runner = new FakeRunner(() => {});
    const engine = new Engine(cfg, runner);
    try {
      expect(engine.config.models.cheap).toBe('codex-default');
      expect(engine.modelsInUse().has('haiku')).toBe(false);
      await engine.syncModels({ probe: false });
      expect(runner.calls).toHaveLength(0);
      expect(engine.usage().note).toContain('cannot be enforced');
      expect(() => engine.updateSettings({ engine: { provider: 'claude' } })).toThrow('separate');
      engine.updateSettings({ engine: { codexBin: '/different' } });
      expect(engine.config.provider).toBe('codex');
      expect(engine.config.codexBin).not.toBe('/different');
      expect(readFileSync(join(dataDir, 'provider'), 'utf8')).toBe('codex');
      expect(() => new Engine(defaultConfig(ROOT, { dataDir, provider: 'claude', log: () => {} }), runner)).toThrow('separate directory');
    } finally { await engine.stop(); }
  });
  test('auth checks stderr and home, rejects API-key login without exposing key fragments', async () => {
    let invocation: any;
    const run = async (args: string[], cwd: string, opts: any) => { invocation = { args, opts }; return { code: 0, stdout: '', stderr: 'Logged in using ChatGPT' }; };
    expect((await codexAuthStatus('/bin/codex', run, '/test/home')).loggedIn).toBe(true);
    expect(invocation).toMatchObject({ args: ['/bin/codex', 'login', 'status'], opts: { env: { CODEX_HOME: '/test/home' } } });
    const key = await codexAuthStatus('/bin/codex', async () => ({ code: 0, stdout: '', stderr: 'Logged in using an API key - sk-secret' }));
    expect(key.loggedIn).toBe(false);
    expect(JSON.stringify(key)).not.toContain('sk-secret');
  });
  test('doctor checks Codex alone and scans shared skills without treating them as removable copies', async () => {
    const home = temp(); const paths = skillsPaths(join(home, '.codex'), join(home, 'data'), 'codex', home);
    mkdirSync(join(home, '.agents/skills/example'), { recursive: true });
    writeFileSync(join(home, '.agents/skills/example/SKILL.md'), '---\nname: example\ndescription: shared skill\n---\n');
    const scan = scanSkills(paths);
    expect(scan.installed[0]).toMatchObject({ name: 'example', canUninstall: false });
    const calls: string[][] = [];
    const report = await runDoctor({ provider: 'codex', paths, catalog: { version: 1, entries: [] }, statuses: [], which: (name) => `/bin/${name}`, exec: async (args) => { calls.push(args); return { code: 0, stdout: args.includes('--version') ? 'codex-cli 0.160.0' : '', stderr: args.includes('status') ? 'Logged in using ChatGPT' : '' }; } });
    expect(calls.some((args) => args.some((arg) => arg.includes('claude')))).toBe(false);
    expect(report.checks.find((check) => check.id === 'codex-auth')?.ok).toBe(true);
    expect(report.checks.find((check) => check.id === 'codex-cost')?.severity).toBe('warn');
  });
});
