/**
 * Lean sessions (ADR-0102): a Claude Code session loads only what Foundry gives it. On top of the session's own flag
 * settings (`--settings`, the highest-ranking source after a managed policy) it gets `disableClaudeAiConnectors` unless a
 * claude.ai connector is among what it may use, and `skillOverrides` turning off the person's own skills that Foundry
 * did not install; its MCP servers are handed over explicitly under --strict-mcp-config (strictServers). The person's
 * settings, sign-in, CLAUDE.md, plugins and hooks stay: a session without its user settings would lose an
 * apiKeyHelper, a Bedrock or proxy environment, and every plugin Foundry installed.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseSkillMd } from './skills/frontmatter.ts';
import type { InstalledSkill } from './skills/types.ts';

/** the tool prefix of every claude.ai connector (`claude.ai Gmail` → mcp__claude_ai_Gmail) */
export const CONNECTOR_PREFIX = 'mcp__claude_ai_';

/** The session's flag settings with what a lean session adds: the connectors and the skills it goes without. */
export function leanSettings(base: object | undefined, o: { connectorsAllowed: boolean; skillsOff: readonly string[] }): object {
  const own = (base ?? {}) as Record<string, unknown>;
  const overrides = own.skillOverrides && typeof own.skillOverrides === 'object' ? (own.skillOverrides as Record<string, string>) : {};
  return {
    ...own,
    ...(o.connectorsAllowed ? {} : { disableClaudeAiConnectors: true }),
    ...(o.skillsOff.length ? { skillOverrides: { ...Object.fromEntries(o.skillsOff.map((n) => [n, 'off'])), ...overrides } } : {}),
  };
}

/**
 * The names under which Claude Code lists the person's own skills — user-scope skills without Foundry's marker — that no
 * catalog entry names and no project skill of the session's folder shares: `skillOverrides` is keyed by the name in a
 * skill's frontmatter (a folder `ui-typography` holding `name: typography` is the skill `typography`), and an override
 * turns off every skill of that name, a project's too. Plugin skills are left alone: a plugin comes whole.
 */
export function ownSkillNames(rows: readonly InstalledSkill[], keep: ReadonlySet<string>, read: (path: string) => string | null = readText): string[] {
  const off = new Set<string>();
  for (const r of rows) {
    if (r.scope !== 'user' || r.marker || r.plugin) continue;
    const listed = (r.skillMd ? parseSkillMd(read(r.skillMd) ?? '').name : null) || r.name;
    for (const name of new Set([listed, r.name])) if (!keep.has(name)) off.add(name);
  }
  return [...off].sort();
}

/** the folder names of a workspace's project skills (`.claude/skills/<name>`), which a lean session keeps whatever the person's own are called */
export function projectSkillNames(cwd: string): string[] {
  const dir = join(cwd, '.claude', 'skills');
  try {
    return existsSync(dir) ? readdirSync(dir).filter((n) => !n.startsWith('.')) : [];
  } catch {
    return [];
  }
}

function readText(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}
