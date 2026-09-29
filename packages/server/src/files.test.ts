import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exec } from '@foundry/engine';
import { FileRefused, fileKind, parseNameStatus, parsePorcelain, resolveServable, servedType, taskFiles } from './files.ts';

const tmp = () => realpathSync(mkdtempSync(join(tmpdir(), 'files-')));
const refused = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof FileRefused ? e.status : 'other';
  }
  return null;
};

describe('which files the UI may show', () => {
  test('a file inside a root is served; outside, through a symlink, in .git or a .env file is refused', () => {
    const root = tmp();
    const outside = tmp();
    mkdirSync(join(root, 'assets'));
    mkdirSync(join(root, '.git'));
    writeFileSync(join(root, 'assets', 'diagram check.md'), '# hi');
    writeFileSync(join(root, '.git', 'config'), '[core]');
    writeFileSync(join(root, '.env.local'), 'SECRET=1');
    writeFileSync(join(outside, 'secret.txt'), 'no');
    symlinkSync(join(outside, 'secret.txt'), join(root, 'link.txt'));

    expect(resolveServable(join(root, 'assets', 'diagram check.md'), [root])).toEqual({ abs: join(root, 'assets', 'diagram check.md'), size: 4 });
    expect(refused(() => resolveServable(join(outside, 'secret.txt'), [root]))).toBe(403);
    expect(refused(() => resolveServable(join(root, 'link.txt'), [root]))).toBe(403);
    expect(refused(() => resolveServable(join(root, 'assets', '..', '..', outside.split('/').pop()!, 'secret.txt'), [root]))).not.toBeNull();
    expect(refused(() => resolveServable(join(root, '.git', 'config'), [root]))).toBe(403);
    expect(refused(() => resolveServable(join(root, '.env.local'), [root]))).toBe(403);
    expect(refused(() => resolveServable('assets/diagram check.md', [root]))).toBe(400);
    expect(refused(() => resolveServable(join(root, 'assets'), [root]))).toBe(400);
    expect(refused(() => resolveServable(join(root, 'nope.png'), [root]))).toBe(404);
    // a sibling folder that merely starts with the root's name is not inside it
    const sibling = `${root}-other`;
    mkdirSync(sibling);
    writeFileSync(join(sibling, 'a.txt'), 'x');
    expect(refused(() => resolveServable(join(sibling, 'a.txt'), [root]))).toBe(403);
  });

  test('kind and served type come from the extension; markup is served as plain text', () => {
    expect(fileKind('shot.JPEG')).toBe('image');
    expect(fileKind('a.pdf')).toBe('pdf');
    expect(fileKind('clip.mp4')).toBe('video');
    expect(fileKind('notes.md')).toBe('markdown');
    expect(fileKind('package.json')).toBe('json');
    expect(fileKind('Dockerfile')).toBe('text');
    expect(fileKind('app.tsx')).toBe('text');
    expect(fileKind('archive.zip')).toBe('binary');
    expect(servedType('page.html')).toBe('text/plain; charset=utf-8');
    expect(servedType('logo.svg')).toBe('image/svg+xml');
    expect(servedType('a.pdf')).toBe('application/pdf');
    expect(servedType('archive.zip')).toBe('application/octet-stream');
  });
});

describe("a task's files", () => {
  test('git output with renames, deletions and spaces in names', () => {
    expect(parseNameStatus('M\0src/a.ts\0A\0docs/new file.md\0D\0gone.ts\0R100\0old.png\0img/new.png\0')).toEqual(['src/a.ts', 'docs/new file.md', 'img/new.png']);
    expect(parsePorcelain('?? out/shot 1.png\0 M src/a.ts\0 D gone.ts\0R  new.ts\0old.ts\0')).toEqual(['out/shot 1.png', 'src/a.ts', 'new.ts']);
  });

  test('a merged task lists its commit; a running one its worktree changes and new files', async () => {
    const repo = tmp();
    const git = (...args: string[]) => exec(['git', ...args], repo);
    await git('init', '-q', '-b', 'main');
    writeFileSync(join(repo, 'a.ts'), 'a');
    await git('add', '-A');
    await git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'init');
    const base = (await git('rev-parse', 'HEAD')).stdout.trim();
    mkdirSync(join(repo, 'art'));
    writeFileSync(join(repo, 'art', 'hero image.png'), 'png');
    writeFileSync(join(repo, 'a.ts'), 'b');
    await git('add', '-A');
    await git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'work');
    const commit = (await git('rev-parse', 'HEAD')).stdout.trim();
    const goal = { id: 'g1', workspaceDir: repo, repoPath: repo } as never;

    const merged = await taskFiles('/nowhere', goal, { worktreePath: null, commitRef: commit, baseRef: base } as never, exec);
    expect(merged.sort()).toEqual([join(repo, 'a.ts'), join(repo, 'art', 'hero image.png')]);

    writeFileSync(join(repo, 'draft.md'), '# wip');
    const running = await taskFiles('/nowhere', goal, { worktreePath: repo, commitRef: null, baseRef: base } as never, exec);
    expect(running.sort()).toEqual([join(repo, 'a.ts'), join(repo, 'art', 'hero image.png'), join(repo, 'draft.md')]);
  });
});
