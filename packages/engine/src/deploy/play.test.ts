import { describe, expect, test } from 'bun:test';
import { generateKeyPairSync, verify } from 'node:crypto';
import { parseServiceAccount, playAppReachable, playToken } from './play.ts';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const sa = { type: 'service_account', client_email: 'deploy@proj.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), token_uri: 'https://oauth2.googleapis.com/token' };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

describe('Google Play (ADR-0096)', () => {
  test('the service account key is read, or refused in words', () => {
    expect(parseServiceAccount(JSON.stringify(sa))).toMatchObject({ ok: true, account: { client_email: sa.client_email } });
    expect(parseServiceAccount('{"type":"authorized_user"}')).toMatchObject({ ok: false, reason: expect.stringContaining('not a service account key') });
    expect(parseServiceAccount('nope')).toMatchObject({ ok: false, reason: expect.stringContaining('not JSON') });
  });

  test('an access token from a signed assertion; the app’s record reached through an edit that is dropped again', async () => {
    const calls: { url: string; method: string; body: string | null; auth: string | null }[] = [];
    const f = async (url: string, init: RequestInit) => {
      calls.push({ url, method: init.method ?? 'GET', body: typeof init.body === 'string' ? init.body : null, auth: (init.headers as Record<string, string>).authorization ?? null });
      if (url.endsWith('/token')) {
        const assertion = new URLSearchParams(String(init.body)).get('assertion')!;
        const [h, p, s] = assertion.split('.');
        const b64 = (x: string) => Buffer.from(x.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
        expect(JSON.parse(b64(h!).toString())).toEqual({ alg: 'RS256', typ: 'JWT' });
        expect(JSON.parse(b64(p!).toString())).toMatchObject({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/androidpublisher', aud: sa.token_uri });
        expect(verify('sha256', Buffer.from(`${h}.${p}`), publicKey, b64(s!))).toBe(true);
        return json({ access_token: 'ya29.token' });
      }
      if (url.endsWith('/edits') && init.method === 'POST') return url.includes('com.acme.shop') ? json({ id: 'edit-1' }) : json({ error: { code: 404 } }, 404);
      if (url.endsWith('/edits/edit-1') && init.method === 'DELETE') return new Response('', { status: 204 });
      return json({}, 500);
    };
    expect(await playToken(sa, f)).toBe('ya29.token');
    expect(await playAppReachable(sa, 'com.acme.shop', f)).toEqual({ ok: true });
    expect(calls.slice(-2).map((c) => `${c.method} ${c.url} ${c.auth}`)).toEqual(['POST https://androidpublisher.googleapis.com/androidpublisher/v3/applications/com.acme.shop/edits Bearer ya29.token', 'DELETE https://androidpublisher.googleapis.com/androidpublisher/v3/applications/com.acme.shop/edits/edit-1 Bearer ya29.token']);
    expect(await playAppReachable(sa, 'com.nope', f)).toMatchObject({ ok: false, reason: expect.stringContaining('no app com.nope') });
    await expect(playToken(sa, async () => json({ error: 'invalid_grant', error_description: 'Invalid JWT Signature.' }, 400))).rejects.toThrow(/Invalid JWT Signature/);
  });
});
