import { beforeAll, describe, expect, test } from 'bun:test';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { exec } from '../git/git.ts';
import { loadCatalog } from './catalog.ts';
import { makeFakeHome, skillMd, writeCatalog, type FakeHome } from './fake-home.test-helper.ts';
import { scanSkills } from './scanner.ts';
import { SkillsUpdateChecker } from './updates.ts';
import { runSourceUpdate } from './updaters.ts';

const sh = async (args: string[], cwd: string) => {
  const r = await exec(args, cwd);
  if (r.code !== 0) throw new Error(`${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};
const commit = async (dir: string, msg: string, date: string) => {
  await sh(['git', 'add', '-A'], dir);
  await sh(['git', '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', msg, `--date=${date}`], dir);
  return sh(['git', 'rev-parse', 'HEAD'], dir);
};
const version = (dir: string, v: string) => writeFileSync(join(dir, '.claude-plugin', 'marketplace.json'), JSON.stringify({ name: 'mk', plugins: [{ name: 'pp', version: v, source: './' }] }));

/**
 * A plugin repo "o/plug" (skill s1 with a data file) whose author keeps changing files without raising the version,
 * plus a docs-only change and a hand-installed skill that has a catalog entry Foundry cannot install by itself.
 */
describe('update status: unreleased plugin changes, docs-only differences, what can be adopted', () => {
  let fh: FakeHome;
  let up: string;
  let installed: string;
  let catalogPath: string;
  const checker = () => new SkillsUpdateChecker(fh.paths, { ttlMs: 60_000, urlFor: (repo) => (repo === 'o/plug' ? `file://${up}` : undefined) });
  const report = async () => checker().report(scanSkills(fh.paths), loadCatalog(catalogPath), { refresh: true });

  beforeAll(async () => {
    fh = makeFakeHome();
    up = join(fh.home, 'plug');
    mkdirSync(join(up, '.claude-plugin'), { recursive: true });
    mkdirSync(join(up, 'skills', 's1'), { recursive: true });
    await sh(['git', 'init', '-q', '-b', 'main'], up);
    version(up, '1.0.0');
    writeFileSync(join(up, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'pp', skills: ['./skills/s1'] }));
    writeFileSync(join(up, 'skills', 's1', 'SKILL.md'), skillMd('s1', 'first skill'));
    writeFileSync(join(up, 'skills', 's1', 'data.txt'), 'data v1');
    installed = await commit(up, 'v1.0.0', '2026-01-01T00:00:00Z');

    // the plugin as the CLI installed it, at that commit
    const cache = join(fh.paths.pluginsDir, 'cache', 'mk', 'pp', '1.0.0');
    mkdirSync(cache, { recursive: true });
    cpSync(join(up, '.claude-plugin'), join(cache, '.claude-plugin'), { recursive: true });
    cpSync(join(up, 'skills'), join(cache, 'skills'), { recursive: true });
    writeFileSync(
      join(fh.paths.pluginsDir, 'installed_plugins.json'),
      JSON.stringify({ version: 2, plugins: { 'pp@mk': [{ scope: 'user', installPath: cache, version: '1.0.0', gitCommitSha: installed, installedAt: '2026-01-02T00:00:00Z', lastUpdated: '2026-01-02T00:00:00Z' }] } }),
    );
    writeFileSync(fh.paths.marketplacesFile, JSON.stringify({ mk: { source: { source: 'github', repo: 'o/plug' }, installLocation: join(fh.paths.pluginsDir, 'marketplaces', 'mk'), lastUpdated: '2026-01-02T00:00:00Z' } }));

    // upstream keeps working on the skill's data under the same version number
    writeFileSync(join(up, 'skills', 's1', 'data.txt'), 'data v2');
    await commit(up, 'more data, same version', '2026-02-01T00:00:00Z');

    // the hand-installed skills of the fake home get a catalog: `plain` only as a manual entry
    catalogPath = writeCatalog(join(fh.home, 'catalog'), [{ id: 'plain', name: 'plain', summary: 's', why: 'w', tier: 'optional', source: { type: 'manual', install: 'copy it', detectDir: 'plain' }, roles: [] }]);
  });

  test('a plugin whose upstream changed under the same version is "unreleased": no Update, a hint, and the exact installed commit', async () => {
    const r = await report();
    const src = r.sources.find((s) => s.id === 'plugin:pp@mk')!;
    const s1 = src.skills.find((k) => k.name === 's1')!;
    expect(s1.status).toBe('unreleased');
    expect(s1.match).toMatchObject({ relation: 'older', olderCommit: installed });
    expect(s1.actions).not.toContain('update');
    expect(src.updateAvailable).toBe(false);
    expect(src.updater.hint).toContain('not released yet');
    expect(src.updater.hint).toContain('v1.0.0');
  }, 30_000);

  test('once the author raises the version, the same change is an update', async () => {
    version(up, '1.1.0');
    await commit(up, 'release 1.1.0', '2026-03-01T00:00:00Z');
    const r = await report();
    const src = r.sources.find((s) => s.id === 'plugin:pp@mk')!;
    const s1 = src.skills.find((k) => k.name === 's1')!;
    expect(s1.status).toBe('outdated');
    expect(s1.actions).toContain('update');
    expect(src.updateAvailable).toBe(true);
  }, 30_000);

  test('a copy that differs from upstream only in its README is up to date; one with an old data file is outdated but not "= upstream"', async () => {
    const hand = join(fh.paths.skillsDir, 's1');
    rmSync(hand, { recursive: true, force: true });
    cpSync(join(up, 'skills', 's1'), hand, { recursive: true });
    writeFileSync(join(hand, 'README.md'), 'my notes');
    const catalogWithS1 = writeCatalog(join(fh.home, 'catalog2'), [{ id: 's1', name: 's1', summary: 's', why: 'w', tier: 'optional', source: { type: 'git', repo: 'o/plug', url: `file://${up}`, path: 'skills/s1' }, roles: [] }]);
    const byName = async () => {
      const r = await checker().report(scanSkills(fh.paths), loadCatalog(catalogWithS1), { refresh: true });
      return r.sources.flatMap((s) => s.skills).find((k) => k.name === 's1' && k.scope === 'user')!;
    };
    expect((await byName()).status).toBe('up-to-date');
    rmSync(join(hand, 'README.md'));
    writeFileSync(join(hand, 'data.txt'), 'data v1');
    const old = await byName();
    expect(old.status).toBe('outdated');
    expect(old.match?.relation).toBe('differs');
    expect(old.actions).toContain('adopt'); // a git catalog entry: Foundry can install it
  }, 30_000);

  test('a hand copy whose catalog entry is manual is not offered for adoption, and adopting it anyway reports the failure', async () => {
    const r = await report();
    const plainRow = r.sources.flatMap((s) => s.skills).find((k) => k.name === 'plain')!;
    expect(plainRow.actions).not.toContain('adopt');
    const run = await runSourceUpdate(
      { id: 'local', kind: 'local', label: 'local', manager: 'hand', repo: null, homepage: null, local: { commit: null, version: null, installedAt: null, updatedAt: null }, upstream: null, updateAvailable: null, updater: { kind: 'adopt', command: null, hint: null }, error: null, skills: [{ ...plainRow, catalogId: 'plain' }] },
      ['plain'],
      { paths: fh.paths, catalog: loadCatalog(catalogPath) },
    );
    expect(run.exitCode).toBe(1);
    expect(run.changed).toEqual([]);
    expect(run.error).toContain('copy it');
  }, 30_000);
});
