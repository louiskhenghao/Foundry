/**
 * The tools Foundry needs beside the coding agents, and how to install each without a terminal (ADR-0105): the recipes
 * install.sh ran in bash, as commands the Setup page and `foundry setup` run alike. A compiled Foundry (the macOS app, a
 * release tarball) has no installer around it, so the person installs what is missing from the Setup page. Each recipe
 * prefers Homebrew on macOS when it is there and otherwise a release build unpacked under ~/.local, so nothing asks for
 * a password; what only a package manager with sudo can do (git or ffmpeg on Linux) is a command to run by hand.
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export type ToolId = 'git' | 'uv' | 'gh' | 'node' | 'ffmpeg';
export const TOOL_IDS: ToolId[] = ['git', 'uv', 'gh', 'node', 'ffmpeg'];
export const isToolId = (id: string): id is ToolId => (TOOL_IDS as string[]).includes(id);

export interface ToolEnv {
  which: (bin: string) => string | null;
  platform: NodeJS.Platform | string;
  arch: string;
  home: string;
  /** a Linux on musl (Alpine): no glibc release builds of Node.js */
  musl?: boolean;
}

export interface ToolRecipe {
  id: ToolId;
  label: string;
  /** the command it provides: present when this is on PATH */
  bin: string;
  /** what runs to install it here, through bash; null when only the person can (a password, a package manager) */
  command: string | null;
  /** how it gets there: said on the Setup page beside the button */
  via: 'brew' | 'apple' | 'script' | 'release' | null;
  /** what to do by hand: a command for a terminal */
  manual: string;
  url: string;
  /** git on macOS: the command opens Apple's own installer, which finishes after the command returns */
  finishesLater?: boolean;
}

export function defaultToolEnv(): ToolEnv {
  let musl = false;
  if (process.platform === 'linux') {
    try {
      musl = existsSync('/etc/alpine-release') || readFileSync('/proc/self/maps', 'utf8').includes('musl');
    } catch {}
  }
  // PATH passed in: Bun.which alone keeps the PATH the process started with, and setup adds ~/.local/bin as it goes
  return { which: (b) => Bun.which(b, { PATH: process.env.PATH ?? '' }), platform: process.platform, arch: process.arch, home: homedir(), musl };
}

/** the system package manager's own command, for what Foundry leaves to the person on Linux */
export function packageCommand(pkg: string, which: ToolEnv['which']): string {
  if (which('apt-get')) return `sudo apt-get install -y ${pkg}`;
  if (which('dnf')) return `sudo dnf install -y ${pkg}`;
  if (which('yum')) return `sudo yum install -y ${pkg}`;
  if (which('pacman')) return `sudo pacman -S --needed ${pkg}`;
  if (which('apk')) return `sudo apk add ${pkg}`;
  if (which('zypper')) return `sudo zypper install -y ${pkg}`;
  return `install ${pkg} with your system's package manager`;
}

const SHARE = '"$HOME/.local/share/foundry"';
const BIN = '"$HOME/.local/bin"';

/** the GitHub CLI's newest release, unpacked under ~/.local/share/foundry and linked into ~/.local/bin */
function ghRelease(asset: (v: string) => string, folder: (v: string) => string, unpack: string): string {
  return [
    'set -e',
    `v="$(curl -fsSL --retry 3 https://api.github.com/repos/cli/cli/releases/latest | sed -n 's/.*"tag_name": *"v\\([^"]*\\)".*/\\1/p' | head -1)"`,
    '[ -n "$v" ] || { echo "could not find the newest GitHub CLI release" >&2; exit 1; }',
    `mkdir -p ${SHARE} ${BIN}`,
    't="$(mktemp -d)"',
    // ${v}, never $v: in gh_$v_linux the shell reads a variable named v_linux
    `curl -fsSL --retry 3 -o "$t/gh" "https://github.com/cli/cli/releases/download/v${'${v}'}/${asset('${v}')}"`,
    `rm -rf ${SHARE}/${folder('${v}')}`,
    unpack,
    'rm -rf "$t"',
    `ln -sf ${SHARE}/${folder('${v}')}/bin/gh ${BIN}/gh`,
    `${BIN}/gh --version | head -1`,
  ].join('\n');
}

/** Node.js 22 from nodejs.org, unpacked into ~/.local/share/foundry/node, with corepack's pnpm and yarn shims */
function nodeRelease(os: 'darwin' | 'linux', cpu: 'arm64' | 'x64'): string {
  return [
    'set -e',
    `f="$(curl -fsSL --retry 3 https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt | awk '$2 ~ /-${os}-${cpu}\\.tar\\.gz$/ {print $2; exit}')"`,
    '[ -n "$f" ] || { echo "could not find a Node.js 22 build for this computer" >&2; exit 1; }',
    `d=${SHARE}/node`,
    `rm -rf "$d" && mkdir -p "$d" ${BIN}`,
    'curl -fsSL --retry 3 "https://nodejs.org/dist/latest-v22.x/$f" | tar -xz -C "$d" --strip-components 1',
    `for b in node npm npx corepack; do ln -sf "$d/bin/$b" ${BIN}/$b; done`,
    `"$d/bin/corepack" enable --install-directory ${BIN} || true`,
    `${BIN}/node --version`,
  ].join('\n');
}

export function toolRecipe(id: ToolId, env: ToolEnv): ToolRecipe {
  const mac = env.platform === 'darwin';
  const brew = mac && !!env.which('brew');
  const cpu = env.arch === 'arm64' ? 'arm64' : env.arch === 'x64' ? 'x64' : null;
  switch (id) {
    case 'git':
      return mac
        ? { id, label: 'git', bin: 'git', command: 'xcode-select --install', via: 'apple', manual: 'xcode-select --install', url: 'https://git-scm.com/downloads', finishesLater: true }
        : { id, label: 'git', bin: 'git', command: null, via: null, manual: packageCommand('git', env.which), url: 'https://git-scm.com/downloads' };
    case 'uv':
      return { id, label: 'uv', bin: 'uv', command: 'curl -LsSf https://astral.sh/uv/install.sh | sh', via: 'script', manual: 'curl -LsSf https://astral.sh/uv/install.sh | sh', url: 'https://docs.astral.sh/uv/' };
    case 'gh': {
      const url = 'https://cli.github.com';
      if (brew) return { id, label: 'GitHub CLI', bin: 'gh', command: 'brew install gh', via: 'brew', manual: 'brew install gh', url };
      if (mac && cpu) {
        const a = cpu === 'x64' ? 'amd64' : 'arm64';
        return { id, label: 'GitHub CLI', bin: 'gh', command: ghRelease((v) => `gh_${v}_macOS_${a}.zip`, (v) => `gh_${v}_macOS_${a}`, `ditto -x -k "$t/gh" ${SHARE}`), via: 'release', manual: 'brew install gh', url };
      }
      if (env.platform === 'linux' && cpu) {
        const a = cpu === 'x64' ? 'amd64' : 'arm64';
        return { id, label: 'GitHub CLI', bin: 'gh', command: ghRelease((v) => `gh_${v}_linux_${a}.tar.gz`, (v) => `gh_${v}_linux_${a}`, `tar -xzf "$t/gh" -C ${SHARE}`), via: 'release', manual: packageCommand('gh', env.which), url };
      }
      return { id, label: 'GitHub CLI', bin: 'gh', command: null, via: null, manual: 'see https://cli.github.com', url };
    }
    case 'node': {
      const url = 'https://nodejs.org';
      if (brew) return { id, label: 'Node.js', bin: 'node', command: 'brew install node && (corepack enable || true) && node --version', via: 'brew', manual: 'brew install node', url };
      if (mac && cpu) return { id, label: 'Node.js', bin: 'node', command: nodeRelease('darwin', cpu), via: 'release', manual: 'brew install node', url };
      if (env.platform === 'linux' && cpu && !env.musl) return { id, label: 'Node.js', bin: 'node', command: nodeRelease('linux', cpu), via: 'release', manual: packageCommand('nodejs npm', env.which), url };
      return { id, label: 'Node.js', bin: 'node', command: null, via: null, manual: packageCommand('nodejs npm', env.which), url };
    }
    case 'ffmpeg':
      if (brew) return { id, label: 'ffmpeg', bin: 'ffmpeg', command: 'brew install ffmpeg', via: 'brew', manual: 'brew install ffmpeg', url: 'https://ffmpeg.org' };
      return { id, label: 'ffmpeg', bin: 'ffmpeg', command: null, via: null, manual: mac ? 'brew install ffmpeg (Homebrew: https://brew.sh)' : packageCommand('ffmpeg', env.which), url: 'https://ffmpeg.org' };
  }
}
