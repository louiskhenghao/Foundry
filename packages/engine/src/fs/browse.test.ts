import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BrowseError, listDirs, pickFolder, wellKnownRoots } from './browse.ts';

function tree() {
  const root = mkdtempSync(join(tmpdir(), 'browse-'));
  mkdirSync(join(root, 'b-repo', '.git'), { recursive: true });
  mkdirSync(join(root, 'a-plain'));
  mkdirSync(join(root, '.hidden'));
  mkdirSync(join(root, 'node_modules', 'x'), { recursive: true });
  writeFileSync(join(root, 'file.txt'), 'x');
  return root;
}

describe('listDirs', () => {
  test('lists only directories, sorted, with git flag; hides dotfiles and node_modules', () => {
    const root = tree();
    const l = listDirs(root, { roots: [root] });
    expect(l.entries.map((e) => e.name)).toEqual(['a-plain', 'b-repo']);
    expect(l.entries[1]!.isGitRepo).toBe(true);
    expect(l.entries[0]!.isGitRepo).toBe(false);
    expect(l.parent).toBeNull(); // root itself has no parent inside the allowed roots
  });
  test('showHidden includes dot directories', () => {
    const root = tree();
    expect(listDirs(root, { roots: [root], showHidden: true }).entries.map((e) => e.name)).toContain('.hidden');
  });
  test('parent stays inside roots', () => {
    const root = tree();
    const l = listDirs(join(root, 'a-plain'), { roots: [root] });
    expect(l.parent).toBe(root);
  });
  test('refuses paths outside roots and missing paths', () => {
    const root = tree();
    expect(() => listDirs('/', { roots: [root] })).toThrow(BrowseError);
    expect(() => listDirs(join(root, 'nope'), { roots: [root] })).toThrow(/does not exist/);
    expect(() => listDirs(join(root, 'file.txt'), { roots: [root] })).toThrow(/not a directory/);
  });
});

describe('wellKnownRoots', () => {
  test('includes home and only existing folders', () => {
    const home = tree();
    mkdirSync(join(home, 'Projects'));
    const roots = wellKnownRoots(home);
    expect(roots[0]).toEqual({ label: 'Home', path: home });
    expect(roots.map((r) => r.label)).toContain('Projects');
    expect(roots.map((r) => r.label)).not.toContain('Developer');
  });
});

describe('pickFolder', () => {
  test('rejects on non-darwin', async () => {
    await expect(pickFolder({ platform: 'linux' })).rejects.toThrow(/macOS/);
  });
  test('maps osascript cancel (-128) to cancelled and strips trailing slash', async () => {
    const cancel = await pickFolder({ platform: 'darwin', run: async () => ({ code: 1, stdout: '', stderr: 'execution error: User canceled. (-128)' }) });
    expect(cancel).toEqual({ path: null, cancelled: true });
    const ok = await pickFolder({ platform: 'darwin', run: async () => ({ code: 0, stdout: '/Users/me/Projects/x/\n', stderr: '' }) });
    expect(ok).toEqual({ path: '/Users/me/Projects/x', cancelled: false });
  });
  test('serialises concurrent dialogs', async () => {
    let calls = 0;
    const run = async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 20));
      return { code: 0, stdout: '/tmp/a\n', stderr: '' };
    };
    const [a, b] = await Promise.all([pickFolder({ platform: 'darwin', run }), pickFolder({ platform: 'darwin', run })]);
    expect(calls).toBe(1);
    expect(a).toEqual(b);
  });
});
