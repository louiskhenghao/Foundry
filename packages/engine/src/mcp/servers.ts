import type { AgentProvider } from '@foundry/core';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import type { McpServerRow, McpHealth } from './types.ts';

/**
 * Claude Code's tool-name form of a server name (its own normaliser, copied): anything outside [A-Za-z0-9_-] becomes
 * "_", and for claude.ai connectors runs of "_" collapse and none lead or trail ("claude.ai Slack (beta)" → claude_ai_Slack_beta).
 */
export const toolName = (s: string): string => {
  const t = s.replace(/[^a-zA-Z0-9_-]/g, '_');
  return s.startsWith('claude.ai ') ? t.replace(/_+/g, '_').replace(/^_|_$/g, '') : t;
};
export const userPrefix = (name: string) => `mcp__${toolName(name)}`;
export const pluginPrefix = (plugin: string, server: string) => `mcp__plugin_${toolName(plugin)}_${toolName(server)}`;
/** the tool prefix of a server a plugin ships, as each coding agent names it: Claude Code under the plugin's name, Codex by the server's own name */
export const pluginServerPrefix = (provider: AgentProvider, plugin: string, server: string) => (provider !== 'claude' ? userPrefix(server) : pluginPrefix(plugin, server));

/** the .claude.json the `claude` Foundry spawns reads: $CLAUDE_CONFIG_DIR/.claude.json, else ~/.claude.json */
export const defaultClaudeJson = (): string => (process.env.CLAUDE_CONFIG_DIR ? join(process.env.CLAUDE_CONFIG_DIR, '.claude.json') : join(homedir(), '.claude.json'));

const readJson = (file: string): any => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};

type Config = { type?: string; command?: string; args?: unknown[]; url?: string };
const describe = (c: Config): Pick<McpServerRow, 'transport' | 'target'> => {
  const transport = c.type === 'http' || c.type === 'sse' ? c.type : c.command ? 'stdio' : c.url ? 'http' : null;
  const target = c.url ?? (c.command ? [c.command, ...(Array.isArray(c.args) ? c.args.map(String) : [])].join(' ') : null);
  return { transport, target };
};

/** A plugin's servers: its .mcp.json ({ mcpServers } or the map itself) or plugin.json's mcpServers (a map or a file). */
function pluginServers(installPath: string): Record<string, Config> {
  const root = readJson(join(installPath, '.mcp.json'));
  if (root) return root.mcpServers ?? root;
  const manifest = readJson(join(installPath, '.claude-plugin', 'plugin.json'));
  const m = manifest?.mcpServers;
  if (typeof m === 'string') {
    const file = readJson(isAbsolute(m) ? m : join(installPath, m));
    return file?.mcpServers ?? file ?? {};
  }
  return m && typeof m === 'object' ? m : {};
}

/** The plugins Claude Code loads everywhere: installed for the user and not switched off in its settings. */
function enabledPlugins(claudeHome: string): { id: string; plugin: string; path: string }[] {
  const registry = readJson(join(claudeHome, 'plugins', 'installed_plugins.json'));
  const enabled = readJson(join(claudeHome, 'settings.json'))?.enabledPlugins ?? {};
  const out: { id: string; plugin: string; path: string }[] = [];
  for (const [id, recs] of Object.entries<any>(registry?.plugins ?? registry ?? {})) {
    if (enabled[id] === false) continue;
    // a plugin installed for one project (scope project/local) is not loaded everywhere
    const rec = (Array.isArray(recs) ? recs : [recs]).find((r) => r?.installPath && (r.scope ?? 'user') === 'user');
    if (!rec) continue;
    out.push({ id, plugin: id.split('@')[0]!, path: isAbsolute(rec.installPath) ? rec.installPath : join(claudeHome, 'plugins', rec.installPath) });
  }
  return out;
}

/** a variable Claude Code sets only for a plugin's own server: a server handed over by hand would read it empty */
const PLUGIN_VARIABLE = /\$\{CLAUDE_PLUGIN_[A-Z_]*\}/;
const PLUGIN_ROOT = '${CLAUDE_PLUGIN_ROOT}';

/**
 * The MCP servers a lean session is handed with --strict-mcp-config (ADR-0102): each server Claude Code would load whose
 * tools the session may call, under the name it has natively so its tools keep their names — a user-scope server as
 * .claude.json has it, a plugin's as `plugin_<plugin>_<server>` with its ${CLAUDE_PLUGIN_ROOT} written out (Claude Code
 * expands ${VAR} and ${VAR:-default} in it as in a .mcp.json). `wanted` holds tool prefixes (mcp__<server>) or tool
 * names. null when a wanted server cannot be handed over that way — a claude.ai connector, a plugin server that reads
 * another plugin variable — and the session keeps the servers Claude Code loads itself. A repository's own .mcp.json is
 * never read: it is the repository's, and Claude Code asks before it runs one.
 */
export function strictServers(claudeHome: string, wanted: readonly string[], claudeJson = defaultClaudeJson()): { mcpServers: Record<string, unknown> } | null {
  const wants = (prefix: string) => wanted.some((w) => w === prefix || w.startsWith(`${prefix}__`));
  const cfg = readJson(claudeJson) ?? {};
  for (const name of Array.isArray(cfg.claudeAiMcpEverConnected) ? cfg.claudeAiMcpEverConnected : []) if (typeof name === 'string' && wants(userPrefix(name))) return null;
  const out: Record<string, unknown> = {};
  for (const [name, c] of Object.entries<Config>(cfg.mcpServers ?? {})) if (wants(userPrefix(name))) out[name] = c;
  for (const { plugin, path } of enabledPlugins(claudeHome)) {
    for (const [name, c] of Object.entries<Config>(pluginServers(path))) {
      if (!wants(pluginPrefix(plugin, name))) continue;
      // the path as it reads inside a JSON string; split/join, as a replacement string would read `$` in it
      const text = JSON.stringify(c).split(PLUGIN_ROOT).join(JSON.stringify(path).slice(1, -1));
      if (PLUGIN_VARIABLE.test(text)) return null;
      out[`plugin_${plugin}_${name}`] = JSON.parse(text);
    }
  }
  return { mcpServers: out };
}

/**
 * Every MCP server Claude Code would load, read from its files (ADR-0016): user scope in .claude.json, servers shipped
 * by enabled plugins, and claude.ai connectors. No server is started.
 */
export function listServers(claudeHome: string, allowed: readonly string[], claudeJson = defaultClaudeJson()): McpServerRow[] {
  const out: McpServerRow[] = [];
  const row = (r: Omit<McpServerRow, 'allowed' | 'catalogId'>): McpServerRow => ({ ...r, allowed: allowed.includes(r.prefix), catalogId: null });
  const cfg = readJson(claudeJson) ?? {};
  for (const [name, c] of Object.entries<Config>(cfg.mcpServers ?? {})) out.push(row({ name, source: 'user', plugin: null, prefix: userPrefix(name), ...describe(c) }));

  for (const { id, plugin, path } of enabledPlugins(claudeHome)) {
    for (const [name, c] of Object.entries<Config>(pluginServers(path))) out.push(row({ name, source: 'plugin', plugin: id, prefix: pluginPrefix(plugin, name), ...describe(c) }));
  }

  for (const name of Array.isArray(cfg.claudeAiMcpEverConnected) ? cfg.claudeAiMcpEverConnected : []) {
    if (typeof name === 'string') out.push(row({ name, source: 'connector', plugin: null, prefix: userPrefix(name), transport: 'http', target: null }));
  }
  return out;
}

/** The name `claude mcp list` prints for a row: plugins as plugin:<plugin>:<server>. */
export const listName = (r: Pick<McpServerRow, 'name' | 'source' | 'plugin'>) => (r.source === 'plugin' && r.plugin ? `plugin:${r.plugin.split('@')[0]}:${r.name}` : r.name);

/** `claude mcp list` output: "name: target - ✔ Connected" per line (a plugin's name has colons, so split at ": "). */
export function parseHealth(out: string): McpHealth[] {
  const rows: McpHealth[] = [];
  for (const line of out.split('\n')) {
    const m = /^(.+?): (.*) - (\S+)\s+(.+)$/.exec(line.trim());
    if (!m) continue;
    const text = m[4]!.trim();
    // \"Connected · tools fetch failed\" is not working: look for trouble before success
    const status: McpHealth['status'] = /auth/i.test(text) ? 'needs-auth' : /fail|error/i.test(text) ? 'failed' : /pending|approval/i.test(text) ? 'pending' : /connected/i.test(text) ? 'connected' : 'unknown';
    rows.push({ name: m[1]!, status, detail: text });
  }
  return rows;
}
