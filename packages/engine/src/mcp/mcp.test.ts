import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { McpManager } from './manager.ts';
import { listServers, parseHealth } from './servers.ts';

const CATALOG = resolve(import.meta.dir, '../../../../catalog/mcp.json');

/** a Claude home with one user server, one plugin server, one disabled plugin and two connectors */
function fakeHome(): string {
  const root = mkdtempSync(join(tmpdir(), 'foundry-mcp-'));
  const home = join(root, '.claude');
  mkdirSync(join(home, 'plugins'), { recursive: true });
  writeFileSync(join(root, '.claude.json'), JSON.stringify({ mcpServers: { gitnexus: { command: '/bin/gitnexus', args: ['mcp'], env: { SECRET: 'x' } } }, claudeAiMcpEverConnected: ['claude.ai Gmail', 'claude.ai Google Drive'] }));
  const media = join(home, 'plugins', 'cache', 'media');
  const off = join(home, 'plugins', 'cache', 'off');
  mkdirSync(media, { recursive: true });
  mkdirSync(join(off, '.claude-plugin'), { recursive: true });
  writeFileSync(join(media, '.mcp.json'), JSON.stringify({ mcpServers: { 'media-pipeline': { command: 'node', args: ['server.js'] } } }));
  writeFileSync(join(off, '.claude-plugin', 'plugin.json'), JSON.stringify({ mcpServers: { quiet: { type: 'http', url: 'https://example.com/mcp' } } }));
  writeFileSync(join(home, 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'media-pipeline@media-market': [{ scope: 'user', installPath: media }], 'off@market': [{ scope: 'user', installPath: off }] } }));
  writeFileSync(join(home, 'settings.json'), JSON.stringify({ enabledPlugins: { 'off@market': false } }));
  return home;
}

describe('listServers', () => {
  test('user scope, enabled plugins and connectors, with the tool prefixes sessions are allowed by', () => {
    const rows = listServers(fakeHome(), ['mcp__plugin_media-pipeline_media-pipeline']);
    expect(rows.map((r) => [r.name, r.source, r.prefix, r.allowed])).toEqual([
      ['gitnexus', 'user', 'mcp__gitnexus', false],
      ['media-pipeline', 'plugin', 'mcp__plugin_media-pipeline_media-pipeline', true],
      ['claude.ai Gmail', 'connector', 'mcp__claude_ai_Gmail', false],
      ['claude.ai Google Drive', 'connector', 'mcp__claude_ai_Google_Drive', false],
    ]);
    expect(rows[0]).toMatchObject({ transport: 'stdio', target: '/bin/gitnexus mcp' });
    expect(JSON.stringify(rows)).not.toContain('SECRET');
  });
  test('no Claude config at all is an empty list', () => {
    expect(listServers(join(mkdtempSync(join(tmpdir(), 'foundry-mcp-none-')), '.claude'), [])).toEqual([]);
  });
});

test('parseHealth reads `claude mcp list`, plugin names included', () => {
  const out = 'Checking MCP server health…\n\nclaude.ai Gmail: https://gmailmcp.googleapis.com/mcp/v1 - ✔ Connected\nplugin:media-pipeline:media-pipeline: node server.js - ✔ Connected\nbroken: npx nope - ✗ Failed to connect\nlinear: https://mcp.linear.app/mcp - ⚠ Needs authentication\n';
  expect(parseHealth(out).map((h) => [h.name, h.status])).toEqual([
    ['claude.ai Gmail', 'connected'],
    ['plugin:media-pipeline:media-pipeline', 'connected'],
    ['broken', 'failed'],
    ['linear', 'needs-auth'],
  ]);
});

describe('McpManager', () => {
  const setup = () => {
    let allowed: string[] = ['mcp__plugin_media-pipeline_media-pipeline'];
    const calls: string[][] = [];
    const lines: string[] = [];
    const m = new McpManager({
      claudeHome: fakeHome(),
      catalogPath: CATALOG,
      claudeBin: '/usr/bin/claude',
      allowed: () => allowed,
      setAllowed: (p) => {
        allowed = p;
      },
      spawn: async (argv) => {
        calls.push(argv);
        return { code: 0, tail: '' };
      },
      log: () => {},
    });
    return { m, calls, lines, say: (l: string) => lines.push(l), allowed: () => allowed };
  };

  test('a catalog install writes user scope, hides the key in the log, and allows the server in goals', async () => {
    const t = setup();
    expect(await t.m.install({ catalogId: 'exa' }, { EXA_API_KEY: 'exa-secret-123' }, t.say)).toEqual({ ok: true, error: null });
    expect(t.calls[0]!.slice(0, 5)).toEqual(['/usr/bin/claude', 'mcp', 'add-json', '--scope', 'user']);
    expect(JSON.parse(t.calls[0]![6]!)).toEqual({ type: 'stdio', command: 'npx', args: ['-y', 'exa-mcp-server'], env: { EXA_API_KEY: 'exa-secret-123' } });
    expect(t.lines.join('\n')).not.toContain('exa-secret-123');
    expect(t.allowed()).toContain('mcp__exa');
  });
  test('a missing key stops the install before anything runs', async () => {
    const t = setup();
    expect(await t.m.install({ catalogId: 'brave-search' }, {}, t.say)).toEqual({ ok: false, error: 'BRAVE_API_KEY is needed' });
    expect(t.calls).toEqual([]);
  });
  test('a custom server is installed but stays off until switched on', async () => {
    const t = setup();
    expect((await t.m.install({ custom: { name: 'docs', config: { type: 'http', url: 'https://example.com/mcp' } } }, {}, t.say)).ok).toBe(true);
    expect(t.allowed()).not.toContain('mcp__docs');
    expect((await t.m.install({ custom: { name: 'bad name!', config: { type: 'http', url: 'https://x' } } }, {}, t.say)).ok).toBe(false);
  });
  test('only user-scope servers can be removed, and removing one also disallows it', async () => {
    const t = setup();
    t.m.allow('mcp__gitnexus', true);
    expect((await t.m.remove('gitnexus', t.say)).ok).toBe(true);
    expect(t.calls.at(-1)).toEqual(['/usr/bin/claude', 'mcp', 'remove', '--scope', 'user', 'gitnexus']);
    expect(t.allowed()).not.toContain('mcp__gitnexus');
    expect((await t.m.remove('media-pipeline', t.say)).ok).toBe(false);
  });
  test('the switch only takes MCP prefixes', () => {
    const t = setup();
    expect(t.m.allow('mcp__claude_ai_Gmail', true)).toContain('mcp__claude_ai_Gmail');
    expect(() => t.m.allow('Bash', true)).toThrow();
  });
  test('Setup warns about each recommended server that is missing', () => {
    const checks = setup().m.doctorChecks();
    expect(checks.map((c) => [c.id, c.ok])).toEqual([
      ['mcp:context7', false],
      ['mcp:playwright', false],
    ]);
  });
});
