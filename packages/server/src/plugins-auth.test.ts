import { describe, expect, test } from 'bun:test';
import type { Engine } from '@foundry/engine';
import { createApp } from './app.ts';

function fixture(active = 0) {
  const calls: string[] = [];
  const account = (provider: string) => ({
    startLogin: () => { calls.push(`${provider}:login`); return { id: provider }; },
    logout: () => { calls.push(`${provider}:logout`); return { loggedIn: false }; },
  });
  const app = createApp({
    config: { provider: 'claude', dataDir: '/nonexistent', rootDir: '/nonexistent', log: () => {} },
    store: { db: {} }, broadcast: () => {}, busy: () => ({ total: active }),
    accounts: { claude: account('claude'), codex: account('codex') },
    codexQuota: { invalidate: () => calls.push('quota:invalidate') },
    codexPlugins: {
      view: (refresh: boolean) => { calls.push(`plugins:view:${refresh}`); return { state:'available',plugins:[] }; },
      change: (id: string, action: string, say: (line: string) => void) => { calls.push(`plugins:${action}:${id}`); say('native operation'); return { ok: true, id }; },
      invalidate: () => calls.push('plugins:invalidate'),
    },
    skillsForProvider: (provider: string) => ({ hints: { invalidate: () => calls.push(`${provider}:skills:invalidate`) } }),
  } as unknown as Engine);
  const post = (path: string, body: unknown = {}) => app.request(path, { method: 'POST', headers: { 'content-type':'application/json' }, body: JSON.stringify(body) });
  return { app, calls, post };
}

describe('native plugin and account mutation boundaries', () => {
  test('plugins are available only for Codex, with explicit cache refresh', async () => {
    const { app, calls } = fixture();
    expect((await app.request('/api/plugins?provider=claude')).status).toBe(400);
    expect((await app.request('/api/plugins?provider=other')).status).toBe(400);
    expect((await app.request('/api/plugins?provider=codex&refresh=1')).status).toBe(200);
    expect(calls).toEqual(['plugins:view:true']);
  });
  test('changes stream as operations and invalidate only the Codex skill hints', async () => {
    const { post, calls, app } = fixture();
    const r = await post('/api/plugins/change?provider=codex', { id:'example@fixture',action:'install',opId:'plugin-test' });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok:true,op:{ id:'plugin-test',status:'ok' } });
    expect(calls).toEqual(['plugins:install:example@fixture','codex:skills:invalidate']);
    expect((await app.request('/api/skills/ops/plugin-test')).status).toBe(200);
  });
  test('active work blocks plugin changes and both providers’ login/logout before mutating', async () => {
    const { post, calls } = fixture(1);
    expect((await post('/api/plugins/change?provider=codex', { id:'example@fixture',action:'remove' })).status).toBe(409);
    for (const provider of ['claude','codex']) for (const action of ['login','logout']) expect((await post(`/api/auth/${action}?provider=${provider}`)).status).toBe(409);
    expect(calls).toEqual([]);
  });
  test('idle account changes use the selected native account and invalidate dependent caches', async () => {
    const { post, calls } = fixture();
    expect((await post('/api/auth/login?provider=codex')).status).toBe(200);
    expect((await post('/api/auth/logout?provider=codex')).status).toBe(200);
    expect((await post('/api/auth/logout?provider=claude')).status).toBe(200);
    expect(calls).toEqual(['codex:login','codex:logout','quota:invalidate','plugins:invalidate','claude:logout']);
  });
  test('invalid plugin operations never reach the native manager', async () => {
    const { post, calls } = fixture();
    expect((await post('/api/plugins/change?provider=claude', { id:'example@fixture',action:'remove' })).status).toBe(400);
    expect((await post('/api/plugins/change?provider=codex', { id:'example@fixture',action:'update' })).status).toBe(400);
    expect(calls).toEqual([]);
  });
});
