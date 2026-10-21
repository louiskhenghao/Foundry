import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeFakeHome, skillMd } from './fake-home.test-helper.ts';
import { SkillsManager } from './manager.ts';
import { scanSkills } from './scanner.ts';
import { installSuite, linkSuiteSkills, readSuite, suiteDirs } from './suites.ts';

const fake = makeFakeHome();
let upstream: string;
let catalogPath: string;
const g = (args: string, cwd: string) => Bun.$`sh -c ${`cd ${cwd} && git -c user.name=t -c user.email=t@t ${args}`}`.quiet();
const suiteDef = (ref: string) => ({ id: 'pstack', label: 'pstack', summary: '', repo: 'acme/pstack', url: `file://${upstream}`, ref, path: 'plugins/pstack', homepage: 'https://example.com/pstack' });
const writeCatalogAt = (ref: string) => {
  mkdirSync(join(fake.home, 'cat'), { recursive: true });
  const p = join(fake.home, 'cat', 'skills.json');
  const entries = [
    { id: 'pstack-tdd', name: 'tdd', summary: '', why: '', tier: 'recommended', source: { type: 'suite', suite: 'pstack' }, roles: ['worker'], bundle: 'pstack', workflow: [{ role: 'worker', mandate: 'must', when: 'bug', suite: 'pstack', instruction: 'test first' }] },
    { id: 'pstack-sharpen', name: 'sharpen', summary: '', why: '', tier: 'recommended', source: { type: 'suite', suite: 'pstack' }, roles: ['clarifier'], bundle: 'pstack' },
    { id: 'tdd', name: 'tdd', summary: '', why: '', tier: 'recommended', source: { type: 'git', repo: 'mattpocock/skills' }, roles: ['worker'], workflow: [{ role: 'worker', mandate: 'must', when: 'feature', instruction: 'tests first' }] },
  ];
  writeFileSync(p, JSON.stringify({ version: 1, suites: [suiteDef(ref)], entries }));
  return p;
};

beforeAll(async () => {
  upstream = join(fake.home, 'pstack-upstream');
  const plugin = join(upstream, 'plugins', 'pstack');
  mkdirSync(join(plugin, '.claude-plugin'), { recursive: true });
  mkdirSync(join(plugin, 'hooks'), { recursive: true });
  for (const s of ['tdd', 'sharpen']) {
    mkdirSync(join(plugin, 'skills', s), { recursive: true });
    writeFileSync(join(plugin, 'skills', s, 'SKILL.md'), skillMd(s, `pstack ${s} v1`));
  }
  writeFileSync(join(plugin, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'pstack', version: '1.0.0' }));
  writeFileSync(join(plugin, 'hooks', 'hooks.json'), JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'echo route' }] }] } }));
  await g('init -q -b main', upstream);
  await g('add -A', upstream);
  await g('commit -q -m v1', upstream);
  await g('tag v1', upstream);
  writeFileSync(join(plugin, 'skills', 'tdd', 'SKILL.md'), skillMd('tdd', 'pstack tdd v2'));
  await g('commit -q -am v2', upstream);
  await g('tag v2', upstream);
  catalogPath = writeCatalogAt('v1');
});
afterAll(() => rmSync(fake.home, { recursive: true, force: true }));

describe('workflow suites (ADR-0049)', () => {
  // these two clone, install and re-sync a real repository: more than the default 5 s on a busy machine
  test('installing one of its skills installs the suite: a hook-less copy at the pinned release, rows under its prefix', async () => {
    const m = new SkillsManager({ claudeHome: fake.claudeHome, dataDir: fake.dataDir, catalogPath, which: () => null });
    const r = await m.install('pstack-tdd');
    expect(r.ok).toBe(true);
    const { plugin } = suiteDirs(fake.paths, 'pstack');
    expect(r.path).toBe(plugin);
    expect(existsSync(join(plugin, 'skills', 'tdd', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(plugin, '.claude-plugin', 'plugin.json'))).toBe(true);
    // the plugin's hooks never reach a Foundry session
    expect(existsSync(join(plugin, 'hooks'))).toBe(false);
    expect(readFileSync(join(plugin, 'skills', 'tdd', 'SKILL.md'), 'utf8')).toContain('v1');
    expect(readSuite(fake.paths, 'pstack')).toMatchObject({ id: 'pstack', ref: 'v1', repo: 'acme/pstack', skills: ['sharpen', 'tdd'] });

    const scan = scanSkills(fake.paths);
    const row = scan.installed.find((x) => x.name === 'pstack:tdd')!;
    expect(row).toMatchObject({ scope: 'plugin', invoke: '/pstack:tdd', managedBy: 'foundry', canUninstall: false, plugin: { id: 'suite:pstack', version: 'v1', skillPath: 'skills/tdd' } });
    // the home's bare-named copies of tdd are not duplicates of the suite's, and the suite's is not theirs
    expect(row.duplicateOf).toEqual([]);
    expect(scan.suites.map((x) => x.id)).toEqual(['pstack']);
    // Codex finds a suite skill as a linked folder, not a slash command
    expect(scanSkills({ ...fake.paths, provider: 'codex' }).installed.find((x) => x.name === 'pstack:tdd')!.invoke).toBe('pstack-tdd');

    const st = await m.status();
    const by = (id: string) => st.find((x) => x.entry.id === id)!;
    expect(by('pstack-tdd')).toMatchObject({ status: 'installed', installedInvoke: '/pstack:tdd' });
    expect(by('pstack-sharpen').status).toBe('installed');
    // Matt Pocock's tdd is still resolved to its own copy
    expect(by('tdd').installedInvoke).not.toBe('/pstack:tdd');

    // the same copy serves every member; a second install at the same pin changes nothing
    expect(await m.install('pstack-sharpen')).toMatchObject({ ok: true, path: plugin });
  }, 30_000);

  test('the Extensions page sees one source at the pin; moving the pin marks it outdated and Update re-syncs', async () => {
    const m = new SkillsManager({ claudeHome: fake.claudeHome, dataDir: fake.dataDir, catalogPath, which: () => null });
    const report = await m.updates({ offline: true });
    const src = report.sources.find((s) => s.id === 'suite:pstack')!;
    expect(src).toMatchObject({ kind: 'suite', manager: 'foundry', updater: { kind: 'suite' } });
    expect(src.skills.map((k) => [k.name, k.status, k.actions])).toEqual([
      ['pstack:sharpen', 'up-to-date', []],
      ['pstack:tdd', 'up-to-date', []],
    ]);

    // a Foundry release moves the pin: the copy is behind it until re-synced
    writeCatalogAt('v2');
    m.reloadCatalog();
    const behind = await m.updates({ offline: true });
    expect(behind.sources.find((s) => s.id === 'suite:pstack')!.skills.every((k) => k.status === 'outdated' && k.actions.includes('update'))).toBe(true);
    const run = await m.updateSource('suite:pstack');
    expect(run.error).toBeNull();
    expect(run.changed.length).toBe(1);
    const { plugin } = suiteDirs(fake.paths, 'pstack');
    expect(readFileSync(join(plugin, 'skills', 'tdd', 'SKILL.md'), 'utf8')).toContain('v2');
    expect(readSuite(fake.paths, 'pstack')!.ref).toBe('v2');
    expect(existsSync(join(plugin, 'hooks'))).toBe(false);
  }, 30_000);

  test('a re-sync at the pin keeps the pinned release while upstream moves on', async () => {
    // the pin is v1 again; main is at v2
    writeCatalogAt('v1');
    const r = await installSuite(suiteDef('v1'), { paths: fake.paths }, { refresh: true });
    expect(r.changed).toBe(true);
    const { plugin } = suiteDirs(fake.paths, 'pstack');
    expect(readFileSync(join(plugin, 'skills', 'tdd', 'SKILL.md'), 'utf8')).toContain('v1');
    expect((await installSuite(suiteDef('v1'), { paths: fake.paths }, { refresh: true })).changed).toBe(false);
  });

  test('Codex: the suite skills a workspace needs are linked under its prefix and kept out of git', async () => {
    const ws = join(fake.home, 'ws');
    mkdirSync(ws, { recursive: true });
    await g('init -q -b main', ws);
    const s = readSuite(fake.paths, 'pstack')!;
    expect(await linkSuiteSkills(ws, s, ['tdd', 'nope'])).toEqual(['pstack-tdd']);
    const link = join(ws, '.agents', 'skills', 'pstack-tdd');
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(existsSync(join(link, 'SKILL.md'))).toBe(true);
    expect(readFileSync(join(ws, '.git', 'info', 'exclude'), 'utf8')).toContain('.agents/skills/pstack-tdd');
    // idempotent
    expect(await linkSuiteSkills(ws, s, ['tdd'])).toEqual(['pstack-tdd']);
  });
});
