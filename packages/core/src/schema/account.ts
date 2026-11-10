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

/** the plan keys each coding agent reports, said as its maker names the plan; a key not here is said in title case */
const PLAN_WORDS: Record<AgentProvider, Record<string, string>> = {
  claude: { free: 'Free', pro: 'Pro', max: 'Max', team: 'Team', enterprise: 'Enterprise' },
  codex: { free: 'Free', go: 'Go', plus: 'Plus', pro: 'Pro', team: 'Team', business: 'Business', enterprise: 'Enterprise', edu: 'Edu' },
  agy: {},
};
/** `ultra_plus` → Ultra Plus; a word already cased (AI, Pro) is left as it is */
const inWords = (key: string): string => key.split(/[\s_-]+/).filter(Boolean).map((w) => (/^[a-z]/.test(w) ? w[0]!.toUpperCase() + w.slice(1) : w)).join(' ');

/**
 * The plan an account is on, named for a person. The name the coding agent itself shows wins (Claude Code's
 * `planDisplayName`: "Ultra" while the token's subscription type still reads `max`); else the subscription type's key is
 * said in words (`max` → Max, `plus` → Plus), and a key Foundry has never seen in title case (`ultra_plus` → Ultra Plus),
 * so a plan renamed or added upstream is never shown as a bare key and never hidden. Null when the agent reports no plan.
 * A name already in words passes through unchanged, so a stored name can be given again.
 */
export function planName(provider: AgentProvider, raw: { displayName?: string | null; type?: string | null }): string | null {
  const shown = raw.displayName?.trim();
  if (shown) return shown;
  const key = raw.type?.trim();
  if (!key) return null;
  return PLAN_WORDS[provider][key.toLowerCase()] ?? inWords(key);
}
