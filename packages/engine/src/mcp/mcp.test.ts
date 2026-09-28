import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { McpManager, SERVER_NAME } from './manager.ts';
import { listServers, parseHealth, userPrefix } from './servers.ts';

const CATALOG = resolve(import.meta.dir, '../../../../catalog/mcp.json');

/** a Claude home with one user server, one plugin server, one disabled plugin and two connectors */
function fakeHome(): string {
  const root = mkdtempSync(join(tmpdir(), 'foundry-mcp-'));
  const home = join(root, '.claude');
  mkdirSync(join(home, 'plugins'), { recursive: true });
  writeFileSync(join(root, '.claude.json'), JSON.stringify({ mcpServers: { gitnexus: { command: '/bin/gitnexus', args: ['mcp'], env: { SECRET: 'x' } }, docs: { type: 'http', url: 'https://example.com/mcp' } }, claudeAiMcpEverConnected: ['claude.ai Gmail', 'claude.ai Google Drive'] }));
  const media = join(home, 'plugins', 'cache', 'media');
  const off = join(home, 'plugins', 'cache', 'off');
  mkdirSync(media, { recursive: true });
  mkdirSync(join(off, '.claude-plugin'), { recursive: true });
  writeFileSync(join(media, '.mcp.json'), JSON.stringify({ mcpServers: { 'media-pipeline': { command: 'node', args: ['server.js'] } } }));
  writeFileSync(join(off, '.claude-plugin', 'plugin.json'), JSON.stringify({ mcpServers: { quiet: { type: 'http', url: 'https://example.com/mcp' } } }));
  const ctx7 = join(home, 'plugins', 'cache', 'context7');
  mkdirSync(ctx7, { recursive: true });
  writeFileSync(join(ctx7, '.mcp.json'), JSON.stringify({ context7: { type: 'http', url: 'https://mcp.context7.com/mcp' } }));
  writeFileSync(join(home, 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'media-pipeline@media-market': [{ scope: 'user', installPath: media }], 'off@market': [{ scope: 'user', installPath: off }], 'context7@official': [{ scope: 'project', projectPath: '/some/repo', installPath: ctx7 }] } }));
  writeFileSync(join(home, 'settings.json'), JSON.stringify({ enabledPlugins: { 'off@market': false } }));
  return home;
}

describe('listServers', () => {
  test('user scope, enabled plugins and connectors, with the tool prefixes sessions are allowed by', () => {
    const home = fakeHome();
    const rows = listServers(home, ['mcp__plugin_media-pipeline_media-pipeline'], join(dirname(home), '.claude.json'));
    expect(rows.map((r) => [r.name, r.source, r.prefix, r.allowed])).toEqual([
      ['gitnexus', 'user', 'mcp__gitnexus', false],
      ['docs', 'user', 'mcp__docs', false],
      ['media-pipeline', 'plugin', 'mcp__plugin_media-pipeline_media-pipeline', true],
      ['claude.ai Gmail', 'connector', 'mcp__claude_ai_Gmail', false],
      ['claude.ai Google Drive', 'connector', 'mcp__claude_ai_Google_Drive', false],
    ]);
    expect(rows[0]).toMatchObject({ transport: 'stdio', target: '/bin/gitnexus mcp' });
    expect(JSON.stringify(rows)).not.toContain('SECRET');
  });
  test('no Claude config at all is an empty list', () => {
    const none = mkdtempSync(join(tmpdir(), 'foundry-mcp-none-'));
    expect(listServers(join(none, '.claude'), [], join(none, '.claude.json'))).toEqual([]);
  });
});

test('connector names become tool prefixes the way Claude Code makes them', () => {
  expect(userPrefix('claude.ai Slack (beta)')).toBe('mcp__claude_ai_Slack_beta');
  expect(userPrefix('claude.ai Google Drive')).toBe('mcp__claude_ai_Google_Drive');
  expect(userPrefix('my-server')).toBe('mcp__my-server');
});

test('server names Claude Code accepts, without "__" that would split a tool rule', () => {
  for (const ok of ['context7', 'brave-search', 'my_server', 'a-b_c']) expect(SERVER_NAME.test(ok), ok).toBe(true);
  for (const bad of ['my.server', 'a__b', '_x', 'x_', 'bad name', '']) expect(SERVER_NAME.test(bad), bad).toBe(false);
});

test('parseHealth reads `claude mcp list`, plugin names included', () => {
  const out = 'Checking MCP server health…\n\nclaude.ai Gmail: https://gmailmcp.googleapis.com/mcp/v1 - ✔ Connected\nplugin:media-pipeline:media-pipeline: node server.js - ✔ Connected\nbroken: npx nope - ✗ Failed to connect\nlinear: https://mcp.linear.app/mcp - ⚠ Needs authentication\nhalf: https://h/mcp - ✔ Connected · tools fetch failed\n';
  expect(parseHealth(out).map((h) => [h.name, h.status])).toEqual([
    ['claude.ai Gmail', 'connected'],
    ['plugin:media-pipeline:media-pipeline', 'connected'],
    ['broken', 'failed'],
    ['linear', 'needs-auth'],
    ['half', 'failed'],
  ]);
});

describe('McpManager', () => {
  const setup = () => {
    const home = fakeHome();
    let allowed: string[] = ['mcp__plugin_media-pipeline_media-pipeline'];
    const calls: string[][] = [];
    const lines: string[] = [];
    const m = new McpManager({
      claudeHome: home,
      claudeJson: join(dirname(home), '.claude.json'),
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
    expect((await t.m.install({ custom: { name: 'wiki', config: { type: 'http', url: 'https://example.com/mcp' } } }, {}, t.say)).ok).toBe(true);
    expect(t.allowed()).not.toContain('mcp__wiki');
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
  test('a plugin that ships a catalog server counts as having it (a project-scope plugin does not)', () => {
    const t = setup();
    const home = mkdtempSync(join(tmpdir(), 'foundry-mcp-plug-'));
    // context7 from a user-scope plugin
    const p = join(home, '.claude', 'plugins', 'cache', 'c7');
    mkdirSync(p, { recursive: true });
    writeFileSync(join(p, '.mcp.json'), JSON.stringify({ context7: { type: 'http', url: 'https://mcp.context7.com/mcp' } }));
    writeFileSync(join(home, '.claude', 'plugins', 'installed_plugins.json'), JSON.stringify({ plugins: { 'context7@official': [{ scope: 'user', installPath: p }] } }));
    const m = new McpManager({ claudeHome: join(home, '.claude'), claudeJson: join(home, '.claude.json'), catalogPath: CATALOG, allowed: () => [], setAllowed: () => {}, log: () => {} });
    expect(m.view().catalog.find((c) => c.entry.id === 'context7')?.installed).toBe(true);
    // the fixture's context7 plugin is project-scope: not listed, not installed
    expect(t.m.view().servers.some((s) => s.name === 'context7')).toBe(false);
  });
  test('changing a key replaces the server and keeps whether goals may use it', async () => {
    const t = setup();
    expect((await t.m.install({ custom: { name: 'gitnexus', config: { type: 'stdio', command: 'gitnexus', args: ['mcp'] } } }, { TOKEN: 'a' }, t.say)).error).toBe('gitnexus is already installed');
    t.m.allow('mcp__gitnexus', true);
    const r = await t.m.install({ custom: { name: 'gitnexus', config: { type: 'stdio', command: 'gitnexus', args: ['mcp'] } } }, { TOKEN: 'k"ey\\1' }, t.say, true);
    expect(r.ok).toBe(true);
    expect(t.calls.map((c) => c.slice(1, 3).join(' '))).toEqual(['mcp remove', 'mcp add-json']);
    expect(t.allowed()).toContain('mcp__gitnexus');
    // the key, raw or JSON-escaped, never reaches the log
    expect(t.lines.join('\n')).not.toContain('ey');
  });
  test('a URL server takes no environment: it signs in instead', async () => {
    const t = setup();
    expect((await t.m.install({ custom: { name: 'linear', config: { type: 'http', url: 'https://mcp.linear.app/mcp' } } }, { TOKEN: 'x' }, t.say)).ok).toBe(false);
    expect(t.calls).toEqual([]);
  });
});
