import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';

export type AgentCliId = 'claude-code' | 'codex-cli';
export const AGENT_CLI_IDS: AgentCliId[] = ['claude-code', 'codex-cli'];

/**
 * How Setup installs a coding agent's CLI on this machine, preferring installers that need no npm: Claude Code's native
 * installer, Codex through Homebrew's cask, else npm, else its release binary. null = nothing Foundry can run here;
 * Setup shows the docs instead.
 */
export function agentCliInstall(provider: 'claude' | 'codex', which: (bin: string) => string | null = (b) => Bun.which(b), platform: NodeJS.Platform = process.platform, arch: string = process.arch): { id: AgentCliId; command: string } | null {
  if (provider === 'claude') {
    if (which('curl')) return { id: 'claude-code', command: 'curl -fsSL https://claude.ai/install.sh | bash' };
    return which('npm') ? { id: 'claude-code', command: 'npm install -g @anthropic-ai/claude-code' } : null;
  }
  if (platform === 'darwin' && which('brew')) return { id: 'codex-cli', command: 'brew install --cask codex' };
  if (which('npm')) return { id: 'codex-cli', command: 'npm install -g @openai/codex' };
  // neither: Codex's own release binary into ~/.local/bin (adoptLocalBin puts that on PATH)
  const cpu = arch === 'x64' ? 'x86_64' : arch === 'arm64' ? 'aarch64' : null;
  const os = platform === 'darwin' ? 'apple-darwin' : platform === 'linux' ? 'unknown-linux-musl' : null;
  if (!cpu || !os || !which('curl') || !which('tar')) return null;
  const triple = `${cpu}-${os}`;
  return { id: 'codex-cli', command: `mkdir -p ~/.local/bin && curl -fsSL https://github.com/openai/codex/releases/latest/download/codex-${triple}.tar.gz | tar -xz -C ~/.local/bin && mv ~/.local/bin/codex-${triple} ~/.local/bin/codex` };
}

/**
 * Claude Code's native installer (and Codex's release binary) go to ~/.local/bin, which a server started by launchd,
 * systemd or an older shell may not have on its PATH. When that folder holds either CLI and PATH lacks it, add it.
 */
export function adoptLocalBin(env: Record<string, string | undefined> = process.env, home = homedir()): boolean {
  const dir = join(home, '.local', 'bin');
  const path = env.PATH ?? '';
  if (path.split(delimiter).includes(dir) || !['claude', 'codex'].some((bin) => existsSync(join(dir, bin)))) return false;
  env.PATH = path ? `${dir}${delimiter}${path}` : dir;
  return true;
}
