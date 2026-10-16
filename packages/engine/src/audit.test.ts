import { describe, expect, test } from 'bun:test';
import { rmSync } from 'node:fs';
import { inScope, touchedFiles } from './audit.ts';
import { makeRepo, sh } from './test-helpers.ts';

describe('the audit scope', () => {
  test('a finding is in scope only when it names a file the goal changed, never a folder holding one', () => {
    const touched = new Set(['packages/engine/src/audit.ts', 'src/a/b/c.ts']);
    expect(inScope(['packages/engine/src/audit.ts'], touched)).toBe(true);
    expect(inScope(['./packages/engine/src/audit.ts'], touched)).toBe(true);
    expect(inScope(['README.md', 'src/a/b/c.ts'], touched)).toBe(true);
    expect(inScope(['packages'], touched)).toBe(false);
    expect(inScope(['packages/engine/'], touched)).toBe(false);
    expect(inScope(['src'], touched)).toBe(false);
    expect(inScope([''], touched)).toBe(false);
    expect(inScope([], touched)).toBe(false);
  });

  test('the files a goal changed: its branch since it left the base, names kept whole', async () => {
    const repo = await makeRepo('foundry-audit-');
    const commit = 'git -c user.name=t -c user.email=t@t add -A && git -c user.name=t -c user.email=t@t commit -q -m';
    try {
      await sh(`git checkout -q -b goal/x && mkdir -p "src/a b" && printf x > "src/a b/it's.ts" && printf y > plain.ts && ${commit} work`, repo);
      // the base moves on after the branch point: not the goal's doing
      await sh(`git checkout -q main && printf z > moved.ts && ${commit} moved && git checkout -q goal/x`, repo);
      expect([...(await touchedFiles(repo, 'main'))].sort()).toEqual(['plain.ts', "src/a b/it's.ts"]);
      expect(await touchedFiles(repo, 'no-such-branch')).toEqual(new Set());
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});
