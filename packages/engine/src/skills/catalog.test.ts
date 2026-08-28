import { afterAll, describe, expect, test } from 'bun:test';
import { rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { catalogStatus, loadCatalog } from './catalog.ts';
import { makeFakeHome, writeCatalog } from './fake-home.test-helper.ts';
import { formatSkillsHint } from './hints.ts';
import { scanSkills } from './scanner.ts';

const fake = makeFakeHome();
afterAll(() => rmSync(fake.home, { recursive: true, force: true }));

describe('catalog', () => {
  test('the shipped catalog parses and has exactly one required entry (graphify)', () => {
    const c = loadCatalog(resolve(import.meta.dir, '../../../../catalog/skills.json'));
    expect(c.entries.length).toBeLessThanOrEqual(40);
    expect(c.entries.filter((e) => e.tier === 'required').map((e) => e.id)).toEqual(['graphify']);
    for (const e of c.entries) expect(e.why.length).toBeGreaterThan(20);
  });

  test('rejects duplicate ids and bad shapes', () => {
    const p = writeCatalog(join(fake.home, 'cat-bad'), [
      { id: 'a', name: 'a', summary: '', why: '', tier: 'optional', source: { type: 'git', repo: 'o/r' } },
      { id: 'a', name: 'b', summary: '', why: '', tier: 'optional', source: { type: 'git', repo: 'o/r' } },
    ]);
    expect(() => loadCatalog(p)).toThrow(/duplicate/);
    const p2 = writeCatalog(join(fake.home, 'cat-bad2'), [{ id: 'x', tier: 'nope' }]);
    expect(() => loadCatalog(p2)).toThrow(/invalid/);
  });

  test('status: installed / unmanaged / via-plugin / partial / missing / manual', () => {
    const p = writeCatalog(join(fake.home, 'cat'), [
      { id: 'managed', name: 'managed', summary: '', why: '', tier: 'recommended', source: { type: 'git', repo: 'o/r' }, roles: ['worker'] },
      { id: 'plain', name: 'plain', summary: '', why: '', tier: 'recommended', source: { type: 'git', repo: 'o/r' }, roles: ['worker'] },
      { id: 'diagnosing-bugs', name: 'diagnosing-bugs', summary: '', why: '', tier: 'recommended', source: { type: 'git', repo: 'o/r' }, roles: ['worker'] },
      { id: 'nothere', name: 'nothere', summary: '', why: '', tier: 'recommended', source: { type: 'git', repo: 'o/r' }, roles: ['merger'] },
      { id: 'graphify', name: 'graphify', summary: '', why: '', tier: 'required', source: { type: 'cli', detect: 'graphify', install: 'uv tool install graphifyy' }, roles: ['clarifier'] },
      { id: 'gstack', name: 'gstack', summary: '', why: '', tier: 'optional', source: { type: 'manual', install: 'git clone …', detectDir: 'gstack' } },
    ]);
    const catalog = loadCatalog(p);
    const scan = scanSkills(fake.paths);
    const st = catalogStatus(catalog, scan, fake.paths, (bin) => (bin === 'graphify' ? '/usr/local/bin/graphify' : null));
    const s = (id: string) => st.find((x) => x.entry.id === id)!;
    expect(s('managed')).toMatchObject({ status: 'installed', commit: 'abc1234', installedInvoke: '/managed' });
    expect(s('plain').status).toBe('installed-unmanaged');
    expect(s('diagnosing-bugs')).toMatchObject({ status: 'installed-via-plugin', installedInvoke: '/mp-skills:diagnosing-bugs' });
    expect(s('nothere').status).toBe('missing');
    expect(s('graphify')).toMatchObject({ status: 'partial', manual: { command: 'uv tool install graphifyy' } });
    expect(s('gstack').status).toBe('installed-unmanaged');
    const none = catalogStatus(catalog, scan, fake.paths, () => null);
    expect(none.find((x) => x.entry.id === 'graphify')!.status).toBe('missing');

    // hints: worker gets the three satisfied worker skills, merger gets nothing
    expect(formatSkillsHint('worker', st)).toBe('Installed skills relevant to this role (use when appropriate): /managed, /plain, /mp-skills:diagnosing-bugs');
    expect(formatSkillsHint('merger', st)).toBeNull();
  });

  test('requiresEnv: missingEnv lists what the env probe cannot satisfy', () => {
    const p = writeCatalog(join(fake.home, 'cat-env'), [
      { id: 'managed', name: 'managed', summary: '', why: '', tier: 'recommended', source: { type: 'git', repo: 'o/r' }, roles: ['worker'], requiresEnv: ['OPENAI_API_KEY', 'OTHER_KEY'] },
    ]);
    const catalog = loadCatalog(p);
    const scan = scanSkills(fake.paths);
    const withKey = catalogStatus(catalog, scan, fake.paths, () => null, (n) => n === 'OPENAI_API_KEY');
    expect(withKey[0]!.missingEnv).toEqual(['OTHER_KEY']);
    const noKeys = catalogStatus(catalog, scan, fake.paths, () => null, () => false);
    expect(noKeys[0]!.missingEnv).toEqual(['OPENAI_API_KEY', 'OTHER_KEY']);
    const all = catalogStatus(catalog, scan, fake.paths, () => null, () => true);
    expect(all[0]!.missingEnv).toEqual([]);
  });
});
