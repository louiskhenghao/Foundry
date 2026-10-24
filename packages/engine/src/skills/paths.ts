import type { AgentProvider } from '@foundry/core';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

/** The single place that knows how the host lays out Claude Code skills/plugins. */
export interface SkillsPaths {
  provider?: AgentProvider;
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
  /** persisted release facts of the workflow suites: tags, each fetched tag's skills (ADR-0068) */
  releasesFile: string;
  /** ~/.claude/plugins/known_marketplaces.json */
  marketplacesFile: string;
  /** the workflow suites' store: <dataDir>/suites/<id>/{clone,plugin} (ADR-0049) */
  suitesDir: string;
  /** Codex only: Claude Code's skills folder, to keep shared skills Claude links to from being removed under it */
  claudeSkillsDir?: string;
  /** the Foundry checkout (or image) whose catalog/bundled/ holds the skills Foundry ships itself (ADR-0076) */
  bundledRoot: string;
}

/** the repository root this engine runs from: packages/engine/src/skills → four levels up */
export const FOUNDRY_ROOT = resolve(import.meta.dir, '..', '..', '..', '..');

export function skillsPaths(claudeHome: string, dataDir: string, provider: AgentProvider = 'claude', sharedHome?: string, bundledRoot: string = FOUNDRY_ROOT): SkillsPaths {
  const home = sharedHome ?? (provider !== 'claude' ? homedir() : dirname(claudeHome));
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
    releasesFile: join(dataDir, 'skills-releases.json'),
    marketplacesFile: join(claudeHome, 'plugins', 'known_marketplaces.json'),
    suitesDir: join(dataDir, 'suites'),
    bundledRoot,
  };
}

export const MARKER_FILE = '.foundry.json';
/** Marker name written before the rename to Foundry; still read so existing installs stay managed. */
export const LEGACY_MARKER_FILE = '.ai-engine.json';
