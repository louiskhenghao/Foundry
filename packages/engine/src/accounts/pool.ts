import { IdPrefix, NATIVE_ACCOUNT, PROVIDER_NAME, currentAccountId, listAccounts, newId, type AgentAccount, type EventStore, type PooledProvider } from '@foundry/core';
import { ClaudeAuth, type ClaudeAuthStatus, type LoginSession } from '../auth/claude-auth.ts';
import { CodexQuotaReader } from '../usage/codex-quota.ts';
import { accountHome, linkShared, removeHome } from './homes.ts';

export interface AccountPoolDeps {
  store: EventStore;
  dataDir: string;
  /** the native home of each coding agent (~/.claude, ~/.codex, or what Settings say) */
  nativeHome: (provider: PooledProvider) => string;
  /** the binary of each coding agent, found when asked (it can be installed while Foundry runs) */
  bin: (provider: PooledProvider) => string | null;
  /** the native sign-in's status reader (the Accounts page's existing one) */
  nativeAuth: (provider: PooledProvider) => ClaudeAuth;
  /** whether a usage limit moves new sessions to the next account (Settings → accounts) */
  autoSwitch: (provider: PooledProvider) => boolean;
  log: (message: string) => void;
  now?: () => number;
}

/** an account as the Accounts page shows it */
export interface AccountView extends AgentAccount {
  current: boolean;
  /** its usage limit stopped a session and has not reset yet (ISO), else null */
  limitedUntil: string | null;
}

const key = (provider: PooledProvider, id: string) => `${provider}:${id}`;
/** two sign-ins of the same person and organisation are one account */
const identity = (s: { email: string | null; orgName: string | null }) => `${(s.email ?? '').toLowerCase()}|${s.orgName ?? ''}`;

/**
 * A coding agent's sign-ins (ADR-0065): the machine's own (native) and those added in Foundry, each in a home of its own
 * where only the credentials differ. One of them is current: every new session of the coding agent runs on it. When its
 * usage limit stops a session, the next one that is not limited takes over if auto switch is on.
 */
export class AccountPool {
  /** account → when its usage limit resets (ms), from `account.limited` */
  private limited = new Map<string, number>();
  private auths = new Map<string, ClaudeAuth>();
  private codexQuotas = new Map<string, CodexQuotaReader>();
  /** a sign-in in progress per coding agent: its home exists, its account does not yet */
  private adding = new Map<PooledProvider, { id: string; home: string; auth: ClaudeAuth; session: LoginSession }>();

  constructor(private d: AccountPoolDeps) {}
  private now(): number {
    return this.d.now?.() ?? Date.now();
  }

  native(provider: PooledProvider): AgentAccount {
    const s = this.d.nativeAuth(provider).cachedStatus();
    return { provider, id: NATIVE_ACCOUNT, home: null, email: s?.email ?? null, orgName: s?.orgName ?? null, plan: s?.subscriptionType ?? null, addedAt: '' };
  }
  /** the native account first, then the added ones in the order they are tried */
  list(provider: PooledProvider): AgentAccount[] {
    return [this.native(provider), ...listAccounts(this.d.store.db, provider)];
  }
  get(provider: PooledProvider, id: string): AgentAccount | null {
    return this.list(provider).find((a) => a.id === id) ?? null;
  }
  currentId(provider: PooledProvider): string {
    const id = currentAccountId(this.d.store.db, provider);
    return id === NATIVE_ACCOUNT || listAccounts(this.d.store.db, provider).some((a) => a.id === id) ? id : NATIVE_ACCOUNT;
  }
  current(provider: PooledProvider): AgentAccount {
    return this.get(provider, this.currentId(provider)) ?? this.native(provider);
  }
  label(provider: PooledProvider, id: string): string {
    const a = this.get(provider, id);
    return a?.email ?? (id === NATIVE_ACCOUNT ? `this computer's ${PROVIDER_NAME[provider]} sign-in` : id);
  }
  views(provider: PooledProvider): AccountView[] {
    const current = this.currentId(provider);
    return this.list(provider).map((a) => ({ ...a, current: a.id === current, limitedUntil: this.isLimited(provider, a.id) ? new Date(this.limited.get(key(provider, a.id))!).toISOString() : null }));
  }

  /**
   * The account a session starts on now, with its home ready (the shared parts linked in; a link the native home gained
   * since is added). The native account has no home of Foundry's: the coding agent uses its own default.
   */
  forRun(provider: PooledProvider): AgentAccount {
    const a = this.current(provider);
    if (a.home) {
      try {
        linkShared(provider, this.d.nativeHome(provider), a.home);
      } catch (err) {
        this.d.log(`[accounts] could not link the shared parts into ${a.home}: ${err}`);
      }
    }
    return a;
  }

  // ---------- usage limits ----------

  isLimited(provider: PooledProvider, id: string): boolean {
    return (this.limited.get(key(provider, id)) ?? 0) > this.now();
  }
  /** an account's usage limit stopped a session: it is passed over until `until` (a later report only extends it) */
  markLimited(provider: PooledProvider, id: string, until: number, reason: string): void {
    if ((this.limited.get(key(provider, id)) ?? 0) >= until) return;
    this.limited.set(key(provider, id), until);
    this.d.store.append({ type: 'account.limited', goalId: null, payload: { provider, accountId: id, until: new Date(until).toISOString(), reason } });
  }
  /** the account after `from` in the list (round the end) whose limit is not holding; null when every other one is */
  next(provider: PooledProvider, from = this.currentId(provider)): AgentAccount | null {
    const all = this.list(provider);
    const at = Math.max(0, all.findIndex((a) => a.id === from));
    for (let i = 1; i < all.length; i++) {
      const a = all[(at + i) % all.length]!;
      if (!this.isLimited(provider, a.id)) return a;
    }
    return null;
  }
  /** when the first of the coding agent's accounts can run again (all of them are limited), or null */
  earliestReset(provider: PooledProvider): number | null {
    const resets = this.list(provider).map((a) => this.limited.get(key(provider, a.id)) ?? 0);
    return resets.some((r) => r <= this.now()) ? null : Math.min(...resets);
  }
  /**
   * After a usage limit stopped a session on `id`: true when new sessions need not pause, because the limit hit an account
   * they no longer start on while the current one is fine, or because auto switch moved them to the next account.
   */
  afterLimit(provider: PooledProvider, id: string): boolean {
    const current = this.currentId(provider);
    if (id !== current) return !this.isLimited(provider, current);
    if (!this.d.autoSwitch(provider)) return false;
    const next = this.next(provider, current);
    if (!next) return false;
    this.switchTo(provider, next.id, { auto: true, reason: `the usage limit of ${this.label(provider, current)}` });
    return true;
  }
  /** the pause has ended: with auto switch on, sessions leave a current account still limited for one that is not */
  leaveLimited(provider: PooledProvider): void {
    const current = this.currentId(provider);
    if (!this.d.autoSwitch(provider) || !this.isLimited(provider, current)) return;
    const next = this.next(provider, current);
    if (next) this.switchTo(provider, next.id, { auto: true, reason: `${this.label(provider, current)} is still limited` });
  }
  switchTo(provider: PooledProvider, to: string, how: { auto: boolean; reason: string }): void {
    const from = this.currentId(provider);
    if (from === to) return;
    if (!this.get(provider, to)) throw new Error(`no ${PROVIDER_NAME[provider]} account ${to}`);
    this.d.store.append({ type: 'account.switched', goalId: null, payload: { provider, from, to, auto: how.auto, reason: how.reason } });
    this.d.store.append({ type: 'engine.note', goalId: null, payload: { level: 'info', message: `${PROVIDER_NAME[provider]}: new sessions run on ${this.label(provider, to)} (were on ${this.label(provider, from)}) — ${how.auto ? 'switched automatically: ' : ''}${how.reason}` } });
  }
  /** the limits still holding, from the log (after a restart) */
  restore(): void {
    for (const e of this.d.store.listByType('account.limited', 500).reverse()) {
      if (e.type !== 'account.limited') continue;
      const p = e.payload;
      const until = Date.parse(p.until);
      if (p.provider !== 'agy' && until > this.now()) this.limited.set(key(p.provider, p.accountId), Math.max(until, this.limited.get(key(p.provider, p.accountId)) ?? 0));
    }
  }

  // ---------- sign-ins ----------

  /** the status reader of an account (the native one's is the Accounts page's own) */
  auth(provider: PooledProvider, id: string): ClaudeAuth {
    if (id === NATIVE_ACCOUNT) return this.d.nativeAuth(provider);
    const home = this.get(provider, id)?.home;
    if (!home) throw new Error(`no ${PROVIDER_NAME[provider]} account ${id}`);
    let auth = this.auths.get(key(provider, id));
    if (!auth) this.auths.set(key(provider, id), (auth = this.makeAuth(provider, home)));
    return auth;
  }
  private makeAuth(provider: PooledProvider, home: string): ClaudeAuth {
    return new ClaudeAuth({ provider, claudeBin: () => this.d.bin(provider), ...(provider === 'codex' ? { codexHome: home } : { claudeHome: home }), log: this.d.log });
  }
  /** a Codex account's own quota reader; the native one's is the engine's */
  codexQuota(id: string, native: CodexQuotaReader): CodexQuotaReader {
    if (id === NATIVE_ACCOUNT) return native;
    const home = this.get('codex', id)?.home;
    if (!home) return native;
    let r = this.codexQuotas.get(id);
    if (!r) this.codexQuotas.set(id, (r = new CodexQuotaReader({ bin: () => this.d.bin('codex'), home })));
    return r;
  }

  /**
   * Sign in to one more account: a new home with the shared parts linked, and the coding agent's own sign-in run in it
   * (the browser, or the code pasted back). Only a sign-in that ends signed in, as someone not added yet, becomes an
   * account; anything else leaves no trace.
   */
  startAdd(provider: PooledProvider, input: { email?: string } = {}): LoginSession {
    const pending = this.adding.get(provider);
    if (pending && !pending.session.done) return pending.session;
    const id = newId(IdPrefix.account);
    const home = accountHome(this.d.dataDir, provider, id);
    linkShared(provider, this.d.nativeHome(provider), home);
    const auth = this.makeAuth(provider, home);
    let session: LoginSession;
    try {
      session = auth.startLogin(input);
    } catch (err) {
      removeHome(this.d.dataDir, provider, home);
      throw err;
    }
    const entry = { id, home, auth, session };
    this.adding.set(provider, entry);
    let settled = false;
    const settle = (s: LoginSession) => {
      if (!s.done || settled) return;
      settled = true;
      off();
      void this.finishAdd(provider, entry, s);
    };
    const off = auth.onLoginUpdate(settle);
    settle(session);
    return session;
  }
  private async finishAdd(provider: PooledProvider, entry: { id: string; home: string; auth: ClaudeAuth }, s: LoginSession): Promise<void> {
    const status: ClaudeAuthStatus | null = s.ok ? await entry.auth.status().catch(() => null) : null;
    const native = await this.d.nativeAuth(provider).status().catch(() => null);
    const known = [native?.loggedIn ? native : null, ...listAccounts(this.d.store.db, provider)].flatMap((x) => (x?.email ? [{ email: x.email, orgName: x.orgName }] : []));
    const duplicate = status?.loggedIn && known.some((k) => identity(k) === identity(status));
    if (status?.loggedIn && !duplicate) {
      this.d.store.append({ type: 'account.added', goalId: null, payload: { account: { provider, id: entry.id, home: entry.home, email: status.email, orgName: status.orgName, plan: status.subscriptionType, addedAt: new Date(this.now()).toISOString() } } });
      this.auths.set(key(provider, entry.id), entry.auth);
      return;
    }
    if (duplicate) {
      s.ok = false;
      s.error = `${status!.email} is added already`;
      await entry.auth.logout().catch(() => {});
    }
    try {
      removeHome(this.d.dataDir, provider, entry.home);
    } catch (err) {
      this.d.log(`[accounts] ${err}`);
    }
  }
  addSession(provider: PooledProvider): LoginSession | null {
    return this.adding.get(provider)?.session ?? null;
  }
  submitAddCode(provider: PooledProvider, code: string): LoginSession {
    const pending = this.adding.get(provider);
    if (!pending) throw new Error('no sign-in is in progress');
    return pending.auth.submitCode(code);
  }
  cancelAdd(provider: PooledProvider): void {
    this.adding.get(provider)?.auth.cancelLogin();
  }

  /** Sign an added account out and delete its home; new sessions it was current for go back to the native one. */
  async remove(provider: PooledProvider, id: string): Promise<void> {
    if (id === NATIVE_ACCOUNT) throw new Error("this computer's own sign-in is signed out on the Accounts page, not removed");
    const account = this.get(provider, id);
    if (!account?.home) throw new Error(`no ${PROVIDER_NAME[provider]} account ${id}`);
    if (this.currentId(provider) === id) this.switchTo(provider, NATIVE_ACCOUNT, { auto: false, reason: `${this.label(provider, id)} was removed` });
    await this.auth(provider, id).logout().catch((err) => this.d.log(`[accounts] sign-out of ${account.email ?? id} failed: ${err}`));
    removeHome(this.d.dataDir, provider, account.home);
    this.d.store.append({ type: 'account.removed', goalId: null, payload: { provider, accountId: id } });
    this.auths.delete(key(provider, id));
    this.codexQuotas.delete(id);
    this.limited.delete(key(provider, id));
  }
  /** the order the added accounts are tried in after the native one */
  reorder(provider: PooledProvider, order: string[]): void {
    const added = listAccounts(this.d.store.db, provider).map((a) => a.id);
    if (order.length !== added.length || !added.every((id) => order.includes(id))) throw new Error('the order must name every added account once');
    this.d.store.append({ type: 'account.reordered', goalId: null, payload: { provider, order } });
  }
}
