import { parseCodexAccount } from '../auth/codex-account.ts';
import { CodexAccountReadError, rpcObject, withCodexAccountRpc, type CodexAccountReadOptions } from '../auth/codex-app-server.ts';

export interface CodexRateLimitWindow { usedPercent: number; windowDurationMins: number | null; resetsAt: number | null }
export interface CodexRateLimitSnapshot {
  limitId: string | null;
  limitName: string | null;
  normalModelSlug: string | null;
  primary: CodexRateLimitWindow | null;
  secondary: CodexRateLimitWindow | null;
  credits: { hasCredits: boolean; unlimited: boolean; balance: string | null } | null;
  individualLimit: { limit: string; used: string; remainingPercent: number; resetsAt: number } | null;
  spendControlReached: boolean | null;
  planType: string | null;
  rateLimitReachedType: string | null;
}
export interface CodexUsageSnapshot {
  checkedAt: string;
  /** The only native signal for ordinary included-usage permission. Null is unknown. */
  ordinaryUsageAllowed: boolean | null;
  rateLimits: CodexRateLimitSnapshot;
  rateLimitsByLimitId: Record<string, CodexRateLimitSnapshot> | null;
  accountId: string | null;
}

const invalid = () => new CodexAccountReadError('Codex returned invalid account quota data.', 'protocol');
function text(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== 'string' || value.length > 500) throw invalid();
  return value;
}
function flag(value: unknown): boolean | null {
  if (value == null) return null;
  if (typeof value !== 'boolean') throw invalid();
  return value;
}
function number(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw invalid();
  return value;
}
function window(value: unknown): CodexRateLimitWindow | null {
  if (value == null) return null;
  if (!rpcObject(value)) throw invalid();
  return { usedPercent: number(value.usedPercent), windowDurationMins: value.windowDurationMins == null ? null : number(value.windowDurationMins), resetsAt: value.resetsAt == null ? null : number(value.resetsAt) };
}
function snapshot(value: unknown): CodexRateLimitSnapshot {
  if (!rpcObject(value)) throw invalid();
  let credits: CodexRateLimitSnapshot['credits'] = null;
  if (value.credits != null) {
    if (!rpcObject(value.credits) || typeof value.credits.hasCredits !== 'boolean' || typeof value.credits.unlimited !== 'boolean') throw invalid();
    credits = { hasCredits: value.credits.hasCredits, unlimited: value.credits.unlimited, balance: text(value.credits.balance) };
  }
  let individualLimit: CodexRateLimitSnapshot['individualLimit'] = null;
  if (value.individualLimit != null) {
    const limit = value.individualLimit;
    if (!rpcObject(limit) || typeof limit.limit !== 'string' || typeof limit.used !== 'string') throw invalid();
    individualLimit = { limit: text(limit.limit)!, used: text(limit.used)!, remainingPercent: number(limit.remainingPercent), resetsAt: number(limit.resetsAt) };
  }
  return {
    limitId: text(value.limitId), limitName: text(value.limitName), normalModelSlug: text(value.normalModelSlug), primary: window(value.primary), secondary: window(value.secondary),
    credits, individualLimit, spendControlReached: flag(value.spendControlReached), planType: text(value.planType), rateLimitReachedType: text(value.rateLimitReachedType),
  };
}

/** Keep only bounded, known quota fields; never derive permission/recovery from a window or a credit balance. */
export function parseCodexUsage(value: unknown, checkedAt = new Date().toISOString()): CodexUsageSnapshot {
  if (!rpcObject(value)) throw invalid();
  let rateLimitsByLimitId: Record<string, CodexRateLimitSnapshot> | null = null;
  if (value.rateLimitsByLimitId != null) {
    if (!rpcObject(value.rateLimitsByLimitId) || Object.keys(value.rateLimitsByLimitId).length > 100) throw invalid();
    rateLimitsByLimitId = Object.fromEntries(Object.entries(value.rateLimitsByLimitId).map(([key, entry]) => {
      if (!key || key.length > 200) throw invalid();
      return [key, snapshot(entry)];
    }));
  }
  return { checkedAt, ordinaryUsageAllowed: flag(value.ordinaryUsageAllowed), rateLimits: snapshot(value.rateLimits), rateLimitsByLimitId, accountId: text(value.accountId) };
}

/** Read native ChatGPT quota without starting inference, refreshing tokens, or enabling reserve usage. */
export async function readCodexUsage(bin: string, home?: string, options: CodexAccountReadOptions = {}): Promise<CodexUsageSnapshot> {
  return withCodexAccountRpc(bin, home, options, async (request) => {
    const account = parseCodexAccount(await request('account/read', { refreshToken: false }));
    if (!account) throw new CodexAccountReadError('Sign in with ChatGPT using codex login to read quota.', 'auth');
    const result = await request('account/rateLimits/read', { supportsLunaReserve: false, excludeResetCreditDetails: true });
    return parseCodexUsage(result);
  });
}
