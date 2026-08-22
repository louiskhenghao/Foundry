import { dirname, join } from 'node:path';

/** The single place that knows how the host lays out Claude Code skills/plugins. */
export interface SkillsPaths {
  claudeHome: string;
  skillsDir: string;
  pluginsDir: string;
  settingsJson: string;
  /** ~/.agents/.skill-lock.json written by the community `skills` CLI (symlink family) */
  agentsLock: string;
  agentsSkillsDir: string;
  cacheDir: string;
  trashDir: string;
  sessionViewFile: string;
  /** persisted SkillsUpdateReport (+ per-repo git facts) */
  updatesFile: string;
  /** ~/.claude/plugins/known_marketplaces.json */
  marketplacesFile: string;
}

export function skillsPaths(claudeHome: string, dataDir: string): SkillsPaths {
  const home = dirname(claudeHome);
  return {
    claudeHome,
    skillsDir: join(claudeHome, 'skills'),
    pluginsDir: join(claudeHome, 'plugins'),
    settingsJson: join(claudeHome, 'settings.json'),
    agentsLock: join(home, '.agents', '.skill-lock.json'),
    agentsSkillsDir: join(home, '.agents', 'skills'),
    cacheDir: join(dataDir, 'skills-cache'),
    trashDir: join(dataDir, 'skills-trash'),
    sessionViewFile: join(dataDir, 'skills-last-seen.json'),
    updatesFile: join(dataDir, 'skills-updates.json'),
    marketplacesFile: join(claudeHome, 'plugins', 'known_marketplaces.json'),
  };
}

export const MARKER_FILE = '.ai-engine.json';
