/**
 * What the Dockerfile puts in the image besides the npm packages: the "Tools in the Docker image" group of the Open
 * source credits page and of THIRD-PARTY-NOTICES.txt. `installs` are the Dockerfile keys an entry accounts for (see
 * dockerfileInstalls in credits.ts); credits.test.ts fails when the Dockerfile installs something no entry and no
 * exclusion accounts for, or an entry claims something the Dockerfile no longer installs. The license texts are
 * upstream's, copied into ./licenses at the version the image installs.
 */
export type Tool = {
  id: string;
  name: string;
  url: string;
  license: string;
  copyright: string | null;
  installs: string[];
  /** a Dockerfile ARG holding the version, the base image whose tag is the version, or the version itself */
  version?: { arg: string } | { image: string } | string;
  /** file names in ./licenses */
  text?: string;
  notice?: string;
  note?: string;
};

export const TOOLS: Tool[] = [
  {
    id: 'node',
    name: 'Node.js',
    url: 'https://github.com/nodejs/node',
    license: 'MIT',
    copyright: 'Copyright Node.js contributors. All rights reserved.',
    installs: ['image:node'],
    version: { image: 'node' },
    text: 'node.txt',
    note: 'Node.js bundles third-party components. Their licenses follow its own in /usr/local/LICENSE in the image.',
  },
  {
    id: 'bun',
    name: 'Bun',
    url: 'https://github.com/oven-sh/bun',
    license: 'MIT',
    copyright: null,
    installs: ['npm:bun'],
    version: { arg: 'BUN_VERSION' },
    text: 'bun.md',
    note: 'Bun statically links JavaScriptCore and WebKit (LGPL-2.0) and the libraries listed in its license below.',
  },
  {
    id: 'codex',
    name: 'Codex CLI',
    url: 'https://github.com/openai/codex',
    license: 'Apache-2.0',
    copyright: 'Copyright 2025 OpenAI',
    installs: ['npm:@openai/codex'],
    version: { arg: 'CODEX_VERSION' },
    text: 'codex.txt',
    notice: 'codex.NOTICE',
  },
  {
    id: 'gh',
    name: 'GitHub CLI',
    url: 'https://github.com/cli/cli',
    license: 'MIT',
    copyright: 'Copyright (c) 2019 GitHub Inc.',
    installs: ['apt:gh'],
    text: 'gh.txt',
  },
  {
    id: 'uv',
    name: 'uv',
    url: 'https://github.com/astral-sh/uv',
    license: 'MIT OR Apache-2.0',
    copyright: 'Copyright (c) 2025 Astral Software Inc.',
    installs: ['image:ghcr.io/astral-sh/uv'],
    text: 'uv.txt',
    note: 'Licensed under MIT or Apache-2.0, at your option. The MIT terms are reproduced here.',
  },
  {
    id: 'python',
    name: 'Python',
    url: 'https://github.com/python/cpython',
    license: 'PSF-2.0',
    copyright: 'Copyright (c) 2001 Python Software Foundation. All rights reserved.',
    installs: ['python:3.12'],
    version: '3.12',
    text: 'python.txt',
    note: 'Installed by uv for graphify and MarkItDown. The libraries this build links and the Python packages installed with it keep their license files under /opt/uv in the image.',
  },
  {
    id: 'graphify',
    name: 'graphify',
    url: 'https://github.com/safishamsi/graphify',
    license: 'Apache-2.0',
    copyright: 'Copyright 2026 Safi Shamsi and the Graphify contributors.',
    installs: ['uv:graphifyy'],
    text: 'graphify.txt',
    notice: 'graphify.NOTICE',
  },
  {
    id: 'markitdown',
    name: 'MarkItDown',
    url: 'https://github.com/microsoft/markitdown',
    license: 'MIT',
    copyright: 'Copyright (c) Microsoft Corporation.',
    installs: ['uv:markitdown'],
    text: 'markitdown.txt',
    note: 'The Python packages it depends on are installed beside it under /opt/uv/tools/markitdown, each with its own license file.',
  },
  {
    id: 'docker-cli',
    name: 'Docker CLI',
    url: 'https://github.com/docker/cli',
    license: 'Apache-2.0',
    copyright: 'Copyright 2012-2017 Docker, Inc.',
    installs: ['apt:docker-ce-cli'],
    text: 'docker-cli.txt',
    notice: 'docker-cli.NOTICE',
  },
  {
    id: 'docker-compose',
    name: 'Docker Compose',
    url: 'https://github.com/docker/compose',
    license: 'Apache-2.0',
    copyright: 'Copyright 2020 Docker Compose authors',
    installs: ['apt:docker-compose-plugin'],
    text: 'docker-compose.txt',
    notice: 'docker-compose.NOTICE',
  },
  {
    id: 'ffmpeg',
    name: 'FFmpeg',
    url: 'https://ffmpeg.org',
    license: 'GPL-2.0-or-later (Debian build; LGPL-2.1-or-later core)',
    copyright: null,
    installs: ['apt:ffmpeg'],
    note: "Debian's ffmpeg package is built with its GPL components (libx264 among them), so the binary is GPL-2+ while FFmpeg's own core is LGPL-2.1+. Its copyright file is at /usr/share/doc/ffmpeg/copyright in the image. Foundry runs it to render and measure video (the motion-studio engine, the likeness review's frames, the reviewers' ffprobe checks).",
  },
  {
    id: 'debian',
    name: 'Debian packages',
    url: 'https://www.debian.org',
    license: 'Various',
    copyright: null,
    installs: ['apt:git', 'apt:ripgrep', 'apt:ca-certificates', 'apt:curl', 'apt:gnupg', 'apt:python3-minimal'],
    note: "git, ripgrep, curl, ca-certificates, gnupg, python3-minimal (Python, PSF-2.0: the Figure pack's skills build their page with it, ADR-0076), the base image's system and the libraries Playwright's Chromium needs come from Debian 12 (bookworm). Each package's copyright and license are in /usr/share/doc/<package>/copyright in the image.",
  },
];

/** what the Dockerfile installs that the credits leave out on purpose, and why */
export const EXCLUDED_INSTALLS: Record<string, string> = {
  'npm:@anthropic-ai/claude-code': "Claude Code is proprietary (Anthropic's Commercial Terms of Service), not open source.",
};
