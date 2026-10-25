import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeFakeHome, skillMd, writeCatalog } from './fake-home.test-helper.ts';
import { hashSkillFolder } from './installer.ts';
import { SkillsManager } from './manager.ts';
import { listTrash } from './trash.ts';

/** a skill Foundry ships in its own repository (ADR-0076): installed by copying catalog/bundled/<name> */
const fake = makeFakeHome();
let bundled: string;
let manager: SkillsManager;

const writeSnapshot = (version: string) => {
  mkdirSync(join(bundled, 'assets'), { recursive: true });
  writeFileSync(join(bundled, 'SKILL.md'), skillMd('zap', version));
  writeFileSync(join(bundled, 'LICENSE'), 'MIT');
  writeFileSync(join(bundled, 'assets', 'core.js'), `// ${version}`);
  rmSync(join(bundled, 'SOURCE.json'), { force: true });
  writeFileSync(join(bundled, 'SOURCE.json'), JSON.stringify({ name: 'zap', sha256: hashSkillFolder(bundled) }));
};

beforeAll(() => {
  const catalogDir = join(fake.home, 'catalog');
  bundled = join(catalogDir, 'bundled', 'zap');
  writeSnapshot('v1');
  const catalogPath = writeCatalog(catalogDir, [{ id: 'zap', name: 'zap', summary: '', why: '', tier: 'optional', source: { type: 'bundled', path: 'bundled/zap' }, roles: ['worker'], pack: 'figure', packOption: 'zap' }]);
  manager = new SkillsManager({ claudeHome: fake.claudeHome, dataDir: fake.dataDir, catalogPath, which: () => null });
});
afterAll(() => rmSync(fake.home, { recursive: true, force: true }));

describe('bundled sources', () => {
  test('the folder hash leaves SOURCE.json and the marker out, so the record can hold its own hash', () => {
    const h = hashSkillFolder(bundled);
    expect(h).toHaveLength(64);
    writeFileSync(join(bundled, 'SOURCE.json'), JSON.stringify({ sha256: h, note: 'changed' }));
    writeFileSync(join(bundled, '.foundry.json'), '{}');
    expect(hashSkillFolder(bundled)).toBe(h);
    rmSync(join(bundled, '.foundry.json'));
  });

  test('installs by copying the bundled folder, under a marker that names the snapshot', async () => {
    const r = await manager.install('zap');
    expect(r.ok).toBe(true);
    const dir = join(fake.paths.skillsDir, 'zap');
    expect(readFileSync(join(dir, 'SKILL.md'), 'utf8')).toContain('v1');
    expect(existsSync(join(dir, 'assets', 'core.js'))).toBe(true);
    const marker = JSON.parse(readFileSync(join(dir, '.foundry.json'), 'utf8'));
    expect(marker).toMatchObject({ catalogId: 'zap', repo: 'bundled:bundled/zap', path: 'bundled/zap', ref: null, commit: hashSkillFolder(bundled) });
    const st = (await manager.status()).find((s) => s.entry.id === 'zap')!;
    expect(st.status).toBe('installed');
    expect(st.detail).toContain("Foundry's bundled copy @ ");
    expect(st.manual).toBeNull();
  });

  test('installing the same snapshot again changes nothing; a refreshed snapshot replaces the copy and keeps the old one in the trash', async () => {
    const before = listTrash(fake.paths).length;
    const same = await manager.install('zap');
    expect(same.ok).toBe(true);
    expect(listTrash(fake.paths)).toHaveLength(before);
    writeSnapshot('v2');
    const r = await manager.install('zap');
    expect(r.ok).toBe(true);
    expect(r.commit).toBe(hashSkillFolder(bundled));
    expect(readFileSync(join(fake.paths.skillsDir, 'zap', 'SKILL.md'), 'utf8')).toContain('v2');
    expect(listTrash(fake.paths)).toHaveLength(before + 1);
    const marker = JSON.parse(readFileSync(join(fake.paths.skillsDir, 'zap', '.foundry.json'), 'utf8'));
    expect(marker.updatedAt).toBeTruthy();
  });

  test('a pack install (the Settings picker) installs a bundled member like a git one', async () => {
    rmSync(join(fake.paths.skillsDir, 'zap'), { recursive: true, force: true });
    const { results } = await manager.installPack('figure', 'zap');
    expect(results.map((r) => [r.name, r.action])).toEqual([['zap', 'installed']]);
    expect(existsSync(join(fake.paths.skillsDir, 'zap', 'SKILL.md'))).toBe(true);
    const again = await manager.installPack('figure', 'zap');
    expect(again.results.map((r) => [r.name, r.action])).toEqual([['zap', 'kept']]);
  });

  test('a folder of the same name that Foundry did not install is left alone unless forced', async () => {
    rmSync(join(fake.paths.skillsDir, 'zap'), { recursive: true, force: true });
    mkdirSync(join(fake.paths.skillsDir, 'zap'), { recursive: true });
    writeFileSync(join(fake.paths.skillsDir, 'zap', 'SKILL.md'), skillMd('zap', 'mine'));
    await expect(manager.install('zap')).rejects.toMatchObject({ code: 'conflict' });
    const r = await manager.install('zap', { force: true });
    expect(r.ok).toBe(true);
    expect(readFileSync(join(fake.paths.skillsDir, 'zap', 'SKILL.md'), 'utf8')).toContain('v2');
  });
});
