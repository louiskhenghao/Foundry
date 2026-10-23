import { afterAll, describe, expect, test } from 'bun:test';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { SkillDirIndex, dirFiles, dirFingerprint } from './sources.ts';

const root = mkdtempSync(join(tmpdir(), 'foundry-sources-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function skill(name: string, files: Record<string, string>): string {
  const dir = join(root, name);
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), text);
  }
  return dir;
}

describe('skill fingerprints', () => {
  test("a skill's installed dependencies are not part of its bytes", () => {
    const plain = skill('plain', { 'SKILL.md': '# s', 'lib/a.ts': 'a' });
    const withDeps = skill('with-deps', { 'SKILL.md': '# s', 'lib/a.ts': 'a', 'node_modules/x/index.js': 'x', 'lib/node_modules/y.js': 'y' });
    expect(dirFiles(withDeps).map(([p]) => p)).toEqual(['SKILL.md', 'lib/a.ts']);
    expect(dirFingerprint(withDeps)).toBe(dirFingerprint(plain));
  });

  test('an edit, an added file and a removed file change the fingerprint', () => {
    const dir = skill('edited', { 'SKILL.md': '# v1', 'notes.md': 'aa' });
    const first = dirFingerprint(dir);
    // the same length as before: only the bytes and the time of writing tell the edit
    writeFileSync(join(dir, 'notes.md'), 'ab');
    utimesSync(join(dir, 'notes.md'), new Date('2026-01-02T00:00:00Z'), new Date('2026-01-02T00:00:00Z'));
    const edited = dirFingerprint(dir);
    expect(edited).not.toBe(first);
    writeFileSync(join(dir, 'more.md'), 'm');
    const added = dirFingerprint(dir);
    expect(added).not.toBe(edited);
    rmSync(join(dir, 'more.md'));
    expect(dirFingerprint(dir)).toBe(edited);
  });

  test('a folder whose files have not changed is not read again', () => {
    const dir = skill('unchanged', { 'SKILL.md': '# s', 'data.bin': 'bytes' });
    const first = dirFingerprint(dir);
    // unreadable from now on: a walk that read the file again would fail
    chmodSync(join(dir, 'data.bin'), 0o000);
    try {
      expect(dirFingerprint(dir)).toBe(first);
    } finally {
      chmodSync(join(dir, 'data.bin'), 0o644);
    }
  });
});

describe('SkillDirIndex', () => {
  test('finds the folders of a name in a clone once, shallowest first, without dot folders and node_modules', () => {
    const clone = skill('clone', { 'x/SKILL.md': '# x', 'skills/a/x/SKILL.md': '# x', 'skills/y/SKILL.md': '# y', 'node_modules/x/SKILL.md': 'no', '.hidden/x/SKILL.md': 'no', 'x/README.md': 'r' });
    const index = new SkillDirIndex();
    expect(index.find(clone, 'x')).toEqual(['x', 'skills/a/x']);
    expect(index.find(clone, 'y')).toEqual(['skills/y']);
    expect(index.find(clone, 'z')).toEqual([]);
    // a folder added after the first look is not seen by the same index: it stands for one report
    writeFileSync(join(clone, 'z'), '');
    expect(index.find(clone, 'z')).toEqual([]);
  });
});
