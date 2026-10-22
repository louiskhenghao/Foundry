import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { catalogStatus, loadCatalog } from './catalog.ts';
import { skillMd } from './fake-home.test-helper.ts';
import { SkillsManager } from './manager.ts';
import { skillsPaths } from './paths.ts';
import { scanSkills } from './scanner.ts';

/**
 * Another tool installs its `retro` as a folder whose SKILL.md links into the tool's own tree, beside a plugin that
 * ships a different `retro` and a catalog entry of that plugin's repository. The name is shared; the skills are not.
 */
const home = mkdtempSync(join(tmpdir(), 'foundry-linked-'));
const claudeHome = join(home, '.claude');
const dataDir = join(home, 'data');
const paths = skillsPaths(claudeHome, dataDir);
const tool = join(home, 'other-tool', 'retro');
const up = join(home, 'upstream');
const catalogPath = join(home, 'skills.json');
const g = (args: string, cwd: string) => Bun.$`sh -c ${`cd ${cwd} && git -c user.name=t -c user.email=t@t ${args}`}`.quiet();
const put = (file: string, text: string) => {
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, text);
};
const plugin = () => {
  const installPath = join(claudeHome, 'plugins', 'cache', 'mkt', 'acme-skills', '1');
  put(join(installPath, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'acme-skills', skills: ['./skills/retro'] }));
  put(join(installPath, 'skills', 'retro', 'SKILL.md'), skillMd('retro', 'Conduct a retrospective'));
  put(join(claudeHome, 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'acme-skills@mkt': [{ scope: 'user', installPath, version: '1' }] } }));
};

beforeAll(async () => {
  put(join(tool, 'SKILL.md'), skillMd('retro', 'Weekly engineering retrospective of another tool'));
  mkdirSync(join(paths.skillsDir, 'retro'), { recursive: true });
  symlinkSync(join(tool, 'SKILL.md'), join(paths.skillsDir, 'retro', 'SKILL.md'));
  put(join(up, 'skills', 'engineering', 'retro', 'SKILL.md'), skillMd('retro', 'Conduct a retrospective'));
  await g('init -q -b main', up);
  await g('add -A', up);
  await g('commit -q -m v1', up);
  await g('tag v1.0.0', up);
  put(paths.marketplacesFile, JSON.stringify({ mkt: { source: { source: 'github', repo: 'acme/skills' }, installLocation: join(claudeHome, 'plugins', 'marketplaces', 'mkt') } }));
  put(catalogPath, JSON.stringify({ version: 1, entries: [{ id: 'retro', name: 'retro', summary: '', why: '', tier: 'recommended', bundle: 'acme', source: { type: 'git', repo: 'acme/skills', url: `file://${up}`, ref: 'v1.0.0', path: 'skills/engineering/retro' }, roles: [] }] }));
  plugin();
});
afterAll(() => rmSync(home, { recursive: true, force: true }));

describe('a linked skill folder belongs to where it links (ADR-0069)', () => {
  test('the scanner sees a folder whose SKILL.md links elsewhere as linked, to the folder it links into', () => {
    const row = scanSkills(paths).installed.find((r) => r.scope === 'user' && r.name === 'retro')!;
    expect(row).toMatchObject({ managedBy: 'symlink', symlink: { target: tool, broken: false }, canUninstall: true });
  });

  test('the catalog entry is satisfied by the plugin that ships it, not by the linked folder of the same name', () => {
    const s = catalogStatus(loadCatalog(catalogPath), scanSkills(paths), paths, () => null, () => true).find((x) => x.entry.id === 'retro')!;
    expect(s).toMatchObject({ status: 'installed-via-plugin', installedInvoke: '/acme-skills:retro' });
  });

  test('the update report lists it as linked: nothing to adopt, never a stale shadow, and the shadow cleanup leaves it', async () => {
    const m = new SkillsManager({ claudeHome, dataDir, catalogPath, which: () => null, updates: { ttlMs: 60_000, urlFor: () => `file://${up}` } });
    const report = await m.updates({ refresh: true });
    const linked = report.sources.find((s) => s.id === 'linked')!;
    expect(linked).toMatchObject({ manager: 'hand', updater: { kind: 'none' } });
    expect(linked.updater.hint).toContain('where it links');
    expect(linked.skills.find((k) => k.name === 'retro')).toMatchObject({ status: 'unknown', catalogId: null, shadowedBy: null, actions: ['uninstall'] });
    expect(report.shadowed).not.toContain('retro');
    const r = await m.cleanupShadows(['retro']);
    expect(r.trashed).toEqual([]);
    expect(r.skipped[0]!.reason).toContain('links to');
    expect(lstatSync(join(paths.skillsDir, 'retro', 'SKILL.md')).isSymbolicLink()).toBe(true);
  }, 30_000);

  test("without the plugin, installing the bundle keeps the linked folder instead of taking it over", async () => {
    rmSync(join(claudeHome, 'plugins', 'installed_plugins.json'));
    const m = new SkillsManager({ claudeHome, dataDir, catalogPath, which: () => null });
    const { results } = await m.installBundle('acme');
    expect(results).toEqual([{ id: 'retro', name: 'retro', action: 'kept', detail: expect.stringContaining(tool) }]);
    expect(lstatSync(join(paths.skillsDir, 'retro', 'SKILL.md')).isSymbolicLink()).toBe(true);
    expect(existsSync(join(paths.skillsDir, 'retro', '.foundry.json'))).toBe(false);
    plugin();
  }, 30_000);
});
