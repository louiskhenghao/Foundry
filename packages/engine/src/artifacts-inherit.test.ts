import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { copyArtifacts, inheritArtifacts, listArtifacts } from './workspace.ts';

test("a task worktree inherits the goal's artifacts, and only what it changed or added comes back", () => {
  const goal = mkdtempSync(join(tmpdir(), 'foundry-art-goal-'));
  const task = mkdtempSync(join(tmpdir(), 'foundry-art-task-'));
  mkdirSync(join(goal, 'artifacts'), { recursive: true });
  writeFileSync(join(goal, 'artifacts', 'pipe.step'), 'pipe v1');
  writeFileSync(join(goal, 'artifacts', 'clamp.step'), 'clamp v1');
  expect(inheritArtifacts(goal, task)).toBe(2);
  expect(listArtifacts(task)).toEqual(['clamp.step', 'pipe.step']);
  // meanwhile another task exported a newer pipe; this one touched only the clamp and added its drawing
  writeFileSync(join(goal, 'artifacts', 'pipe.step'), 'pipe v2');
  writeFileSync(join(task, 'artifacts', 'clamp.step'), 'clamp v2');
  writeFileSync(join(task, 'artifacts', 'clamp.pdf'), 'drawing');
  expect(copyArtifacts(task, goal)).toBe(2);
  expect(readFileSync(join(goal, 'artifacts', 'pipe.step'), 'utf8')).toBe('pipe v2');
  expect(readFileSync(join(goal, 'artifacts', 'clamp.step'), 'utf8')).toBe('clamp v2');
  expect(listArtifacts(goal)).toEqual(['clamp.pdf', 'clamp.step', 'pipe.step']);
  // a workspace that inherited nothing copies everything, as media tasks always did
  const media = mkdtempSync(join(tmpdir(), 'foundry-art-media-'));
  mkdirSync(join(media, 'artifacts'));
  writeFileSync(join(media, 'artifacts', 'poster.png'), 'png');
  expect(copyArtifacts(media, goal)).toBe(1);
});

test("artifacts copied into a worktree that runs checks leave alone what git tracks, and mirror a task's inherited files unless only its changes are asked for", async () => {
  const { copyUntrackedArtifacts } = await import('./workspace.ts');
  const { makeRepo, sh } = await import('./test-helpers.ts');
  // the repository keeps a file of its own under artifacts/
  const repo = await makeRepo();
  mkdirSync(join(repo, 'artifacts'), { recursive: true });
  writeFileSync(join(repo, 'artifacts', 'abi.json'), 'v1');
  await sh('git add artifacts/abi.json && git commit -qm abi', repo);
  const check = join(mkdtempSync(join(tmpdir(), 'foundry-art-check-')), 'wt');
  await sh(`git worktree add -q --detach "${check}" HEAD`, repo);
  // the source changed the tracked file and made an export git does not track
  writeFileSync(join(repo, 'artifacts', 'abi.json'), 'v2');
  writeFileSync(join(repo, 'artifacts', 'part.step'), 'part');
  expect(await copyUntrackedArtifacts(repo, check)).toEqual(['part.step']);
  expect(readFileSync(join(check, 'artifacts', 'abi.json'), 'utf8')).toBe('v1');
  // no tracked file changed: a merge or checkout in that worktree is not refused
  expect(await sh('git status --porcelain --untracked-files=no', check)).toBe('');
  // a task worktree that inherited the export: mirrored by default, left out when only the task's changes are asked for
  const task = mkdtempSync(join(tmpdir(), 'foundry-art-task-'));
  inheritArtifacts(join(check), task);
  const fresh = mkdtempSync(join(tmpdir(), 'foundry-art-fresh-'));
  expect(await copyUntrackedArtifacts(task, fresh, { onlyChanged: true })).toEqual([]);
  expect((await copyUntrackedArtifacts(task, fresh)).sort()).toEqual(['abi.json', 'part.step']);
});

test('the artifacts listing follows no symbolic link: one pointing outside is not listed through, one pointing at its own folder does not empty the listing', () => {
  const { symlinkSync } = require('node:fs') as typeof import('node:fs');
  const ws = mkdtempSync(join(tmpdir(), 'foundry-art-links-'));
  const outside = mkdtempSync(join(tmpdir(), 'foundry-art-outside-'));
  writeFileSync(join(outside, 'key.png'), 'not the goal');
  mkdirSync(join(ws, 'artifacts', 'sub'), { recursive: true });
  writeFileSync(join(ws, 'artifacts', 'top.png'), 'png');
  writeFileSync(join(ws, 'artifacts', 'sub', 'a.png'), 'png');
  writeFileSync(join(ws, 'artifacts', '.inherited.json'), '{}');
  symlinkSync(outside, join(ws, 'artifacts', 'linkdir'));
  symlinkSync(join(outside, 'key.png'), join(ws, 'artifacts', 'linkfile.png'));
  symlinkSync('..', join(ws, 'artifacts', 'sub', 'loop'));
  expect(listArtifacts(ws)).toEqual(['sub/a.png', 'top.png']);
  // a symbolic link in place of the folder itself lists nothing
  const linked = mkdtempSync(join(tmpdir(), 'foundry-art-linked-'));
  symlinkSync(join(ws, 'artifacts'), join(linked, 'artifacts'));
  expect(listArtifacts(linked)).toEqual([]);
});
