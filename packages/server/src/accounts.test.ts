import { expect, test } from 'bun:test';
import { Engine, defaultConfig } from '@foundry/engine';
import { FakeRunner } from '../../engine/src/test-helpers.ts';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createApp } from './app.ts';

test('a coding agent\'s accounts: listed without their homes, made current, switched to on a pause, removed (ADR-0065)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'foundry-accounts-api-'));
  // no CLI on purpose: status reads fail fast instead of asking the machine's real one
  const engine = new Engine(defaultConfig(resolve(import.meta.dir, '../../..'), { dataDir: dir, claudeHome: join(dir, 'claude'), codexHome: join(dir, 'codex'), claudeBin: join(dir, 'no-claude'), codexBin: join(dir, 'no-codex'), log: () => {} }), new FakeRunner(() => {}));
  const app = createApp(engine);
  const json = async (path: string, init?: RequestInit) => {
    const r = await app.request(path, init);
    return { status: r.status, body: (await r.json()) as any };
  };
  const post = (path: string, body?: unknown) => json(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  try {
    const home = join(dir, 'accounts', 'claude', 'acc_b');
    mkdirSync(home, { recursive: true });
    engine.store.append({ type: 'account.added', goalId: null, payload: { account: { provider: 'claude', id: 'acc_b', home, email: 'b@example.com', orgName: null, plan: 'max', addedAt: new Date().toISOString() } } });

    const list = (await json('/api/accounts')).body.accounts;
    const claude = list.find((a: any) => a.provider === 'claude').pool;
    expect(claude.autoSwitch).toBe(false);
    expect(claude.accounts.map((a: any) => [a.id, a.current])).toEqual([['native', true], ['acc_b', false]]);
    expect(JSON.stringify(claude)).not.toContain(home);
    expect(list.find((a: any) => a.provider === 'agy').pool).toBeUndefined();
    expect((await post('/api/accounts/agy/add')).status).toBe(400);

    expect((await post('/api/accounts/claude/acc_b/use')).status).toBe(200);
    expect((await json('/api/health')).body.currentAccountByProvider).toEqual({ claude: 'b@example.com', codex: null });

    // a pause offers the next account; Switch and continue makes it current and lifts the pause
    engine.pauseUntil(Date.now() + 3600_000, 'five_hour', 'fixture', 'claude');
    engine.accountPool.markLimited('claude', 'acc_b', Date.now() + 3600_000, 'fixture');
    expect((await json('/api/health')).body.switchToByProvider.claude).toBe("this computer's Claude sign-in");
    expect((await post('/api/usage/switch?provider=claude')).body.to).toBe("this computer's Claude sign-in");
    expect(engine.isRateLimited('claude')).toBe(false);
    expect(engine.accountPool.currentId('claude')).toBe('native');

    expect((await post('/api/accounts/claude/auto-switch', { on: true })).status).toBe(200);
    expect(engine.config.autoSwitch.claude).toBe(true);
    expect(engine.settings.values().accounts.autoSwitchClaude).toBe(true);

    expect((await json('/api/accounts/claude/acc_b', { method: 'DELETE' })).status).toBe(200);
    expect(existsSync(home)).toBe(false);
    expect(engine.accountPool.list('claude').map((a) => a.id)).toEqual(['native']);
    expect((await json('/api/accounts/claude/native', { method: 'DELETE' })).status).toBe(400);
  } finally {
    await engine.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});
