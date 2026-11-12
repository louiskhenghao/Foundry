import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { ClaudeUsageReader, claudeKeychainService, fetchClaudeUsage, parseClaudeUsage } from './claude-usage.ts';

// what Claude's usage service answered on a real account (2026-11-11), ids removed; the experiment fields it also carries are left out
const REPORT = {
  five_hour: null,
  seven_day: { utilization: 2.0, resets_at: '2026-11-18T04:59:59.832865+00:00' },
  seven_day_opus: null,
  seven_day_sonnet: null,
  extra_usage: { is_enabled: false, monthly_limit: 20000, used_credits: 0, utilization: 0, currency: 'USD', decimal_places: 2, disabled_reason: 'out_of_credits' },
  limits: [
    { kind: 'weekly_all', group: 'weekly', percent: 2, severity: 'normal', resets_at: '2026-11-18T04:59:59.832865+00:00', scope: null, is_active: true },
    { kind: 'weekly_scoped', group: 'weekly', percent: 11, severity: 'normal', resets_at: '2026-11-18T04:59:59.833058+00:00', scope: { model: { id: 'model-id', display_name: 'Fable' }, surface: null }, is_active: false },
  ],
  spend: { percent: 0, severity: 'normal', enabled: false },
  cedar_ember: null,
};

describe('Claude’s usage report (ADR-0090)', () => {
  test('the three cards: no session window open, the week over all models, one model’s week; extra usage only when it is on', () => {
    const u = parseClaudeUsage(REPORT, new Date('2026-11-11T10:32:49Z'));
    expect(u).toMatchObject({ state: 'available', checkedAt: '2026-11-11T10:32:49.000Z', fiveHour: null, sevenDay: { usedPercent: 2, resetsAt: '2026-11-18T04:59:59.832Z' }, models: [{ name: 'Fable', usedPercent: 11, resetsAt: '2026-11-18T04:59:59.833Z' }], extraUsage: null });
  });

  test('a session window, extra usage turned on (its cents said in dollars), and the older per-model fields when the limits rows are missing', () => {
    const u = parseClaudeUsage({ five_hour: { utilization: 37.5, resets_at: '2026-11-11T15:00:00Z' }, seven_day: { utilization: 53 }, seven_day_opus: { utilization: 11, resets_at: '2026-11-14T02:00:00Z' }, extra_usage: { is_enabled: true, monthly_limit: 20000, used_credits: 1234, utilization: 6.17, currency: 'USD', decimal_places: 2 } });
    expect(u).toMatchObject({ state: 'available', fiveHour: { usedPercent: 37.5, resetsAt: '2026-11-11T15:00:00.000Z' }, sevenDay: { usedPercent: 53, resetsAt: null }, models: [{ name: 'Opus', usedPercent: 11 }], extraUsage: { usedPercent: 6.17, used: 12.34, limit: 200, currency: 'USD' } });
  });

  test('a report of another shape is an error, one naming no window is unavailable, a figure past 100 is 100: never a report of zero usage', () => {
    expect(parseClaudeUsage('nope').state).toBe('error');
    expect(parseClaudeUsage([]).state).toBe('error');
    expect(parseClaudeUsage({ five_hour: null, seven_day: null, limits: [] })).toMatchObject({ state: 'unavailable' });
    expect(parseClaudeUsage({ seven_day: { utilization: 250 } })).toMatchObject({ sevenDay: { usedPercent: 100 } });
    expect(parseClaudeUsage({ seven_day: { utilization: 'lots' }, limits: [{ kind: 'weekly_all', percent: 40 }] })).toMatchObject({ sevenDay: { usedPercent: 40, resetsAt: null } });
  });

  test('the Keychain item is Claude Code’s default one without CLAUDE_CONFIG_DIR, and keyed to the dir with it', () => {
    expect(claudeKeychainService(null)).toBe('Claude Code-credentials');
    const dir = '/data/accounts/claude/acc_1';
    expect(claudeKeychainService(dir)).toBe(`Claude Code-credentials-${createHash('sha256').update(dir).digest('hex').slice(0, 8)}`);
    expect(claudeKeychainService(dir)).toMatch(/^Claude Code-credentials-[a-f0-9]{8}$/);
  });

  test('the service is asked with the bearer and the OAuth beta header; its refusals and waits are named', async () => {
    let seen: RequestInit | undefined;
    await fetchClaudeUsage('tok', { fetch: (async (_u: unknown, init?: RequestInit) => { seen = init; return Response.json({}); }) as unknown as typeof fetch });
    expect((seen!.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    expect((seen!.headers as Record<string, string>)['anthropic-beta']).toBe('oauth-2025-04-20');
    await expect(fetchClaudeUsage('tok', { fetch: (async () => new Response('', { status: 429 })) as unknown as typeof fetch })).rejects.toMatchObject({ kind: 'rate-limited' });
    await expect(fetchClaudeUsage('tok', { fetch: (async () => new Response('', { status: 401 })) as unknown as typeof fetch })).rejects.toMatchObject({ kind: 'auth' });
    await expect(fetchClaudeUsage('tok', { fetch: (async () => new Response('<html>', { status: 200 })) as unknown as typeof fetch })).rejects.toMatchObject({ kind: 'protocol' });
  });
});

/** a usage service that answers the report for one token and refuses any other */
const service = (good: string, calls: string[] = []) =>
  (async (_url: unknown, init?: RequestInit) => {
    const auth = String((init?.headers as Record<string, string>)?.Authorization ?? '');
    calls.push(auth);
    return auth === `Bearer ${good}` ? Response.json(REPORT) : new Response('{}', { status: 401 });
  }) as unknown as typeof fetch;
const ok = { code: 0, stdout: '', stderr: '' };

describe('reading one account’s usage', () => {
  test('no sign-in: unavailable at once, without running the CLI or asking the service', async () => {
    let runs = 0;
    const calls: string[] = [];
    const r = new ClaudeUsageReader({ bin: () => '/bin/claude', configDir: null, credentials: async () => null, run: async () => { runs++; return ok; }, fetch: service('t', calls) });
    expect(await r.read()).toMatchObject({ state: 'unavailable', message: 'Sign in to Claude Code to read its usage.' });
    expect(runs).toBe(0);
    expect(calls).toEqual([]);
  });

  test('a lapsed token: Claude Code’s own /usage runs once in the account’s home (no token of the native sign-in), then the new token is used', async () => {
    let token = 'old';
    const runs: string[][] = [];
    const calls: string[] = [];
    const env = { CLAUDE_CONFIG_DIR: '/home/acc', CLAUDE_CODE_OAUTH_TOKEN: '' };
    const r = new ClaudeUsageReader({
      bin: () => '/bin/claude', configDir: '/home/acc', env, now: () => 1_000_000,
      credentials: async (dir) => { expect(dir).toBe('/home/acc'); return { accessToken: token, expiresAt: token === 'old' ? 999_999 : null }; },
      run: async (cmd, _cwd, opts) => { runs.push(cmd); expect(opts?.env).toEqual(env); token = 'fresh'; return ok; },
      fetch: service('fresh', calls),
    });
    expect((await r.read()).state).toBe('available');
    expect(runs).toEqual([['/bin/claude', '-p', '/usage', '--output-format', 'json']]);
    expect(calls).toEqual(['Bearer fresh']);
  });

  test('a refused token is refreshed once; when the CLI leaves it as it was, the usage is unavailable and the token appears nowhere', async () => {
    const runs: string[][] = [];
    const calls: string[] = [];
    const r = new ClaudeUsageReader({ bin: () => '/bin/claude', configDir: null, credentials: async () => ({ accessToken: 'sk-ant-secret', expiresAt: null }), run: async (cmd) => { runs.push(cmd); return ok; }, fetch: service('other', calls) });
    const u = await r.read();
    expect(u).toMatchObject({ state: 'unavailable' });
    expect(runs).toHaveLength(1);
    expect(calls).toEqual(['Bearer sk-ant-secret']);
    expect(JSON.stringify(u)).not.toContain('secret');
  });

  test('a refused token that the CLI did renew is tried again, once', async () => {
    let token = 'stale';
    const calls: string[] = [];
    const r = new ClaudeUsageReader({ bin: () => '/bin/claude', configDir: null, credentials: async () => ({ accessToken: token, expiresAt: null }), run: async () => { token = 'renewed'; return ok; }, fetch: service('renewed', calls) });
    expect((await r.read()).state).toBe('available');
    expect(calls).toEqual(['Bearer stale', 'Bearer renewed']);
  });

  test('reads coalesce and are kept a minute, a failure a quarter of that; the sign-in changing discards what was read', async () => {
    let now = 0;
    let fetches = 0;
    let status = 200;
    const r = new ClaudeUsageReader({ bin: () => null, configDir: null, now: () => now, credentials: async () => ({ accessToken: 't', expiresAt: null }), fetch: (async () => { fetches++; return status === 200 ? Response.json(REPORT) : new Response('', { status }); }) as unknown as typeof fetch });
    await Promise.all([r.read(), r.read(), r.read(true)]);
    expect(fetches).toBe(1);
    now = 30_000;
    await r.read();
    expect(fetches).toBe(1);
    now = 61_000;
    status = 503;
    expect(await r.read()).toMatchObject({ state: 'error', message: 'Claude’s usage service answered 503.' });
    expect(fetches).toBe(2);
    now = 70_000;
    await r.read();
    expect(fetches).toBe(2);
    now = 77_000;
    await r.read();
    expect(fetches).toBe(3);
    r.invalidate();
    expect(r.current()).toBeUndefined();
    status = 200;
    expect((await r.read()).state).toBe('available');
    expect(fetches).toBe(4);
  });

  test('the service out of reach is an error with its reason, never a report of zero usage', async () => {
    const r = new ClaudeUsageReader({ bin: () => null, configDir: null, credentials: async () => ({ accessToken: 't', expiresAt: null }), fetch: (async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch });
    const u = await r.read();
    expect(u).toMatchObject({ state: 'error', message: 'Claude’s usage service could not be reached.' });
    expect('fiveHour' in u).toBe(false);
  });
});
