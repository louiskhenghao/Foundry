import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { adoptLocalBin, agentCliInstall } from './agent-cli.ts';

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
