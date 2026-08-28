import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initRepo, inspectRepo } from './git-init.ts';

describe('git-init', () => {
  test('inspect + init on a plain directory', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'foundry-init-'));
    writeFileSync(join(dir, 'a.txt'), 'a');
    const before = await inspectRepo(dir);
    expect(before).toMatchObject({ exists: true, isDir: true, isGitRepo: false, insideRepoAt: null });
    const r = await initRepo(dir);
    expect(r.branch).toBe('main');
    expect(r.filesCommitted).toBe(2); // a.txt + .gitignore
    expect(r.gitignoreWritten).toBe(true);
    expect(existsSync(join(dir, '.gitignore'))).toBe(true);
    const after = await inspectRepo(dir);
    expect(after).toMatchObject({ isGitRepo: true, branch: 'main', hasCommits: true, dirty: false, remotes: [] });
    await expect(initRepo(dir)).rejects.toThrow(/already a git repository/);
  });

  test('refuses nested init and keeps an existing .gitignore', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'foundry-init2-'));
    writeFileSync(join(dir, '.gitignore'), 'custom\n');
    await initRepo(dir);
    const { readFileSync } = await import('node:fs');
    expect(readFileSync(join(dir, '.gitignore'), 'utf8')).toBe('custom\n');
    const sub = join(dir, 'sub');
    mkdirSync(sub);
    const info = await inspectRepo(sub);
    expect(info.isGitRepo).toBe(false);
    expect(info.insideRepoAt).toBeTruthy();
    await expect(initRepo(sub)).rejects.toThrow(/inside the git repository/);
  });

  test('missing path', async () => {
    expect((await inspectRepo('/definitely/not/here')).exists).toBe(false);
    await expect(initRepo('/definitely/not/here')).rejects.toThrow(/not a directory/);
  });
});
