import { afterEach, describe, expect, test } from 'bun:test';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventStore, NATIVE_ACCOUNT, openDatabase, type PooledProvider } from '@foundry/core';
import { ClaudeAuth } from '../auth/claude-auth.ts';
import { accountHome, linkShared, removeHome } from './homes.ts';
import { AccountPool } from './pool.ts';

const dirs: string[] = [];
const stores: EventStore[] = [];
afterEach(() => {
  for (const s of stores.splice(0)) s.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const temp = () => {
  const d = mkdtempSync(join(tmpdir(), 'foundry-accounts-'));
  dirs.push(d);
  return d;
};

/**
 * A stand-in `claude`: signed in when its config dir holds a `.signed` file with the email in it. `auth login` signs in
 * as $LOGIN_EMAIL (in the config dir it runs with), `auth logout` signs out.
 */
function fakeClaude(dir: string): string {
  const bin = join(dir, 'claude');
  writeFileSync(bin, `#!/bin/sh
f="$CLAUDE_CONFIG_DIR/.signed"
case "$2" in
  status) if [ -n "$CLAUDE_CODE_OAUTH_TOKEN" ]; then printf '{"loggedIn":true,"authMethod":"oauth_token","email":"me@example.com","orgName":null,"subscriptionType":"max"}'; elif [ -f "$f" ]; then printf '{"loggedIn":true,"authMethod":"claude.ai","email":"%s","orgName":null,"subscriptionType":"max"}' "$(cat "$f")"; else echo '{"loggedIn":false}'; fi; exit 0;;
  login) printf '%s' "$LOGIN_EMAIL" > "$f"; echo "Logged in"; exit 0;;
  logout) rm -f "$f"; exit 0;;
esac
exit 1
`);
  chmodSync(bin, 0o755);
  return bin;
}

function setup(opts: { auto?: boolean; now?: () => number } = {}) {
  const root = temp();
  const dataDir = join(root, 'data');
  const native = { claude: join(root, 'native-claude'), codex: join(root, 'native-codex') };
  mkdirSync(join(native.claude, 'skills', 'tdd'), { recursive: true });
  writeFileSync(join(native.claude, 'settings.json'), '{}');
  writeFileSync(join(native.claude, '.signed'), 'me@example.com');
  mkdirSync(dataDir, { recursive: true });
  const store = new EventStore(openDatabase(join(dataDir, 'engine.db')));
  stores.push(store);
  const bin = fakeClaude(root);
  const nativeAuth = { claude: new ClaudeAuth({ provider: 'claude', claudeHome: native.claude, claudeBin: bin }), codex: new ClaudeAuth({ provider: 'codex', codexHome: native.codex, claudeBin: null }) };
  const auto = { value: opts.auto ?? false };
  const pool = new AccountPool({ store, dataDir, nativeHome: (p) => native[p], bin: (p) => (p === 'claude' ? bin : null), nativeAuth: (p) => nativeAuth[p], autoSwitch: () => auto.value, log: () => {}, now: opts.now });
  /** an account added as a finished sign-in would add it */
  const add = (provider: PooledProvider, id: string, email: string) => {
    const home = accountHome(dataDir, provider, id);
    linkShared(provider, native[provider], home);
    store.append({ type: 'account.added', goalId: null, payload: { account: { provider, id, home, email, orgName: null, plan: 'max', addedAt: new Date().toISOString() } } });
    return home;
  };
  return { root, dataDir, native, store, pool, add, auto };
}

const settle = async (pred: () => boolean, ms = 5000) => {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error('timeout');
    await Bun.sleep(20);
  }
};

describe('account homes', () => {
  test('an added account shares everything but its sign-in with the native home, by link', () => {
    const { native, dataDir } = setup();
    const home = accountHome(dataDir, 'claude', 'acc_1');
    expect(linkShared('claude', native.claude, home).sort()).toEqual(['projects', 'sessions', 'settings.json', 'skills']);
    expect(readlinkSync(join(home, 'skills'))).toBe(join(native.claude, 'skills'));
    // the transcripts are shared from the first session on, so another account can resume one
    expect(existsSync(join(native.claude, 'projects'))).toBe(true);
    expect(lstatSync(join(home, 'projects')).isSymbolicLink()).toBe(true);
    expect(existsSync(join(home, '.signed'))).toBe(false);
    // what the account has of its own stays; a link the native home gained since is added
    writeFileSync(join(home, 'CLAUDE.md'), 'its own');
    mkdirSync(join(native.claude, 'agents'));
    expect(linkShared('claude', native.claude, home)).toEqual(['agents']);
    expect(readFileSync(join(home, 'CLAUDE.md'), 'utf8')).toBe('its own');
  });

  test('removing a home deletes the links, never what they point at, and nothing outside the accounts folder', () => {
    const { native, dataDir } = setup();
    const home = accountHome(dataDir, 'claude', 'acc_1');
    linkShared('claude', native.claude, home);
    removeHome(dataDir, 'claude', home);
    expect(existsSync(home)).toBe(false);
    expect(existsSync(join(native.claude, 'skills', 'tdd'))).toBe(true);
    expect(existsSync(join(native.claude, 'settings.json'))).toBe(true);
    expect(() => removeHome(dataDir, 'claude', native.claude)).toThrow('not an account home');
    expect(() => removeHome(dataDir, 'claude', join(dataDir, 'accounts', 'claude'))).toThrow('not an account home');
  });
});

describe('the current account and usage limits', () => {
  test('native first; a limit passes an account over until it resets; the next one wraps round the list', () => {
    let now = 1_000_000;
    const { pool, add } = setup({ now: () => now });
    add('claude', 'acc_a', 'a@example.com');
    add('claude', 'acc_b', 'b@example.com');
    expect(pool.list('claude').map((a) => a.id)).toEqual([NATIVE_ACCOUNT, 'acc_a', 'acc_b']);
    expect(pool.currentId('claude')).toBe(NATIVE_ACCOUNT);
    expect(pool.next('claude')!.id).toBe('acc_a');
    pool.markLimited('claude', 'acc_a', now + 60_000, 'test');
    expect(pool.next('claude')!.id).toBe('acc_b');
    expect(pool.next('claude', 'acc_b')!.id).toBe(NATIVE_ACCOUNT);
    expect(pool.earliestReset('claude')).toBeNull();
    pool.markLimited('claude', NATIVE_ACCOUNT, now + 30_000, 'test');
    pool.markLimited('claude', 'acc_b', now + 90_000, 'test');
    expect(pool.next('claude')).toBeNull();
    expect(pool.earliestReset('claude')).toBe(now + 30_000);
    now += 31_000;
    expect(pool.isLimited('claude', NATIVE_ACCOUNT)).toBe(false);
    expect(pool.next('claude', 'acc_b')!.id).toBe(NATIVE_ACCOUNT);
  });

  test('auto switch moves new sessions to the next account and stays there; off, the limit pauses', () => {
    const { pool, add, auto, store } = setup();
    add('claude', 'acc_a', 'a@example.com');
    pool.markLimited('claude', NATIVE_ACCOUNT, Date.now() + 60_000, 'test');
    expect(pool.afterLimit('claude', NATIVE_ACCOUNT)).toBe(false);
    expect(pool.currentId('claude')).toBe(NATIVE_ACCOUNT);
    auto.value = true;
    expect(pool.afterLimit('claude', NATIVE_ACCOUNT)).toBe(true);
    expect(pool.currentId('claude')).toBe('acc_a');
    const switched = store.listByType('account.switched', 1)[0]!.payload;
    expect(switched).toMatchObject({ provider: 'claude', from: NATIVE_ACCOUNT, to: 'acc_a', auto: true });
    // a late report of the old account's limit changes nothing while the current one is fine
    expect(pool.afterLimit('claude', NATIVE_ACCOUNT)).toBe(true);
    expect(pool.currentId('claude')).toBe('acc_a');
    // every account limited: nowhere to go
    pool.markLimited('claude', 'acc_a', Date.now() + 60_000, 'test');
    expect(pool.afterLimit('claude', 'acc_a')).toBe(false);
  });

  test('limits outlive a restart; a removed account sends its sessions back to the native one', async () => {
    const { pool, add, store, dataDir, native } = setup();
    const home = add('claude', 'acc_a', 'a@example.com');
    writeFileSync(join(home, '.signed'), 'a@example.com');
    pool.switchTo('claude', 'acc_a', { auto: false, reason: 'test' });
    pool.markLimited('claude', 'acc_a', Date.now() + 60_000, 'test');
    const again = new AccountPool({ store, dataDir, nativeHome: () => native.claude, bin: () => null, nativeAuth: () => new ClaudeAuth({ provider: 'claude', claudeBin: null }), autoSwitch: () => false, log: () => {} });
    again.restore();
    expect(again.isLimited('claude', 'acc_a')).toBe(true);
    expect(again.currentId('claude')).toBe('acc_a');
    await pool.remove('claude', 'acc_a');
    expect(pool.currentId('claude')).toBe(NATIVE_ACCOUNT);
    expect(pool.list('claude').map((a) => a.id)).toEqual([NATIVE_ACCOUNT]);
    expect(existsSync(home)).toBe(false);
    expect(existsSync(join(native.claude, 'skills', 'tdd'))).toBe(true);
    await expect(pool.remove('claude', NATIVE_ACCOUNT)).rejects.toThrow('not removed');
  });

  test('the order the added accounts are tried in', () => {
    const { pool, add } = setup();
    add('claude', 'acc_a', 'a@example.com');
    add('claude', 'acc_b', 'b@example.com');
    pool.reorder('claude', ['acc_b', 'acc_a']);
    expect(pool.list('claude').map((a) => a.id)).toEqual([NATIVE_ACCOUNT, 'acc_b', 'acc_a']);
    expect(() => pool.reorder('claude', ['acc_b'])).toThrow('every added account');
  });
});

describe('adding an account', () => {
  test('a sign-in in a new home becomes an account; the same person twice leaves no trace', async () => {
    const { pool, dataDir } = setup();
    process.env.LOGIN_EMAIL = 'other@example.com';
    // this computer signs in with a token (claude setup-token): an added account still reads as itself
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'native-token';
    try {
      const s = pool.startAdd('claude');
      await settle(() => pool.list('claude').length === 2);
      expect(s.ok).toBe(true);
      const added = pool.list('claude')[1]!;
      expect(added).toMatchObject({ email: 'other@example.com', plan: 'max' });
      expect(added.home!.startsWith(join(dataDir, 'accounts', 'claude'))).toBe(true);
      expect(readFileSync(join(added.home!, '.signed'), 'utf8')).toBe('other@example.com');
      expect(lstatSync(join(added.home!, 'skills')).isSymbolicLink()).toBe(true);
      // the machine's own account, signed in again in a new home
      process.env.LOGIN_EMAIL = 'me@example.com';
      const twice = pool.startAdd('claude');
      await settle(() => twice.done && !!twice.error);
      expect(twice.ok).toBe(false);
      expect(twice.error).toContain('added already');
      expect(pool.list('claude')).toHaveLength(2);
      // its home goes once the duplicate sign-in is signed out again
      await settle(() => readdirSync(join(dataDir, 'accounts', 'claude')).length === 1);
      expect(readdirSync(join(dataDir, 'accounts', 'claude'))).toEqual([added.id]);
    } finally {
      delete process.env.LOGIN_EMAIL;
      delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    }
  });
});
