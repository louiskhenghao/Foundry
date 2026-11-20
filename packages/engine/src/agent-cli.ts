import type { AgentProvider } from '@foundry/core';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';

export type AgentCliId = 'claude-code' | 'codex-cli' | 'antigravity-cli';
export const AGENT_CLI_IDS: AgentCliId[] = ['claude-code', 'codex-cli', 'antigravity-cli'];

/**
 * How Setup installs a coding agent's CLI on this machine, preferring installers that need no npm: Claude Code's native
 * installer, Codex through Homebrew's cask, else npm, else its release binary. null = nothing Foundry can run here;
 * Setup shows the docs instead.
 */
export function agentCliInstall(provider: AgentProvider, which: (bin: string) => string | null = (b) => Bun.which(b), platform: NodeJS.Platform = process.platform, arch: string = process.arch): { id: AgentCliId; command: string } | null {
  if (provider === 'claude') {
    if (which('curl')) return { id: 'claude-code', command: 'curl -fsSL https://claude.ai/install.sh | bash' };
    return which('npm') ? { id: 'claude-code', command: 'npm install -g @anthropic-ai/claude-code' } : null;
  }
  if (provider === 'agy') {
    // Google's installer puts the binary in ~/.local/bin; Homebrew has a cask on macOS
    if (platform === 'darwin' && which('brew')) return { id: 'antigravity-cli', command: 'brew install --cask antigravity-cli' };
    return which('curl') ? { id: 'antigravity-cli', command: 'curl -fsSL https://antigravity.google/cli/install.sh | bash' } : null;
  }
  if (platform === 'darwin' && which('brew')) return { id: 'codex-cli', command: 'brew install --cask codex' };
  if (which('npm')) return { id: 'codex-cli', command: 'npm install -g @openai/codex' };
  // neither: Codex's own release binary into ~/.local/bin (adoptLocalBin puts that on PATH)
  const command = codexRelease(which, platform, arch);
  return command ? { id: 'codex-cli', command } : null;
}

/** Codex's newest release binary, unpacked into ~/.local/bin; null where there is none for this machine or no curl/tar */
function codexRelease(which: (bin: string) => string | null, platform: NodeJS.Platform, arch: string): string | null {
  const cpu = arch === 'x64' ? 'x86_64' : arch === 'arm64' ? 'aarch64' : null;
  const os = platform === 'darwin' ? 'apple-darwin' : platform === 'linux' ? 'unknown-linux-musl' : null;
  if (!cpu || !os || !which('curl') || !which('tar')) return null;
  const triple = `${cpu}-${os}`;
  return `mkdir -p ~/.local/bin && curl -fsSL https://github.com/openai/codex/releases/latest/download/codex-${triple}.tar.gz | tar -xz -C ~/.local/bin && mv ~/.local/bin/codex-${triple} ~/.local/bin/codex`;
}

/** a coding agent's CLI as installed here against its newest release (Setup, Settings → Models) */
export interface AgentCliStatus {
  provider: AgentProvider;
  id: AgentCliId;
  label: string;
  installed: boolean;
  /** what `--version` says; null when it did not answer */
  version: string | null;
  /** the newest release; null when it could not be looked up */
  newest: string | null;
  outdated: boolean;
  /** what Update runs, while it is outdated */
  command: string | null;
}

export const AGENT_CLI_OF: Record<AgentProvider, AgentCliId> = { claude: 'claude-code', codex: 'codex-cli', agy: 'antigravity-cli' };
export const AGENT_CLI_BIN: Record<AgentProvider, string> = { claude: 'claude', codex: 'codex', agy: 'agy' };
export const AGENT_CLI_LABEL: Record<AgentProvider, string> = { claude: 'Claude Code', codex: 'Codex CLI', agy: 'Antigravity CLI' };
export const providerOfCli = (id: AgentCliId): AgentProvider => (id === 'codex-cli' ? 'codex' : id === 'antigravity-cli' ? 'agy' : 'claude');

/** the x.y.z in a CLI's `--version` line ("2.1.323 (Claude Code)", "codex-cli 0.160.0", "1.5.13") */
export function cliVersion(out: string): string | null {
  return /\d+\.\d+\.\d+/.exec(out)?.[0] ?? null;
}

/** whether version `a` comes before `b`, numerically part by part (2.1.99 before 2.1.321) */
export function olderVersion(a: string, b: string): boolean {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) < (pb[i] ?? 0);
  return false;
}

/**
 * Where each CLI's newest release is published, first the source its own updater reads: Claude Code's `latest` channel
 * (its `stable` channel trails it by weeks, and new models come with `latest`), the npm registry for Codex, and the
 * manifest Google's installer reads for Antigravity.
 */
export function newestCliUrls(provider: AgentProvider, platform: string = process.platform, arch: string = process.arch, musl = false): string[] {
  if (provider === 'claude') return ['https://downloads.claude.ai/claude-code-releases/latest', 'https://registry.npmjs.org/@anthropic-ai/claude-code/latest'];
  if (provider === 'codex') return ['https://registry.npmjs.org/@openai/codex/latest'];
  const os = platform === 'darwin' ? 'darwin' : platform === 'linux' ? 'linux' : null;
  const cpu = arch === 'x64' ? 'amd64' : arch === 'arm64' ? 'arm64' : null;
  if (!os || !cpu) return [];
  return [`https://antigravity-cli-auto-updater-974169037036.us-central1.run.app/manifests/${os}_${cpu}${os === 'linux' && musl ? '_musl' : ''}.json`];
}

/** the newest release of a coding agent's CLI; null when none of its sources answers in time */
export async function newestAgentCli(provider: AgentProvider, fetchFn: typeof fetch = fetch, opts: { platform?: string; arch?: string; musl?: boolean; timeoutMs?: number } = {}): Promise<string | null> {
  for (const url of newestCliUrls(provider, opts.platform, opts.arch, opts.musl)) {
    try {
      const res = await fetchFn(url, { signal: AbortSignal.timeout(opts.timeoutMs ?? 5000) });
      if (!res.ok) continue;
      const text = (await res.text()).trim();
      // a plain version (Claude Code's channel files) or JSON with one (npm, Antigravity's manifest)
      const v = /^\d+\.\d+\.\d+$/.test(text) ? text : (/"version"\s*:\s*"(\d+\.\d+\.\d+)"/.exec(text)?.[1] ?? null);
      if (v) return v;
    } catch {}
  }
  return null;
}

const sh = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/**
 * How to bring an installed coding agent's CLI up to its newest release, by how it was installed (`real`: the binary's
 * resolved path). A Homebrew cask is upgraded with the brew that owns it (a server started at login may not have brew on
 * PATH), an npm install through npm, Claude Code's native install with `claude install latest` (`claude update` follows
 * the install's channel, and `stable` lags behind the releases that bring new models), the Codex release binary Setup
 * unpacked into ~/.local/bin is unpacked again (`codex update` cannot place it), anything else by the CLI's own updater.
 */
export function agentCliUpdate(provider: AgentProvider, bin: string, real: string, home: string = homedir(), which: (bin: string) => string | null = (b) => Bun.which(b), platform: NodeJS.Platform = process.platform, arch: string = process.arch): { id: AgentCliId; command: string } {
  const id = AGENT_CLI_OF[provider];
  const cask = /^(.*)\/Caskroom\//.exec(real);
  const brew = cask ? `${cask[1]}/bin/brew` : null;
  if (provider === 'claude') {
    if (brew) return { id, command: `${sh(brew)} upgrade --cask claude-code` };
    if (real.includes('/node_modules/')) return { id, command: 'npm install -g @anthropic-ai/claude-code@latest' };
    if (real.startsWith(join(home, '.local', 'share', 'claude', 'versions') + '/')) return { id, command: `${sh(bin)} install latest` };
    return { id, command: `${sh(bin)} update` };
  }
  if (provider === 'codex') {
    if (brew) return { id, command: `${sh(brew)} upgrade --cask codex` };
    const release = real === join(home, '.local', 'bin', 'codex') ? codexRelease(which, platform, arch) : null;
    return { id, command: release ?? `${sh(bin)} update` };
  }
  if (brew) return { id, command: `${sh(brew)} upgrade --cask antigravity-cli` };
  return { id, command: `${sh(bin)} update` };
}

/**
 * Claude Code's native installer, Codex's release binary and the tools Setup installs (uv, gh, Node.js, graphify…) go to
 * ~/.local/bin, which a server started by launchd, systemd or an older shell may not have on its PATH. When that folder
 * holds one of them and PATH lacks it, add it.
 */
const LOCAL_BIN_TOOLS = ['claude', 'codex', 'agy', 'uv', 'gh', 'node', 'graphify', 'markitdown'];
export function adoptLocalBin(env: Record<string, string | undefined> = process.env, home = homedir()): boolean {
  const dir = join(home, '.local', 'bin');
  const path = env.PATH ?? '';
  if (path.split(delimiter).includes(dir) || !LOCAL_BIN_TOOLS.some((bin) => existsSync(join(dir, bin)))) return false;
  env.PATH = path ? `${dir}${delimiter}${path}` : dir;
  return true;
}
