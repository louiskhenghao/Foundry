import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Engine, defaultConfig } from '@foundry/engine';
import { FakeRunner, makeRepo } from '../../engine/src/test-helpers.ts';
import { createApp } from './app.ts';

const json = { 'content-type': 'application/json' };

test('Access (ADR-0061): off until someone has a token; then a bearer or the sign-in cookie is needed, the first token signs its maker in, what a person does carries their name, and revoking the last token turns it off', async () => {
  const home = mkdtempSync(join(tmpdir(), 'foundry-access-api-'));
  const repo = await makeRepo();
  const engine = new Engine(defaultConfig(resolve(import.meta.dir, '../../..'), { dataDir: home, claudeHome: join(home, 'claude'), useGraphify: false, log: () => {} }), new FakeRunner(() => {}));
  engine.beginUpdateDrain();
  const app = createApp(engine);
  try {
    expect(await (await app.request('/api/access/me')).json()).toEqual({ enabled: false, person: null });
    expect((await app.request('/api/goals')).status).toBe(200);
    expect((await app.request('/api/access/people')).status).toBe(200);
    // a sign-in while Access is off is refused with why
    expect((await app.request('/api/access/login', { method: 'POST', headers: json, body: JSON.stringify({ token: 'x' }) })).status).toBe(401);

    // the first person: a token shown once, and the maker's browser signed in with it
    const made = await app.request('/api/access/people', { method: 'POST', headers: json, body: JSON.stringify({ name: 'Ada' }) });
    expect(made.status).toBe(201);
    const ada = (await made.json()) as { person: { id: string; name: string }; token: string };
    expect(ada.token).toMatch(/^fnd_/);
    const cookie = made.headers.get('set-cookie')!;
    expect(cookie).toContain(`foundry_token=${encodeURIComponent(ada.token)}`);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).not.toContain('Secure');
    const adaCookie = cookie.split(';')[0]!;

    // from now on every request needs a token: a bearer header, or the cookie
    const refused = await app.request('/api/goals');
    expect(refused.status).toBe(401);
    expect(await refused.json()).toMatchObject({ code: 'auth' });
    expect((await app.request('/api/goals', { headers: { authorization: `Bearer ${ada.token}` } })).status).toBe(200);
    expect((await app.request('/api/goals', { headers: { cookie: adaCookie } })).status).toBe(200);
    expect((await app.request('/api/goals', { headers: { authorization: 'Bearer fnd_wrong' } })).status).toBe(401);
    expect(await (await app.request('/api/access/me', { headers: { cookie: adaCookie } })).json()).toMatchObject({ enabled: true, person: { name: 'Ada' } });
    expect(await (await app.request('/api/access/me')).json()).toEqual({ enabled: true, person: null });

    // signing in: a wrong token is refused, the right one sets the cookie; HTTPS marks it secure
    const wrong = await app.request('/api/access/login', { method: 'POST', headers: json, body: JSON.stringify({ token: 'fnd_nope' }) });
    expect(wrong.status).toBe(401);
    expect((await wrong.json()).error).toBe('that token is not known here');
    const ok = await app.request('/api/access/login', { method: 'POST', headers: { ...json, 'x-forwarded-proto': 'https' }, body: JSON.stringify({ token: ` ${ada.token} ` }) });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('set-cookie')).toContain('Secure');
    expect(await ok.json()).toMatchObject({ person: { name: 'Ada' } });
    const out = await app.request('/api/access/logout', { method: 'POST', headers: { cookie: adaCookie } });
    expect(out.headers.get('set-cookie')).toContain('Max-Age=0');

    // adding a second person takes a token now; what a person does carries their name
    expect((await app.request('/api/access/people', { method: 'POST', headers: json, body: JSON.stringify({ name: 'Bob' }) })).status).toBe(401);
    const bobRes = await app.request('/api/access/people', { method: 'POST', headers: { ...json, authorization: `Bearer ${ada.token}` }, body: JSON.stringify({ name: 'Bob' }) });
    expect(bobRes.status).toBe(201);
    expect(bobRes.headers.get('set-cookie')).toBeNull();
    const bob = (await bobRes.json()) as { person: { id: string }; token: string };
    expect((await app.request('/api/access/people', { method: 'POST', headers: { ...json, authorization: `Bearer ${ada.token}` }, body: JSON.stringify({ name: 'bob' }) })).status).toBe(409);
    const goal = await (await app.request('/api/goals', { method: 'POST', headers: { ...json, authorization: `Bearer ${bob.token}` }, body: JSON.stringify({ prompt: 'a goal', repoPath: repo, nature: 'code' }) })).json();
    expect(goal.by).toBe('Bob');
    const people = await (await app.request('/api/access/people', { headers: { cookie: adaCookie } })).json();
    expect(people.people.map((p: { name: string }) => p.name)).toEqual(['Ada', 'Bob']);
    expect(JSON.stringify(people)).not.toContain('hash');

    // a revoked token stops at once; the last revoke turns Access off
    expect((await app.request(`/api/access/people/${ada.person.id}`, { method: 'DELETE', headers: { authorization: `Bearer ${bob.token}` } })).status).toBe(200);
    expect((await app.request('/api/goals', { headers: { cookie: adaCookie } })).status).toBe(401);
    expect((await app.request('/api/access/people/p_nobody', { method: 'DELETE', headers: { authorization: `Bearer ${bob.token}` } })).status).toBe(404);
    expect((await app.request(`/api/access/people/${bob.person.id}`, { method: 'DELETE', headers: { authorization: `Bearer ${bob.token}` } })).status).toBe(200);
    expect(await (await app.request('/api/access/me')).json()).toEqual({ enabled: false, person: null });
    expect((await app.request('/api/goals')).status).toBe(200);
  } finally {
    await engine.stop();
    for (const path of [home, repo, `${repo}-foundry`]) rmSync(path, { recursive: true, force: true });
  }
}, 30_000);
