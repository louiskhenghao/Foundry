import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/** The single place that knows how the host lays out Claude Code skills/plugins. */
export interface SkillsPaths {
  provider?: 'claude' | 'codex';
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

export function skillsPaths(claudeHome: string, dataDir: string, provider: 'claude' | 'codex' = 'claude', sharedHome?: string): SkillsPaths {
  const home = sharedHome ?? (provider === 'codex' ? homedir() : dirname(claudeHome));
  return {
    provider,
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

export const MARKER_FILE = '.foundry.json';
/** Marker name written before the rename to Foundry; still read so existing installs stay managed. */
export const LEGACY_MARKER_FILE = '.ai-engine.json';
