import { existsSync, lstatSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import type { PooledProvider } from '@foundry/core';

/**
 * What an added account's home shares with the native one, by link (ADR-0065): everything but the sign-in, so a skill or
 * plugin installed once reaches every account and a session started on one account can be resumed on another. `make`
 * dirs are created in the native home when missing (the transcripts must be shared from the first session on).
 */
export const SHARED_ENTRIES: Record<PooledProvider, { make: string[]; link: string[] }> = {
  claude: { make: ['projects', 'sessions'], link: ['skills', 'plugins', 'agents', 'commands', 'output-styles', 'hooks', 'plans', 'settings.json', 'CLAUDE.md'] },
  codex: { make: ['sessions'], link: ['skills', 'plugins', 'prompts', 'rules', 'hooks', 'config.toml', 'hooks.json', 'AGENTS.md'] },
};

/** where Foundry keeps the homes of a coding agent's added accounts */
export const accountsRoot = (dataDir: string, provider: PooledProvider): string => join(dataDir, 'accounts', provider);
export const accountHome = (dataDir: string, provider: PooledProvider, id: string): string => join(accountsRoot(dataDir, provider), id);

const present = (path: string): boolean => {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
};

/**
 * Link what the account shares with the native home into its own. A missing link is made; an entry the account already
 * has (its credentials, a file the coding agent wrote there itself) stays as it is. Returns the names it linked.
 */
export function linkShared(provider: PooledProvider, nativeHome: string, home: string): string[] {
  mkdirSync(home, { recursive: true });
  const linked: string[] = [];
  for (const name of SHARED_ENTRIES[provider].make) mkdirSync(join(nativeHome, name), { recursive: true });
  for (const name of [...SHARED_ENTRIES[provider].make, ...SHARED_ENTRIES[provider].link]) {
    const from = join(nativeHome, name);
    const to = join(home, name);
    if (!existsSync(from) || present(to)) continue;
    symlinkSync(from, to);
    linked.push(name);
  }
  return linked;
}

/** Delete an added account's home: its own files go, the links go, what they point at in the native home stays. */
export function removeHome(dataDir: string, provider: PooledProvider, home: string): void {
  const inside = relative(resolve(accountsRoot(dataDir, provider)), resolve(home));
  // never anything outside Foundry's accounts folder, whatever an event says
  if (!inside || inside.startsWith('..') || inside.includes('/')) throw new Error(`refusing to remove ${home}: not an account home`);
  rmSync(home, { recursive: true, force: true });
}
