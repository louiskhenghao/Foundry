import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeCatalog } from './fake-home.test-helper.ts';
import { SkillsManager, UninstallRefused } from './manager.ts';
import { restoreSkill } from './trash.ts';

// everything lives in a temporary home: the real ~/.agents/skills is never touched
const home = mkdtempSync(join(tmpdir(), 'foundry-shared-skills-'));
afterAll(() => rmSync(home, { recursive: true, force: true }));
const skill = (dir: string, name: string) => {
  mkdirSync(join(dir, name), { recursive: true });
  writeFileSync(join(dir, name, 'SKILL.md'), `---\nname: ${name}\ndescription: ${name} skill\n---\nbody\n`);
};

describe('Codex: skills in the shared ~/.agents/skills folder', () => {
  const agents = join(home, '.agents', 'skills');
  const claudeSkills = join(home, '.claude', 'skills');
  skill(agents, 'solo');
  skill(agents, 'linked');
  skill(agents, 'via-skill-md');
  // Claude Code reaches two of them: one as a folder link, one through a linked SKILL.md
  mkdirSync(claudeSkills, { recursive: true });
  symlinkSync('../../.agents/skills/linked', join(claudeSkills, 'linked'));
  mkdirSync(join(claudeSkills, 'via-skill-md'));
  symlinkSync(join(agents, 'via-skill-md', 'SKILL.md'), join(claudeSkills, 'via-skill-md', 'SKILL.md'));
  const codex = new SkillsManager({ provider: 'codex', claudeHome: join(home, '.codex'), sharedHome: home, claudeSkillsDir: claudeSkills, dataDir: join(home, 'data'), catalogPath: writeCatalog(join(home, 'catalog'), []), which: () => null });

  test('one only Codex shares can be uninstalled and restored to where it was', async () => {
    const row = codex.scan().installed.find((r) => r.name === 'solo')!;
    expect(row).toMatchObject({ canUninstall: true });
    const { trash } = await codex.uninstall('solo');
    expect(existsSync(join(agents, 'solo'))).toBe(false);
    expect(trash.origin).toBe(agents);
    restoreSkill('solo', codex.paths);
    expect(existsSync(join(agents, 'solo', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(home, '.codex', 'skills', 'solo'))).toBe(false);
  });

  test('one Claude Code uses through a link is refused, and Claude Code’s copy is untouched', async () => {
    for (const name of ['linked', 'via-skill-md']) {
      const row = codex.scan().installed.find((r) => r.name === name)!;
      expect(row.canUninstall).toBe(false);
      expect(row.uninstallNote).toContain(join(claudeSkills, name));
      await expect(codex.uninstall(name)).rejects.toBeInstanceOf(UninstallRefused);
      expect((await codex.uninstallMany([name], { force: true })).results[0]).toMatchObject({ ok: false });
      expect(existsSync(join(agents, name, 'SKILL.md'))).toBe(true);
    }
    expect(lstatSync(join(claudeSkills, 'linked')).isSymbolicLink()).toBe(true);
    expect(existsSync(join(claudeSkills, 'linked', 'SKILL.md'))).toBe(true);
  });
});
