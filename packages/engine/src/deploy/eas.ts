/**
 * The stores (ADR-0094): an Expo app built in the cloud by EAS and handed to the store — iOS to App Store Connect, where
 * it lands in TestFlight (a preview and a production deploy alike: production is the one the person then submits for
 * review there, which Foundry never does); Android as an APK to install for a preview, or submitted to Google Play's
 * production track for production. Only Expo apps: EAS holds the signing, so Foundry never sees a certificate or a
 * keystore. Everything Foundry writes (its own build and submit profiles in eas.json) stays in its checkout.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DeployStoreProvider } from '@foundry/core';

export type StoreProvider = DeployStoreProvider;
export const STORE_PROVIDERS: StoreProvider[] = ['appstore', 'play'];
export const STORE_LABEL: Record<StoreProvider, string> = { appstore: 'App Store (TestFlight)', play: 'Google Play' };
export const STORE_PLATFORM: Record<StoreProvider, 'ios' | 'android'> = { appstore: 'ios', play: 'android' };
/** the EAS CLI, pinned to a major like the hosts' (providers.ts) */
export const EAS_CLI = { pkg: 'eas-cli@27', bin: 'eas' };
/** Foundry's profiles in the checkout's eas.json: the build shapes it needs, and the submit profile with the keys */
export const FOUNDRY_PROFILE = { preview: 'foundry-preview', production: 'foundry-production', submit: 'foundry' } as const;

export interface ExpoApp {
  /** the app's folder, relative to the repository ('' = the repository) */
  dir: string;
  name: string | null;
  slug: string | null;
  /** the EAS project the app is linked to (extra.eas.projectId); null = `eas init` not run yet */
  projectId: string | null;
  owner: string | null;
  bundleId: string | null;
  package: string | null;
  version: string | null;
  /** app.json, or a dynamic app.config.* (read at build time, so the facts above may be missing here) */
  configFile: string;
  dynamic: boolean;
  /** how the project installs, for a dynamic config that needs its packages to be read, or a project without a lockfile */
  install: string[];
  /** a lockfile is in the project; EAS refuses to build without one, so Foundry installs in its checkout first to make one */
  lockfile: boolean;
}
export type ExpoDeployability = { ok: true; app: ExpoApp; notes: string[] } | { ok: false; reason: string };

const readJson = (p: string): Record<string, unknown> | null => {
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
};
const LOCKFILES = ['bun.lock', 'bun.lockb', 'pnpm-lock.yaml', 'yarn.lock', 'package-lock.json'];
const installCommand = (root: string): string[] => (existsSync(join(root, 'bun.lock')) || existsSync(join(root, 'bun.lockb')) ? ['bun', 'install', '--frozen-lockfile'] : existsSync(join(root, 'pnpm-lock.yaml')) ? ['pnpm', 'install', '--frozen-lockfile'] : existsSync(join(root, 'yarn.lock')) ? ['yarn', 'install'] : existsSync(join(root, 'package-lock.json')) ? ['npm', 'ci'] : ['npm', 'install']);

/**
 * What a repository is for the stores: an Expo app (the `expo` package, an app config) with the id the store wants — a
 * bundle identifier for the App Store, a package name for Google Play. A bare React Native app, a Flutter or a native
 * project is refused in words: Foundry builds through EAS only.
 */
export function expoDeployability(root: string, provider: StoreProvider, dir = ''): ExpoDeployability {
  const at = join(root, dir);
  const pkg = readJson(join(at, 'package.json'));
  const deps = { ...((pkg?.dependencies as Record<string, string>) ?? {}), ...((pkg?.devDependencies as Record<string, string>) ?? {}) };
  if (!pkg) return { ok: false, reason: 'no package.json: the stores take an Expo app (the expo package and an app.json or app.config.js)' };
  if (!('expo' in deps)) {
    if ('react-native' in deps) return { ok: false, reason: 'a bare React Native app: Foundry builds for the stores through Expo EAS only (add expo and an app config, or use EAS yourself)' };
    if (existsSync(join(at, 'pubspec.yaml'))) return { ok: false, reason: 'a Flutter app: Foundry builds for the stores through Expo EAS only' };
    if (existsSync(join(at, 'ios')) && existsSync(join(at, 'android'))) return { ok: false, reason: 'a native iOS/Android project: Foundry builds for the stores through Expo EAS only' };
    return { ok: false, reason: 'not an Expo app (no expo package): the stores take an Expo app built on EAS' };
  }
  const dynamic = ['app.config.ts', 'app.config.js', 'app.config.mjs', 'app.config.cjs'].find((f) => existsSync(join(at, f))) ?? null;
  const json = existsSync(join(at, 'app.json')) ? readJson(join(at, 'app.json')) : null;
  const expo = ((json?.expo as Record<string, unknown>) ?? (json && !('expo' in json) && 'name' in json ? json : null)) as Record<string, unknown> | null;
  if (!expo && !dynamic) return { ok: false, reason: 'no app.json (with an "expo" section) and no app.config.js: the stores need the app’s config' };
  const ios = (expo?.ios as Record<string, unknown>) ?? {};
  const android = (expo?.android as Record<string, unknown>) ?? {};
  const extra = (expo?.extra as Record<string, unknown>) ?? {};
  const eas = (extra.eas as Record<string, unknown>) ?? {};
  const app: ExpoApp = {
    dir,
    name: typeof expo?.name === 'string' ? expo.name : null,
    slug: typeof expo?.slug === 'string' ? expo.slug : null,
    projectId: typeof eas.projectId === 'string' ? eas.projectId : null,
    owner: typeof expo?.owner === 'string' ? expo.owner : null,
    bundleId: typeof ios.bundleIdentifier === 'string' ? ios.bundleIdentifier : null,
    package: typeof android.package === 'string' ? android.package : null,
    version: typeof expo?.version === 'string' ? expo.version : null,
    configFile: dynamic ?? 'app.json',
    dynamic: !!dynamic && !expo,
    install: installCommand(at),
    lockfile: LOCKFILES.some((f) => existsSync(join(at, f))),
  };
  const notes: string[] = [];
  if (app.dynamic) notes.push(`The app’s config is ${dynamic}, read when the build starts: the packages are installed in the checkout first, and the bundle id and package name are what it says then.`);
  if (!app.lockfile) notes.push('The project has no lockfile, and EAS builds only with one: the packages are installed in the checkout first to make it. Commit a lockfile to keep the builds the same every time.');
  if (!app.dynamic && provider === 'appstore' && !app.bundleId) return { ok: false, reason: 'app.json names no ios.bundleIdentifier: the App Store needs one (com.yourcompany.app), set once' };
  if (!app.dynamic && provider === 'play' && !app.package) return { ok: false, reason: 'app.json names no android.package: Google Play needs one (com.yourcompany.app), set once' };
  return { ok: true, app, notes };
}

export interface EasProfilesInput {
  /** App Store Connect: the app's numeric id and the key as a file, for the iOS submit */
  asc?: { appId: string; keyPath: string; keyId: string; issuerId: string } | null;
  /** Google Play: the service account's key as a file, for the Android production submit */
  play?: { keyPath: string } | null;
}
/** whether the checkout's packages must be installed before EAS reads the project: a dynamic config, or no lockfile */
export const needsInstall = (app: ExpoApp) => app.dynamic || !app.lockfile;

/**
 * Foundry's profiles, merged into the checkout's eas.json (the project's own profiles kept, Foundry's built on them):
 * `foundry-preview` — an internal-distribution APK for Android, a store build for iOS (TestFlight takes those alone);
 * `foundry-production` — store builds, an app bundle for Android; and the `foundry` submit profile with the keys. A
 * missing `cli.appVersionSource` is set to `local` so no question waits for a person. Returns the file's new text.
 */
export function writeEasProfiles(dir: string, input: EasProfilesInput): string {
  const path = join(dir, 'eas.json');
  const cur = (existsSync(path) ? readJson(path) : null) ?? {};
  const build = ((cur.build as Record<string, unknown>) ?? {}) as Record<string, Record<string, unknown>>;
  const base = (name: string) => (name in build ? { extends: name } : {});
  build[FOUNDRY_PROFILE.preview] = { ...base('preview' in build ? 'preview' : 'production'), android: { distribution: 'internal', buildType: 'apk' }, ios: { distribution: 'store' } };
  build[FOUNDRY_PROFILE.production] = { ...base('production'), distribution: 'store', android: { buildType: 'app-bundle' } };
  const submit = ((cur.submit as Record<string, unknown>) ?? {}) as Record<string, Record<string, unknown>>;
  submit[FOUNDRY_PROFILE.submit] = {
    ...(input.asc ? { ios: { ascAppId: input.asc.appId, ascApiKeyPath: input.asc.keyPath, ascApiKeyId: input.asc.keyId, ascApiKeyIssuerId: input.asc.issuerId } } : {}),
    ...(input.play ? { android: { serviceAccountKeyPath: input.play.keyPath, track: 'production', releaseStatus: 'completed' } } : {}),
  };
  const cli = { ...((cur.cli as Record<string, unknown>) ?? {}) };
  if (!('appVersionSource' in cli)) cli.appVersionSource = 'local';
  const next = { ...cur, cli, build, submit };
  const text = `${JSON.stringify(next, null, 2)}\n`;
  writeFileSync(path, text);
  return text;
}

/** the environment every EAS command runs with: the token, and no git so the checkout is uploaded as it is (Foundry's eas.json included) */
export const easEnv = (token: string) => ({ EXPO_TOKEN: token, EAS_NO_VCS: '1', CI: '1', EAS_NO_UPDATE_CHECK: '1' } as Record<string, string>);

/** what `eas build --json` and `eas build:view --json` say of a build */
export interface EasBuild {
  id: string;
  status: string;
  platform: string | null;
  appVersion: string | null;
  appBuildVersion: string | null;
  artifacts: { buildUrl: string | null; applicationArchiveUrl: string | null };
  project: { slug: string | null; account: string | null };
  error: string | null;
}
const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
/** the first build in a CLI's JSON output (an array from `eas build`, an object from `eas build:view`), or null */
export function parseEasBuild(stdout: string): EasBuild | null {
  const start = Math.min(...['[', '{'].map((c) => stdout.indexOf(c)).filter((i) => i >= 0));
  if (!Number.isFinite(start)) return null;
  let json: unknown;
  try {
    json = JSON.parse(stdout.slice(start).trim());
  } catch {
    const end = Math.max(stdout.lastIndexOf(']'), stdout.lastIndexOf('}'));
    try {
      json = JSON.parse(stdout.slice(start, end + 1));
    } catch {
      return null;
    }
  }
  const b = (Array.isArray(json) ? json[0] : json) as Record<string, unknown> | undefined;
  if (!b || typeof b.id !== 'string') return null;
  const artifacts = (b.artifacts as Record<string, unknown>) ?? {};
  // the CLI names the project under `app` (its id, slug and the account that owns it); older outputs said `project`
  const project = ((b.app ?? b.project) as Record<string, unknown>) ?? {};
  const owner = (project.ownerAccount as Record<string, unknown>) ?? {};
  const actor = (b.initiatingActor as Record<string, unknown>) ?? {};
  const error = (b.error as Record<string, unknown>) ?? null;
  return {
    id: b.id,
    status: String(b.status ?? ''),
    platform: str(b.platform),
    appVersion: str(b.appVersion),
    appBuildVersion: str(b.appBuildVersion),
    artifacts: { buildUrl: str(artifacts.buildUrl), applicationArchiveUrl: str(artifacts.applicationArchiveUrl) },
    project: { slug: str(project.slug), account: str(owner.name) ?? str(actor.displayName) },
    error: error ? (str(error.message) ?? str(error.errorCode)) : null,
  };
}
/** the build's page on expo.dev, when the output named the account and the project */
export const easBuildPage = (b: EasBuild) => (b.project.account && b.project.slug ? `https://expo.dev/accounts/${b.project.account}/projects/${b.project.slug}/builds/${b.id}` : null);
/** EAS's terminal build states */
export const EAS_BUILD_DONE = new Set(['FINISHED', 'ERRORED', 'CANCELED']);

/** the submission's page, from `eas submit`'s words */
export const easSubmissionUrl = (out: string) => out.match(/https:\/\/expo\.dev\/accounts\/[^\s"')]+\/submissions\/[A-Za-z0-9-]+/)?.[0] ?? null;
/** what `eas submit:view --json` says of the latest submission */
export function parseEasSubmission(stdout: string): { id: string; status: string; buildId: string | null } | null {
  const start = stdout.indexOf('{');
  if (start < 0) return null;
  try {
    const j = JSON.parse(stdout.slice(start, stdout.lastIndexOf('}') + 1)) as Record<string, unknown>;
    if (typeof j.id !== 'string') return null;
    const build = (j.submittedBuild as Record<string, unknown>) ?? {};
    return { id: j.id, status: String(j.status ?? ''), buildId: str(build.id) ?? str(j.submittedBuildId) };
  } catch {
    return null;
  }
}

/** what an EAS error means for Foundry's settings or the project, when its own words do not say it */
export function easFailureHint(out: string): string | null {
  if (/not logged in|EXPO_TOKEN|Invalid token|401/i.test(out)) return 'EAS refused the token: set Settings → Git & delivery → Expo token to an access token from expo.dev (Account settings → Access tokens)';
  if (/projectId|not linked|eas init|Run eas init/i.test(out)) return 'the app is not linked to an EAS project: run `npx eas-cli init` in your folder once and commit app.json';
  if (/Credentials are not set up|run this command again in interactive mode|distribution certificate|provisioning profile/i.test(out)) return 'EAS holds no iOS signing for this app yet: run `npx eas-cli credentials -p ios` in your folder once (it signs in with your Apple ID) and build again';
  if (/ascAppId|App Store Connect app|Could not find.*app/i.test(out)) return 'App Store Connect has no app for this bundle id: make it there first (My Apps → +), then deploy again';
  if (/service account|serviceAccountKeyPath|androidpublisher|403/i.test(out)) return 'Google Play refused the service account: give it release access to the app in the Play Console (Users and permissions), and make sure the app record exists there';
  if (/Apple ID|appleId|two-factor|Enter your Apple ID/i.test(out)) return 'EAS wants an Apple ID sign-in, which Foundry cannot give: set the App Store Connect API key in Settings → Git & delivery → Stores';
  return null;
}
