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
