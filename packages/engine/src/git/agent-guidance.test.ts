import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeRepo, sh } from '../test-helpers.ts';
import { commitAll } from './git.ts';

const repos: string[] = [];
afterEach(() => {
  for (const r of repos.splice(0)) rmSync(r, { recursive: true, force: true });
});
const BLOCK = '<!-- gitnexus:start -->\n# GitNexus\nuse it\n<!-- gitnexus:end -->\n';

describe('commitAll and tool guidance', () => {
  test("a gitnexus section and skills the task did not have stay out of its commit; the task's own changes go in", async () => {
    const repo = await makeRepo();
    repos.push(repo);
    writeFileSync(join(repo, 'CLAUDE.md'), '# Project\n');
    await sh('git add CLAUDE.md && git commit -qm "docs: guidance"', repo);
    writeFileSync(join(repo, 'CLAUDE.md'), `# Project\nrun bun test\n\n${BLOCK}`);
    writeFileSync(join(repo, 'AGENTS.md'), BLOCK);
    mkdirSync(join(repo, '.claude', 'skills', 'gitnexus'), { recursive: true });
    writeFileSync(join(repo, '.claude', 'skills', 'gitnexus', 'SKILL.md'), 'x');
    writeFileSync(join(repo, 'app.ts'), 'export {};\n');
    await commitAll(repo, 'feat: app');
    expect((await sh('git show --name-only --format= HEAD', repo)).split('\n').sort()).toEqual(['CLAUDE.md', 'app.ts']);
    expect(readFileSync(join(repo, 'CLAUDE.md'), 'utf8')).toBe('# Project\nrun bun test\n');
    expect(existsSync(join(repo, 'AGENTS.md'))).toBe(false);
    expect(existsSync(join(repo, '.claude'))).toBe(false);
    expect(await sh('git status --porcelain', repo)).toBe('');
  });

  test('a section already committed, and ignored files, are left alone', async () => {
    const repo = await makeRepo();
    repos.push(repo);
    writeFileSync(join(repo, 'AGENTS.md'), `# Agents\n\n${BLOCK}`);
    writeFileSync(join(repo, '.gitignore'), 'CLAUDE.md\n');
    await sh('git add -A && git commit -qm "docs: agents"', repo);
    writeFileSync(join(repo, 'CLAUDE.md'), BLOCK);
    writeFileSync(join(repo, 'AGENTS.md'), `# Agents\nmore\n\n${BLOCK}`);
    await commitAll(repo, 'docs: more');
    expect(readFileSync(join(repo, 'AGENTS.md'), 'utf8')).toContain('gitnexus:start');
    expect(readFileSync(join(repo, 'CLAUDE.md'), 'utf8')).toBe(BLOCK);
  });
});
