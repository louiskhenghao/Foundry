import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { exec } from '../git/git.ts';
import type { ClaudeUsage, ClaudeUsageWindow } from './types.ts';

/**
 * Where Claude Code reads the account's own usage from: what its `/usage` and the menu-bar app show (ADR-0090). Not a
 * documented API: when it changes, the reader says the usage is unavailable and nothing else is touched.
 */
export const CLAUDE_USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const OAUTH_BETA = 'oauth-2025-04-20';

/** the sign-in Claude Code keeps for a config dir: the bearer its usage is read with, and when it lapses */
export interface ClaudeCredentials {
  accessToken: string;
  /** ms since the epoch; null when the token does not say (a long-lived one from the environment) */
  expiresAt: number | null;
}

/**
 * The Keychain item Claude Code keeps a config dir's sign-in in: `Claude Code-credentials` for its default home, and the
 * same with `-` and the first 8 hex of the dir's sha256 when CLAUDE_CONFIG_DIR names the dir (what an added account's
 * home is, ADR-0065). `configDir` is that variable's value, null when it is not set.
 */
export function claudeKeychainService(configDir: string | null): string {
  return configDir === null ? 'Claude Code-credentials' : `Claude Code-credentials-${createHash('sha256').update(configDir.normalize('NFC')).digest('hex').slice(0, 8)}`;
}

const parseCredentials = (text: string): ClaudeCredentials | null => {
  try {
    const o = JSON.parse(text)?.claudeAiOauth;
    return typeof o?.accessToken === 'string' && o.accessToken ? { accessToken: o.accessToken, expiresAt: typeof o.expiresAt === 'number' && Number.isFinite(o.expiresAt) ? o.expiresAt : null } : null;
  } catch {
    return null;
  }
};

/**
 * The sign-in Claude Code keeps for a config dir, read where Claude Code keeps it and never written: a token in the
 * environment first (it outranks any config dir for Claude Code too; an added account runs with it blanked), then on
 * macOS the Keychain item through the `security` tool (Claude Code wrote the item with it, so no prompt), else
 * `.credentials.json` in the config dir. The token stays in memory: never logged or stored, sent only to Claude's own
 * usage service.
 */
export async function readClaudeCredentials(configDir: string | null, opts: { run?: typeof exec; envToken?: string | null } = {}): Promise<ClaudeCredentials | null> {
  if (opts.envToken) return { accessToken: opts.envToken, expiresAt: null };
  if (process.platform === 'darwin') {
    const r = await (opts.run ?? exec)(['security', 'find-generic-password', '-s', claudeKeychainService(configDir), '-w'], homedir(), { timeoutMs: 10_000 }).catch(() => null);
    const c = r && r.code === 0 ? parseCredentials(r.stdout.trim()) : null;
    if (c) return c;
  }
  try {
    return parseCredentials(readFileSync(join(configDir ?? join(homedir(), '.claude'), '.credentials.json'), 'utf8'));
  } catch {
    return null;
  }
}

export class ClaudeUsageReadError extends Error {
  constructor(
    message: string,
    readonly kind: 'auth' | 'rate-limited' | 'http' | 'network' | 'protocol',
  ) {
    super(message);
  }
}

/** one read of the usage service with the account's bearer; the answer is whatever JSON it sent, checked by `parseClaudeUsage` */
export async function fetchClaudeUsage(token: string, opts: { fetch?: typeof fetch; timeoutMs?: number } = {}): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 8_000);
  let res: Response;
  try {
    res = await (opts.fetch ?? fetch)(CLAUDE_USAGE_URL, { headers: { Authorization: `Bearer ${token}`, 'anthropic-beta': OAUTH_BETA, Accept: 'application/json' }, signal: controller.signal });
  } catch {
    throw new ClaudeUsageReadError('Claude’s usage service could not be reached.', 'network');
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 401 || res.status === 403) throw new ClaudeUsageReadError('Claude did not accept the sign-in.', 'auth');
  if (res.status === 429) throw new ClaudeUsageReadError('Claude’s usage service asked to wait before it is read again.', 'rate-limited');
  if (!res.ok) throw new ClaudeUsageReadError(`Claude’s usage service answered ${res.status}.`, 'http');
  try {
    return await res.json();
  } catch {
    throw new ClaudeUsageReadError('Claude’s usage report could not be read.', 'protocol');
  }
}

const percent = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : null);
const iso = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};
const window = (v: unknown, key = 'utilization'): ClaudeUsageWindow | null => {
  if (!v || typeof v !== 'object') return null;
  const used = percent((v as Record<string, unknown>)[key]);
  return used === null ? null : { usedPercent: used, resetsAt: iso((v as Record<string, unknown>).resets_at) };
};
/** an amount the report gives in minor units (cents), in the currency's units */
const money = (v: unknown, places: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v / 10 ** (typeof places === 'number' ? places : 2) : null);

/**
 * The report read into the few fields the Accounts page shows: the 5-hour window (`five_hour`, null when no session
 * window is open), the weekly window over every model (`seven_day`, else the `limits` row for all models), a weekly window
 * per model from the `limits` rows scoped to one (the older per-model fields when there are none), and extra usage when
 * it is turned on. Everything else in the report (dozens of fields that come and go) is left alone.
 */
export function parseClaudeUsage(payload: unknown, now = new Date()): ClaudeUsage {
  const checkedAt = now.toISOString();
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { state: 'error', checkedAt, message: 'Claude’s usage report had an unexpected shape.' };
  const p = payload as Record<string, any>;
  const limits: any[] = Array.isArray(p.limits) ? p.limits.filter((l) => l && typeof l === 'object') : [];
  const fiveHour = window(p.five_hour);
  const sevenDay = window(p.seven_day) ?? window(limits.find((l) => l.kind === 'weekly_all'), 'percent');
  const scoped = limits.filter((l) => l.kind === 'weekly_scoped' && typeof l.scope?.model?.display_name === 'string');
  const models = scoped.length
    ? scoped.flatMap((l) => {
        const w = window(l, 'percent');
        return w ? [{ name: String(l.scope.model.display_name), ...w }] : [];
      })
    : (['opus', 'sonnet'] as const).flatMap((m) => {
        const w = window(p[`seven_day_${m}`]);
        return w ? [{ name: m[0]!.toUpperCase() + m.slice(1), ...w }] : [];
      });
  const x = p.extra_usage;
  const extraUsage = x && typeof x === 'object' && x.is_enabled === true ? { usedPercent: percent(x.utilization), used: money(x.used_credits, x.decimal_places), limit: money(x.monthly_limit, x.decimal_places), currency: typeof x.currency === 'string' ? x.currency : null } : null;
  if (!fiveHour && !sevenDay && !models.length) return { state: 'unavailable', checkedAt, message: 'Claude’s usage report names no usage window.' };
  return { state: 'available', checkedAt, fiveHour, sevenDay, models, extraUsage };
}

export interface ClaudeUsageReaderDeps {
  /** the Claude CLI, found when asked (it can be installed while Foundry runs) */
  bin: () => string | null;
  /** the account's config dir as CLAUDE_CONFIG_DIR names it; null for Claude Code's own default home */
  configDir: string | null;
  /** what the CLI runs with for this account: its config dir, and no token of the native sign-in in an added account's home */
  env?: Record<string, string>;
  /** a token in the environment (the native sign-in's), which outranks the stored one */
  envToken?: string | null;
  run?: typeof exec;
  fetch?: typeof fetch;
  credentials?: (configDir: string | null) => Promise<ClaudeCredentials | null>;
  now?: () => number;
  log?: (message: string) => void;
}

/**
 * One account's usage as Claude reports it, kept a minute (a quarter of one after a failure) and read once however many
 * ask at the same time. Claude Code alone refreshes a lapsed token: when the stored one has expired, or the service
 * refuses it, the reader runs Claude Code's own `/usage` once in that account's home (a local command: no model turn, no
 * cost) and reads the token again; it never refreshes a token itself.
 */
export class ClaudeUsageReader {
  private cached: { at: number; value: ClaudeUsage } | null = null;
  private pending: Promise<ClaudeUsage> | null = null;
  private generation = 0;
  constructor(private d: ClaudeUsageReaderDeps) {}
  current(): ClaudeUsage | undefined {
    return this.cached?.value;
  }
  /** the sign-in changed: what was read is another account's, or none */
  invalidate(): void {
    this.generation++;
    this.pending = null;
    this.cached = null;
  }
  read(force = false): Promise<ClaudeUsage> {
    const now = this.d.now?.() ?? Date.now();
    if (this.pending) return this.pending;
    if (!force && this.cached && now - this.cached.at < (this.cached.value.state === 'available' ? 60_000 : 15_000)) return Promise.resolve(this.cached.value);
    const generation = this.generation;
    this.pending = this.readOnce(now)
      .then((value) => {
        if (generation !== this.generation) return { state: 'unavailable' as const, checkedAt: new Date(now).toISOString(), message: 'The sign-in changed. Refresh to read its usage.' };
        this.cached = { at: now, value };
        return value;
      })
      .finally(() => {
        if (generation === this.generation) this.pending = null;
      });
    return this.pending;
  }
  /** Claude Code refreshes the sign-in's token itself: its own /usage, answered locally, with no model turn */
  private async refresh(): Promise<void> {
    const bin = this.d.bin();
    if (!bin) return;
    await (this.d.run ?? exec)([bin, '-p', '/usage', '--output-format', 'json'], homedir(), { timeoutMs: 45_000, env: this.d.env }).catch(() => null);
  }
  private async readOnce(now: number): Promise<ClaudeUsage> {
    const checkedAt = new Date(now).toISOString();
    const credentials = this.d.credentials ?? ((dir: string | null) => readClaudeCredentials(dir, { run: this.d.run, envToken: this.d.envToken }));
    let c = await credentials(this.d.configDir);
    if (!c) return { state: 'unavailable', checkedAt, message: 'Sign in to Claude Code to read its usage.' };
    let refreshed = false;
    if (c.expiresAt !== null && c.expiresAt <= now) {
      await this.refresh();
      refreshed = true;
      c = (await credentials(this.d.configDir)) ?? c;
    }
    for (;;) {
      try {
        return parseClaudeUsage(await fetchClaudeUsage(c.accessToken, { fetch: this.d.fetch }), new Date(now));
      } catch (e) {
        const err = e instanceof ClaudeUsageReadError ? e : new ClaudeUsageReadError('Claude’s usage could not be read.', 'network');
        if (err.kind === 'auth' && !refreshed) {
          refreshed = true;
          await this.refresh();
          const again = await credentials(this.d.configDir);
          if (again && again.accessToken !== c.accessToken) {
            c = again;
            continue;
          }
        }
        this.d.log?.(`[usage] Claude usage not read (${err.kind}): ${err.message}`);
        return err.kind === 'auth'
          ? { state: 'unavailable', checkedAt, message: 'Claude Code’s sign-in has lapsed: run claude once on this account, or sign in again.' }
          : { state: 'error', checkedAt, message: err.message };
      }
    }
  }
}
