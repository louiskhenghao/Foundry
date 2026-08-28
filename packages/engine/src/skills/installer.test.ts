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
    await expect(manager.uninstall('gstack')).rejects.toMatchObject({ reason: 'managed-by-gstack' });
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
