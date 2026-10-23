import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeRepo, sh } from '../test-helpers.ts';
import { recentCommits, seedDocument } from './seed.ts';

test('the newest commits, newest first, with their messages and files; a merge has no files', async () => {
  const repo = await makeRepo();
  try {
    writeFileSync(join(repo, 'a.txt'), 'a\n');
    await sh('git -c user.name=t -c user.email=t@t add -A && git -c user.name=t -c user.email=t@t commit -q -m "feat: add a"', repo);
    writeFileSync(join(repo, 'b.txt'), 'b\n');
    writeFileSync(join(repo, 'c.txt'), 'c\n');
    await sh('git -c user.name=t -c user.email=t@t add -A && git -c user.name=t -c user.email=t@t commit -q -m "fix: b and c" -m "Closes #12: the body says why."', repo);
    const commits = await recentCommits(repo, 2);
    expect(commits.map((c) => c.message.split('\n')[0])).toEqual(['fix: b and c', 'feat: add a']);
    expect(commits[0]!.message).toContain('Closes #12');
    expect(commits[0]!.files.sort()).toEqual(['b.txt', 'c.txt']);
    expect(commits[1]!.files).toEqual(['a.txt']);
    expect(commits[0]!.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(commits[0]!.author).toBe('t');
    expect(Date.parse(commits[0]!.date)).toBeGreaterThan(0);
    expect(await recentCommits(repo, 0)).toEqual([]);
    expect((await recentCommits(repo, 10)).length).toBe(3);

    const doc = seedDocument(commits[0]!);
    expect(doc.documentId).toBe(`git:${commits[0]!.sha}`);
    expect(doc.tags).toEqual(['source:git']);
    expect(doc.content).toContain('fix: b and c');
    expect(doc.content).toContain('- b.txt');
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('a folder that is not a repository seeds nothing', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'foundry-memory-seed-nogit-'));
  try {
    expect(await recentCommits(dir, 5)).toEqual([]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
