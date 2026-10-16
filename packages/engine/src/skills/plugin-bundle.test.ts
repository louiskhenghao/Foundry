import { afterAll, expect, test } from 'bun:test';
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pluginInstallCommand } from './catalog.ts';
import { fakeCadPlugin, skillMd, writeCatalog } from './fake-home.test-helper.ts';
import { readPluginMcpServer, serverBaseArgs } from './installer.ts';
import { SkillsManager } from './manager.ts';

const home = mkdtempSync(join(tmpdir(), 'foundry-plugin-bundle-'));
afterAll(() => rmSync(home, { recursive: true, force: true }));

const source = { type: 'plugin', marketplace: 'earthtojake/text-to-cad', ref: 'latest', marketplaceId: 'earthtojake', plugin: 'text-to-cad' } as const;
const base = { summary: '', why: '', tier: 'optional', roles: ['worker'], bundle: 'text-to-cad', scenarios: ['cad'] };
const entries = [
  { ...base, id: 'text-to-cad-cad', name: 'cad', source: { ...source, mcpServers: [{ name: 'cad', denyTools: ['cad_telemetry'] }], warmup: { mcpServer: 'cad', args: ['--version'], note: 'downloading the CAD runtime' } } },
  { ...base, id: 'text-to-cad-dxf', name: 'dxf', source },
];
const CADGEN = ['--no-config', '--from', 'cadgen==0.7.21', 'cadgen', 'mcp'];
type Spawn = (argv: string[], cwd: string, onLine: (l: string) => void, opts?: { env?: Record<string, string> }) => Promise<{ code: number; tail: string }>;

/** the CLI stand-in's work: the plugin laid down the way Codex does, with its manifest and MCP config */
function layCodexPlugin(codexHome: string): void {
  const root = join(codexHome, 'plugins', 'cache', 'earthtojake', 'text-to-cad', '0.7.21');
  mkdirSync(join(root, '.codex-plugin'), { recursive: true });
  writeFileSync(join(root, '.codex-plugin', 'plugin.json'), JSON.stringify({ name: 'text-to-cad', skills: './skills/', mcpServers: './codex.mcp.json' }));
  writeFileSync(join(root, 'codex.mcp.json'), JSON.stringify({ mcpServers: { cad: { command: 'uvx', args: CADGEN, env: { CADGEN_INSTALL_CHANNEL: 'codex' } } } }));
  for (const s of ['cad', 'dxf']) {
    mkdirSync(join(root, 'skills', s), { recursive: true });
    writeFileSync(join(root, 'skills', s, 'SKILL.md'), skillMd(s, `${s} from text-to-cad`));
  }
  writeFileSync(join(root, '.codex-marketplace-install.json'), JSON.stringify({ source_type: 'git', source: 'https://github.com/earthtojake/text-to-cad.git' }));
  appendFileSync(join(codexHome, 'config.toml'), '\n[plugins."text-to-cad@earthtojake"]\nenabled = true\n');
}

test('the install commands carry the marketplace ref the way each CLI spells it', () => {
  expect(pluginInstallCommand(source as never, 'claude')).toBe('claude plugin marketplace add earthtojake/text-to-cad#latest && claude plugin install text-to-cad@earthtojake');
  expect(pluginInstallCommand(source as never, 'codex')).toBe('codex plugin marketplace add earthtojake/text-to-cad --ref latest && codex plugin add text-to-cad@earthtojake');
});

test('a plugin bundle installs its plugin once, allows the servers it ships under the prefix the coding agent gives them, and warms its runtime up with the pinned command', async () => {
  const codexHome = join(home, 'codex');
  mkdirSync(codexHome, { recursive: true });
  writeFileSync(join(codexHome, 'config.toml'), 'model = "x"\n');
  const catalogPath = writeCatalog(join(home, 'catalog'), entries);
  const calls: string[][] = [];
  const envs: (Record<string, string> | undefined)[] = [];
  const spawn: Spawn = async (argv, _cwd, onLine, opts) => {
    calls.push(argv);
    if (argv[1] === 'plugin' && argv[2] === 'add') layCodexPlugin(codexHome);
    if (argv[0] === 'uvx') envs.push(opts?.env);
    onLine(`ran ${argv.join(' ')}`);
    return { code: 0, tail: '' };
  };
  const allowed: string[][] = [];
  const installed: string[] = [];
  const manager = new SkillsManager({ provider: 'codex', codexBin: 'codex', claudeHome: codexHome, dataDir: join(home, 'data'), catalogPath, which: () => null, updater: { spawn: spawn as never }, onPluginServers: (p) => void allowed.push(p), sessionEnv: () => ({ CADGEN_TELEMETRY: '0', OPENAI_API_KEY: 'sk-secret' }), onPluginInstalled: (id) => installed.push(id) });
  const lines: string[] = [];
  const { results } = await manager.installBundle('text-to-cad', (l) => lines.push(l));
  // one plugin install for the two members; the second rides along
  expect(results.map((r) => [r.name, r.action])).toEqual([['cad', 'installed'], ['dxf', 'plugin']]);
  expect(calls.map((c) => c.slice(0, 4))).toEqual([
    ['codex', 'plugin', 'marketplace', 'add'],
    ['codex', 'plugin', 'add', 'text-to-cad@earthtojake'],
    ['uvx', '--no-config', '--from', 'cadgen==0.7.21'],
  ]);
  expect(calls[0]).toEqual(['codex', 'plugin', 'marketplace', 'add', 'earthtojake/text-to-cad', '--ref', 'latest']);
  // the warm-up: the server's own command up to its `mcp` subcommand, then --version; the plugin's env plus the session's switches, never its keys
  expect(calls[2]).toEqual(['uvx', '--no-config', '--from', 'cadgen==0.7.21', 'cadgen', '--version']);
  expect(envs).toEqual([{ CADGEN_INSTALL_CHANNEL: 'codex', CADGEN_TELEMETRY: '0' }]);
  // Codex names a plugin's server by its own name
  expect(allowed).toEqual([['mcp__cad']]);
  expect(lines.some((l) => l.includes('mcp__cad allowed'))).toBe(true);
  expect(lines.some((l) => l.startsWith('✔ downloading the CAD runtime'))).toBe(true);
  expect(installed).toEqual(['text-to-cad@earthtojake']);
  // both members now count as installed through the plugin
  expect((await manager.status()).filter((s) => s.entry.bundle === 'text-to-cad').map((s) => s.status)).toEqual(['installed-via-plugin', 'installed-via-plugin']);
  // a second run: the plugin is already on disk, yet its servers are allowed and its runtime warmed up again, and the waiting goals told
  const again = await manager.installBundle('text-to-cad');
  expect(again.results.map((r) => r.action)).toEqual(['plugin', 'plugin']);
  expect(allowed).toEqual([['mcp__cad'], ['mcp__cad']]);
  expect(calls.filter((c) => c[0] === 'uvx')).toHaveLength(2);
  expect(installed).toEqual(['text-to-cad@earthtojake', 'text-to-cad@earthtojake']);
});

test("Claude Code names a plugin's server under the plugin; a failed warm-up is reported on the entries while the install stands", async () => {
  const claudeHome = join(home, 'claude');
  const root = fakeCadPlugin(claudeHome, ['cad', 'dxf']);
  const catalogPath = writeCatalog(join(home, 'catalog-claude'), entries);
  const allowed: string[][] = [];
  const calls: string[][] = [];
  const installed: string[] = [];
  const spawn: Spawn = async (argv) => {
    calls.push(argv);
    return { code: 1, tail: 'No solution found when resolving tool dependencies' };
  };
  const manager = new SkillsManager({ provider: 'claude', claudeHome, dataDir: join(home, 'data-claude'), catalogPath, which: () => null, updater: { spawn: spawn as never }, onPluginServers: (p) => void allowed.push(p), onPluginInstalled: (id) => installed.push(id) });
  const lines: string[] = [];
  const { results } = await manager.installBundle('text-to-cad', (l) => lines.push(l));
  expect(allowed).toEqual([['mcp__plugin_text-to-cad_cad']]);
  expect(lines.some((l) => l.includes('mcp__plugin_text-to-cad_cad allowed'))).toBe(true);
  expect(readPluginMcpServer(root, 'claude', 'cad')).toEqual({ command: 'uvx', args: CADGEN, env: { CADGEN_INSTALL_CHANNEL: 'claude' } });
  expect(calls.map((c) => c.at(-1))).toEqual(['--version']);
  expect(lines.some((l) => l.startsWith('✘ downloading the CAD runtime: exit 1'))).toBe(true);
  expect(results.map((r) => r.action)).toEqual(['plugin', 'plugin']);
  expect(results[0]!.detail).toContain('runtime warm-up failed: exit 1');
  expect(installed).toEqual(['text-to-cad@earthtojake']);
});

test("a plugin config outside the plugin is not followed; the server's base stops at its mcp subcommand", () => {
  const root = join(home, 'escape');
  mkdirSync(join(root, '.claude-plugin'), { recursive: true });
  writeFileSync(join(root, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'x', mcpServers: '../outside.json' }));
  writeFileSync(join(home, 'outside.json'), JSON.stringify({ mcpServers: { cad: { command: 'evil' } } }));
  expect(readPluginMcpServer(root, 'claude', 'cad')).toBeNull();
  expect(serverBaseArgs(['--from', 'cadgen==1', 'cadgen', 'mcp'])).toEqual(['--from', 'cadgen==1', 'cadgen']);
  expect(serverBaseArgs(['--from', 'cadgen==1', 'cadgen', 'mcp', '--stdio'])).toEqual(['--from', 'cadgen==1', 'cadgen']);
  expect(serverBaseArgs(['serve'])).toEqual([]);
});
