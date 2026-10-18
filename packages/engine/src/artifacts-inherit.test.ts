import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { contentHash, copyArtifactFiles, copyInto, inheritArtifacts, listArtifacts } from './workspace.ts';

test("a task worktree inherits the goal's artifacts, and only what it changed or added comes back", async () => {
  const goal = mkdtempSync(join(tmpdir(), 'foundry-art-goal-'));
  const task = mkdtempSync(join(tmpdir(), 'foundry-art-task-'));
  mkdirSync(join(goal, 'artifacts'), { recursive: true });
  writeFileSync(join(goal, 'artifacts', 'pipe.step'), 'pipe v1');
  writeFileSync(join(goal, 'artifacts', 'clamp.step'), 'clamp v1');
  expect(await inheritArtifacts(goal, task)).toBe(2);
  expect(listArtifacts(task)).toEqual(['clamp.step', 'pipe.step']);
  // meanwhile another task exported a newer pipe; this one touched only the clamp and added its drawing
  writeFileSync(join(goal, 'artifacts', 'pipe.step'), 'pipe v2');
  writeFileSync(join(task, 'artifacts', 'clamp.step'), 'clamp v2');
  writeFileSync(join(task, 'artifacts', 'clamp.pdf'), 'drawing');
  expect(await copyArtifactFiles(task, goal)).toHaveLength(2);
  expect(readFileSync(join(goal, 'artifacts', 'pipe.step'), 'utf8')).toBe('pipe v2');
  expect(readFileSync(join(goal, 'artifacts', 'clamp.step'), 'utf8')).toBe('clamp v2');
  expect(listArtifacts(goal)).toEqual(['clamp.pdf', 'clamp.step', 'pipe.step']);
  // a workspace that inherited nothing copies everything, as media tasks always did
  const media = mkdtempSync(join(tmpdir(), 'foundry-art-media-'));
  mkdirSync(join(media, 'artifacts'));
  writeFileSync(join(media, 'artifacts', 'poster.png'), 'png');
  expect(await copyArtifactFiles(media, goal)).toHaveLength(1);
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
  await inheritArtifacts(join(check), task);
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

test('artifacts are never written through a symbolic link on the destination side', async () => {
  const { existsSync, lstatSync, symlinkSync } = await import('node:fs');
  const from = mkdtempSync(join(tmpdir(), 'foundry-art-from-'));
  mkdirSync(join(from, 'artifacts', 'sub'), { recursive: true });
  writeFileSync(join(from, 'artifacts', 'latest.png'), 'new');
  writeFileSync(join(from, 'artifacts', 'sub', 'a.png'), 'a');
  const outside = mkdtempSync(join(tmpdir(), 'foundry-art-outside-'));
  writeFileSync(join(outside, 'victim.png'), 'victim');
  mkdirSync(join(outside, 'elsewhere'));
  const to = mkdtempSync(join(tmpdir(), 'foundry-art-to-'));
  mkdirSync(join(to, 'artifacts'));
  symlinkSync(join(outside, 'victim.png'), join(to, 'artifacts', 'latest.png'));
  symlinkSync(join(outside, 'elsewhere'), join(to, 'artifacts', 'sub'));
  const failed: string[] = [];
  expect(await copyArtifactFiles(from, to, { onError: (f) => failed.push(f) })).toEqual(['latest.png']);
  // the link at the file is replaced by the file, the file it pointed at is untouched, and the linked folder is refused
  expect(readFileSync(join(outside, 'victim.png'), 'utf8')).toBe('victim');
  expect(lstatSync(join(to, 'artifacts', 'latest.png')).isSymbolicLink()).toBe(false);
  expect(readFileSync(join(to, 'artifacts', 'latest.png'), 'utf8')).toBe('new');
  expect(failed).toEqual(['sub/a.png']);
  expect(existsSync(join(outside, 'elsewhere', 'a.png'))).toBe(false);
  // an artifacts/ folder that is itself a link takes nothing
  const linked = mkdtempSync(join(tmpdir(), 'foundry-art-linked-to-'));
  symlinkSync(outside, join(linked, 'artifacts'));
  const refused: string[] = [];
  expect(await copyArtifactFiles(from, linked, { onError: (f) => refused.push(f) })).toEqual([]);
  expect(refused.sort()).toEqual(['latest.png', 'sub/a.png']);
});

test('a copy replaces the file instead of writing into it: a hard link is not written through, an unreadable folder is reported, a copy in progress is never an artifact', async () => {
  const { chmodSync, linkSync } = await import('node:fs');
  const from = mkdtempSync(join(tmpdir(), 'foundry-art-from-'));
  mkdirSync(join(from, 'artifacts', 'locked'), { recursive: true });
  writeFileSync(join(from, 'artifacts', 'part.step'), 'the task');
  writeFileSync(join(from, 'artifacts', 'locked', 'hidden.step'), 'x');
  writeFileSync(join(from, 'artifacts', '.foundry-part-1-0-left.step'), 'a copy cut short');
  const outside = mkdtempSync(join(tmpdir(), 'foundry-art-outside-'));
  writeFileSync(join(outside, 'victim.step'), 'victim');
  const to = mkdtempSync(join(tmpdir(), 'foundry-art-to-'));
  mkdirSync(join(to, 'artifacts'));
  linkSync(join(outside, 'victim.step'), join(to, 'artifacts', 'part.step'));
  const failed: string[] = [];
  const root = process.getuid?.() === 0;
  if (!root) chmodSync(join(from, 'artifacts', 'locked'), 0o000);
  try {
    expect(await copyArtifactFiles(from, to, { onError: (f) => failed.push(f) })).toEqual(['part.step']);
  } finally {
    chmodSync(join(from, 'artifacts', 'locked'), 0o755);
  }
  expect(readFileSync(join(outside, 'victim.step'), 'utf8')).toBe('victim');
  expect(readFileSync(join(to, 'artifacts', 'part.step'), 'utf8')).toBe('the task');
  if (!root) expect(failed).toEqual(['locked/']);
  expect(listArtifacts(to)).toEqual(['part.step']);
});

/** what a setImmediate loop saw of `dir`'s artifacts while `work` ran: a copy that never yields lets it see only the start */
const watch = async (dir: string, work: () => Promise<unknown>) => {
  const seen = new Set<number>();
  let running = true;
  const probe = () => {
    seen.add(listArtifacts(dir).length);
    if (running) setImmediate(probe);
  };
  setImmediate(probe);
  await work();
  running = false;
  return seen;
};

test('copies let the event loop run between files: a landing, an inheritance and a delivery are seen half done', async () => {
  const from = mkdtempSync(join(tmpdir(), 'foundry-art-from-'));
  mkdirSync(join(from, 'artifacts', 'parts'), { recursive: true });
  for (const n of ['a', 'b', 'c', 'd']) writeFileSync(join(from, 'artifacts', 'parts', `${n}.step`), n.repeat(1 << 16));
  const to = mkdtempSync(join(tmpdir(), 'foundry-art-to-'));
  const landing = await watch(to, () => copyArtifactFiles(from, to));
  expect([...landing].some((n) => n > 0 && n < 4)).toBe(true);
  expect(listArtifacts(to)).toHaveLength(4);
  const task = mkdtempSync(join(tmpdir(), 'foundry-art-task-'));
  const inheriting = await watch(task, () => inheritArtifacts(from, task));
  expect([...inheriting].some((n) => n > 0 && n < 4)).toBe(true);
  expect(readFileSync(join(task, 'artifacts', 'parts', 'b.step'), 'utf8')).toBe('b'.repeat(1 << 16));
  // the delivery's copy into the output folder lands whole, under its own name
  const out = join(mkdtempSync(join(tmpdir(), 'foundry-art-out-')), 'model.step');
  await copyInto(join(from, 'artifacts', 'parts', 'c.step'), out);
  expect(readFileSync(out, 'utf8')).toBe('c'.repeat(1 << 16));
});

test('a content digest reads a large export as a stream that lets the event loop run, and tells contents apart', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'foundry-art-hash-'));
  writeFileSync(join(dir, 'big.step'), Buffer.alloc(8 << 20, 7));
  writeFileSync(join(dir, 'same.step'), Buffer.alloc(8 << 20, 7));
  let ticks = 0;
  let running = true;
  const tick = () => {
    ticks++;
    if (running) setImmediate(tick);
  };
  setImmediate(tick);
  try {
    const digest = await contentHash(join(dir, 'big.step'));
    running = false;
    // one yield on the first chunk and one every 16 after it: an 8 MB file streams in more than 16 chunks
    expect(ticks).toBeGreaterThan(1);
    expect(await contentHash(join(dir, 'same.step'))).toBe(digest);
    writeFileSync(join(dir, 'same.step'), Buffer.alloc(8 << 20, 8));
    expect(await contentHash(join(dir, 'same.step'))).not.toBe(digest);
  } finally {
    running = false;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('digests of many small exports one after another let the event loop run between them', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'foundry-art-hash-'));
  for (let i = 0; i < 50; i++) writeFileSync(join(dir, `f${i}.png`), Buffer.alloc(64 << 10, i));
  let ticks = 0;
  let running = true;
  const tick = () => {
    ticks++;
    if (running) setImmediate(tick);
  };
  setImmediate(tick);
  try {
    for (let i = 0; i < 50; i++) await contentHash(join(dir, `f${i}.png`));
    expect(ticks).toBeGreaterThan(0);
  } finally {
    running = false;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the inherited marker is never written through a link planted at the name it is written under first', async () => {
  const { symlinkSync } = await import('node:fs');
  const goal = mkdtempSync(join(tmpdir(), 'foundry-art-goal-'));
  const task = mkdtempSync(join(tmpdir(), 'foundry-art-task-'));
  const victim = join(mkdtempSync(join(tmpdir(), 'foundry-art-victim-')), 'victim.txt');
  mkdirSync(join(goal, 'artifacts'), { recursive: true });
  writeFileSync(join(goal, 'artifacts', 'part.step'), 'GOAL');
  writeFileSync(victim, 'KEEP');
  mkdirSync(join(task, 'artifacts'), { recursive: true });
  for (let n = 0; n < 5000; n++) symlinkSync(victim, join(task, 'artifacts', `.foundry-part-${process.pid}-${n.toString(36)}-.inherited.json`));
  try {
    expect(await inheritArtifacts(goal, task)).toBe(1);
    expect(readFileSync(victim, 'utf8')).toBe('KEEP');
    expect(JSON.parse(readFileSync(join(task, 'artifacts', '.inherited.json'), 'utf8'))).toHaveProperty(['part.step']);
  } finally {
    for (const d of [goal, task, join(victim, '..')]) rmSync(d, { recursive: true, force: true });
  }
});

test('inheriting replaces a link left in a reused task worktree instead of writing through it', async () => {
  const { lstatSync, symlinkSync } = await import('node:fs');
  const goal = mkdtempSync(join(tmpdir(), 'foundry-art-goal-'));
  const task = mkdtempSync(join(tmpdir(), 'foundry-art-task-'));
  const outside = join(mkdtempSync(join(tmpdir(), 'foundry-art-outside-')), 'keep.txt');
  mkdirSync(join(goal, 'artifacts'), { recursive: true });
  writeFileSync(join(goal, 'artifacts', 'part.step'), 'GOAL');
  writeFileSync(outside, 'KEEP');
  mkdirSync(join(task, 'artifacts'), { recursive: true });
  symlinkSync(outside, join(task, 'artifacts', 'part.step'));
  symlinkSync(outside, join(task, 'artifacts', '.inherited.json'));
  expect(await inheritArtifacts(goal, task)).toBe(1);
  expect(readFileSync(outside, 'utf8')).toBe('KEEP');
  expect(lstatSync(join(task, 'artifacts', 'part.step')).isSymbolicLink()).toBe(false);
  expect(lstatSync(join(task, 'artifacts', '.inherited.json')).isSymbolicLink()).toBe(false);
  expect(readFileSync(join(task, 'artifacts', 'part.step'), 'utf8')).toBe('GOAL');
  // a folder that became a link takes nothing (the rest still comes), and an artifacts/ that is a link takes nothing at all
  const elsewhere = mkdtempSync(join(tmpdir(), 'foundry-art-elsewhere-'));
  mkdirSync(join(goal, 'artifacts', 'parts'), { recursive: true });
  writeFileSync(join(goal, 'artifacts', 'parts', 'hinge.step'), 'HINGE');
  const reused = mkdtempSync(join(tmpdir(), 'foundry-art-reused-'));
  mkdirSync(join(reused, 'artifacts'), { recursive: true });
  symlinkSync(elsewhere, join(reused, 'artifacts', 'parts'));
  expect(await inheritArtifacts(goal, reused)).toBe(1);
  expect(require('node:fs').existsSync(join(elsewhere, 'hinge.step'))).toBe(false);
  const linked = mkdtempSync(join(tmpdir(), 'foundry-art-linked-task-'));
  symlinkSync(elsewhere, join(linked, 'artifacts'));
  expect(await inheritArtifacts(goal, linked)).toBe(0);
  expect(require('node:fs').readdirSync(elsewhere)).toEqual([]);
});

test('what Finder and Windows leave in a folder is never an artifact: not listed, so never landed, delivered or opened as the model', async () => {
  const { cadModelIn } = await import('./goal-artifacts.ts');
  const { utimesSync } = await import('node:fs');
  const ws = mkdtempSync(join(tmpdir(), 'foundry-art-clutter-'));
  try {
    mkdirSync(join(ws, 'artifacts', 'parts'), { recursive: true });
    writeFileSync(join(ws, 'artifacts', 'assembly.step'), 'step');
    utimesSync(join(ws, 'artifacts', 'assembly.step'), new Date(Date.UTC(2026, 0, 1)), new Date(Date.UTC(2026, 0, 1)));
    // an AppleDouble sidecar (written on exFAT or a share when the file's attributes change): newer than the model
    for (const f of ['.DS_Store', '._assembly.step', 'parts/Thumbs.db', 'parts/desktop.ini', 'parts/._hinge.step']) writeFileSync(join(ws, 'artifacts', f), 'os');
    expect(listArtifacts(ws)).toEqual(['assembly.step']);
    expect(cadModelIn(join(ws, 'artifacts'), listArtifacts(ws))).toBe('assembly.step');
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});
