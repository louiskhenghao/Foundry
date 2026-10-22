import type { Credits } from './types.ts';

/**
 * The cards at the top of the Open source credits page: the projects Foundry leans on most, each with what Foundry uses
 * it for. A card's version, license and link come from credits.json through its `ref`. Git and SQLite reach the image
 * inside Debian and Bun, so they carry their own. credits.test.ts checks that every ref resolves.
 */
export type FeaturedRef = { npm: string } | { tool: string } | { catalog: string };
export type Featured = { name: string; use: string } & ({ ref: FeaturedRef } | { license: string; url: string });

export const FEATURED: { title: string; blurb: string; items: Featured[] }[] = [
  {
    title: 'Runtime',
    blurb: 'What Foundry itself runs on.',
    items: [
      { name: 'Bun', use: 'Runs the engine, the server and the CLI, and installs their packages.', ref: { tool: 'bun' } },
      { name: 'SQLite', use: 'Keeps every goal, task, event and setting, through the driver built into Bun.', license: 'Public domain', url: 'https://sqlite.org' },
      { name: 'Node.js', use: 'Runs the coding-agent CLIs in the Docker image, and the MCP servers they start.', ref: { tool: 'node' } },
      { name: 'Git', use: 'Gives every goal its own branch and worktree, and delivers it as a merge or a pull request.', license: 'GPL-2.0', url: 'https://git-scm.com' },
      { name: 'React & React Router', use: 'Draw every screen of the web UI and move between them.', ref: { npm: 'react' } },
      { name: 'Hono', use: "Serves Foundry's API and the web UI.", ref: { npm: 'hono' } },
      { name: 'Zod', use: 'Checks settings, catalogs and what the agents hand back against their schemas.', ref: { npm: 'zod' } },
      { name: 'Tailwind CSS', use: 'Styles the web UI, light and dark.', ref: { npm: 'tailwindcss' } },
      { name: 'Playwright', use: 'Drives the headless browser for self-checks, walkthroughs and browser QA.', ref: { npm: 'playwright' } },
      { name: 'react-markdown & remark', use: 'Render Briefs, reports and the guide from Markdown, sanitised.', ref: { npm: 'react-markdown' } },
      { name: 'highlight.js', use: 'Colours code in file previews and diffs.', ref: { npm: 'highlight.js' } },
      { name: 'Zustand', use: "Holds the web UI's live state.", ref: { npm: 'zustand' } },
    ],
  },
  {
    title: 'Agents & workflow',
    blurb: 'The open-source agent, skills and tools Foundry brings to a goal.',
    items: [
      { name: 'Codex CLI', use: 'A coding agent Foundry can run any goal with.', ref: { tool: 'codex' } },
      { name: "Matt Pocock's skills", use: 'The default workflow suite: TDD, grilling, code review, diagnosing bugs and more.', ref: { catalog: 'mattpocock/skills' } },
      { name: 'pstack', use: "The pstack workflow suite: Michael Denyer's port of poteto's agent style and Cursor's team skills.", ref: { catalog: 'michael-denyer/pstack-claude' } },
      { name: 'graphify', use: 'Maps a repository into a graph, so each session reads only the files and symbols it needs.', ref: { tool: 'graphify' } },
      { name: 'MarkItDown', use: 'Turns attachments and documents into Markdown the agents can read.', ref: { tool: 'markitdown' } },
      { name: 'GitHub CLI', use: 'Pushes branches and opens, reviews and merges pull requests.', ref: { tool: 'gh' } },
    ],
  },
];

/** a card's version, license and link; undefined when its ref names nothing in the credits */
export function resolveFeatured(f: Featured, c: Credits): { version: string | null; license: string; url: string } | undefined {
  if (!('ref' in f)) return { version: null, license: f.license, url: f.url };
  const r = f.ref;
  if ('npm' in r) {
    const p = c.packages.find((x) => x.name === r.npm);
    return p && { version: p.version, license: p.license, url: p.url };
  }
  if ('tool' in r) {
    const t = c.tools.find((x) => x.id === r.tool);
    return t && { version: t.version, license: t.license, url: t.url };
  }
  const k = c.catalog.find((x) => x.project === r.catalog);
  return k && { version: k.ref, license: k.license, url: k.url };
}
