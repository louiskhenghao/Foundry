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
