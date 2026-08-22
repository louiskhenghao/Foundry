import { beforeAll, describe, expect, test } from 'bun:test';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { exec } from '../git/git.ts';
import { makeFakeHome, skillMd, writeCatalog, type FakeHome } from './fake-home.test-helper.ts';
import { loadCatalog } from './catalog.ts';
import { scanSkills } from './scanner.ts';
import { dirFingerprint, gitBlobSha1, sourceOf } from './sources.ts';
import { SkillsUpdateChecker } from './updates.ts';
import { runSourceUpdate } from './updaters.ts';
import { SkillsManager } from './manager.ts';

const sh = async (args: string[], cwd: string) => {
  const r = await exec(args, cwd);
  if (r.code !== 0) throw new Error(`${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};
const gitEnv = ['-c', 'user.name=t', '-c', 'user.email=t@t'];

/**
 * Upstream "mattpocock/skills"-like repo with 3 commits: tdd v1 → tdd v2 (+ diagnosing-bugs) → unrelated file.
 * Served over file:// so ensureCache clones it like GitHub.
 */
async function makeUpstream(root: string) {
  const up = join(root, 'upstream');
  mkdirSync(join(up, 'skills', 'engineering', 'tdd'), { recursive: true });
  await sh(['git', 'init', '-q', '-b', 'main'], up);
  const tddV1 = skillMd('tdd', 'tdd v1');
  writeFileSync(join(up, 'skills', 'engineering', 'tdd', 'SKILL.md'), tddV1);
  await sh(['git', 'add', '-A'], up);
  await sh(['git', ...gitEnv, 'commit', '-q', '-m', 'tdd v1', '--date=2026-01-01T00:00:00Z'], up);
  const v1 = await sh(['git', 'rev-parse', 'HEAD'], up);
  writeFileSync(join(up, 'skills', 'engineering', 'tdd', 'SKILL.md'), skillMd('tdd', 'tdd v2 — better'));
  mkdirSync(join(up, 'skills', 'engineering', 'diagnosing-bugs'), { recursive: true });
  writeFileSync(join(up, 'skills', 'engineering', 'diagnosing-bugs', 'SKILL.md'), skillMd('diagnosing-bugs', 'find bugs'));
  await sh(['git', 'add', '-A'], up);
  await sh(['git', ...gitEnv, 'commit', '-q', '-m', 'tdd v2 + diagnosing-bugs', '--date=2026-03-01T00:00:00Z'], up);
  const v2 = await sh(['git', 'rev-parse', 'HEAD'], up);
  writeFileSync(join(up, 'README.md'), 'readme');
  await sh(['git', 'add', '-A'], up);
  await sh(['git', ...gitEnv, 'commit', '-q', '-m', 'readme', '--date=2026-04-01T00:00:00Z'], up);
  const head = await sh(['git', 'rev-parse', 'HEAD'], up);
  return { up, url: `file://${up}`, v1, v2, head, tddV1 };
}

describe('skills sources & updates', () => {
  let fh: FakeHome;
  let upstream: Awaited<ReturnType<typeof makeUpstream>>;
  let catalogPath: string;

  beforeAll(async () => {
    fh = makeFakeHome();
    upstream = await makeUpstream(fh.home);
    catalogPath = writeCatalog(join(fh.home, 'catalog'), [
      { id: 'tdd', name: 'tdd', summary: 's', why: 'w', tier: 'recommended', bundle: 'mp', source: { type: 'git', repo: 'mattpocock/skills', url: upstream.url, path: 'skills/engineering/tdd' }, roles: ['worker'] },
      { id: 'diagnosing-bugs', name: 'diagnosing-bugs', aliases: ['diagnose'], summary: 's', why: 'w', tier: 'recommended', bundle: 'mp', source: { type: 'git', repo: 'mattpocock/skills', url: upstream.url, path: 'skills/engineering/diagnosing-bugs' }, roles: ['worker'] },
    ]);
    // loose hand copy of tdd == upstream v1 (older), and a loose `diagnose` (old name) that differs from upstream
    writeFileSync(join(fh.paths.skillsDir, 'tdd', 'SKILL.md'), upstream.tddV1);
    mkdirSync(join(fh.paths.skillsDir, 'diagnose'));
    writeFileSync(join(fh.paths.skillsDir, 'diagnose', 'SKILL.md'), skillMd('diagnose', 'hand-edited'));
    // ai-engine-managed copy of diagnosing-bugs at v2 (identical bytes) — install it for real
    const m = new SkillsManager({ claudeHome: fh.claudeHome, dataDir: fh.dataDir, catalogPath, which: () => null });
    const r = await m.install('diagnosing-bugs');
    expect(r.ok).toBe(true);
    // marketplace metadata for the plugin in the fake home
    writeFileSync(fh.paths.marketplacesFile, JSON.stringify({ mkt: { source: { source: 'github', repo: 'mattpocock/skills' }, installLocation: join(fh.paths.pluginsDir, 'marketplaces', 'mkt'), lastUpdated: '2026-02-01T00:00:00Z' } }));
  });

  test('sourceOf classifies provenance families', () => {
    const scan = scanSkills(fh.paths);
    const by = (n: string, scope = 'user') => scan.installed.find((r) => r.name === n && r.scope === scope)!;
    expect(sourceOf(by('linked'), fh.paths)).toMatchObject({ manager: 'agents-cli', repo: 'x/y' });
    expect(by('linked').lock?.source).toBe('x/y');
    expect(sourceOf(by('tdd', 'plugin'), fh.paths)).toMatchObject({ kind: 'plugin', repo: 'mattpocock/skills' });
    expect(by('tdd', 'plugin').plugin?.skillPath).toBe('skills/engineering/tdd');
    expect(sourceOf(by('autoplan'), fh.paths)?.id).toBe('gstack');
    expect(sourceOf(by('diagnosing-bugs'), fh.paths)).toMatchObject({ manager: 'ai-engine', repo: 'mattpocock/skills' });
    expect(sourceOf(by('plain'), fh.paths)).toBeNull();
  });

  test('fingerprints ignore the marker and match git blob ids', () => {
    const dir = join(fh.paths.skillsDir, 'diagnosing-bugs');
    expect(existsSync(join(dir, '.ai-engine.json'))).toBe(true);
    const upDir = join(fh.paths.cacheDir, 'mattpocock', 'skills', 'skills', 'engineering', 'diagnosing-bugs');
    expect(dirFingerprint(dir)).toBe(dirFingerprint(upDir));
    expect(gitBlobSha1(Buffer.from('hello\n'))).toBe('ce013625030ba8dba906f756967f9e9ca394464a');
  });

  test('report: up-to-date / older copy / differs / unknown, grouped by source', async () => {
    const checker = new SkillsUpdateChecker(fh.paths, { ttlMs: 60_000, urlFor: (repo) => (repo === 'mattpocock/skills' ? upstream.url : undefined) });
    const report = await checker.report(scanSkills(fh.paths), loadCatalog(catalogPath), { refresh: true });
    const src = (id: string) => report.sources.find((s) => s.id === id)!;
    const row = (s: string, n: string) => src(s).skills.find((k) => k.name === n)!;

    // ai-engine managed, identical to upstream
    expect(src('ai-engine:mattpocock/skills').upstream?.commit).toBe(upstream.head);
    expect(row('ai-engine:mattpocock/skills', 'diagnosing-bugs').status).toBe('up-to-date');
    expect(row('ai-engine:mattpocock/skills', 'diagnosing-bugs').upstream?.commit).toBe(upstream.v2); // per-path date, not repo HEAD
    expect(src('ai-engine:mattpocock/skills').updateAvailable).toBe(false);

    // loose copies: tdd == v1 → outdated/older with the commit; diagnose (alias) → modified
    const hand = src('hand:mattpocock/skills');
    expect(hand.manager).toBe('hand');
    const tdd = hand.skills.find((k) => k.name === 'tdd')!;
    expect(tdd.status).toBe('outdated');
    expect(tdd.match).toMatchObject({ relation: 'older', olderCommit: upstream.v1 });
    expect(tdd.shadowedBy).toBe('/mp-skills:tdd');
    expect(tdd.actions).toContain('adopt');
    expect(tdd.actions).toContain('trash-shadow');
    const diag = hand.skills.find((k) => k.name === 'diagnose')!;
    expect(diag.status).toBe('modified');
    expect(diag.catalogId).toBe('diagnosing-bugs');
    expect(hand.updateAvailable).toBe(true);
    expect(hand.updater.kind).toBe('adopt');
    expect(report.shadowed).toContain('tdd');

    // plugin rows compare against our cache too
    const plugin = report.sources.find((s) => s.id === 'plugin:mp-skills@mkt')!;
    expect(plugin.updater.kind).toBe('plugin');
    expect(plugin.skills.find((k) => k.name === 'tdd')!.status).toBe('modified'); // fake plugin content is not upstream content

    // unknown origin
    expect(report.sources.find((s) => s.id === 'unknown')!.skills.map((k) => k.name)).toContain('plain');
    // gstack hint
    expect(report.sources.find((s) => s.id === 'gstack')!.updater.kind).toBe('hint');

    // cached + persisted
    expect(checker.cached()?.stale).toBe(false);
    expect(existsSync(fh.paths.updatesFile)).toBe(true);
    const again = await new SkillsUpdateChecker(fh.paths, { ttlMs: 60_000 }).report(scanSkills(fh.paths), loadCatalog(catalogPath), { offline: true });
    expect(again.sources.find((s) => s.id === 'hand:mattpocock/skills')!.skills.find((k) => k.name === 'tdd')!.status).toBe('outdated');
  }, 30_000);

  test('upstream moves → managed copy becomes outdated → ai-engine updater brings it back', async () => {
    writeFileSync(join(upstream.up, 'skills', 'engineering', 'diagnosing-bugs', 'SKILL.md'), skillMd('diagnosing-bugs', 'find bugs v3'));
    await sh(['git', 'add', '-A'], upstream.up);
    await sh(['git', ...gitEnv, 'commit', '-q', '-m', 'v3', '--date=2026-05-01T00:00:00Z'], upstream.up);
    const runs: string[] = [];
    const m = new SkillsManager({ claudeHome: fh.claudeHome, dataDir: fh.dataDir, catalogPath, which: () => null, onRun: (r) => runs.push(`${r.sourceId}:${r.updater}:${r.changed.length}`), updates: { ttlMs: 60_000, urlFor: () => upstream.url } });
    const before = await m.updates({ refresh: true });
    const managed = before.sources.find((s) => s.id === 'ai-engine:mattpocock/skills')!;
    expect(managed.skills[0]!.status).toBe('outdated');
    expect(managed.updateAvailable).toBe(true);

    const lines: string[] = [];
    const run = await m.updateSource(managed.id, { onLine: (l) => lines.push(l) });
    expect(run.exitCode).toBe(0);
    expect(run.changed.map((c) => c.name)).toEqual(['diagnosing-bugs']);
    expect(runs).toEqual(['ai-engine:mattpocock/skills:ai-engine:1']);
    expect(lines.some((l) => l.startsWith('✓ diagnosing-bugs'))).toBe(true);
    expect(readFileSync(join(fh.paths.skillsDir, 'diagnosing-bugs', 'SKILL.md'), 'utf8')).toContain('v3');
    const after = await m.updates({ refresh: true });
    expect(after.sources.find((s) => s.id === 'ai-engine:mattpocock/skills')!.skills[0]!.status).toBe('up-to-date');
  }, 30_000);

  test('adopt replaces loose copies (alias dir trashed) and cleanupShadows trashes only real shadows', async () => {
    const m = new SkillsManager({ claudeHome: fh.claudeHome, dataDir: fh.dataDir, catalogPath, which: () => null, updates: { ttlMs: 60_000, urlFor: () => upstream.url } });
    await m.updates({ refresh: true });
    const runs = await m.adopt(['diagnose']);
    expect(runs.length).toBe(1);
    expect(runs[0]!.changed[0]!.name).toBe('diagnosing-bugs');
    expect(existsSync(join(fh.paths.skillsDir, 'diagnose'))).toBe(false); // old name trashed
    expect(m.trash().some((t) => t.name === 'diagnose')).toBe(true);

    const r = await m.cleanupShadows(['tdd', 'plain']);
    expect(r.trashed.map((t) => t.name)).toEqual(['tdd']);
    expect(r.skipped[0]).toMatchObject({ name: 'plain' });
    expect(existsSync(join(fh.paths.skillsDir, 'tdd'))).toBe(false);
    const doc = await m.doctor();
    expect(doc.checks.find((c) => c.id === 'shadow-copies')?.ok).toBe(true);
  }, 30_000);

  test('third-party updaters build the right argv and stream output', async () => {
    const calls: string[][] = [];
    const spawn = async (argv: string[], _cwd: string, onLine: (l: string) => void) => {
      calls.push(argv);
      onLine('\x1b[32mupdating…\x1b[0m');
      return { code: 0, tail: 'updating…' };
    };
    const lines: string[] = [];
    const ctx = { paths: fh.paths, catalog: loadCatalog(catalogPath), spawn, npxBin: '/usr/bin/npx', claudeBin: '/usr/bin/claude', onLine: (l: string) => lines.push(l) };
    const src = (id: string, kind: 'agents-cli' | 'plugin') => ({ id, kind: 'github', label: id, manager: kind, repo: null, homepage: null, local: { commit: null, version: null, installedAt: null, updatedAt: null }, upstream: null, updateAvailable: true, updater: { kind, command: null, hint: null }, error: null, skills: [] }) as any;
    const a = await runSourceUpdate(src('agents-cli:x/y', 'agents-cli'), ['linked'], ctx);
    expect(calls[0]).toEqual(['/usr/bin/npx', '-y', 'skills@latest', 'update', '-g', '-y', '-a', 'claude-code', 'linked']);
    expect(a.exitCode).toBe(0);
    const p = await runSourceUpdate(src('plugin:mp-skills@mkt', 'plugin'), undefined, ctx);
    expect(calls[1]).toEqual(['/usr/bin/claude', 'plugin', 'marketplace', 'update', 'mkt']);
    expect(calls[2]).toEqual(['/usr/bin/claude', 'plugin', 'update', 'mp-skills@mkt', '-y']);
    expect(p.changed).toEqual([]); // sha unchanged in the fake registry
    expect(lines.some((l) => l === 'updating…')).toBe(true); // ANSI stripped
  });
});

// keep cpSync referenced for future fixtures
void cpSync;
