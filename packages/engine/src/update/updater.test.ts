import { describe, expect, test } from 'bun:test';
import { compareVersions, parseChangelog, parseSha256Sums, pickLatestRelease, releaseAssetName, releaseLayout } from './updater.ts';

describe('the version source: GitHub Releases of the public releases repo (ADR-0101)', () => {
  test('the newest stable, published release wins; drafts, pre-releases and odd tags are invisible', () => {
    const picked = pickLatestRelease([
      { tag_name: 'v2.35.0', assets: [{ name: 'SHA256SUMS', browser_download_url: 'https://x/sums', size: 300 }] },
      { tag_name: 'v3.0.0', draft: true, assets: [] },
      { tag_name: 'v2.36.0-rc.1', prerelease: true, assets: [] },
      { tag_name: 'v2.36.0', assets: [{ name: 'foundry-2.36.0-linux-x64.tar.gz', browser_download_url: 'https://x/linux', size: 70_000_000 }] },
      { tag_name: 'latest', assets: [] },
      { tag_name: 'v2.9.1', assets: [] },
    ]);
    expect(picked).toEqual({ version: '2.36.0', assets: [{ name: 'foundry-2.36.0-linux-x64.tar.gz', url: 'https://x/linux', size: 70_000_000 }] });
    expect(pickLatestRelease([])).toBeNull();
    expect(pickLatestRelease([{ tag_name: 'v3.0.0', draft: true }])).toBeNull();
  });

  test('each install and computer has one release file', () => {
    expect(releaseAssetName('app', '2.36.0', 'darwin', 'arm64')).toBe('Foundry-2.36.0-mac-universal.zip');
    expect(releaseAssetName('app', '2.36.0', 'linux', 'x64')).toBeNull();
    expect(releaseAssetName('binary', '2.36.0', 'darwin', 'x64')).toBe('foundry-2.36.0-darwin-universal.tar.gz');
    expect(releaseAssetName('binary', '2.36.0', 'linux', 'arm64')).toBe('foundry-2.36.0-linux-arm64.tar.gz');
    expect(releaseAssetName('binary', '2.36.0', 'linux', 'x64')).toBe('foundry-2.36.0-linux-x64.tar.gz');
    expect(releaseAssetName('binary', '2.36.0', 'linux', 'ia32')).toBeNull();
    expect(releaseAssetName('binary', '2.36.0', 'win32', 'x64')).toBeNull();
  });

  test('SHA256SUMS as sha256sum writes it, binary marker or not', () => {
    const sums = parseSha256Sums('ab'.repeat(32) + '  foundry-2.36.0-linux-x64.tar.gz\n' + 'CD'.repeat(32) + ' *Foundry-2.36.0-mac-universal.zip\n\nnot a line\n');
    expect(sums.get('foundry-2.36.0-linux-x64.tar.gz')).toBe('ab'.repeat(32));
    expect(sums.get('Foundry-2.36.0-mac-universal.zip')).toBe('cd'.repeat(32));
    expect(sums.size).toBe(2);
  });

  test('a tarball install is one Foundry can switch only with a `current` link beside its version folder', () => {
    const linked = (p: string) => ({ isSymbolicLink: () => p === '/opt/foundry/current' });
    expect(releaseLayout('/opt/foundry/2.35.0', linked)).toEqual({ base: '/opt/foundry', current: '/opt/foundry/current' });
    expect(releaseLayout('/opt/elsewhere/2.35.0', linked)).toBeNull();
    expect(releaseLayout('/opt/foundry/2.35.0', () => { throw new Error('ENOENT'); })).toBeNull();
    expect(releaseLayout(null)).toBeNull();
  });

  test('versions and changelog sections, as before', () => {
    expect(compareVersions('2.10.0', '2.9.9')).toBeGreaterThan(0);
    expect(parseChangelog('# Foundry releases\n\n## 2.36.0 — 2026-11-20\n\n- a\n\n## 2.35.0 — 2026-11-18\n\n- b\n').map((s) => s.version)).toEqual(['2.36.0', '2.35.0']);
  });
});

describe('the switch to 3.0 (ADR-0103)', () => {
  const { mkdirSync, mkdtempSync, rmSync, writeFileSync } = require('node:fs') as typeof import('node:fs');
  const { tmpdir } = require('node:os') as typeof import('node:os');
  const { join } = require('node:path') as typeof import('node:path');
  const { UpdateManager, dockerSwitchSteps, majorJump, majorOf, switchEnv } = require('./updater.ts') as typeof import('./updater.ts');

  test('a new major is a jump; a minor or a patch is not', () => {
    expect(majorOf('2.35.0')).toBe(2);
    expect(majorJump('2.35.0', '3.0.0')).toBe(true);
    expect(majorJump('2.35.0', '2.36.0')).toBe(false);
    expect(majorJump('3.0.0', '3.0.1')).toBe(false);
    expect(majorJump('2.35.0', null)).toBe(false);
    expect(majorJump('2.35.0-rc.1', '3.0.0')).toBe(false);
  });

  test("the installer and the new install never get the old install's data folder, port or supervisor", () => {
    // found switching a real install: FOUNDRY_DATA_DIR handed on had the new app open the old folder, not its copy
    const env = switchEnv({ PATH: '/usr/bin', HOME: '/Users/me', FOUNDRY_HOME: '/Users/me/.foundry', FOUNDRY_PROVIDER: 'codex', FOUNDRY_DATA_DIR: '/old/data', FOUNDRY_PORT: '4111', FOUNDRY_SUPERVISED: '1', INVOCATION_ID: 'x', FOUNDRY_ROOT: '/old', FOUNDRY_APP_SHELL: '1', FOUNDRY_DOCKER: '1', EMPTY: undefined });
    expect(env).toEqual({ PATH: '/usr/bin', HOME: '/Users/me', FOUNDRY_HOME: '/Users/me/.foundry', FOUNDRY_PROVIDER: 'codex' });
  });

  test("a container's steps run on its host: install without starting, copy the volume, repath, start", () => {
    const steps = dockerSwitchSteps('binary');
    expect(steps[0]).toContain('--mode binary --no-start');
    expect(steps.some((s) => s.includes("docker run --rm --volumes-from foundry") && s.includes('.local/share/foundry/data'))).toBe(true);
    expect(steps).toContain('foundry repath /repos "$HOME/Projects"');
    expect(steps.at(-1)).toBe('foundry start');
    expect(dockerSwitchSteps('app').join('\n')).toContain('Library/Application Support/Foundry/data');
  });

  /** an UpdateManager over a checkout at 2.35.0, whose version source offers 3.0.0 */
  async function checkout(env: Record<string, string> = {}) {
    const root = mkdtempSync(join(tmpdir(), 'foundry-switch-'));
    mkdirSync(join(root, '.git'));
    writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '2.35.0' }));
    const server = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      fetch: (req) => (new URL(req.url).pathname === '/releases' ? Response.json([{ tag_name: 'v3.0.0', assets: [{ name: 'Foundry-3.0.0-mac-universal.zip', browser_download_url: 'http://x/zip' }, { name: 'SHA256SUMS', browser_download_url: 'http://x/sums' }] }]) : new Response('', { status: 404 })),
    });
    const engine = { config: { rootDir: root, dataDir: join(root, 'data'), provider: 'claude', port: 4111, log: () => {} }, store: { listByType: () => [], append: () => {} }, busy: () => ({ total: 0 }), beginUpdateDrain: () => {}, endUpdateDrain: () => {} };
    const updater = new UpdateManager(engine as never, { releasesUrl: `http://127.0.0.1:${server.port}/releases`, changelogUrl: `http://127.0.0.1:${server.port}/none`, install: { kind: 'checkout', root, execDir: null }, platform: 'darwin', arch: 'arm64', env: { PATH: process.env.PATH ?? '', HOME: root, FOUNDRY_HOME: join(root, '.foundry'), ...env } });
    await updater.check();
    return { updater, done: () => (server.stop(true), rmSync(root, { recursive: true, force: true })), root };
  }

  test('a checkout offered 3.0 switches to the app, and only with the go-ahead', async () => {
    const { updater, done, root } = await checkout();
    try {
      const cap = updater.capability();
      expect(cap).toMatchObject({ mode: 'local', canSelfUpdate: true, method: 'switch' });
      expect(cap.switch).toMatchObject({ to: '3.0.0', install: 'app', from: 'local', dataDir: join(root, 'data'), port: 4111, log: join(root, '.foundry', 'switch.log') });
      expect(cap.switch!.target).toBe(join(root, 'Library', 'Application Support', 'Foundry', 'data'));
      await expect(updater.apply({})).rejects.toThrow(/needs the person's go-ahead/);
    } finally {
      done();
    }
  });

  test('a container offered 3.0 gets the steps, never a button', async () => {
    const { updater, done } = await checkout({ FOUNDRY_DOCKER: '1' });
    try {
      const cap = updater.capability();
      expect(cap).toMatchObject({ mode: 'docker', canSelfUpdate: false, method: null });
      expect(cap.switch?.from).toBe('docker');
      expect(cap.guided).toEqual(dockerSwitchSteps('app'));
    } finally {
      done();
    }
  });
});
