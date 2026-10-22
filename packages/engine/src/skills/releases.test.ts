import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { skillMd } from './fake-home.test-helper.ts';
import { SkillsManager } from './manager.ts';
import { readMarker } from './installer.ts';
import { skillsPaths } from './paths.ts';
import { changelogNotes, compareVersions, effectiveRef, forecastBetween, suiteReleases, tagSkills, withReleases } from './releases.ts';
import { readSuite } from './suites.ts';
import type { Catalog } from './types.ts';

const g = (args: string, cwd: string) => Bun.$`sh -c ${`cd ${cwd} && git -c user.name=t -c user.email=t@t ${args}`}`.quiet();
const put = (root: string, rel: string, text: string) => {
  mkdirSync(join(root, rel, '..'), { recursive: true });
  writeFileSync(join(root, rel), text);
};

const home = mkdtempSync(join(tmpdir(), 'foundry-releases-'));
const bundleRepo = join(home, 'acme-upstream');
const suiteRepo = join(home, 'pstack-upstream');

/** a catalog with one bundle of git entries (acme, at v1.0.0) and one suite (pstack, at v1.0.0) */
const catalogJson = () => ({
  version: 1,
  suites: [{ id: 'pstack', label: 'pstack', summary: '', repo: 'acme/pstack', url: `file://${suiteRepo}`, ref: 'v1.0.0', path: 'plugins/pstack', homepage: 'https://example.com/pstack' }],
  entries: [
    { id: 'tdd', name: 'tdd', summary: '', why: '', tier: 'recommended', bundle: 'acme', source: { type: 'git', repo: 'acme/skills', url: `file://${bundleRepo}`, ref: 'v1.0.0', path: 'skills/engineering/tdd' }, roles: ['worker'], workflow: [{ role: 'worker', mandate: 'must', when: 'feature', instruction: 'tests first' }] },
    { id: 'grilling', name: 'grilling', summary: '', why: '', tier: 'recommended', bundle: 'acme', source: { type: 'git', repo: 'acme/skills', url: `file://${bundleRepo}`, ref: 'v1.0.0', path: 'skills/productivity/grilling' }, roles: ['clarifier'], workflow: [{ role: 'clarifier', mandate: 'prefer', instruction: 'grill' }] },
    { id: 'pstack-tdd', name: 'tdd', summary: '', why: '', tier: 'recommended', bundle: 'pstack', source: { type: 'suite', suite: 'pstack' }, roles: ['worker'], workflow: [{ role: 'worker', mandate: 'must', when: 'bug', suite: 'pstack', instruction: 'test first' }] },
  ],
});
const catalog = () => catalogJson() as unknown as Catalog;

beforeAll(async () => {
  // acme v1.0.0: tdd, grilling, extra; v1.1.0: tdd moves to eng/, grilling to deprecated/, teach arrives
  const manifest = (skills: string[]) => JSON.stringify({ name: 'acme-skills', version: '1', skills });
  put(bundleRepo, '.claude-plugin/plugin.json', manifest(['./skills/engineering/tdd', './skills/productivity/grilling', './skills/engineering/extra']));
  put(bundleRepo, 'skills/engineering/tdd/SKILL.md', skillMd('tdd', 'tdd v1'));
  put(bundleRepo, 'skills/productivity/grilling/SKILL.md', skillMd('grilling'));
  put(bundleRepo, 'skills/engineering/extra/SKILL.md', skillMd('extra'));
  put(bundleRepo, 'CHANGELOG.md', '# acme\n\n## 1.0.0\n\n- first\n');
  await g('init -q -b main', bundleRepo);
  await g('add -A', bundleRepo);
  await g('commit -q -m v1', bundleRepo);
  await g('tag v1.0.0', bundleRepo);
  await g('mv skills/engineering/tdd skills/eng-tdd-tmp', bundleRepo);
  mkdirSync(join(bundleRepo, 'skills', 'eng'), { recursive: true });
  await g('mv skills/eng-tdd-tmp skills/eng/tdd', bundleRepo);
  mkdirSync(join(bundleRepo, 'skills', 'deprecated'), { recursive: true });
  await g('mv skills/productivity/grilling skills/deprecated/grilling', bundleRepo);
  put(bundleRepo, 'skills/eng/tdd/SKILL.md', skillMd('tdd', 'tdd v2'));
  put(bundleRepo, 'skills/productivity/teach/SKILL.md', skillMd('teach'));
  put(bundleRepo, '.claude-plugin/plugin.json', manifest(['./skills/eng/tdd', './skills/engineering/extra', './skills/productivity/teach']));
  put(bundleRepo, 'CHANGELOG.md', '# acme\n\n## 1.1.0\n\n- [#12](https://x/12) [`abc1234`](https://x/c) Thanks [@m](https://x/m)! - `grilling` is deprecated: use `teach`.\n- `tdd` moves under eng/.\n\n## 1.0.0\n\n- first\n');
  await g('add -A', bundleRepo);
  await g('commit -q -m v1.1', bundleRepo);
  await g('tag v1.1.0', bundleRepo);
  await g('tag not-a-release', bundleRepo);

  // pstack v1.0.0: tdd, sharpen; v1.1.0: + reflect
  put(suiteRepo, 'plugins/pstack/.claude-plugin/plugin.json', JSON.stringify({ name: 'pstack', version: '1.0.0' }));
  for (const s of ['tdd', 'sharpen']) put(suiteRepo, `plugins/pstack/skills/${s}/SKILL.md`, skillMd(s));
  put(suiteRepo, 'CHANGES.md', '# CHANGES\n\n## 1.0.0 - First\n');
  await g('init -q -b main', suiteRepo);
  await g('add -A', suiteRepo);
  await g('commit -q -m v1', suiteRepo);
  await g('tag v1.0.0', suiteRepo);
  put(suiteRepo, 'plugins/pstack/skills/reflect/SKILL.md', skillMd('reflect'));
  put(suiteRepo, 'CHANGES.md', '# CHANGES\n\n## 1.1.0 - reflect arrives\n\nNew `reflect` skill.\n\n## 1.0.0 - First\n');
  await g('add -A', suiteRepo);
  await g('commit -q -m v1.1', suiteRepo);
  await g('tag v1.1.0', suiteRepo);
});
afterAll(() => rmSync(home, { recursive: true, force: true }));

describe('suite releases: the rules (ADR-0068)', () => {
  test('versions compare by number, and the newer of the pin and the choice is used', () => {
    expect(compareVersions('v0.9.101', 'v0.9.93')).toBeGreaterThan(0);
    expect(compareVersions('1.3.1', 'v1.3.1')).toBe(0);
    expect(effectiveRef('v1.3.1', 'v1.4.0')).toBe('v1.4.0');
    // a Foundry release that pins a newer one than the person chose wins: a suite never moves back
    expect(effectiveRef('v1.5.0', 'v1.4.0')).toBe('v1.5.0');
    expect(effectiveRef('v1.3.1', undefined)).toBe('v1.3.1');
    expect(effectiveRef('v1.3.1', 'latest')).toBe('v1.3.1');
  });

  test("a catalog's suites at a release: its suites, and a bundle whose git entries share one repository and tag", () => {
    expect(suiteReleases(catalog()).map((r) => [r.id, r.kind, r.repo, r.catalogRef])).toEqual([
      ['pstack', 'suite', 'acme/pstack', 'v1.0.0'],
      ['acme', 'bundle', 'acme/skills', 'v1.0.0'],
    ]);
    const mixed = catalogJson();
    (mixed.entries[1]!.source as { ref: string }).ref = 'v1.1.0';
    expect(suiteReleases(mixed as unknown as Catalog).map((r) => r.id)).toEqual(['pstack']);
  });

  test('the catalog in use: unchanged without a newer choice; a moved suite and bundle at the chosen release, a moved skill followed', () => {
    const c = catalog();
    expect(withReleases(c, {}, () => null)).toBe(c);
    expect(withReleases(c, { acme: 'v0.9.0' }, () => null)).toBe(c);
    const moved = withReleases(c, { acme: 'v1.1.0', pstack: 'v1.1.0' }, (repo, ref) => (repo === 'acme/skills' && ref === 'v1.1.0' ? { tdd: 'skills/eng/tdd', extra: 'skills/engineering/extra' } : null));
    expect(moved.suites[0]!.ref).toBe('v1.1.0');
    expect(moved.entries.find((e) => e.id === 'tdd')!.source).toMatchObject({ ref: 'v1.1.0', path: 'skills/eng/tdd' });
    // a skill the release no longer ships keeps its path (and is not found there)
    expect(moved.entries.find((e) => e.id === 'grilling')!.source).toMatchObject({ ref: 'v1.1.0', path: 'skills/productivity/grilling' });
    expect(moved.entries.find((e) => e.id === 'pstack-tdd')!.source).toEqual({ type: 'suite', suite: 'pstack' });
  });

  test("a release's skills: a bundle's manifest, folders under deprecated/ apart, node_modules ignored; a suite's own skills folder", () => {
    const files = ['skills/a/x/SKILL.md', 'skills/deprecated/y/SKILL.md', 'node_modules/z/SKILL.md', 'docs/x.md', 'skills/in-progress/w/SKILL.md'];
    expect(tagSkills({ kind: 'bundle', path: null }, files, ['./skills/a/x'])).toEqual({ skills: { x: 'skills/a/x', w: 'skills/in-progress/w' }, deprecated: ['y'], published: ['x'] });
    expect(tagSkills({ kind: 'bundle', path: null }, files, null).published).toBeNull();
    expect(tagSkills({ kind: 'suite', path: 'plugins/p' }, ['plugins/p/skills/a/SKILL.md', 'plugins/p/skills/a/sub/b/SKILL.md', 'other/c/SKILL.md'], null)).toEqual({ skills: { a: 'plugins/p/skills/a' }, deprecated: [], published: ['a'] });
  });

  test("the changelog between two releases: its headings and the lines naming a skill, a changeset's lead dropped", () => {
    const text = '# x\n\n## 1.2.0 - Two\n\n- [#9](https://a) [`abcdef1`](https://b) Thanks [@c](https://d)! - `old` is renamed to `new`.\n\n## 1.1.0\n\n- `old` gets faster\n\n## 1.0.0\n\n- `old` arrives\n';
    expect(changelogNotes(text, 'v1.0.0', 'v1.2.0', ['old'])).toEqual({ headlines: ['1.2.0 - Two', '1.1.0'], notes: { old: ['`old` is renamed to `new`.', '`old` gets faster'] } });
    // what became of it comes before a mere mention, whatever the order in the changelog
    expect(changelogNotes('## 2.0.0\n\n- `x` gets a new flag\n- `x` is removed in favour of `y`\n\n## 1.0.0\n', 'v1.0.0', 'v2.0.0', ['x']).notes.x).toEqual(['`x` is removed in favour of `y`', '`x` gets a new flag']);
    // 1.10.0 is not 1.1.0
    expect(changelogNotes('## 1.10.0\n\n- `a`\n', 'v1.0.0', 'v1.1.0', ['a']).headlines).toEqual([]);
    expect(changelogNotes(null, 'v1', 'v2', ['a']).notes).toEqual({ a: [] });
  });

  test('a forecast: what goes (deprecated or not, with the rules Foundry gives it and the changelog), what comes, what stays', () => {
    const rel = suiteReleases(catalog()).find((r) => r.id === 'acme')!;
    const from = { ref: 'v1.0.0', skills: { skills: { tdd: 'skills/engineering/tdd', grilling: 'skills/productivity/grilling', extra: 'skills/engineering/extra' }, deprecated: [], published: ['extra', 'grilling', 'tdd'] } };
    const to = { ref: 'v1.1.0', skills: { skills: { tdd: 'skills/eng/tdd', extra: 'skills/engineering/extra', teach: 'skills/productivity/teach' }, deprecated: ['grilling'], published: ['extra', 'teach', 'tdd'] } };
    expect(forecastBetween(rel, catalog(), from, to, '## 1.1.0\n\n- `grilling` is deprecated\n\n## 1.0.0\n')).toEqual({
      from: 'v1.0.0',
      to: 'v1.1.0',
      removed: [{ name: 'grilling', deprecated: true, inCatalog: true, rules: [{ role: 'clarifier', mandate: 'prefer' }], notes: ['`grilling` is deprecated'] }],
      added: ['teach'],
      kept: 2,
      headlines: ['1.1.0'],
    });
  });
});

describe('suite releases: forecast and Move on this computer (ADR-0068)', () => {
  const claudeHome = join(home, 'pc', '.claude');
  const dataDir = join(home, 'pc', 'data');
  const paths = skillsPaths(claudeHome, dataDir);
  let chosen: Record<string, string> = {};
  let m: SkillsManager;

  beforeAll(async () => {
    const catalogPath = join(home, 'pc', 'skills.json');
    mkdirSync(paths.skillsDir, { recursive: true });
    writeFileSync(catalogPath, JSON.stringify(catalogJson()));
    m = new SkillsManager({ claudeHome, dataDir, catalogPath, which: () => null, suiteReleases: () => chosen, onSuiteRelease: (id, ref) => ((chosen = { ...chosen }), ref ? (chosen[id] = ref) : delete chosen[id]) });
    const bundle = await m.installBundle('acme');
    expect(bundle.results.map((r) => r.action)).toEqual(['installed', 'installed']);
    expect((await m.install('pstack-tdd')).ok).toBe(true);
  }, 60_000);

  test('each suite with its release, what is installed, the releases it may move to and a forecast of the newest', async () => {
    const views = await m.releases({ refresh: true });
    const acme = views.find((v) => v.id === 'acme')!;
    expect(acme).toMatchObject({ kind: 'bundle', catalogRef: 'v1.0.0', chosenRef: null, ref: 'v1.0.0', installed: { as: 'git', ref: 'v1.0.0' }, latest: 'v1.1.0', choices: ['v1.1.0', 'v1.0.0'], error: null });
    expect(acme.forecast).toEqual({ from: 'v1.0.0', to: 'v1.1.0', removed: [{ name: 'grilling', deprecated: true, inCatalog: true, rules: [{ role: 'clarifier', mandate: 'prefer' }], notes: ['`grilling` is deprecated: use `teach`.'] }], added: ['teach'], kept: 2, headlines: ['1.1.0'] });
    const pstack = views.find((v) => v.id === 'pstack')!;
    expect(pstack).toMatchObject({ kind: 'suite', installed: { as: 'suite', ref: 'v1.0.0' }, latest: 'v1.1.0' });
    expect(pstack.forecast).toMatchObject({ removed: [], added: ['reflect'], kept: 2, headlines: ['1.1.0 - reflect arrives'] });
    // what a release removes is known before anything moves
    expect(await m.forecastRelease('acme', 'v1.0.0')).toMatchObject({ removed: [], added: [], kept: 3 });
  }, 60_000);

  test("a Move refuses a release before the catalog's pin or one upstream does not have", async () => {
    await expect(m.moveRelease('acme', 'v0.9.0')).rejects.toThrow('v1.0.0 or a later release');
    await expect(m.moveRelease('acme', 'v9.9.9')).rejects.toThrow('has no release v9.9.9');
    await expect(m.moveRelease('nope', 'v1.1.0')).rejects.toThrow('not a workflow suite');
    expect(chosen).toEqual({});
  }, 60_000);

  test("moving the bundle: the choice saved, Foundry's copies updated (a moved skill followed), what the release dropped to the trash", async () => {
    const run = await m.moveRelease('acme', 'v1.1.0');
    expect(run.error).toBeNull();
    expect(chosen).toEqual({ acme: 'v1.1.0' });
    expect(existsSync(join(paths.skillsDir, 'grilling'))).toBe(false);
    expect(m.trash().some((t) => t.name === 'grilling' && t.reason === 'not in acme v1.1.0')).toBe(true);
    expect(readFileSync(join(paths.skillsDir, 'tdd', 'SKILL.md'), 'utf8')).toContain('tdd v2');
    expect(readMarker(join(paths.skillsDir, 'tdd'))).toMatchObject({ ref: 'v1.1.0', path: 'skills/eng/tdd' });
    expect(m.catalog().entries.find((e) => e.id === 'tdd')!.source).toMatchObject({ ref: 'v1.1.0', path: 'skills/eng/tdd' });
    expect((await m.releases()).find((v) => v.id === 'acme')).toMatchObject({ chosenRef: 'v1.1.0', ref: 'v1.1.0', installed: { as: 'git', ref: 'v1.1.0' }, forecast: null });
  }, 60_000);

  test("moving the suite re-syncs its copy at the release; moving back to the catalog's pin clears the choice", async () => {
    expect((await m.moveRelease('pstack', 'v1.1.0')).error).toBeNull();
    expect(readSuite(paths, 'pstack')).toMatchObject({ ref: 'v1.1.0', skills: ['reflect', 'sharpen', 'tdd'] });
    expect(chosen).toEqual({ acme: 'v1.1.0', pstack: 'v1.1.0' });
    expect((await m.moveRelease('pstack', 'v1.0.0')).error).toBeNull();
    expect(readSuite(paths, 'pstack')).toMatchObject({ ref: 'v1.0.0', skills: ['sharpen', 'tdd'] });
    expect(chosen).toEqual({ acme: 'v1.1.0' });
  }, 60_000);
});

describe('suite releases: a bundle installed as a Claude plugin (ADR-0068)', () => {
  test("a Move re-pins the plugin's marketplace (Claude's settings entry first), then updates the plugin", async () => {
    const claudeHome = join(home, 'plugin-pc', '.claude');
    const dataDir = join(home, 'plugin-pc', 'data');
    const catalogPath = join(home, 'plugin-pc', 'skills.json');
    const installPath = join(claudeHome, 'plugins', 'cache', 'acme', 'acme-skills', '1');
    put(installPath, '.claude-plugin/plugin.json', JSON.stringify({ name: 'acme-skills', skills: ['./skills/tdd'] }));
    put(installPath, 'skills/tdd/SKILL.md', skillMd('tdd'));
    const source = { source: 'github', repo: 'acme/skills', ref: 'v1.0.0' };
    put(claudeHome, 'plugins/installed_plugins.json', JSON.stringify({ version: 2, plugins: { 'acme-skills@acme': [{ scope: 'user', installPath, version: '1' }] } }));
    put(claudeHome, 'plugins/known_marketplaces.json', JSON.stringify({ acme: { source, installLocation: join(claudeHome, 'plugins', 'marketplaces', 'acme') } }));
    put(claudeHome, 'settings.json', JSON.stringify({ theme: 'dark', extraKnownMarketplaces: { acme: { source } } }));
    writeFileSync(catalogPath, JSON.stringify(catalogJson()));
    const calls: string[][] = [];
    let chosen: Record<string, string> = {};
    const m = new SkillsManager({ claudeHome, dataDir, catalogPath, which: () => null, claudeBin: '/bin/claude', suiteReleases: () => chosen, onSuiteRelease: (id, ref) => (chosen = ref ? { [id]: ref } : {}), updater: { spawn: async (argv) => (calls.push(argv), { code: 0, tail: '' }) } });

    expect((await m.releases({ refresh: true })).find((v) => v.id === 'acme')!.installed).toEqual({ as: 'plugin', ref: 'v1.0.0' });
    const run = await m.moveRelease('acme', 'v1.1.0');
    expect(run).toMatchObject({ error: null, updater: 'plugin', changed: [{ name: 'acme-skills@acme', from: 'v1.0.0', to: 'v1.1.0' }] });
    expect(calls).toEqual([
      ['/bin/claude', 'plugin', 'marketplace', 'add', 'acme/skills#v1.1.0'],
      ['/bin/claude', 'plugin', 'update', 'acme-skills@acme', '-y'],
    ]);
    // the rest of Claude's settings stay as they were
    expect(JSON.parse(readFileSync(join(claudeHome, 'settings.json'), 'utf8'))).toEqual({ theme: 'dark', extraKnownMarketplaces: { acme: { source: { ...source, ref: 'v1.1.0' } } } });
    expect(chosen).toEqual({ acme: 'v1.1.0' });
  }, 60_000);
});
