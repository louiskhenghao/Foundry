import { describe, expect, test } from 'bun:test';
import { isToolId, packageCommand, toolRecipe, type ToolEnv } from './installers.ts';

const env = (over: Partial<ToolEnv> & { have?: string[] } = {}): ToolEnv => {
  const have = new Set(over.have ?? ['curl', 'tar']);
  return { which: (b) => (have.has(b) ? `/usr/bin/${b}` : null), platform: 'darwin', arch: 'arm64', home: '/Users/me', ...over };
};

describe('how Setup installs the tools beside the coding agents (ADR-0102)', () => {
  test('Homebrew first on macOS when it is there', () => {
    const e = env({ have: ['curl', 'brew'] });
    expect(toolRecipe('gh', e)).toMatchObject({ command: 'brew install gh', via: 'brew' });
    expect(toolRecipe('node', e).command).toStartWith('brew install node');
    expect(toolRecipe('ffmpeg', e)).toMatchObject({ command: 'brew install ffmpeg', via: 'brew' });
  });

  test('without Homebrew, release builds for this CPU under ~/.local, no password', () => {
    const arm = env();
    const gh = toolRecipe('gh', arm);
    expect(gh.via).toBe('release');
    expect(gh.command).toContain('gh_${v}_macOS_arm64.zip');
    expect(gh.command).toContain('ditto -x -k');
    expect(gh.command).toContain('ln -sf "$HOME/.local/share/foundry"/gh_${v}_macOS_arm64/bin/gh "$HOME/.local/bin"/gh');
    // never a bare $v before an underscore: the shell would read another variable
    expect(gh.command).not.toMatch(/\$v_/);
    expect(toolRecipe('gh', env({ arch: 'x64' })).command).toContain('gh_${v}_macOS_amd64.zip');
    const node = toolRecipe('node', env({ arch: 'x64' }));
    expect(node.command).toContain('-darwin-x64\\.tar\\.gz$');
    expect(node.command).toContain('corepack" enable --install-directory');
    // ffmpeg has no release build Foundry trusts on macOS: Homebrew, by hand
    expect(toolRecipe('ffmpeg', arm)).toMatchObject({ command: null, manual: 'brew install ffmpeg (Homebrew: https://brew.sh)' });
  });

  test('git on macOS is Apple’s command line tools, which finish after the command returns', () => {
    expect(toolRecipe('git', env())).toMatchObject({ command: 'xcode-select --install', via: 'apple', finishesLater: true });
  });

  test('Linux: release builds where there is one, the package manager by hand where it needs sudo', () => {
    const deb = env({ platform: 'linux', arch: 'x64', have: ['curl', 'apt-get'] });
    expect(toolRecipe('gh', deb).command).toContain('gh_${v}_linux_amd64.tar.gz');
    expect(toolRecipe('node', deb).command).toContain('-linux-x64\\.tar\\.gz$');
    expect(toolRecipe('git', deb)).toMatchObject({ command: null, manual: 'sudo apt-get install -y git' });
    expect(toolRecipe('ffmpeg', deb)).toMatchObject({ command: null, manual: 'sudo apt-get install -y ffmpeg' });
    // Alpine: no glibc Node.js build
    expect(toolRecipe('node', env({ platform: 'linux', arch: 'arm64', musl: true, have: ['apk'] }))).toMatchObject({ command: null, manual: 'sudo apk add nodejs npm' });
    expect(toolRecipe('uv', deb).command).toBe('curl -LsSf https://astral.sh/uv/install.sh | sh');
  });

  test('the ids and the package managers', () => {
    expect(isToolId('gh')).toBe(true);
    expect(isToolId('claude-code')).toBe(false);
    expect(packageCommand('git', (b) => (b === 'pacman' ? '/usr/bin/pacman' : null))).toBe('sudo pacman -S --needed git');
    expect(packageCommand('git', () => null)).toBe("install git with your system's package manager");
  });
});
