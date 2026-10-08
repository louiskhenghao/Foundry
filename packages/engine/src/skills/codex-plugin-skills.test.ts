import { afterAll, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pluginInstallCommand } from './catalog.ts';
import { skillMd, writeCatalog } from './fake-home.test-helper.ts';
import { SkillsManager } from './manager.ts';
import { codexEnabledPlugins } from './scanner.ts';

const home = mkdtempSync(join(tmpdir(), 'foundry-codex-plugin-skills-'));
afterAll(() => rmSync(home, { recursive: true, force: true }));

/** a plugin version folder as Codex leaves it in plugins/cache/<marketplace>/<name>/<version>/ */
function plugin(codexHome: string, marketplace: string, name: string, version: string, manifest: { dir: '.codex-plugin' | '.claude-plugin'; skills?: string | string[] }, skills: string[]) {
  const root = join(codexHome, 'plugins', 'cache', marketplace, name, version);
  mkdirSync(join(root, manifest.dir), { recursive: true });
  writeFileSync(join(root, manifest.dir, 'plugin.json'), JSON.stringify({ name, ...(manifest.skills ? { skills: manifest.skills } : {}) }));
  const skillsRoot = typeof manifest.skills === 'string' ? manifest.skills : 'skills';
  for (const s of skills) {
    mkdirSync(join(root, skillsRoot, s), { recursive: true });
    writeFileSync(join(root, skillsRoot, s, 'SKILL.md'), skillMd(s, `${s} from ${name}`));
  }
  writeFileSync(join(root, '.codex-marketplace-install.json'), JSON.stringify({ source_type: 'git', source: `https://github.com/acme/${marketplace}.git` }));
  return root;
}

test('Codex plugin skills are listed from its plugin cache, and a catalog plugin counts as installed there', async () => {
  const codexHome = join(home, 'codex');
  mkdirSync(codexHome, { recursive: true });
  writeFileSync(
    join(codexHome, 'config.toml'),
    ['model = "x"', '', '[plugins."ui-pro@ui-pro-market"]', 'enabled = true', '', '[plugins."off@m"]', 'enabled = false', '', '[plugins."bundled@openai-bundled"]', 'enabled = true', '', '[mcp_servers.x]', 'command = "y"'].join('\n'),
  );
  expect(codexEnabledPlugins(join(codexHome, 'config.toml'))).toEqual(['ui-pro@ui-pro-market', 'bundled@openai-bundled']);
  // two versions: the newer one is read; a Claude Code manifest with a skills folder elsewhere works too
  const old = plugin(codexHome, 'ui-pro-market', 'ui-pro', '1.0.0', { dir: '.claude-plugin', skills: './.claude/skills/' }, ['old-only']);
  utimesSync(old, new Date(2020, 0, 1), new Date(2020, 0, 1));
  plugin(codexHome, 'ui-pro-market', 'ui-pro', '2.0.0', { dir: '.claude-plugin', skills: './.claude/skills/' }, ['ui-pro', 'brand']);
  plugin(codexHome, 'openai-bundled', 'bundled', '1.0.46', { dir: '.codex-plugin' }, ['visualize']);
  plugin(codexHome, 'm', 'off', '1.0.0', { dir: '.codex-plugin' }, ['hidden']);

  const base = { summary: '', why: '', tier: 'optional', pack: 'design', packOption: 'ui-pro', roles: ['worker'] };
  const catalogPath = writeCatalog(join(home, 'catalog'), [{ ...base, id: 'ui-pro', name: 'ui-pro', source: { type: 'plugin', marketplace: 'acme/ui-pro-market', marketplaceId: 'ui-pro-market', plugin: 'ui-pro' } }]);
  const codex = new SkillsManager({ provider: 'codex', claudeHome: codexHome, dataDir: join(home, 'data'), catalogPath, which: () => null });

  const rows = codex.scan().installed.filter((r) => r.scope === 'plugin');
  expect(rows.map((r) => [r.plugin?.id, r.name]).sort()).toEqual([['bundled@openai-bundled', 'visualize'], ['ui-pro@ui-pro-market', 'brand'], ['ui-pro@ui-pro-market', 'ui-pro']]);
  expect(rows.find((r) => r.name === 'ui-pro')?.plugin).toMatchObject({ version: '2.0.0', marketplaceRepo: 'acme/ui-pro-market' });
  expect(rows.every((r) => !r.canUninstall)).toBe(true);

  // the catalog keeps its plugin entry for Codex and finds it installed through the plugin
  const status = (await codex.status()).find((s) => s.entry.id === 'ui-pro');
  expect(status?.status).toBe('installed-via-plugin');
  expect(pluginInstallCommand({ type: 'plugin', marketplace: 'acme/ui-pro-market', marketplaceId: 'ui-pro-market', plugin: 'ui-pro' } as never, 'codex')).toBe('codex plugin marketplace add acme/ui-pro-market && codex plugin add ui-pro@ui-pro-market');
});
