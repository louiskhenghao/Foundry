import { describe, expect, test } from 'bun:test';
import { SkillsHints } from './hints.ts';
import { CatalogEntry, type CatalogEntryStatus } from './types.ts';

const tdd: CatalogEntryStatus = {
  entry: CatalogEntry.parse({ id: 'tdd', name: 'tdd', summary: '', why: '', tier: 'recommended', source: { type: 'git', repo: 'o/r' }, roles: ['worker'], workflow: [{ role: 'worker', mandate: 'must', when: 'feature', instruction: 'test first' }] }),
  status: 'installed',
  installedInvoke: '/tdd',
  commit: null,
  detail: '',
  manual: null,
  missingEnv: [],
};

describe('SkillsHints and the workflow suite (ADR-0049)', () => {
  test("a call's profile wins over the Settings default; plain mandates nothing", async () => {
    const hints = new SkillsHints(async () => [tdd], { profile: () => 'mattpocock' });
    expect(await hints.sectionFor('worker', { taskKind: 'feature' })).toContain("Matt Pocock's engineering workflow");
    expect(await hints.sectionFor('worker', { taskKind: 'feature', profile: 'pstack' })).toContain("pstack's engineering workflow");
    expect((await hints.sectionFor('worker', { taskKind: 'feature', profile: 'plain' }))!.startsWith('# Skills\n')).toBe(true);
    expect((await hints.mandatedFor('worker', { taskKind: 'feature' })).map((m) => m.invoke)).toEqual(['/tdd']);
    expect((await hints.mandatedFor('worker', { taskKind: 'feature', profile: 'pstack' })).map((m) => m.invoke)).toEqual(['/tdd']);
    expect(await hints.mandatedFor('worker', { taskKind: 'feature', profile: 'plain' })).toEqual([]);
  });
  test('without a Settings default the suite is mattpocock', async () => {
    const hints = new SkillsHints(async () => [tdd]);
    expect(await hints.sectionFor('worker', { taskKind: 'feature' })).toContain("Matt Pocock's engineering workflow");
  });
});
