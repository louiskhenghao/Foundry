import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { skillsPaths, type SkillsPaths } from './paths.ts';

export function skillMd(name: string, description = `${name} does things`, extra = ''): string {
  return `---\nname: ${name}\ndescription: ${description}\n${extra}---\n\n# ${name}\n`;
}

export interface FakeHome {
  home: string;
  claudeHome: string;
  dataDir: string;
  paths: SkillsPaths;
  repo: string;
}

/**
 * Builds a ~/.claude that exhibits every provenance family we classify:
 * plain dir, agents-cli symlink, broken symlink, gstack clone + flattened copy, manifest.json,
 * foundry marker, a user `tdd` that duplicates a plugin skill, two plugins (array + dir form),
 * and a repo with project skills.
 */
export function makeFakeHome(): FakeHome {
  const home = mkdtempSync(join(tmpdir(), 'foundry-fake-home-'));
  const claudeHome = join(home, '.claude');
  const dataDir = join(home, 'data');
  const paths = skillsPaths(claudeHome, dataDir);
  const s = paths.skillsDir;
  mkdirSync(s, { recursive: true });

  // plain hand-installed
  mkdirSync(join(s, 'plain'));
  writeFileSync(join(s, 'plain', 'SKILL.md'), skillMd('plain', '"Quoted description"'));

  // agents-cli symlink family
  mkdirSync(join(paths.agentsSkillsDir, 'linked'), { recursive: true });
  writeFileSync(join(paths.agentsSkillsDir, 'linked', 'SKILL.md'), skillMd('linked', '>\n  folded block\n  description'));
  symlinkSync(join('..', '..', '.agents', 'skills', 'linked'), join(s, 'linked'));
  writeFileSync(paths.agentsLock, JSON.stringify({ version: 3, skills: { linked: { source: 'x/y', sourceType: 'github' } } }));
  symlinkSync(join('..', '..', '.agents', 'skills', 'gone'), join(s, 'broken'));

  // gstack clone + flattened copy
  mkdirSync(join(s, 'gstack', '.git'), { recursive: true });
  mkdirSync(join(s, 'gstack', 'autoplan'));
  writeFileSync(join(s, 'gstack', 'SKILL.md'), skillMd('gstack', 'router'));
  const autoplan = skillMd('autoplan', 'gstack autoplan');
  writeFileSync(join(s, 'gstack', 'autoplan', 'SKILL.md'), autoplan);
  mkdirSync(join(s, 'autoplan'));
  writeFileSync(join(s, 'autoplan', 'SKILL.md'), autoplan);

  // manifest.json family
  mkdirSync(join(s, 'withmanifest'));
  writeFileSync(join(s, 'withmanifest', 'SKILL.md'), skillMd('withmanifest'));
  writeFileSync(join(s, 'withmanifest', 'manifest.json'), JSON.stringify({ name: 'withmanifest', version: '1.2.3', homepage: 'https://example.com/x' }));

  // foundry managed
  mkdirSync(join(s, 'managed'));
  writeFileSync(join(s, 'managed', 'SKILL.md'), skillMd('managed'));
  writeFileSync(join(s, 'managed', '.foundry.json'), JSON.stringify({ catalogId: 'managed', repo: 'o/r', ref: null, commit: 'abc1234', path: 'skills/managed', installedAt: '2026-01-01T00:00:00Z' }));

  // user tdd duplicating a plugin skill
  mkdirSync(join(s, 'tdd'));
  writeFileSync(join(s, 'tdd', 'SKILL.md'), skillMd('tdd', 'old copy'));

  // unparsable dir (no SKILL.md)
  mkdirSync(join(s, 'empty-dir'));

  // plugins
  const cache = join(paths.pluginsDir, 'cache');
  const p1 = join(cache, 'mkt', 'mp-skills', '1.0.0');
  mkdirSync(join(p1, '.claude-plugin'), { recursive: true });
  mkdirSync(join(p1, 'skills', 'engineering', 'tdd'), { recursive: true });
  mkdirSync(join(p1, 'skills', 'engineering', 'diagnosing-bugs'), { recursive: true });
  writeFileSync(join(p1, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'mp-skills', skills: ['./skills/engineering/tdd', './skills/engineering/diagnosing-bugs'] }));
  writeFileSync(join(p1, 'skills', 'engineering', 'tdd', 'SKILL.md'), skillMd('tdd', 'plugin tdd'));
  writeFileSync(join(p1, 'skills', 'engineering', 'diagnosing-bugs', 'SKILL.md'), skillMd('diagnosing-bugs'));
  const p2 = join(cache, 'mkt2', 'ui', '2.0.0');
  mkdirSync(join(p2, '.claude-plugin'), { recursive: true });
  mkdirSync(join(p2, '.claude', 'skills', 'design'), { recursive: true });
  writeFileSync(join(p2, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'ui', skills: './.claude/skills/' }));
  writeFileSync(join(p2, '.claude', 'skills', 'design', 'SKILL.md'), skillMd('design'));
  writeFileSync(
    join(paths.pluginsDir, 'installed_plugins.json'),
    JSON.stringify({ version: 2, plugins: { 'mp-skills@mkt': [{ scope: 'user', installPath: p1, version: '1.0.0' }], 'ui@mkt2': [{ scope: 'user', installPath: p2, version: '2.0.0' }], 'ghost@mkt': [{ scope: 'user', installPath: join(cache, 'nope'), version: '0' }] } }),
  );

  // settings.json with one good and one missing hook path
  writeFileSync(join(claudeHome, 'settings.json'), JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: join(s, 'gstack', 'SKILL.md') }, { type: 'command', command: '/definitely/missing/hook.sh' }] }] } }));

  // project repo with .claude/skills (one real dir, one symlink into <repo>/skills)
  const repo = join(home, 'repo');
  mkdirSync(join(repo, '.claude', 'skills', 'proj-real'), { recursive: true });
  writeFileSync(join(repo, '.claude', 'skills', 'proj-real', 'SKILL.md'), skillMd('proj-real'));
  mkdirSync(join(repo, 'skills', 'proj-linked'), { recursive: true });
  writeFileSync(join(repo, 'skills', 'proj-linked', 'SKILL.md'), skillMd('proj-linked'));
  symlinkSync(join('..', '..', 'skills', 'proj-linked'), join(repo, '.claude', 'skills', 'proj-linked'));

  return { home, claudeHome, dataDir, paths, repo };
}

export function writeCatalog(dir: string, entries: object[]): string {
  mkdirSync(dir, { recursive: true });
  const p = join(dir, 'skills.json');
  writeFileSync(p, JSON.stringify({ version: 1, entries }));
  return p;
}
