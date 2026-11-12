import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FOUNDRY_PROFILE, easBuildPage, easFailureHint, easSubmissionUrl, expoDeployability, parseEasBuild, parseEasSubmission, writeEasProfiles } from './eas.ts';

const tmp = (files: Record<string, string>) => {
  const dir = mkdtempSync(join(tmpdir(), 'foundry-eas-'));
  for (const [p, body] of Object.entries(files)) {
    mkdirSync(join(dir, p, '..'), { recursive: true });
    writeFileSync(join(dir, p), body);
  }
  return dir;
};
const expoPkg = JSON.stringify({ dependencies: { expo: '~54.0.0', react: '19' } });
const appJson = JSON.stringify({ expo: { name: 'Shop', slug: 'shop', version: '1.2.0', owner: 'acme', ios: { bundleIdentifier: 'com.acme.shop' }, android: { package: 'com.acme.shop' }, extra: { eas: { projectId: 'p-1' } } } });

describe('what a store would build (ADR-0094)', () => {
  test('an Expo app with app.json: its ids for both stores; a bare React Native, Flutter or native project is refused; missing ids are named', () => {
    const d = tmp({ 'package.json': expoPkg, 'app.json': appJson, 'yarn.lock': '' });
    expect(expoDeployability(d, 'appstore')).toEqual({ ok: true, app: { dir: '', name: 'Shop', slug: 'shop', projectId: 'p-1', owner: 'acme', bundleId: 'com.acme.shop', package: 'com.acme.shop', version: '1.2.0', configFile: 'app.json', dynamic: false, install: ['yarn', 'install'], lockfile: true }, notes: [] });
    expect(expoDeployability(tmp({ 'package.json': JSON.stringify({ dependencies: { 'react-native': '0.76' } }) }), 'play')).toMatchObject({ ok: false, reason: expect.stringContaining('bare React Native') });
    expect(expoDeployability(tmp({ 'package.json': '{}', 'pubspec.yaml': '' }), 'play')).toMatchObject({ ok: false, reason: expect.stringContaining('Flutter') });
    expect(expoDeployability(tmp({ 'package.json': JSON.stringify({ dependencies: { vite: '5' } }) }), 'appstore')).toMatchObject({ ok: false, reason: expect.stringContaining('not an Expo app') });
    expect(expoDeployability(tmp({ 'package.json': expoPkg }), 'appstore')).toMatchObject({ ok: false, reason: expect.stringContaining('no app.json') });
    expect(expoDeployability(tmp({ 'package.json': expoPkg, 'app.json': JSON.stringify({ expo: { name: 'x', slug: 'x', android: { package: 'com.x' } } }) }), 'appstore')).toMatchObject({ ok: false, reason: expect.stringContaining('ios.bundleIdentifier') });
    expect(expoDeployability(tmp({ 'package.json': expoPkg, 'app.json': JSON.stringify({ expo: { name: 'x', slug: 'x', ios: { bundleIdentifier: 'com.x' } } }) }), 'play')).toMatchObject({ ok: false, reason: expect.stringContaining('android.package') });
    // a dynamic config is read at build time: the ids are unknown here, the packages get installed first
    const dyn = expoDeployability(tmp({ 'package.json': expoPkg, 'app.config.ts': 'export default {}', 'pnpm-lock.yaml': '' }), 'appstore');
    expect(dyn).toMatchObject({ ok: true, app: { dynamic: true, configFile: 'app.config.ts', bundleId: null, install: ['pnpm', 'install', '--frozen-lockfile'], lockfile: true }, notes: [expect.stringContaining('read when the build starts')] });
    // no lockfile: EAS refuses to build without one, so the install comes first and says so (a real finding of the live run)
    expect(expoDeployability(tmp({ 'package.json': expoPkg, 'app.json': appJson }), 'play')).toMatchObject({ ok: true, app: { lockfile: false, install: ['npm', 'install'] }, notes: [expect.stringContaining('no lockfile')] });
    // a monorepo's app folder
    expect(expoDeployability(tmp({ 'package.json': '{}', 'apps/mobile/package.json': expoPkg, 'apps/mobile/app.json': appJson }), 'play', 'apps/mobile')).toMatchObject({ ok: true, app: { dir: 'apps/mobile', package: 'com.acme.shop', install: ['npm', 'install'] } });
    rmSync(d, { recursive: true, force: true });
  });

  test('Foundry’s profiles are merged into the checkout’s eas.json: built on the project’s own, the submit profile with the keys, appVersionSource left alone or set to local', () => {
    const d = tmp({ 'eas.json': JSON.stringify({ cli: { version: '>= 10' }, build: { production: { autoIncrement: true, env: { A: '1' } }, preview: { distribution: 'internal' } }, submit: { production: { ios: { appleId: 'me@x' } } } }) });
    const text = writeEasProfiles(d, { asc: { appId: '1234567890', keyPath: '/tmp/k/AuthKey.p8', keyId: 'KEY1', issuerId: 'ISS1' }, play: { keyPath: '/tmp/k/sa.json' } });
    const j = JSON.parse(readFileSync(join(d, 'eas.json'), 'utf8'));
    expect(text).toBe(`${JSON.stringify(j, null, 2)}\n`);
    expect(j.cli).toEqual({ version: '>= 10', appVersionSource: 'local' });
    expect(j.build.production).toEqual({ autoIncrement: true, env: { A: '1' } });
    expect(j.build[FOUNDRY_PROFILE.preview]).toEqual({ extends: 'preview', android: { distribution: 'internal', buildType: 'apk' }, ios: { distribution: 'store' } });
    expect(j.build[FOUNDRY_PROFILE.production]).toEqual({ extends: 'production', distribution: 'store', android: { buildType: 'app-bundle' } });
    expect(j.submit.production).toEqual({ ios: { appleId: 'me@x' } });
    expect(j.submit[FOUNDRY_PROFILE.submit]).toEqual({ ios: { ascAppId: '1234567890', ascApiKeyPath: '/tmp/k/AuthKey.p8', ascApiKeyId: 'KEY1', ascApiKeyIssuerId: 'ISS1' }, android: { serviceAccountKeyPath: '/tmp/k/sa.json', track: 'production', releaseStatus: 'completed' } });
    // no eas.json at all: Foundry's alone, with nothing to extend
    const e = tmp({});
    const j2 = JSON.parse(writeEasProfiles(e, {}));
    expect(j2).toEqual({ cli: { appVersionSource: 'local' }, build: { [FOUNDRY_PROFILE.preview]: { android: { distribution: 'internal', buildType: 'apk' }, ios: { distribution: 'store' } }, [FOUNDRY_PROFILE.production]: { distribution: 'store', android: { buildType: 'app-bundle' } } }, submit: { [FOUNDRY_PROFILE.submit]: {} } });
    for (const x of [d, e]) rmSync(x, { recursive: true, force: true });
  });

  test('what the CLI prints is read: a build (array or object), its page, a submission’s page and record, an error in Foundry’s words', () => {
    // the shape the CLI printed in the live run: the project under `app`, the account under it
    const b = parseEasBuild('Loading…\n[{"id":"b-1","status":"IN_QUEUE","platform":"IOS","appVersion":"1.2.0","appBuildVersion":"7","artifacts":{},"initiatingActor":{"displayName":"acme"},"app":{"id":"p-1","name":"Shop","slug":"shop","ownerAccount":{"id":"a-1","name":"acme"}}}]');
    expect(b).toEqual({ id: 'b-1', status: 'IN_QUEUE', platform: 'IOS', appVersion: '1.2.0', appBuildVersion: '7', artifacts: { buildUrl: null, applicationArchiveUrl: null }, project: { slug: 'shop', account: 'acme' }, error: null });
    expect(easBuildPage(b!)).toBe('https://expo.dev/accounts/acme/projects/shop/builds/b-1');
    expect(parseEasBuild('{"id":"b-2","status":"ERRORED","artifacts":{"buildUrl":"https://x/app.apk"},"error":{"message":"Gradle build failed","errorCode":"GRADLE"}}')).toMatchObject({ id: 'b-2', status: 'ERRORED', artifacts: { buildUrl: 'https://x/app.apk' }, error: 'Gradle build failed', project: { slug: null, account: null } });
    expect(parseEasBuild('[{"id":"b-3","status":"NEW","project":{"slug":"old","ownerAccount":{"name":"acme"}}}]')).toMatchObject({ project: { slug: 'old', account: 'acme' } });
    expect(parseEasBuild('nothing')).toBeNull();
    expect(easSubmissionUrl('✔ Scheduled submission\nSubmission details: https://expo.dev/accounts/acme/projects/shop/submissions/9f3a-1\n')).toBe('https://expo.dev/accounts/acme/projects/shop/submissions/9f3a-1');
    expect(parseEasSubmission('{"id":"sub-1","status":"FINISHED","submittedBuild":{"id":"b-1"}}')).toEqual({ id: 'sub-1', status: 'FINISHED', buildId: 'b-1' });
    expect(easFailureHint('Error: Credentials are not set up. Run this command again in interactive mode.')).toContain('eas-cli credentials');
    expect(easFailureHint('Could not find an app on App Store Connect matching ascAppId')).toContain('App Store Connect has no app');
    expect(easFailureHint('Unauthorized: invalid EXPO_TOKEN')).toContain('Expo token');
    expect(easFailureHint('some other failure')).toBeNull();
  });
});
