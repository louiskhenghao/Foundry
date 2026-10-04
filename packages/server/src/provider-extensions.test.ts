import { describe, expect, test } from 'bun:test';
import type { Engine } from '@foundry/engine';
import { createApp } from './app.ts';

function fixture() {
  const calls: string[] = [];
  const skills = (provider: string) => ({
    overview: async () => ({ provider }),
    install: async (id: string) => { calls.push(`${provider}:install:${id}`); return { ok: true, name: id }; },
    installBundle: async (id: string) => { calls.push(`${provider}:bundle:${id}`); return { results: [] }; },
    restore: async (name: string) => { calls.push(`${provider}:restore:${name}`); return { path: provider }; },
  });
  const mcp = (provider: string) => ({
    view: async () => ({ servers: [{ name: provider }], catalog: [] }),
    allow: (prefix: string, on: boolean) => { calls.push(`${provider}:allow:${prefix}:${on}`); return on ? [prefix] : []; },
    remove: async (name: string) => { calls.push(`${provider}:remove:${name}`); return { ok: true }; },
    check: async () => [{ name: provider, status: 'connected', detail: 'ok' }],
    login: { session: () => ({ provider }), cancel: () => calls.push(`${provider}:cancel`) },
  });
  const app = createApp({
    config: { provider: 'claude', dataDir: '/nonexistent', rootDir: '/nonexistent', log: () => {} },
    store: { db: {} }, broadcast: () => {},
    skillsForProvider: skills, mcpFor: mcp,
    doctor: async (provider: string) => ({ provider }),
  } as unknown as Engine);
  const send = (path: string, method: string, body?: unknown) => app.request(path, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { app, calls, send };
}

describe('provider-scoped extensions and setup', () => {
  test('reads the explicit provider regardless of launch profile; legacy requests retain the default', async () => {
    const { app } = fixture();
    expect(await (await app.request('/api/skills?provider=codex')).json()).toEqual({ provider: 'codex' });
    expect(await (await app.request('/api/skills')).json()).toEqual({ provider: 'claude' });
    expect(await (await app.request('/api/doctor?provider=codex')).json()).toEqual({ provider: 'codex' });
    expect((await (await app.request('/api/mcp?provider=codex')).json()).servers[0].name).toBe('codex');
    expect(await (await app.request('/api/mcp/login?provider=codex')).json()).toEqual({ provider: 'codex' });
  });
  test('skill mutations and MCP permissions stay in the selected provider', async () => {
    const { send, calls } = fixture();
    expect((await send('/api/skills/install?provider=codex', 'POST', { id: 'tdd' })).status).toBe(200);
    expect((await send('/api/skills/install-bundle?provider=claude', 'POST', { bundle: 'workflow' })).status).toBe(200);
    expect((await send('/api/skills/test/restore?provider=codex', 'POST', {})).status).toBe(200);
    expect((await send('/api/mcp/allowed?provider=codex', 'PUT', { prefix: 'mcp__example', on: true })).status).toBe(200);
    expect((await send('/api/mcp/remove?provider=claude', 'POST', { name: 'example' })).status).toBe(200);
    expect(calls).toEqual(['codex:install:tdd', 'claude:bundle:workflow', 'codex:restore:test', 'codex:allow:mcp__example:true', 'claude:remove:example']);
  });
  test('unknown providers fail before touching either native configuration', async () => {
    const { send, calls } = fixture();
    const r = await send('/api/mcp/allowed?provider=other', 'PUT', { prefix: 'mcp__example', on: true });
    expect(r.status).toBe(400);
    expect(calls).toEqual([]);
  });
});
