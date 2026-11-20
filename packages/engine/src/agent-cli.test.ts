import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { adoptLocalBin, agentCliInstall, agentCliUpdate, cliVersion, newestAgentCli, newestCliUrls, olderVersion } from './agent-cli.ts';

const has = (...bins: string[]) => (b: string) => (bins.includes(b) ? `/usr/bin/${b}` : null);

describe('agentCliInstall', () => {
  test('Claude Code uses its native installer, needing no npm; npm only without curl', () => {
    expect(agentCliInstall('claude', has('curl'))).toEqual({ id: 'claude-code', command: 'curl -fsSL https://claude.ai/install.sh | bash' });
    expect(agentCliInstall('claude', has('npm'))!.command).toBe('npm install -g @anthropic-ai/claude-code');
    expect(agentCliInstall('claude', has())).toBeNull();
  });
  test('Codex uses the Homebrew cask on macOS, else npm, else its release binary', () => {
    expect(agentCliInstall('codex', has('brew', 'npm'), 'darwin')!.command).toBe('brew install --cask codex');
    expect(agentCliInstall('codex', has('brew', 'npm'), 'linux')!.command).toBe('npm install -g @openai/codex');
    expect(agentCliInstall('codex', has('curl', 'tar'), 'linux', 'arm64')!.command).toContain('releases/latest/download/codex-aarch64-unknown-linux-musl.tar.gz');
    expect(agentCliInstall('codex', has('curl', 'tar'), 'darwin', 'x64')!.command).toContain('codex-x86_64-apple-darwin');
    expect(agentCliInstall('codex', has(), 'linux', 'arm64')).toBeNull();
  });
});

describe('adoptLocalBin', () => {
  test('adds ~/.local/bin to PATH only when it holds claude and PATH lacks it', () => {
    const home = mkdtempSync(join(tmpdir(), 'foundry-home-'));
    const env: Record<string, string | undefined> = { PATH: '/usr/bin' };
    expect(adoptLocalBin(env, home)).toBe(false);
    mkdirSync(join(home, '.local', 'bin'), { recursive: true });
    writeFileSync(join(home, '.local', 'bin', 'claude'), '');
    expect(adoptLocalBin(env, home)).toBe(true);
    expect(env.PATH).toBe(`${join(home, '.local', 'bin')}:/usr/bin`);
    expect(adoptLocalBin(env, home)).toBe(false);
  });
});

describe('agent CLI versions', () => {
  test('the x.y.z of each CLI\'s --version line, compared part by part as numbers', () => {
    expect(cliVersion('2.1.323 (Claude Code)\n')).toBe('2.1.323');
    expect(cliVersion('codex-cli 0.160.0')).toBe('0.160.0');
    expect(cliVersion('1.5.13')).toBe('1.5.13');
    expect(cliVersion('command not found')).toBeNull();
    expect(olderVersion('2.1.99', '2.1.321')).toBe(true);
    expect(olderVersion('2.1.321', '2.1.321')).toBe(false);
    expect(olderVersion('2.2.0', '2.1.329')).toBe(false);
    expect(olderVersion('0.160.0', '0.171.0')).toBe(true);
  });

  test("the newest release: Claude Code's latest channel (not stable, which lags behind new models), npm for Codex, Google's manifest for agy", () => {
    expect(newestCliUrls('claude')[0]).toBe('https://downloads.claude.ai/claude-code-releases/latest');
    expect(newestCliUrls('codex')).toEqual(['https://registry.npmjs.org/@openai/codex/latest']);
    expect(newestCliUrls('agy', 'darwin', 'arm64')).toEqual(['https://antigravity-cli-auto-updater-974169037036.us-central1.run.app/manifests/darwin_arm64.json']);
    expect(newestCliUrls('agy', 'linux', 'x64', true)[0]).toEndWith('/manifests/linux_amd64_musl.json');
    expect(newestCliUrls('agy', 'win32', 'x64')).toEqual([]);
  });

  test('reads a plain version or JSON, falls through a source that fails, and is null when none answers', async () => {
    const asked: string[] = [];
    const fake = (answers: Record<string, string | null>) =>
      (async (url: string | URL | Request) => {
        asked.push(String(url));
        const body = answers[String(url)];
        if (body === undefined) throw new Error('offline');
        return new Response(body ?? '', { status: body === null ? 503 : 200 });
      }) as typeof fetch;
    expect(await newestAgentCli('claude', fake({ 'https://downloads.claude.ai/claude-code-releases/latest': '2.1.329\n' }))).toBe('2.1.329');
    // the channel file is down: npm's answer is used
    expect(await newestAgentCli('claude', fake({ 'https://downloads.claude.ai/claude-code-releases/latest': null, 'https://registry.npmjs.org/@anthropic-ai/claude-code/latest': '{"name":"@anthropic-ai/claude-code","version":"2.1.329"}' }))).toBe('2.1.329');
    expect(await newestAgentCli('agy', fake({ 'https://antigravity-cli-auto-updater-974169037036.us-central1.run.app/manifests/darwin_arm64.json': '{\n  "version": "1.5.13",\n  "url": "x"\n}' }), { platform: 'darwin', arch: 'arm64' })).toBe('1.5.13');
    expect(await newestAgentCli('codex', fake({}))).toBeNull();
  });
});

describe('agentCliUpdate', () => {
  const home = '/Users/me';
  test("Claude Code: the cask's own brew, npm's latest, `install latest` for the native install (its channel may be stable), else its updater", () => {
    expect(agentCliUpdate('claude', '/opt/homebrew/bin/claude', '/opt/homebrew/Caskroom/claude-code/2.1.312/claude', home).command).toBe("'/opt/homebrew/bin/brew' upgrade --cask claude-code");
    expect(agentCliUpdate('claude', '/usr/local/bin/claude', '/usr/local/lib/node_modules/@anthropic-ai/claude-code/cli.js', home).command).toBe('npm install -g @anthropic-ai/claude-code@latest');
    expect(agentCliUpdate('claude', `${home}/.local/bin/claude`, `${home}/.local/share/claude/versions/2.1.312`, home)).toEqual({ id: 'claude-code', command: `'${home}/.local/bin/claude' install latest` });
    expect(agentCliUpdate('claude', '/somewhere/claude', '/somewhere/claude', home).command).toBe("'/somewhere/claude' update");
  });
  test('Codex: brew upgrades the cask, the release binary in ~/.local/bin is unpacked again (codex update cannot place it), else codex update', () => {
    expect(agentCliUpdate('codex', '/opt/homebrew/bin/codex', '/opt/homebrew/Caskroom/codex/0.160.0/codex-aarch64-apple-darwin', home).command).toBe("'/opt/homebrew/bin/brew' upgrade --cask codex");
    const release = agentCliUpdate('codex', `${home}/.local/bin/codex`, `${home}/.local/bin/codex`, home, has('curl', 'tar'), 'darwin', 'arm64');
    expect(release.command).toContain('releases/latest/download/codex-aarch64-apple-darwin.tar.gz');
    expect(agentCliUpdate('codex', '/x/bin/codex', '/x/lib/node_modules/@openai/codex/bin/codex.js', home).command).toBe("'/x/bin/codex' update");
  });
  test('Antigravity: the cask through brew, else agy update; a path with a quote stays one word', () => {
    expect(agentCliUpdate('agy', '/usr/local/bin/agy', '/usr/local/Caskroom/antigravity-cli/1.5.0/agy', home).command).toBe("'/usr/local/bin/brew' upgrade --cask antigravity-cli");
    expect(agentCliUpdate('agy', "/it's/agy", "/it's/agy", home)).toEqual({ id: 'antigravity-cli', command: "'/it'\\''s/agy' update" });
  });
});
