import { z } from 'zod';
import { AgentProvider } from './provider.ts';

/**
 * The coding agents Foundry can hold several sign-ins of (ADR-0065). Antigravity keeps one: its CLI has no config dir
 * of its own to point at, and on macOS every agy login shares one Keychain item.
 */
export const POOLED_PROVIDERS = ['claude', 'codex'] as const;
export type PooledProvider = (typeof POOLED_PROVIDERS)[number];
export const isPooled = (provider: AgentProvider): provider is PooledProvider => (POOLED_PROVIDERS as readonly string[]).includes(provider);

/** the machine's own sign-in of a coding agent (~/.claude, ~/.codex): account 1, always there */
export const NATIVE_ACCOUNT = 'native';

/**
 * One subscription sign-in of a coding agent. The machine's own login is `native`; every other account lives in a home
 * Foundry made for it, where only the credentials are its own (ADR-0065).
 */
export const AgentAccount = z.object({
  provider: AgentProvider,
  id: z.string(),
  /** the account's config dir (CLAUDE_CONFIG_DIR, CODEX_HOME); null = the coding agent's default home, the native login */
  home: z.string().nullable(),
  email: z.string().nullable(),
  orgName: z.string().nullable(),
  plan: z.string().nullable(),
  addedAt: z.string(),
});
export type AgentAccount = z.infer<typeof AgentAccount>;
