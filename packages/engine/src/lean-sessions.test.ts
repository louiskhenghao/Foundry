import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { leanSettings, ownSkillNames, projectSkillNames } from './lean-sessions.ts';
import type { InstalledSkill } from './skills/types.ts';

const row = (r: Partial<InstalledSkill> & Pick<InstalledSkill, 'name'>): InstalledSkill =>
  ({ scope: 'user', invoke: `/${r.name}`, dir: `/skills/${r.name}`, skillMd: null, description: '', version: null, managedBy: null, marker: null, plugin: null, lock: null, symlink: null, manifest: null, duplicateOf: [], canUninstall: true, uninstallNote: null, hint: null, unparsable: false, ...r }) as InstalledSkill;

describe('the flag settings of a lean session', () => {
  test('keeps what the session had, turns the connectors off, and lists the skills it goes without', () => {
    const s = leanSettings({ hooks: { SessionStart: [] }, skillOverrides: { keep: 'name-only' } }, { connectorsAllowed: false, skillsOff: ['mine', 'keep'] });
    expect(s).toEqual({ hooks: { SessionStart: [] }, disableClaudeAiConnectors: true, skillOverrides: { mine: 'off', keep: 'name-only' } });
  });
  test('an allowed connector keeps them all; nothing to turn off adds no overrides', () => {
    expect(leanSettings(undefined, { connectorsAllowed: true, skillsOff: [] })).toEqual({});
  });
});

describe("the person's own skills a lean session goes without", () => {
  const md: Record<string, string> = { '/skills/ui-typography/SKILL.md': '---\nname: typography\ndescription: d\n---\n', '/skills/tdd/SKILL.md': '---\nname: tdd\n---\n' };
  const read = (p: string) => md[p] ?? null;
  test('by the name Claude Code lists them under, and the folder name; Foundry\'s own, catalog names, plugins and projects stay', () => {
    const rows = [
      row({ name: 'ui-typography', skillMd: '/skills/ui-typography/SKILL.md' }),
      row({ name: 'gstack-ship' }),
      row({ name: 'colorfigures', marker: { catalogId: 'colorfigures' } as InstalledSkill['marker'] }),
      row({ name: 'tdd', skillMd: '/skills/tdd/SKILL.md' }),
      row({ name: 'grill', scope: 'plugin', plugin: { id: 'x@y' } as InstalledSkill['plugin'] }),
      row({ name: 'local', scope: 'project' }),
    ];
    expect(ownSkillNames(rows, new Set(['tdd']), read)).toEqual(['gstack-ship', 'typography', 'ui-typography']);
  });
  test("a workspace's project skills are read from its .claude/skills", () => {
    const cwd = mkdtempSync(join(tmpdir(), 'foundry-lean-'));
    mkdirSync(join(cwd, '.claude', 'skills', 'foundry-learnings'), { recursive: true });
    writeFileSync(join(cwd, '.claude', 'skills', '.DS_Store'), '');
    expect(projectSkillNames(cwd)).toEqual(['foundry-learnings']);
    expect(projectSkillNames(join(cwd, 'nowhere'))).toEqual([]);
  });
});
