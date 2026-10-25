import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exec } from '@foundry/engine';
import { FileRefused, commitTree, deliveredArtifacts, deliveredFile, fileKind, goalFileSource, landedPath, parseNameStatus, parsePorcelain, pathInGoal, resolveServable, servedType, taskFileSource, taskMadeFiles } from './files.ts';

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

  test('a finished task is read from its commit once its folders are gone; a running one from its worktree', async () => {
    const base = tmp();
    const repo = join(base, 'repo');
    mkdirSync(repo);
    const git = (...args: string[]) => exec(['git', ...args], repo);
    await git('init', '-q', '-b', 'main');
    writeFileSync(join(repo, 'a.ts'), 'a');
    await git('add', '-A');
    await git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'init');
    const baseRef = (await git('rev-parse', 'HEAD')).stdout.trim();
    mkdirSync(join(repo, 'art'));
    writeFileSync(join(repo, 'art', 'hero image.png'), 'png-bytes');
    writeFileSync(join(repo, 'a.ts'), 'b');
    await git('add', '-A');
    await git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'work');
    const commitRef = (await git('rev-parse', 'HEAD')).stdout.trim();
    // the user's checkout moves on: the file the task wrote is changed afterwards
    writeFileSync(join(repo, 'a.ts'), 'later');
    const workspaceDir = join(base, 'Goal-x');
    const goal = { id: 'g1', workspaceDir, repoPath: repo } as never;
    const gone = join(base, '.foundry', 'Goal-x', 'tasks', 't1');
    const task = { id: 't1', state: 'done', worktreePath: gone, commitRef, baseRef, updatedAt: new Date().toISOString(), relevantFiles: [] } as never;

    const tree = await commitTree(repo, commitRef, exec);
    expect([...tree.keys()].sort()).toEqual(['a.ts', 'art/hero image.png']);
    expect(await taskFileSource('/data', goal, task, 'a.ts', exec)).toEqual({ kind: 'commit', repo, ref: commitRef, rel: 'a.ts', size: 1 });
    expect(await taskFileSource('/data', goal, task, 'art/hero image.png', exec)).toMatchObject({ kind: 'commit', size: 9 });
    expect(await taskFileSource('/data', goal, task, 'never-made.ts', exec)).toBeNull();
    expect(await taskFileSource('/data', goal, task, '../secret', exec)).toBeNull();
    expect(await taskFileSource('/data', goal, task, '.env', exec)).toBeNull();

    const made = await taskMadeFiles('/data', goal, task, [], exec);
    expect(made.rels.sort()).toEqual(['a.ts', 'art/hero image.png']);

    // a live-log path into the removed worktree names the task and the file
    const hit = pathInGoal(join(gone, 'art', 'hero image.png'), '/data', [{ goal, tasks: [task] }]);
    expect(hit).toMatchObject({ rel: 'art/hero image.png' });
    expect(hit!.task).toBe(task);
    expect(await goalFileSource(goal, [task], 'a.ts', exec)).toMatchObject({ kind: 'commit', ref: commitRef });

    // while it runs, its worktree has the newest bytes
    const running = { ...(task as object), state: 'running', worktreePath: repo, commitRef: null } as never;
    expect(await taskFileSource('/data', goal, running, 'a.ts', exec)).toMatchObject({ kind: 'folder', size: 5 });
    writeFileSync(join(repo, 'draft.md'), '# wip');
    expect((await taskMadeFiles('/data', goal, running, [], exec)).rels.sort()).toEqual(['a.ts', 'art/hero image.png', 'draft.md']);
  });

  test('images an image goal wrote outside git belong to the task that ran when they were written', async () => {
    const workspaceDir = join(tmp(), 'Goal-img');
    mkdirSync(join(workspaceDir, 'artifacts', 'posters'), { recursive: true });
    const poster = join(workspaceDir, 'artifacts', 'posters', 'v1.png');
    const older = join(workspaceDir, 'artifacts', 'old.png');
    writeFileSync(poster, 'p');
    writeFileSync(older, 'o');
    const hourAgo = new Date(Date.now() - 3600_000);
    utimesSync(older, hourAgo, hourAgo);
    const goal = { id: 'g2', workspaceDir, repoPath: workspaceDir } as never;
    const sibling = join(workspaceDir, 'artifacts', 'story.png');
    writeFileSync(sibling, 's');
    const window = [{ startedAt: new Date(Date.now() - 60_000).toISOString(), endedAt: new Date().toISOString() }];
    const task = { id: 't2', state: 'done', worktreePath: null, commitRef: null, updatedAt: new Date().toISOString(), spec: 'Make the poster', relevantFiles: [] } as never;
    expect((await taskMadeFiles('/data', goal, task, window, exec)).artifacts.sort()).toEqual([poster, sibling].sort());
    // a task that ran beside another: the files its plan names are its own
    const named = { ...(task as object), relevantFiles: ['artifacts/posters/v1.png'] } as never;
    expect((await taskMadeFiles('/data', goal, named, window, exec)).artifacts).toEqual([poster]);
  });
});

describe('a path in a merged task', () => {
  test("a removed task worktree's file is read from the progress folder", () => {
    const base = tmp();
    const workspaceDir = join(base, 'Goal-abc');
    mkdirSync(join(workspaceDir, 'public'), { recursive: true });
    writeFileSync(join(workspaceDir, 'public', 'card.svg'), '<svg/>');
    const goal = { id: 'g1', workspaceDir, repoPath: base } as never;
    const gone = join(base, '.foundry', 'Goal-abc', 'tasks', 't_1', 'public', 'card.svg');
    expect(landedPath(gone, '/data', [goal])).toBe(join(workspaceDir, 'public', 'card.svg'));
    expect(landedPath(join(base, '.foundry', 'Goal-abc', 'tasks', 't_1', 'nope.txt'), '/data', [goal])).toBeNull();
    expect(landedPath(join(workspaceDir, 'public', 'card.svg'), '/data', [goal])).toBeNull();
    expect(landedPath('/elsewhere/tasks/t_1/public/card.svg', '/data', [goal])).toBeNull();
  });
});

import { fileResponse } from './files.ts';
import { bodyCapMb } from './app.ts';

describe('a file the browser may seek in (ADR-0077)', () => {
  const dir = tmp();
  const clip = join(dir, 'clip.bin');
  writeFileSync(clip, 'abcdefghij'); // 10 bytes
  const get = (range?: string) => fileResponse(clip, new Request('http://x/clip', { headers: range ? { range } : {} }), { 'content-type': 'video/mp4' });
  test('no Range: the whole file, with Accept-Ranges', async () => {
    const r = get();
    expect(r.status).toBe(200);
    expect(r.headers.get('accept-ranges')).toBe('bytes');
    expect(await r.text()).toBe('abcdefghij');
  });
  test('a range: 206 with the bytes it names and Content-Range', async () => {
    const r = get('bytes=2-4');
    expect(r.status).toBe(206);
    expect(r.headers.get('content-range')).toBe('bytes 2-4/10');
    expect(r.headers.get('content-length')).toBe('3');
    expect(r.headers.get('content-type')).toBe('video/mp4');
    expect(await r.text()).toBe('cde');
  });
  test('an open end and a suffix: to the last byte, and the last bytes', async () => {
    expect(await get('bytes=7-').text()).toBe('hij');
    expect(await get('bytes=-3').text()).toBe('hij');
    expect(get('bytes=2-99').headers.get('content-range')).toBe('bytes 2-9/10');
  });
  test('a range past the end: 416 with the size', () => {
    const r = get('bytes=20-30');
    expect(r.status).toBe(416);
    expect(r.headers.get('content-range')).toBe('bytes */10');
  });
});

describe('what a request may carry', () => {
  test('an upload may hold a media attachment; a Transfer file has no cap; anything else keeps to 30 MB', () => {
    expect(bodyCapMb('/api/goals/g_1/attachments', 'POST')).toBe(210);
    expect(bodyCapMb('/api/goals/g_1/materials/M1', 'POST')).toBe(210);
    expect(bodyCapMb('/api/goals/g_1/conversations', 'POST')).toBe(210);
    expect(bodyCapMb('/api/goals/g_1/conversations/c_1', 'POST')).toBe(210);
    expect(bodyCapMb('/api/transfer/incoming', 'POST')).toBeNull();
    expect(bodyCapMb('/api/goals', 'POST')).toBe(30);
    expect(bodyCapMb('/api/goals/g_1/attachments', 'GET')).toBe(30);
  });
});

describe('web pages (ADR-0076)', () => {
  test('html is a kind of its own, served as plain text unless the route renders it on request', () => {
    expect(fileKind('kettle.html')).toBe('html');
    expect(fileKind('Page.HTM')).toBe('html');
    expect(servedType('kettle.html')).toBe('text/plain; charset=utf-8');
    expect(fileKind('core.js')).toBe('text');
    expect(fileKind('shot.png')).toBe('image');
  });
});

describe("a goal's delivered copies (ADR-0076)", () => {
  test("stand in for a finished task's artifacts once the goal's folder is gone, and only the recorded files are reachable by path", async () => {
    const out = tmp();
    writeFileSync(join(out, 'toaster.html'), 'page');
    writeFileSync(join(out, 'core.js'), 'engine');
    writeFileSync(join(out, 'notes.txt'), 'the person\'s own');
    const goal = { id: 'g1', workspaceDir: join(tmp(), 'gone'), repoPath: tmp(), completion: { artifactsRun: { status: 'ok', files: ['toaster.html', 'core.js', 'missing.png'], dest: out } } } as never;
    expect(deliveredArtifacts(goal).map((p) => p.split('/').pop())).toEqual(['toaster.html', 'core.js']);
    expect(deliveredFile(join(out, 'toaster.html'), [goal])).toMatchObject({ rel: 'toaster.html', size: 4 });
    expect(deliveredFile(join(out, 'notes.txt'), [goal])).toBeNull();
    expect(deliveredFile(join(out, 'missing.png'), [goal])).toBeNull();
    const exec = async () => ({ code: 1, stdout: '' });
    // the task's plan names the page: that one is its own; a task naming nothing gets every copy
    const task = { id: 't1', state: 'done', worktreePath: null, commitRef: null, baseRef: null, updatedAt: new Date().toISOString(), relevantFiles: [], spec: 'draw it', delivers: ['artifacts/toaster.html'] } as never;
    expect((await taskMadeFiles('/data', goal, task, [], exec)).artifacts.map((p) => p.split('/').pop())).toEqual(['toaster.html']);
    const vague = { ...(task as object), delivers: [] } as never;
    expect((await taskMadeFiles('/data', goal, vague, [], exec)).artifacts.map((p) => p.split('/').pop())).toEqual(['toaster.html', 'core.js']);
    // a running task never reads the Output folder
    const running = { ...(task as object), state: 'running' } as never;
    expect((await taskMadeFiles('/data', goal, running, [], exec)).artifacts).toEqual([]);
  });
});
