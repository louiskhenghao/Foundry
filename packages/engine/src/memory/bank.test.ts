import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { makeRepo, sh } from '../test-helpers.ts';
import { bankIdFor } from './bank.ts';

test("a folder's bank is named after the repository's main folder, as Hindsight's own integration names it", async () => {
  const repo = await makeRepo();
  const wt = `${repo}-wt`;
  try {
    expect(await bankIdFor(repo)).toBe(`coding-agent::${basename(repo)}`);
    // a worktree belongs to the same repository: one bank, not one per checkout
    await sh(`git worktree add -q -b memory-wt ${wt}`, repo);
    expect(await bankIdFor(wt)).toBe(`coding-agent::${basename(repo)}`);
    expect(await bankIdFor(join(wt, 'nowhere'))).toBeNull();
  } finally {
    await sh(`git worktree remove --force ${wt}`, repo).catch(() => {});
    for (const p of [repo, wt]) rmSync(p, { recursive: true, force: true });
  }
});

test('a folder that is not a repository has no bank', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'foundry-memory-nogit-'));
  try {
    expect(await bankIdFor(dir)).toBeNull();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
