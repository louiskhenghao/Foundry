/**
 * App Store Connect's API (ADR-0096): the app behind a bundle id, a build's processing after the upload, and the App
 * Store version's state once the person submits it for review — read with the API key from Settings (a JWT signed
 * here, nothing else), never written to. What Foundry never does through it: submit a version for review, or release.
 */
import { createPrivateKey, sign } from 'node:crypto';

export const ASC_API = 'https://api.appstoreconnect.apple.com/v1';
export interface AscCredentials {
  keyId: string;
  issuerId: string;
  /** the .p8 file's contents */
  key: string;
}
export type AscFetch = (url: string, init: RequestInit) => Promise<Response>;

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
/** a short-lived token for the API: ES256 over the key, as Apple asks (at most 20 minutes; 10 here) */
export function ascToken(c: AscCredentials, now = Date.now()): string {
  const header = b64url(JSON.stringify({ alg: 'ES256', kid: c.keyId, typ: 'JWT' }));
  const iat = Math.floor(now / 1000);
  const payload = b64url(JSON.stringify({ iss: c.issuerId, iat, exp: iat + 600, aud: 'appstoreconnect-v1' }));
  const key = createPrivateKey({ key: c.key.trim().endsWith('-----') ? `${c.key.trim()}\n` : c.key, format: 'pem' });
  const sig = sign('sha256', Buffer.from(`${header}.${payload}`), { key, dsaEncoding: 'ieee-p1363' });
  return `${header}.${payload}.${b64url(sig)}`;
}

/** one GET; the body parsed as JSON, or the text */
export async function asc(c: AscCredentials, path: string, doFetch: AscFetch = (u, i) => fetch(u, i)): Promise<{ status: number; data: unknown }> {
  const r = await doFetch(`${ASC_API}${path}`, { method: 'GET', headers: { authorization: `Bearer ${ascToken(c)}`, accept: 'application/json' }, signal: AbortSignal.timeout(30_000) });
  const text = await r.text();
  let data: unknown = text;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {}
  return { status: r.status, data };
}
type Resource = { id: string; type?: string; attributes?: Record<string, unknown>; relationships?: Record<string, { data?: { id: string } | null }> };
const list = (data: unknown): Resource[] => ((data as { data?: unknown })?.data as Resource[] | undefined) ?? [];

/** the app with this bundle id, or null; an error of the API's own (a refused key) is thrown in words */
export async function ascApp(c: AscCredentials, bundleId: string, f?: AscFetch): Promise<{ id: string; name: string } | null> {
  const r = await asc(c, `/apps?filter[bundleId]=${encodeURIComponent(bundleId)}&limit=1`, f);
  if (r.status === 401) throw new Error('App Store Connect refused the API key: check the key, its id and the issuer id under Settings → Git & delivery → Stores');
  if (r.status !== 200) throw new Error(`App Store Connect answered ${r.status}`);
  const app = list(r.data)[0];
  return app ? { id: app.id, name: String(app.attributes?.name ?? bundleId) } : null;
}

/** the uploaded build on App Store Connect by its build number (and version), newest first; null while it has not arrived */
export async function ascBuild(c: AscCredentials, appId: string, buildNumber: string | null, appVersion: string | null, f?: AscFetch): Promise<{ id: string; processingState: string; uploadedDate: string | null } | null> {
  const q = [`filter[app]=${appId}`, buildNumber ? `filter[version]=${encodeURIComponent(buildNumber)}` : '', appVersion ? `filter[preReleaseVersion.version]=${encodeURIComponent(appVersion)}` : '', 'sort=-uploadedDate', 'limit=1'].filter(Boolean).join('&');
  const r = await asc(c, `/builds?${q}`, f);
  if (r.status !== 200) throw new Error(`App Store Connect answered ${r.status} for the build`);
  const b = list(r.data)[0];
  return b ? { id: b.id, processingState: String(b.attributes?.processingState ?? 'PROCESSING'), uploadedDate: typeof b.attributes?.uploadedDate === 'string' ? b.attributes.uploadedDate : null } : null;
}

/** the App Store version this build is attached to, once the person attaches one; its state as Apple names it */
export async function ascVersionFor(c: AscCredentials, appId: string, buildId: string, f?: AscFetch): Promise<{ id: string; versionString: string; state: string } | null> {
  const r = await asc(c, `/apps/${appId}/appStoreVersions?filter[platform]=IOS&include=build&limit=10`, f);
  if (r.status !== 200) throw new Error(`App Store Connect answered ${r.status} for the versions`);
  const v = list(r.data).find((x) => x.relationships?.build?.data?.id === buildId);
  return v ? { id: v.id, versionString: String(v.attributes?.versionString ?? ''), state: String(v.attributes?.appVersionState ?? v.attributes?.appStoreState ?? '') } : null;
}

export interface StoreStanding {
  /** in words, for the row and the notification */
  state: string;
  code: string | null;
  status: 'submitted' | 'live' | 'failed';
  done: boolean;
}
/**
 * Where an iOS deploy stands, from the build's processing and the version's state: processing → in TestFlight (a
 * preview's end; production waits for the person to submit it) → waiting for review → in review → approved → live, or
 * rejected. Apple's codes are kept beside the words.
 */
export function storeStanding(build: { processingState: string } | null, version: { state: string; versionString: string } | null, production: boolean): StoreStanding {
  if (!build || build.processingState === 'PROCESSING') return { state: 'uploaded; App Store Connect is processing the build', code: build?.processingState ?? null, status: 'submitted', done: false };
  if (build.processingState === 'FAILED' || build.processingState === 'INVALID') return { state: 'App Store Connect could not process the build: see it under TestFlight there', code: build.processingState, status: 'failed', done: true };
  if (!version) return production ? { state: 'in TestFlight — submit this build for review in App Store Connect', code: 'VALID', status: 'submitted', done: false } : { state: 'in TestFlight', code: 'VALID', status: 'live', done: true };
  const v = version.versionString ? `version ${version.versionString}` : 'the version';
  switch (version.state) {
    case 'PREPARE_FOR_SUBMISSION':
      return { state: `in TestFlight; ${v} is being prepared in App Store Connect, not submitted for review yet`, code: version.state, status: 'submitted', done: false };
    case 'READY_FOR_REVIEW':
    case 'WAITING_FOR_REVIEW':
    case 'WAITING_FOR_EXPORT_COMPLIANCE':
      return { state: `${v} is waiting for review`, code: version.state, status: 'submitted', done: false };
    case 'IN_REVIEW':
      return { state: `${v} is in review`, code: version.state, status: 'submitted', done: false };
    case 'PENDING_DEVELOPER_RELEASE':
      return { state: `${v} is approved — waiting for you to release it in App Store Connect`, code: version.state, status: 'submitted', done: false };
    case 'PENDING_APPLE_RELEASE':
    case 'PROCESSING_FOR_DISTRIBUTION':
      return { state: `${v} is approved and being released`, code: version.state, status: 'submitted', done: false };
    case 'ACCEPTED':
    case 'READY_FOR_DISTRIBUTION':
      return { state: `${v} is live in the App Store`, code: version.state, status: 'live', done: true };
    case 'REJECTED':
    case 'METADATA_REJECTED':
    case 'INVALID_BINARY':
      return { state: `${v} was rejected in review — see the message in App Store Connect`, code: version.state, status: 'failed', done: true };
    case 'DEVELOPER_REJECTED':
      return { state: `${v} was withdrawn from review by you`, code: version.state, status: 'failed', done: true };
    case 'REPLACED_WITH_NEW_VERSION':
      return { state: `${v} was replaced by a newer version`, code: version.state, status: 'submitted', done: true };
    default:
      return { state: `${v}: ${version.state.toLowerCase().replace(/_/g, ' ')}`, code: version.state, status: 'submitted', done: false };
  }
}
/** the app's pages in App Store Connect, and in the App Store once live */
export const ascConsoleUrl = (appId: string, production: boolean) => (production ? `https://appstoreconnect.apple.com/apps/${appId}/distribution` : `https://appstoreconnect.apple.com/apps/${appId}/testflight/ios`);
export const appStoreUrl = (appId: string) => `https://apps.apple.com/app/id${appId}`;
