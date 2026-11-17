/**
 * The software besides the npm packages (ADR-0108: there is no Docker image any more): the runtime Foundry's release
 * ships, compiled into foundry, and what `foundry setup` installs on a person's computer, each from its own project's
 * release. Both are on the Open source credits page and in THIRD-PARTY-NOTICES.txt; Foundry's own files hold only the
 * first. credits.test.ts fails when foundry setup installs something no entry and no exclusion accounts for. The license
 * texts are upstream's, copied into ./licenses.
 */
export type Tool = {
  id: string;
  name: string;
  url: string;
  license: string;
  copyright: string | null;
  /** release: in Foundry's own release files · setup: installed by foundry setup, from its own project's release */
  ships: 'release' | 'setup';
  /** the version, where one is fixed */
  version?: string;
  /** file names in ./licenses */
  text?: string;
  notice?: string;
  note?: string;
};

export const TOOLS: Tool[] = [
  {
    id: 'bun',
    name: 'Bun',
    url: 'https://github.com/oven-sh/bun',
    license: 'MIT',
    copyright: null,
    ships: 'release',
    text: 'bun.md',
    note: 'Compiled into foundry: a release runs on the Bun that built it. Bun statically links JavaScriptCore and WebKit (LGPL-2.0) and the libraries listed in its license below.',
  },
  {
    id: 'node',
    name: 'Node.js',
    url: 'https://github.com/nodejs/node',
    license: 'MIT',
    copyright: 'Copyright Node.js contributors. All rights reserved.',
    ships: 'setup',
    text: 'node.txt',
    note: 'Installed by foundry setup (from Homebrew, or its own release under ~/.local) for the MCP servers and coding-agent CLIs that run on it. It bundles third-party components, whose licenses follow its own in the LICENSE file it installs.',
  },
  {
    id: 'codex',
    name: 'Codex CLI',
    url: 'https://github.com/openai/codex',
    license: 'Apache-2.0',
    copyright: 'Copyright 2025 OpenAI',
    ships: 'setup',
    text: 'codex.txt',
    notice: 'codex.NOTICE',
    note: 'Installed by foundry setup when Codex is one of the coding agents.',
  },
  {
    id: 'gh',
    name: 'GitHub CLI',
    url: 'https://github.com/cli/cli',
    license: 'MIT',
    copyright: 'Copyright (c) 2019 GitHub Inc.',
    ships: 'setup',
    text: 'gh.txt',
  },
  {
    id: 'uv',
    name: 'uv',
    url: 'https://github.com/astral-sh/uv',
    license: 'MIT OR Apache-2.0',
    copyright: 'Copyright (c) 2025 Astral Software Inc.',
    ships: 'setup',
    text: 'uv.txt',
    note: 'Licensed under MIT or Apache-2.0, at your option. The MIT terms are reproduced here.',
  },
  {
    id: 'python',
    name: 'Python',
    url: 'https://github.com/python/cpython',
    license: 'PSF-2.0',
    copyright: 'Copyright (c) 2001 Python Software Foundation. All rights reserved.',
    ships: 'setup',
    version: '3.12',
    text: 'python.txt',
    note: 'Installed by uv for graphify and MarkItDown, with the libraries its build links, each keeping its license file beside it.',
  },
  {
    id: 'graphify',
    name: 'graphify',
    url: 'https://github.com/safishamsi/graphify',
    license: 'Apache-2.0',
    copyright: 'Copyright 2026 Safi Shamsi and the Graphify contributors.',
    ships: 'setup',
    text: 'graphify.txt',
    notice: 'graphify.NOTICE',
  },
  {
    id: 'markitdown',
    name: 'MarkItDown',
    url: 'https://github.com/microsoft/markitdown',
    license: 'MIT',
    copyright: 'Copyright (c) Microsoft Corporation.',
    ships: 'setup',
    text: 'markitdown.txt',
    note: 'Optional (foundry setup --with markitdown). The Python packages it depends on are installed beside it, each with its own license file.',
  },
  {
    id: 'ffmpeg',
    name: 'FFmpeg',
    url: 'https://ffmpeg.org',
    license: 'LGPL-2.1-or-later, or GPL-2.0-or-later by build',
    copyright: null,
    ships: 'setup',
    note: "Optional (foundry setup --with ffmpeg), from Homebrew or the system's packages, whose build decides whether it is LGPL-2.1+ or GPL-2+. Foundry runs it to render and measure video (the motion-studio engine, the likeness review's frames, the reviewers' ffprobe checks).",
  },
];

/** what foundry setup installs that the credits leave out on purpose, and why (every one of its ids is either here or credited) */
export const SETUP_NOT_CREDITED: Record<string, string> = {
  claude: "Claude Code is proprietary (Anthropic's Commercial Terms of Service), not open source.",
  agy: "The Antigravity CLI is Google's own, not open source.",
  git: "git comes with the computer's own developer tools (Apple's command line tools, or the system's packages), not from Foundry.",
  chromium: 'Chromium for Playwright is downloaded by Playwright itself, which is credited with the npm packages.',
};
