import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeRepo, sh } from '../test-helpers.ts';
import { EXCLUDE_MARKER, copyProjectSkills, hasStackManifest, runAutoskills } from './autoskills.ts';

/** a stand-in for `npx autoskills`: writes two skills, a lock file and a CLAUDE.md like the real tool */
const fakeNpx = async (argv: string[], cwd: string, onLine: (l: string) => void) => {
  expect(argv.slice(0, 4)).toEqual(['npx', '-y', 'autoskills@latest', '-y']);
  for (const n of ['react', 'tailwind']) {
    mkdirSync(join(cwd, '.claude', 'skills', n), { recursive: true });
    writeFileSync(join(cwd, '.claude', 'skills', n, 'SKILL.md'), `---\nname: ${n}\n---\nrules`);
  }
  writeFileSync(join(cwd, 'skills-lock.json'), JSON.stringify({ skills: { react: {}, tailwind: {} } }));
  writeFileSync(join(cwd, 'CLAUDE.md'), (existsSync(join(cwd, 'CLAUDE.md')) ? readFileSync(join(cwd, 'CLAUDE.md'), 'utf8') : '') + '\n## Skills\n- react\n- tailwind\n');
  onLine('installed react, tailwind');
  return { code: 0, tail: 'installed react, tailwind' };
};

describe('autoskills', () => {
  test('skips without a manifest or with an old node', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'as-'));
    expect(hasStackManifest(dir)).toBe(false);
    expect((await runAutoskills(dir, { spawn: fakeNpx as any })).status).toBe('skipped');
    writeFileSync(join(dir, 'package.json'), '{}');
    const old = await runAutoskills(dir, { spawn: fakeNpx as any, nodeVersion: async () => 'v18.2.0' });
    expect(old).toMatchObject({ status: 'skipped' });
    expect(old.detail).toContain('too old');
  });

  test('installs, restores CLAUDE.md, excludes the skills from git, and the worktree stays clean', async () => {
    const repo = await makeRepo();
    writeFileSync(join(repo, 'package.json'), '{"name":"x"}');
    writeFileSync(join(repo, 'CLAUDE.md'), '# house rules\n');
    await sh('git -c user.name=t -c user.email=t@t add -A && git -c user.name=t -c user.email=t@t commit -qm "chore: manifest"', repo);
    const lines: string[] = [];
    const r = await runAutoskills(repo, { spawn: fakeNpx as any, nodeVersion: async () => 'v22.1.0' }, (l) => lines.push(l));
    expect(r).toMatchObject({ status: 'installed', skills: ['react', 'tailwind'] });
    expect(lines).toContain('installed react, tailwind');
    // CLAUDE.md is back to the committed content, skills stay, nothing shows up in git status
    expect(readFileSync(join(repo, 'CLAUDE.md'), 'utf8')).toBe('# house rules\n');
    expect(existsSync(join(repo, '.claude', 'skills', 'react', 'SKILL.md'))).toBe(true);
    expect(await sh('git status --porcelain', repo)).toBe('');
    const exclude = readFileSync(join(repo, '.git', 'info', 'exclude'), 'utf8');
    expect(exclude).toContain(EXCLUDE_MARKER);
    expect(exclude).toContain('.claude/skills/react/');
    expect(exclude).toContain('skills-lock.json');
    // second run: nothing new, exclude file not duplicated
    const again = await runAutoskills(repo, { spawn: fakeNpx as any, nodeVersion: async () => 'v22.1.0' });
    expect(again.status).toBe('skipped');
    expect(readFileSync(join(repo, '.git', 'info', 'exclude'), 'utf8').split(EXCLUDE_MARKER).length).toBe(2);
    // a generated CLAUDE.md (none before) is removed
    const repo2 = await makeRepo();
    writeFileSync(join(repo2, 'package.json'), '{}');
    await runAutoskills(repo2, { spawn: fakeNpx as any, nodeVersion: async () => 'v22.1.0' });
    expect(existsSync(join(repo2, 'CLAUDE.md'))).toBe(false);
    // task worktrees receive a copy of the project skills
    const other = mkdtempSync(join(tmpdir(), 'as-task-'));
    expect(copyProjectSkills(repo, other)).toBe(2);
    expect(existsSync(join(other, '.claude', 'skills', 'tailwind', 'SKILL.md'))).toBe(true);
    expect(copyProjectSkills(repo, other)).toBe(0);
  });

  test('a failing run with nothing installed is reported as failed', async () => {
    const repo = await makeRepo();
    writeFileSync(join(repo, 'package.json'), '{}');
    const r = await runAutoskills(repo, { spawn: (async () => ({ code: 1, tail: 'boom' })) as any, nodeVersion: async () => 'v22.0.0' });
    expect(r.status).toBe('failed');
    expect(r.detail).toContain('boom');
  });
});
