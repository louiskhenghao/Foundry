import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeFakeHome, skillMd, writeCatalog } from './fake-home.test-helper.ts';
import { SkillsManager } from './manager.ts';
import { listTrash } from './trash.ts';

const fake = makeFakeHome();
let fixture: string;
let manager: SkillsManager;

async function gitc(args: string) {
  await Bun.$`sh -c ${`cd ${fixture} && git -c user.name=t -c user.email=t@t ${args}`}`.quiet();
}

beforeAll(async () => {
  fixture = join(fake.home, 'upstream');
  mkdirSync(join(fixture, 'skills', 'foo'), { recursive: true });
  mkdirSync(join(fixture, 'x', 'bar'), { recursive: true });
  writeFileSync(join(fixture, 'skills', 'foo', 'SKILL.md'), skillMd('foo', 'v1'));
  writeFileSync(join(fixture, 'skills', 'foo', 'extra.md'), 'ref');
  writeFileSync(join(fixture, 'x', 'bar', 'SKILL.md'), skillMd('bar'));
  await gitc('init -q -b main');
  await gitc('add -A');
  await gitc('commit -q -m v1');
  const catalogPath = writeCatalog(join(fake.home, 'catalog'), [
    { id: 'foo', name: 'foo', summary: '', why: '', tier: 'recommended', source: { type: 'git', repo: 'acme/upstream', url: `file://${fixture}`, path: 'skills/foo' } },
    { id: 'bar', name: 'bar', summary: '', why: '', tier: 'recommended', source: { type: 'git', repo: 'acme/upstream', url: `file://${fixture}` } },
    { id: 'plain', name: 'plain', summary: '', why: '', tier: 'recommended', source: { type: 'git', repo: 'acme/upstream', url: `file://${fixture}`, path: 'skills/foo' } },
    { id: 'graphify', name: 'graphify', summary: '', why: '', tier: 'required', source: { type: 'cli', detect: 'graphify', install: 'uv tool install graphifyy' } },
  ]);
  manager = new SkillsManager({ claudeHome: fake.claudeHome, dataDir: fake.dataDir, catalogPath, which: () => null });
});
afterAll(() => rmSync(fake.home, { recursive: true, force: true }));

describe('installer', () => {
  test('installs with explicit path, writes marker with HEAD commit', async () => {
    const r = await manager.install('foo');
    expect(r.ok).toBe(true);
    const dir = join(fake.paths.skillsDir, 'foo');
    expect(readFileSync(join(dir, 'SKILL.md'), 'utf8')).toContain('v1');
    expect(existsSync(join(dir, 'extra.md'))).toBe(true);
    const marker = JSON.parse(readFileSync(join(dir, '.foundry.json'), 'utf8'));
    expect(marker).toMatchObject({ catalogId: 'foo', repo: 'acme/upstream', path: 'skills/foo' });
    expect(marker.commit).toHaveLength(40);
    const st = (await manager.status()).find((s) => s.entry.id === 'foo')!;
    expect(st.status).toBe('installed');
    expect(st.commit).toBe(marker.commit);
  });

  test('locates a path-less entry by searching **/<name>/SKILL.md', async () => {
    const r = await manager.install('bar');
    expect(r.ok).toBe(true);
    expect(JSON.parse(readFileSync(join(fake.paths.skillsDir, 'bar', '.foundry.json'), 'utf8')).path).toBe('x/bar');
  });

  test('refuses to overwrite an unmanaged dir unless forced (forced → old copy goes to trash)', async () => {
    await expect(manager.install('plain')).rejects.toMatchObject({ code: 'conflict' });
    const r = await manager.install('plain', { force: true });
    expect(r.ok).toBe(true);
    expect(listTrash(fake.paths).some((t) => t.name === 'plain')).toBe(true);
  });

  test('cli entries are manual', async () => {
    const r = await manager.install('graphify');
    expect(r.ok).toBe(false);
    expect(r.manual?.command).toContain('uv tool install');
  });

  test('update pulls new upstream content and reports commits', async () => {
    writeFileSync(join(fixture, 'skills', 'foo', 'SKILL.md'), skillMd('foo', 'v2'));
    await gitc('commit -qam v2');
    const u = await manager.update('foo');
    expect(u.updated).toHaveLength(1);
    expect(u.updated[0]!.from).not.toBe(u.updated[0]!.to);
    expect(readFileSync(join(fake.paths.skillsDir, 'foo', 'SKILL.md'), 'utf8')).toContain('v2');
    const again = await manager.update('foo');
    expect(again.unchanged).toEqual(['foo']);
  });

  test('installTier skips satisfied entries and never aborts the batch', async () => {
    const r = await manager.installTier(['recommended', 'required']);
    expect(r.results.map((x) => [x.id, x.ok])).toEqual([
      ['foo', true],
      ['bar', true],
      ['plain', true],
      ['graphify', false],
    ]);
  });

  test('uninstall → trash → restore roundtrip; symlink uninstall removes only the link', async () => {
    const { trash } = await manager.uninstall('bar');
    expect(existsSync(join(fake.paths.skillsDir, 'bar'))).toBe(false);
    expect(existsSync(join(trash.path, 'SKILL.md'))).toBe(true);
    const { path } = await manager.restore('bar');
    expect(existsSync(join(path, 'SKILL.md'))).toBe(true);
    await expect(manager.uninstall('linked')).rejects.toMatchObject({ reason: 'managed-needs-force' });
    const { trash: t2 } = await manager.uninstall('linked', { force: true });
    expect(t2.wasSymlink).toBe(true);
    expect(existsSync(join(fake.paths.agentsSkillsDir, 'linked', 'SKILL.md'))).toBe(true);
    const restored = await manager.restore('linked');
    expect(lstatSync(restored.path).isSymbolicLink()).toBe(true);
    await expect(manager.uninstall('tdd-not-there')).rejects.toMatchObject({ reason: 'not-found' });
    await expect(manager.uninstall('design')).rejects.toMatchObject({ reason: 'not-user-scope' });
  });
});

describe('a git source pinned to a tag', () => {
  test('installs the tagged content, and an update keeps it there while main moves on', async () => {
    const up = join(fake.home, 'upstream-tagged');
    mkdirSync(join(up, 'skills', 'pin'), { recursive: true });
    writeFileSync(join(up, 'skills', 'pin', 'SKILL.md'), skillMd('pin', 'tagged'));
    const g = (args: string) => Bun.$`sh -c ${`cd ${up} && git -c user.name=t -c user.email=t@t ${args}`}`.quiet();
    await g('init -q -b main');
    await g('add -A');
    await g('commit -q -m one');
    await g('tag v1.0.0');
    writeFileSync(join(up, 'skills', 'pin', 'SKILL.md'), skillMd('pin', 'newer'));
    await g('commit -q -am two');
    const catalogPath = writeCatalog(join(fake.home, 'catalog-pinned'), [{ id: 'pin', name: 'pin', summary: '', why: '', tier: 'recommended', source: { type: 'git', repo: 'acme/tagged', url: `file://${up}`, ref: 'v1.0.0', path: 'skills/pin' } }]);
    const m = new SkillsManager({ claudeHome: fake.claudeHome, dataDir: fake.dataDir, catalogPath, which: () => null });
    expect((await m.install('pin')).ok).toBe(true);
    const skill = join(fake.paths.skillsDir, 'pin', 'SKILL.md');
    expect(readFileSync(skill, 'utf8')).toContain('tagged');
    // the refresh fetches and resets the cache: to the tag, not to the branch that moved on
    const u = await m.update('pin');
    expect(u.unchanged).toEqual(['pin']);
    expect(readFileSync(skill, 'utf8')).toContain('tagged');
    expect(readFileSync(skill, 'utf8')).not.toContain('newer');
  });
});

describe('a git source pinned to a commit', () => {
  test('installs that commit, fetching it by id when the default branch does not reach it, and an update keeps it there', async () => {
    const up = join(fake.home, 'upstream-commit');
    mkdirSync(join(up, 'skills', 'fix'), { recursive: true });
    writeFileSync(join(up, 'skills', 'fix', 'SKILL.md'), skillMd('fix', 'first'));
    const g = (args: string) => Bun.$`sh -c ${`cd ${up} && git -c user.name=t -c user.email=t@t ${args}`}`.quiet();
    await g('init -q -b main');
    await g('add -A');
    await g('commit -q -m one');
    // the pinned commit sits on a side branch: a shallow clone of main never has it
    await g('checkout -q -b side');
    writeFileSync(join(up, 'skills', 'fix', 'SKILL.md'), skillMd('fix', 'pinned'));
    await g('commit -q -am side');
    const sha = (await Bun.$`sh -c ${`cd ${up} && git rev-parse HEAD`}`.quiet()).text().trim();
    await g('checkout -q main');
    writeFileSync(join(up, 'skills', 'fix', 'SKILL.md'), skillMd('fix', 'newer'));
    await g('commit -q -am two');
    const catalogPath = writeCatalog(join(fake.home, 'catalog-commit'), [{ id: 'fix', name: 'fix', summary: '', why: '', tier: 'recommended', source: { type: 'git', repo: 'acme/commit', url: `file://${up}`, ref: sha, path: 'skills/fix' } }]);
    const m = new SkillsManager({ claudeHome: fake.claudeHome, dataDir: fake.dataDir, catalogPath, which: () => null });
    expect((await m.install('fix')).ok).toBe(true);
    const skill = join(fake.paths.skillsDir, 'fix', 'SKILL.md');
    expect(readFileSync(skill, 'utf8')).toContain('pinned');
    expect(JSON.parse(readFileSync(join(fake.paths.skillsDir, 'fix', '.foundry.json'), 'utf8'))).toMatchObject({ ref: sha, commit: sha });
    // the refresh fetches and resets the cache to the commit, not to main that moved on
    const u = await m.update('fix');
    expect(u.unchanged).toEqual(['fix']);
    expect(readFileSync(skill, 'utf8')).toContain('pinned');
    expect(readFileSync(skill, 'utf8')).not.toContain('newer');
  });

  test('a cache another entry left at a newer commit is moved to the pinned commit before the copy', async () => {
    const up = join(fake.home, 'upstream-shared');
    for (const n of ['old', 'tip']) {
      mkdirSync(join(up, 'skills', n), { recursive: true });
      writeFileSync(join(up, 'skills', n, 'SKILL.md'), skillMd(n, 'first'));
    }
    const g = (args: string) => Bun.$`sh -c ${`cd ${up} && git -c user.name=t -c user.email=t@t ${args}`}`.quiet();
    await g('init -q -b main');
    await g('add -A');
    await g('commit -q -m one');
    const first = (await Bun.$`sh -c ${`cd ${up} && git rev-parse HEAD`}`.quiet()).text().trim();
    for (const n of ['old', 'tip']) writeFileSync(join(up, 'skills', n, 'SKILL.md'), skillMd(n, 'second'));
    await g('commit -q -am two');
    const catalogPath = writeCatalog(join(fake.home, 'catalog-shared'), [
      { id: 'tip', name: 'tip', summary: '', why: '', tier: 'recommended', source: { type: 'git', repo: 'acme/shared', url: `file://${up}`, path: 'skills/tip' } },
      { id: 'old', name: 'old', summary: '', why: '', tier: 'recommended', source: { type: 'git', repo: 'acme/shared', url: `file://${up}`, ref: first, path: 'skills/old' } },
    ]);
    const m = new SkillsManager({ claudeHome: fake.claudeHome, dataDir: fake.dataDir, catalogPath, which: () => null });
    // the unpinned entry clones the shared cache at main's tip
    expect((await m.install('tip')).ok).toBe(true);
    expect(readFileSync(join(fake.paths.skillsDir, 'tip', 'SKILL.md'), 'utf8')).toContain('second');
    // the pinned one finds that cache and moves it to its commit before copying
    expect((await m.install('old')).ok).toBe(true);
    expect(readFileSync(join(fake.paths.skillsDir, 'old', 'SKILL.md'), 'utf8')).toContain('first');
  });

  test('a commit the repository does not have fails the install and leaves no cache behind', async () => {
    const up = join(fake.home, 'upstream-nocommit');
    mkdirSync(join(up, 'skills', 'nofix'), { recursive: true });
    writeFileSync(join(up, 'skills', 'nofix', 'SKILL.md'), skillMd('nofix'));
    const g = (args: string) => Bun.$`sh -c ${`cd ${up} && git -c user.name=t -c user.email=t@t ${args}`}`.quiet();
    await g('init -q -b main');
    await g('add -A');
    await g('commit -q -m one');
    const catalogPath = writeCatalog(join(fake.home, 'catalog-commit-bad'), [{ id: 'nofix', name: 'nofix', summary: '', why: '', tier: 'recommended', source: { type: 'git', repo: 'acme/nocommit', url: `file://${up}`, ref: 'f'.repeat(40), path: 'skills/nofix' } }]);
    const m = new SkillsManager({ claudeHome: fake.claudeHome, dataDir: fake.dataDir, catalogPath, which: () => null });
    await expect(m.install('nofix')).rejects.toThrow('commit fffffff is not in acme/nocommit');
    expect(existsSync(join(fake.paths.cacheDir, 'acme', 'nocommit'))).toBe(false);
    expect(existsSync(join(fake.paths.skillsDir, 'nofix'))).toBe(false);
  });
});
