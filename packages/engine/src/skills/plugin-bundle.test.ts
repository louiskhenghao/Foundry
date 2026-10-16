import { afterAll, expect, test } from 'bun:test';
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pluginInstallCommand } from './catalog.ts';
import { skillMd, writeCatalog } from './fake-home.test-helper.ts';
import { SkillsManager } from './manager.ts';

const home = mkdtempSync(join(tmpdir(), 'foundry-plugin-bundle-'));
afterAll(() => rmSync(home, { recursive: true, force: true }));

const source = { type: 'plugin', marketplace: 'earthtojake/text-to-cad', ref: 'latest', marketplaceId: 'earthtojake', plugin: 'text-to-cad' } as const;

test('the install commands carry the marketplace ref the way each CLI spells it', () => {
  expect(pluginInstallCommand(source as never, 'claude')).toBe('claude plugin marketplace add earthtojake/text-to-cad#latest && claude plugin install text-to-cad@earthtojake');
  expect(pluginInstallCommand(source as never, 'codex')).toBe('codex plugin marketplace add earthtojake/text-to-cad --ref latest && codex plugin add text-to-cad@earthtojake');
});

test('a plugin bundle installs its plugin once, allows the servers it ships and warms its runtime up with the pinned command', async () => {
  const codexHome = join(home, 'codex');
  mkdirSync(codexHome, { recursive: true });
  writeFileSync(join(codexHome, 'config.toml'), 'model = "x"\n');
  const base = { summary: '', why: '', tier: 'optional', roles: ['worker'], bundle: 'text-to-cad', scenarios: ['cad'] };
  const catalogPath = writeCatalog(join(home, 'catalog'), [
    { ...base, id: 'text-to-cad-cad', name: 'cad', source: { ...source, mcpServers: [{ name: 'cad', denyTools: ['cad_telemetry'] }], warmup: { mcpServer: 'cad', args: ['--version'], note: 'downloading the CAD runtime' } } },
    { ...base, id: 'text-to-cad-dxf', name: 'dxf', source },
  ]);
  const calls: string[][] = [];
  /** the CLI stand-in: `plugin add` lays the plugin down the way Codex does, with its manifest and MCP config */
  const spawn = async (argv: string[], _cwd: string, onLine: (l: string) => void) => {
    calls.push(argv);
    if (argv[1] === 'plugin' && argv[2] === 'add') {
      const root = join(codexHome, 'plugins', 'cache', 'earthtojake', 'text-to-cad', '0.7.21');
      mkdirSync(join(root, '.codex-plugin'), { recursive: true });
      writeFileSync(join(root, '.codex-plugin', 'plugin.json'), JSON.stringify({ name: 'text-to-cad', skills: './skills/', mcpServers: './codex.mcp.json' }));
      writeFileSync(join(root, 'codex.mcp.json'), JSON.stringify({ mcpServers: { cad: { command: 'uvx', args: ['--from', 'cadgen==0.7.21', 'cadgen', 'mcp'], env: { CADGEN_INSTALL_CHANNEL: 'codex' } } } }));
      for (const s of ['cad', 'dxf']) {
        mkdirSync(join(root, 'skills', s), { recursive: true });
        writeFileSync(join(root, 'skills', s, 'SKILL.md'), skillMd(s, `${s} from text-to-cad`));
      }
      writeFileSync(join(root, '.codex-marketplace-install.json'), JSON.stringify({ source_type: 'git', source: 'https://github.com/earthtojake/text-to-cad.git' }));
      appendFileSync(join(codexHome, 'config.toml'), '\n[plugins."text-to-cad@earthtojake"]\nenabled = true\n');
    }
    onLine(`ran ${argv.join(' ')}`);
    return { code: 0, tail: '' };
  };
  const allowed: string[][] = [];
  const manager = new SkillsManager({ provider: 'codex', codexBin: 'codex', claudeHome: codexHome, dataDir: join(home, 'data'), catalogPath, which: () => null, updater: { spawn: spawn as never }, onPluginServers: (names) => void allowed.push(names), sessionEnv: () => ({ CADGEN_TELEMETRY: '0' }) });
  const lines: string[] = [];
  const { results } = await manager.installBundle('text-to-cad', (l) => lines.push(l));
  // one plugin install for the two members; the second rides along
  expect(results.map((r) => [r.name, r.action])).toEqual([['cad', 'installed'], ['dxf', 'plugin']]);
  expect(calls.map((c) => c.slice(0, 5))).toEqual([
    ['codex', 'plugin', 'marketplace', 'add', 'earthtojake/text-to-cad'],
    ['codex', 'plugin', 'add', 'text-to-cad@earthtojake'],
    ['uvx', '--from', 'cadgen==0.7.21', 'cadgen', '--version'],
  ]);
  expect(calls[0]).toEqual(['codex', 'plugin', 'marketplace', 'add', 'earthtojake/text-to-cad', '--ref', 'latest']);
  expect(allowed).toEqual([['cad']]);
  expect(lines.some((l) => l.includes('mcp__cad allowed'))).toBe(true);
  expect(lines.some((l) => l.startsWith('✔ downloading the CAD runtime'))).toBe(true);
  // both members now count as installed through the plugin
  expect((await manager.status()).filter((s) => s.entry.bundle === 'text-to-cad').map((s) => s.status)).toEqual(['installed-via-plugin', 'installed-via-plugin']);
});
