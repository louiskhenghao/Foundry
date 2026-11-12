import { describe, expect, test } from 'bun:test';
import { generateKeyPairSync, verify } from 'node:crypto';
import { ascApp, ascBuild, ascToken, ascVersionFor, storeStanding } from './asc.ts';

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const p8 = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const creds = { keyId: 'KEY1', issuerId: 'ISS1', key: p8 };
const b64 = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

describe('App Store Connect (ADR-0094)', () => {
  test('the token is an ES256 JWT Apple accepts: the key id in the header, the issuer and a short expiry in the claims, a raw signature', () => {
    const now = Date.UTC(2026, 10, 12, 10, 0, 0);
    const t = ascToken(creds, now);
    const [h, p, s] = t.split('.');
    expect(JSON.parse(b64(h!).toString())).toEqual({ alg: 'ES256', kid: 'KEY1', typ: 'JWT' });
    const claims = JSON.parse(b64(p!).toString());
    expect(claims).toEqual({ iss: 'ISS1', iat: now / 1000, exp: now / 1000 + 600, aud: 'appstoreconnect-v1' });
    expect(b64(s!).length).toBe(64);
    expect(verify('sha256', Buffer.from(`${h}.${p}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, b64(s!))).toBe(true);
  });

  test('the app behind a bundle id, the build after the upload, the version the build is attached to; a refused key is said in words', async () => {
    const calls: string[] = [];
    const f = async (url: string, init: RequestInit) => {
      calls.push(url);
      expect(String((init.headers as Record<string, string>).authorization)).toStartWith('Bearer eyJ');
      if (url.includes('/apps?')) return json({ data: url.includes('com.acme.shop') ? [{ id: '1234567890', attributes: { name: 'Shop' } }] : [] });
      if (url.includes('/builds?')) return json({ data: [{ id: 'asc-b-1', attributes: { processingState: 'VALID', uploadedDate: '2026-11-12T10:00:00Z' } }] });
      if (url.includes('/appStoreVersions')) return json({ data: [{ id: 'v-old', attributes: { versionString: '1.1.0', appVersionState: 'READY_FOR_DISTRIBUTION' }, relationships: { build: { data: { id: 'asc-b-0' } } } }, { id: 'v-1', attributes: { versionString: '1.2.0', appVersionState: 'IN_REVIEW' }, relationships: { build: { data: { id: 'asc-b-1' } } } }] });
      return json({}, 404);
    };
    expect(await ascApp(creds, 'com.acme.shop', f)).toEqual({ id: '1234567890', name: 'Shop' });
    expect(await ascApp(creds, 'com.other', f)).toBeNull();
    expect(calls[0]).toBe('https://api.appstoreconnect.apple.com/v1/apps?filter[bundleId]=com.acme.shop&limit=1');
    expect(await ascBuild(creds, '1234567890', '7', '1.2.0', f)).toEqual({ id: 'asc-b-1', processingState: 'VALID', uploadedDate: '2026-11-12T10:00:00Z' });
    expect(calls.at(-1)).toBe('https://api.appstoreconnect.apple.com/v1/builds?filter[app]=1234567890&filter[version]=7&filter[preReleaseVersion.version]=1.2.0&sort=-uploadedDate&limit=1');
    expect(await ascVersionFor(creds, '1234567890', 'asc-b-1', f)).toEqual({ id: 'v-1', versionString: '1.2.0', state: 'IN_REVIEW' });
    expect(await ascVersionFor(creds, '1234567890', 'asc-b-9', f)).toBeNull();
    await expect(ascApp(creds, 'com.acme.shop', async () => json({ errors: [] }, 401))).rejects.toThrow(/refused the API key/);
  });

  test('where a build stands, in words: processing, in TestFlight (a preview’s end, production’s wait), review, release, rejection', () => {
    expect(storeStanding(null, null, true)).toMatchObject({ state: expect.stringContaining('processing'), status: 'submitted', done: false });
    expect(storeStanding({ processingState: 'FAILED' }, null, true)).toMatchObject({ status: 'failed', done: true, code: 'FAILED' });
    expect(storeStanding({ processingState: 'VALID' }, null, true)).toEqual({ state: 'in TestFlight — submit this build for review in App Store Connect', code: 'VALID', status: 'submitted', done: false });
    expect(storeStanding({ processingState: 'VALID' }, null, false)).toEqual({ state: 'in TestFlight', code: 'VALID', status: 'live', done: true });
    const v = (state: string) => storeStanding({ processingState: 'VALID' }, { state, versionString: '1.2.0' }, true);
    expect(v('WAITING_FOR_REVIEW')).toMatchObject({ state: 'version 1.2.0 is waiting for review', status: 'submitted', done: false });
    expect(v('IN_REVIEW')).toMatchObject({ state: 'version 1.2.0 is in review', status: 'submitted' });
    expect(v('PENDING_DEVELOPER_RELEASE')).toMatchObject({ state: expect.stringContaining('waiting for you to release'), status: 'submitted', done: false });
    expect(v('READY_FOR_DISTRIBUTION')).toEqual({ state: 'version 1.2.0 is live in the App Store', code: 'READY_FOR_DISTRIBUTION', status: 'live', done: true });
    expect(v('REJECTED')).toMatchObject({ state: expect.stringContaining('rejected in review'), status: 'failed', done: true });
    expect(v('REPLACED_WITH_NEW_VERSION')).toMatchObject({ status: 'submitted', done: true });
    expect(v('SOMETHING_NEW')).toMatchObject({ state: 'version 1.2.0: something new', code: 'SOMETHING_NEW', status: 'submitted', done: false });
  });
});
