import { afterEach, describe, expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { codexAuthStatus } from './claude-auth.ts';
import { readCodexAccount } from './codex-account.ts';
import { parseCodexUsage, readCodexUsage } from '../usage/codex-usage.ts';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const account = { type: 'chatgpt', email: 'person@example.test', planType: 'pro', hiddenToken: 'do-not-copy' };
const limit = { limitId: 'codex', limitName: 'Codex', normalModelSlug: 'native-model', primary: { usedPercent: 12, windowDurationMins: 300, resetsAt: 1 }, secondary: { usedPercent: 90, windowDurationMins: 10080, resetsAt: 2 }, credits: { hasCredits: true, unlimited: false, balance: '12.5' }, spendControlReached: null, individualLimit: null, planType: 'pro', rateLimitReachedType: null };
const quota = { ordinaryUsageAllowed: false, rateLimits: limit, rateLimitsByLimitId: { codex: limit, other: { ...limit, limitId: 'other', primary: null } }, accountId: 'account-id', rateLimitUpsell: { secret: 'do-not-copy' }, rateLimitResetCredits: { secret: 'do-not-copy' } };

function fixture(extra = '', accountResult: unknown = { account }, quotaResult: unknown = quota) {
  const home = mkdtempSync(join(tmpdir(), 'foundry-codex-account-'));
  dirs.push(home);
  const bin = join(home, 'codex-fixture');
  writeFileSync(bin, `#!${process.execPath}
import { appendFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
const home = process.env.CODEX_HOME;
writeFileSync(home + '/pid', String(process.pid));
if (process.argv[2] === 'login') { writeFileSync(home + '/legacy-status', 'called'); process.stderr.write('Logged in using ChatGPT'); process.exit(0); }
const send = (id, result) => process.stdout.write(JSON.stringify({id, result}) + '\\n');
let initialized = false;
createInterface({input:process.stdin}).on('line', (line) => {
  const msg = JSON.parse(line);
  appendFileSync(home + '/requests.jsonl', line + '\\n');
  ${extra}
  if (msg.method === 'initialize') { send(msg.id, {}); return; }
  if (msg.method === 'initialized') { initialized = true; return; }
  if (!initialized) throw Error('read before initialized');
  if (msg.method === 'account/read') send(msg.id, ${JSON.stringify(accountResult)});
  else if (msg.method === 'account/rateLimits/read') send(msg.id, ${JSON.stringify(quotaResult)});
});
`);
  chmodSync(bin, 0o755);
  return {
    bin, home,
    requests: () => existsSync(join(home, 'requests.jsonl')) ? readFileSync(join(home, 'requests.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line)) : [],
    pid: () => Number(readFileSync(join(home, 'pid'), 'utf8')),
  };
}

async function stopped(pid: number) {
  for (let i = 0; i < 30; i++) {
    try { process.kill(pid, 0); } catch { return; }
    await Bun.sleep(10);
  }
  throw new Error('native account fixture survived cleanup');
}

describe('native Codex account and quota reads', () => {
  test('reads only public ChatGPT account identity, with no token refresh or thread creation', async () => {
    const f = fixture();
    expect(await readCodexAccount(f.bin, f.home)).toEqual({ type: 'chatgpt', email: 'person@example.test', planType: 'pro' });
    expect(f.requests().map((m) => m.method)).toEqual(['initialize', 'initialized', 'account/read']);
    expect(f.requests()[2].params).toEqual({ refreshToken: false });
    await stopped(f.pid());
  });

  test('auth status exposes native email and plan instead of parsing login text', async () => {
    const f = fixture();
    expect(await codexAuthStatus(f.bin, undefined, f.home)).toMatchObject({ provider: 'codex', loggedIn: true, authMethod: 'ChatGPT', email: 'person@example.test', subscriptionType: 'pro', error: null });
    expect(existsSync(join(f.home, 'legacy-status'))).toBe(false);
  });

  test('signed-out and API-key accounts are authoritative and never fall back to text login status', async () => {
    for (const nativeAccount of [null, { type: 'apiKey', token: 'sk-hidden' }, { type: 'amazonBedrock', usesCodexManagedCredentials: true }]) {
      const f = fixture('', { account: nativeAccount });
      const status = await codexAuthStatus(f.bin, undefined, f.home);
      expect(status.loggedIn).toBe(false);
      expect(status.email).toBeNull();
      expect(JSON.stringify(status)).not.toContain('sk-hidden');
      expect(existsSync(join(f.home, 'legacy-status'))).toBe(false);
    }
  });

  test('only an unavailable account RPC permits the safe legacy status fallback', async () => {
    const f = fixture(`if (msg.method === 'account/read') { process.stdout.write(JSON.stringify({id:msg.id,error:{code:-32601,message:'secret-not-exposed'}})+'\\n'); return; }`);
    expect(await codexAuthStatus(f.bin, undefined, f.home)).toMatchObject({ loggedIn: true, email: null, subscriptionType: null });
    expect(existsSync(join(f.home, 'legacy-status'))).toBe(true);
    const broken = fixture(`if (msg.method === 'account/read') { process.stdout.write(JSON.stringify({id:msg.id,error:{code:500,message:'sk-do-not-copy'}})+'\\n'); return; }`);
    const status = await codexAuthStatus(broken.bin, undefined, broken.home);
    expect(status.loggedIn).toBe(false);
    expect(status.error).toBe('Codex account/read failed.');
    expect(existsSync(join(broken.home, 'legacy-status'))).toBe(false);
  });

  test('quota reads authenticate first and preserve native multi-bucket permission and nulls', async () => {
    const f = fixture();
    const result = await readCodexUsage(f.bin, f.home);
    expect(result).toMatchObject({ ordinaryUsageAllowed: false, rateLimits: limit, rateLimitsByLimitId: { codex: limit, other: { ...limit, limitId: 'other', primary: null } }, accountId: 'account-id' });
    expect(Number.isFinite(Date.parse(result.checkedAt))).toBe(true);
    expect(JSON.stringify(result)).not.toContain('do-not-copy');
    expect(f.requests().map((m) => m.method)).toEqual(['initialize', 'initialized', 'account/read', 'account/rateLimits/read']);
    expect(f.requests()[3].params).toEqual({ supportsLunaReserve: false, excludeResetCreditDetails: true });
    await stopped(f.pid());
  });

  test('quota is never requested for unsupported or signed-out accounts', async () => {
    for (const nativeAccount of [null, { type: 'apiKey' }]) {
      const f = fixture('', { account: nativeAccount });
      await expect(readCodexUsage(f.bin, f.home)).rejects.toMatchObject({ kind: 'auth' });
      expect(f.requests().some((m) => m.method === 'account/rateLimits/read')).toBe(false);
    }
  });

  test('malformed response data and output floods fail without leaking raw output', async () => {
    for (const extra of [
      `if(msg.method === 'account/read') { process.stdout.write('sk-secret-invalid-json\\n'); return; }`,
      `if(msg.method === 'account/read') { process.stdout.write('x'.repeat(1024*1024+1)); return; }`,
    ]) {
      const f = fixture(extra);
      try { await readCodexAccount(f.bin, f.home); throw Error('unexpected success'); }
      catch (error) { expect(error).toMatchObject({ kind: 'protocol' }); expect(String(error)).not.toContain('sk-secret'); }
      await stopped(f.pid());
    }
    const malformed = fixture('', { account: { type: 'chatgpt', email: 12, planType: 'pro' } });
    await expect(readCodexAccount(malformed.bin, malformed.home)).rejects.toMatchObject({ kind: 'protocol' });
  });

  test('a deadline kills a stalled child even when it ignores SIGTERM', async () => {
    const f = fixture(`process.on('SIGTERM', () => {}); if (msg.method === 'account/read') return;`);
    const start = Date.now();
    await expect(readCodexAccount(f.bin, f.home, { timeoutMs: 1500 })).rejects.toMatchObject({ kind: 'timeout' });
    expect(f.requests().some((m) => m.method === 'account/read')).toBe(true);
    expect(Date.now() - start).toBeLessThan(4000);
    await stopped(f.pid());
  });

  test.skipIf(process.platform === 'win32')('cleanup reaps a native sidecar even after its parent exits first', async () => {
    const sidecar = `import {writeFileSync} from 'node:fs'; process.on('SIGTERM',()=>{}); writeFileSync(process.env.CODEX_HOME+'/sidecar-pid',String(process.pid)); setInterval(()=>{},1000);`;
    const f = fixture(`
      if (msg.method === 'initialize') Bun.spawn([process.execPath, '-e', ${JSON.stringify(sidecar)}], { stdin:'ignore', stdout:'ignore', stderr:'ignore' });
      if (msg.method === 'account/read') {
        const wait = setInterval(async () => { if (await Bun.file(home+'/sidecar-pid').exists()) { clearInterval(wait); send(msg.id, ${JSON.stringify({ account })}); } }, 10);
        return;
      }
    `);
    let pid: number | undefined;
    try {
      expect((await readCodexAccount(f.bin, f.home))?.type).toBe('chatgpt');
      pid = Number(readFileSync(join(f.home, 'sidecar-pid'), 'utf8'));
      await stopped(pid);
    } finally {
      if (pid) try { process.kill(pid, 'SIGKILL'); } catch {}
    }
  });

  test('cancellation rejects pending RPC and reaps the child; pre-cancelled reads never spawn', async () => {
    const f = fixture(`if (msg.method === 'account/read') return;`);
    const controller = new AbortController();
    const promise = readCodexAccount(f.bin, f.home, { signal: controller.signal });
    const settled = promise.then((value) => ({ value }), (error) => ({ error }));
    const started = Date.now();
    while (!f.requests().some((m) => m.method === 'account/read') && Date.now() - started < 3000) await Bun.sleep(10);
    controller.abort();
    expect(await settled).toMatchObject({ error: { kind: 'cancelled' } });
    await stopped(f.pid());
    const never = fixture();
    await expect(readCodexAccount(never.bin, never.home, { signal: AbortSignal.abort() })).rejects.toMatchObject({ kind: 'cancelled' });
    expect(existsSync(join(never.home, 'pid'))).toBe(false);
  });

  test('unsolicited native token-refresh requests are refused rather than fulfilled', async () => {
    const f = fixture(`if (msg.method === 'account/read') { process.stdout.write(JSON.stringify({id:'refresh',method:'account/chatgptAuthTokens/refresh',params:{}})+'\\n'); return; } if (msg.id === 'refresh') { send(2, ${JSON.stringify({ account })}); return; }`);
    expect((await readCodexAccount(f.bin, f.home))?.type).toBe('chatgpt');
    expect(f.requests().find((m) => m.id === 'refresh')).toEqual({ id: 'refresh', error: { code: -32601, message: 'Read-only account client' } });
  });
});

describe('Codex quota normalization', () => {
  test('never infers ordinary usage permission from zero percentages or expired resets', () => {
    for (const permission of [null, undefined, false, true]) {
      const result = parseCodexUsage({ ...quota, ordinaryUsageAllowed: permission, rateLimits: { ...limit, primary: { usedPercent: 0, resetsAt: 1, windowDurationMins: null }, spendControlReached: null } });
      expect(result.ordinaryUsageAllowed).toBe(permission ?? null);
      expect(result.rateLimits.spendControlReached).toBeNull();
    }
  });

  test('retains explicit spend-control and credit state, with absent fields remaining unknown', () => {
    const result = parseCodexUsage({ rateLimits: { ...limit, spendControlReached: true, individualLimit: { limit: '100', used: '101', remainingPercent: 0, resetsAt: 3 }, rateLimitReachedType: 'workspace_member_usage_limit_reached' } });
    expect(result.ordinaryUsageAllowed).toBeNull();
    expect(result.rateLimitsByLimitId).toBeNull();
    expect(result.accountId).toBeNull();
    expect(result.rateLimits.individualLimit?.used).toBe('101');
    expect(result.rateLimits.spendControlReached).toBe(true);
  });

  test('rejects non-finite windows and oversized or malformed bucket maps', () => {
    expect(() => parseCodexUsage({ ...quota, rateLimits: { ...limit, primary: { usedPercent: NaN } } })).toThrow('invalid account quota');
    expect(() => parseCodexUsage({ ...quota, ordinaryUsageAllowed: 'yes' })).toThrow('invalid account quota');
    expect(() => parseCodexUsage({ ...quota, rateLimitsByLimitId: Array(101).fill(limit) })).toThrow('invalid account quota');
    expect(() => parseCodexUsage({ ...quota, rateLimitsByLimitId: Object.fromEntries(Array.from({ length: 101 }, (_, i) => [String(i), limit])) })).toThrow('invalid account quota');
  });
});
