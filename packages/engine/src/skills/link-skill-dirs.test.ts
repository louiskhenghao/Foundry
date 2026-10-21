import { expect, test } from 'bun:test';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { linkSkillDirs } from './suites.ts';

test('Antigravity: installed skills are linked into the workspace by name, kept out of git, never over what is there', async () => {
  const root = mkdtempSync(join(tmpdir(), 'foundry-agy-links-'));
  try {
    const ws = join(root, 'ws');
    mkdirSync(ws, { recursive: true });
    await Bun.$`git init -q -b main ${ws}`.quiet();
    const skill = (name: string, md = true) => {
      const dir = join(root, 'home', name);
      mkdirSync(dir, { recursive: true });
      if (md) writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${name}\n---\n`);
      return { name, dir };
    };
    // the project's own skill of that name stays as it is
    mkdirSync(join(ws, '.agents', 'skills', 'grilling'), { recursive: true });
    expect(await linkSkillDirs(ws, [skill('tdd'), skill('grilling'), skill('no-md', false), { name: '../escape', dir: skill('x').dir }])).toEqual(['tdd']);
    const link = join(ws, '.agents', 'skills', 'tdd');
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(existsSync(join(link, 'SKILL.md'))).toBe(true);
    expect(lstatSync(join(ws, '.agents', 'skills', 'grilling')).isSymbolicLink()).toBe(false);
    expect(existsSync(join(ws, '.agents', 'skills', 'no-md'))).toBe(false);
    expect(existsSync(join(ws, '.agents', 'escape'))).toBe(false);
    expect(readFileSync(join(ws, '.git', 'info', 'exclude'), 'utf8')).toContain('.agents/skills/tdd');
    // the next session finds it linked
    expect(await linkSkillDirs(ws, [skill('tdd')])).toEqual([]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
