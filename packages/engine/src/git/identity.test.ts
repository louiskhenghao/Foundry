import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FOUNDRY_COAUTHOR, commitStaged, git, resolveCommitIdentity, setCommitAuthorMode, withCoauthor } from './git.ts';

const dirs: string[] = [];
afterEach(() => {
  setCommitAuthorMode('you-coauthor');
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
async function repo(withIdentity: boolean) {
  const d = mkdtempSync(join(tmpdir(), 'foundry-ident-'));
  dirs.push(d);
  await git(['init', '-q', '-b', 'main'], d);
  if (withIdentity) {
    await git(['config', 'user.name', 'Ada Example'], d);
    await git(['config', 'user.email', 'ada@example.com'], d);
  }
  return d;
}

describe('commit author', () => {
  test('the co-author trailer joins an existing trailer block, starts one otherwise, and is never doubled', () => {
    expect(withCoauthor('feat: x\n\nbody\n\nTask: t_1\nGoal: g_1')).toBe(`feat: x\n\nbody\n\nTask: t_1\nGoal: g_1\n${FOUNDRY_COAUTHOR}`);
    expect(withCoauthor('feat: x\n\nsome body text')).toBe(`feat: x\n\nsome body text\n\n${FOUNDRY_COAUTHOR}`);
    expect(withCoauthor('feat: x')).toBe(`feat: x\n\n${FOUNDRY_COAUTHOR}`);
    expect(withCoauthor(withCoauthor('feat: x'))).toBe(`feat: x\n\n${FOUNDRY_COAUTHOR}`);
    expect(withCoauthor('feat: x', 'you')).toBe('feat: x');
    expect(withCoauthor('feat: x', 'foundry')).toBe('feat: x');
  });

  test("commits are written by the repository's own git identity, with Foundry as co-author by default", async () => {
    const d = await repo(true);
    expect(await resolveCommitIdentity(d)).toEqual({ name: 'Ada Example', email: 'ada@example.com', source: 'git-config' });
    writeFileSync(join(d, 'a.txt'), 'a');
    await git(['add', '-A'], d);
    await commitStaged(d, 'feat: add a');
    const log = (await git(['log', '-1', '--format=%an <%ae>|%cn <%ce>|%B'], d)).stdout.trim();
    const [author, committer, message] = log.split('|');
    expect(author).toBe('Ada Example <ada@example.com>');
    expect(committer).toBe('Ada Example <ada@example.com>');
    expect(message).toContain(FOUNDRY_COAUTHOR);
  });

  test('"you only" leaves the trailer out; "Foundry only" writes as foundry', async () => {
    const d = await repo(true);
    setCommitAuthorMode('you');
    writeFileSync(join(d, 'a.txt'), 'a');
    await git(['add', '-A'], d);
    await commitStaged(d, 'feat: add a');
    expect((await git(['log', '-1', '--format=%an|%B'], d)).stdout.trim()).toBe('Ada Example|feat: add a');
    setCommitAuthorMode('foundry');
    writeFileSync(join(d, 'b.txt'), 'b');
    await git(['add', '-A'], d);
    await commitStaged(d, 'feat: add b');
    expect((await git(['log', '-1', '--format=%an <%ae>|%B'], d)).stdout.trim()).toBe('foundry <foundry@local>|feat: add b');
  });
});
