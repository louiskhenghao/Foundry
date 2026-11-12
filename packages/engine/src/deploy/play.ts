/**
 * Google Play (ADR-0094): the one thing Foundry asks its API is whether the service account from Settings reaches the
 * app's record — an edit opened and dropped again, nothing published. The submit itself goes through EAS. Google tells
 * no review state through an API, so a production deploy's record stops at submitted and points to the Play Console.
 */
import { sign } from 'node:crypto';

export type PlayFetch = (url: string, init: RequestInit) => Promise<Response>;
export interface ServiceAccount {
  client_email: string;
  private_key: string;
  token_uri?: string;
}
/** the JSON key parsed, or why it is not one */
export function parseServiceAccount(text: string): { ok: true; account: ServiceAccount } | { ok: false; reason: string } {
  try {
    const j = JSON.parse(text) as Partial<ServiceAccount> & { type?: string };
    if (j.type !== 'service_account' || !j.client_email || !j.private_key) return { ok: false, reason: 'not a service account key: the JSON needs type "service_account", client_email and private_key (Google Cloud → IAM → Service accounts → Keys)' };
    return { ok: true, account: { client_email: j.client_email, private_key: j.private_key, token_uri: j.token_uri } };
  } catch {
    return { ok: false, reason: 'the service account key is not JSON' };
  }
}
const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
/** an access token for the Android Publisher API: a signed assertion exchanged at Google's token endpoint */
export async function playToken(sa: ServiceAccount, doFetch: PlayFetch = (u, i) => fetch(u, i), now = Date.now()): Promise<string> {
  const tokenUri = sa.token_uri ?? 'https://oauth2.googleapis.com/token';
  const iat = Math.floor(now / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/androidpublisher', aud: tokenUri, iat, exp: iat + 600 }));
  const assertion = `${header}.${payload}.${b64url(sign('sha256', Buffer.from(`${header}.${payload}`), sa.private_key))}`;
  const r = await doFetch(tokenUri, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${assertion}`, signal: AbortSignal.timeout(30_000) });
  const j = (await r.json().catch(() => ({}))) as { access_token?: string; error_description?: string; error?: string };
  if (!r.ok || !j.access_token) throw new Error(`Google refused the service account: ${j.error_description ?? j.error ?? r.status}`);
  return j.access_token;
}
export const PLAY_API = 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications';
/** whether the account reaches the app's record in the Play Console: an edit opened, then deleted */
export async function playAppReachable(sa: ServiceAccount, packageName: string, doFetch: PlayFetch = (u, i) => fetch(u, i)): Promise<{ ok: true } | { ok: false; reason: string }> {
  const token = await playToken(sa, doFetch);
  const headers = { authorization: `Bearer ${token}`, accept: 'application/json' };
  const r = await doFetch(`${PLAY_API}/${encodeURIComponent(packageName)}/edits`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(30_000) });
  if (r.status === 404) return { ok: false, reason: `Google Play has no app ${packageName} the account can see: make the app in the Play Console first (Create app), and give the service account access to it` };
  if (r.status === 401 || r.status === 403) return { ok: false, reason: `the service account has no access to ${packageName}: in the Play Console, Users and permissions, invite its email with release rights to the app` };
  if (!r.ok) return { ok: false, reason: `Google Play answered ${r.status}` };
  const edit = (await r.json().catch(() => ({}))) as { id?: string };
  if (edit.id) await doFetch(`${PLAY_API}/${encodeURIComponent(packageName)}/edits/${edit.id}`, { method: 'DELETE', headers, signal: AbortSignal.timeout(30_000) }).catch(() => {});
  return { ok: true };
}
/** the Play Console's page for an app, when nothing more precise is known */
export const playConsoleUrl = () => 'https://play.google.com/console/';
