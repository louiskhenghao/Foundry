import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import type { McpServerRow, McpHealth } from './types.ts';

/** Claude Code's tool-name form of a server name: anything outside [A-Za-z0-9_-] becomes "_" */
const toolName = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, '_');
export const userPrefix = (name: string) => `mcp__${toolName(name)}`;
export const pluginPrefix = (plugin: string, server: string) => `mcp__plugin_${toolName(plugin)}_${toolName(server)}`;

/** ~/.claude.json, or $CLAUDE_CONFIG_DIR/.claude.json when the Claude home is not the default one (Docker) */
export function claudeJsonPath(claudeHome: string): string {
  const inside = join(claudeHome, '.claude.json');
  return existsSync(inside) ? inside : join(dirname(claudeHome), '.claude.json');
}

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

/**
 * Every MCP server Claude Code would load, read from its files (ADR-0016): user scope in .claude.json, servers shipped
 * by enabled plugins, and claude.ai connectors. No server is started.
 */
export function listServers(claudeHome: string, allowed: readonly string[]): McpServerRow[] {
  const out: McpServerRow[] = [];
  const row = (r: Omit<McpServerRow, 'allowed' | 'catalogId'>): McpServerRow => ({ ...r, allowed: allowed.includes(r.prefix), catalogId: null });
  const cfg = readJson(claudeJsonPath(claudeHome)) ?? {};
  for (const [name, c] of Object.entries<Config>(cfg.mcpServers ?? {})) out.push(row({ name, source: 'user', plugin: null, prefix: userPrefix(name), ...describe(c) }));

  const registry = readJson(join(claudeHome, 'plugins', 'installed_plugins.json'));
  const enabled = readJson(join(claudeHome, 'settings.json'))?.enabledPlugins ?? {};
  for (const [id, recs] of Object.entries<any>(registry?.plugins ?? registry ?? {})) {
    if (enabled[id] === false) continue;
    const rec = (Array.isArray(recs) ? recs : [recs]).find((r) => r?.installPath);
    if (!rec) continue;
    const path = isAbsolute(rec.installPath) ? rec.installPath : join(claudeHome, 'plugins', rec.installPath);
    const plugin = id.split('@')[0]!;
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
    const status: McpHealth['status'] = /connected/i.test(text) ? 'connected' : /auth/i.test(text) ? 'needs-auth' : /pending|approval/i.test(text) ? 'pending' : /fail|error/i.test(text) ? 'failed' : 'unknown';
    rows.push({ name: m[1]!, status, detail: text });
  }
  return rows;
}
