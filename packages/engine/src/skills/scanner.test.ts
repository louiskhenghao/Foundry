import { afterAll, describe, expect, test } from 'bun:test';
import { rmSync } from 'node:fs';
import { makeFakeHome } from './fake-home.test-helper.ts';
import { parseSkillMd } from './frontmatter.ts';
import { scanSkills } from './scanner.ts';

const fake = makeFakeHome();
afterAll(() => rmSync(fake.home, { recursive: true, force: true }));

describe('frontmatter', () => {
  test('quoted, folded and literal descriptions', () => {
    expect(parseSkillMd('---\nname: a\ndescription: "Hello there"\n---\n').description).toBe('Hello there');
    expect(parseSkillMd('---\nname: a\ndescription: >\n  line one\n  line two\nversion: 1.0.0\n---\n')).toMatchObject({ description: 'line one line two', version: '1.0.0' });
    expect(parseSkillMd('---\ndescription: |\n  keep\n  lines\n---\n').description).toBe('keep\nlines');
    expect(parseSkillMd('no frontmatter').description).toBe('');
  });
});

describe('scanner', () => {
  const scan = scanSkills(fake.paths, { repoPath: fake.repo });
  const by = (name: string, scope = 'user') => scan.installed.find((r) => r.name === name && r.scope === scope)!;

  test('classifies every provenance family', () => {
    expect(by('plain').managedBy).toBeNull();
    expect(by('plain').description).toBe('Quoted description');
    expect(by('linked')).toMatchObject({ managedBy: 'agents-cli', symlink: { broken: false }, description: 'folded block description' });
    expect(by('broken')).toMatchObject({ managedBy: 'agents-cli', symlink: { broken: true }, canUninstall: true });
    expect(by('gstack')).toMatchObject({ managedBy: 'gstack', canUninstall: false });
    expect(by('autoplan')).toMatchObject({ managedBy: 'gstack-copy', canUninstall: true });
    expect(by('withmanifest')).toMatchObject({ managedBy: 'manifest', version: '1.2.3', manifest: { homepage: 'https://example.com/x' } });
    expect(by('managed')).toMatchObject({ managedBy: 'ai-engine', marker: { catalogId: 'managed', commit: 'abc1234' } });
    expect(by('empty-dir')).toMatchObject({ unparsable: true, skillMd: null });
  });

  test('gstack subdirectories are not enumerated as skills', () => {
    expect(scan.installed.filter((r) => r.dir.includes('/gstack/') && r.scope === 'user')).toHaveLength(0);
  });

  test('plugins: array form, dir form, and a broken install path', () => {
    expect(by('tdd', 'plugin')).toMatchObject({ invoke: '/mp-skills:tdd', managedBy: 'plugin', canUninstall: false, plugin: { id: 'mp-skills@mkt' } });
    expect(by('diagnosing-bugs', 'plugin').invoke).toBe('/mp-skills:diagnosing-bugs');
    expect(by('design', 'plugin').invoke).toBe('/ui:design');
    expect(by('ghost', 'plugin')).toMatchObject({ unparsable: true });
  });

  test('project skills incl. symlinked ones', () => {
    expect(by('proj-real', 'project')).toMatchObject({ managedBy: 'project', canUninstall: false });
    expect(by('proj-linked', 'project').symlink?.target).toContain('skills/proj-linked');
  });

  test('duplicates across user and plugin', () => {
    expect(scan.duplicates).toEqual(['tdd']);
    expect(by('tdd').duplicateOf).toEqual(['/mp-skills:tdd']);
    expect(by('tdd', 'plugin').duplicateOf).toEqual(['/tdd']);
  });
});
