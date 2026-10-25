/**
 * The open-source credits: what ships in the Docker image (read from bun.lock, node_modules and the Dockerfile) and the
 * projects behind the Extensions catalog. scripts/gen-credits.ts writes them to the Open source credits page's data and
 * to THIRD-PARTY-NOTICES.txt; apps/web/tests/credits.test.ts fails when either is out of date.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { CatalogCredit, CatalogKind as Kind, Credits, PackageCredit, ToolCredit } from '../../apps/web/src/pages/credits/types.ts';
import { CATALOG } from './catalog.ts';
import { TOOLS } from './tools.ts';

export const ROOT = resolve(import.meta.dir, '../..');
export const CREDITS_JSON = 'apps/web/src/pages/credits/credits.json';
export const NOTICES_TXT = 'THIRD-PARTY-NOTICES.txt';

/** build tools whose own code ends up in the web bundle: Tailwind's base styles and Vite's module preload polyfill */
const BUNDLED_DEV = ['tailwindcss', 'vite'];

type LockMeta = { dependencies?: Record<string, string>; optionalDependencies?: Record<string, string>; peerDependencies?: Record<string, string>; optionalPeers?: string[]; os?: string | string[] };
type Lock = { workspaces: Record<string, { dependencies?: Record<string, string> }>; packages: Record<string, [string, string, LockMeta?, string?]> };

const read = (root: string, path: string) => readFileSync(join(root, path), 'utf8');
export const readLock = (root = ROOT): Lock => Bun.JSONC.parse(read(root, 'bun.lock')) as Lock;
const splitId = (id: string) => ({ name: id.slice(0, id.lastIndexOf('@')), version: id.slice(id.lastIndexOf('@') + 1) });

/** every package `bun install --production` puts in the image, plus BUNDLED_DEV, as sorted `name@version` */
export function productionPackages(lock: Lock): string[] {
  const { packages } = lock;
  // a lock key is the path of names down to a nested copy ("@playwright/test/playwright")
  const path = (key: string) => {
    const parts = key.split('/');
    const names: string[] = [];
    for (let i = 0; i < parts.length; i++) names.push(parts[i]!.startsWith('@') ? `${parts[i]}/${parts[++i]}` : parts[i]!);
    return names;
  };
  // as Node resolves: the nearest copy up the path wins
  const find = (name: string, from: string[]) => {
    for (let i = from.length; i >= 0; i--) {
      const key = [...from.slice(0, i), name].join('/');
      if (packages[key]) return key;
    }
    throw new Error(`bun.lock has no ${name} for ${from.join(' > ') || 'a workspace'}`);
  };
  const seen = new Set<string>();
  const ids = new Set<string>();
  const queue: [string, string[]][] = Object.values(lock.workspaces).flatMap((w) =>
    Object.entries(w.dependencies ?? {})
      .filter(([, range]) => !range.startsWith('workspace:'))
      .map(([name]): [string, string[]] => [name, []]),
  );
  while (queue.length) {
    const [name, from] = queue.shift()!;
    const key = find(name, from);
    if (seen.has(key)) continue;
    seen.add(key);
    const [id, , meta = {}] = packages[key]!;
    // the image is Linux: a package for another system is never installed
    if (meta.os && ![meta.os].flat().includes('linux')) continue;
    ids.add(id);
    const peers = Object.keys(meta.peerDependencies ?? {}).filter((p) => !(meta.optionalPeers ?? []).includes(p));
    for (const dep of [...Object.keys(meta.dependencies ?? {}), ...Object.keys(meta.optionalDependencies ?? {}), ...peers]) queue.push([dep, path(key)]);
  }
  for (const name of BUNDLED_DEV) ids.add(packages[name]![0]);
  return [...ids].sort();
}

/**
 * What the Dockerfile installs, as keys: `image:<name>` (a base image or a COPY --from), `npm:<package>` (npm install -g),
 * `uv:<package>` and `python:<version>` (uv tool install), `apt:<package>` (apt-get install).
 */
export function dockerfileInstalls(dockerfile: string): string[] {
  const lines = dockerfile
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('#'))
    .join('\n')
    .replace(/\\\n/g, ' ')
    .split('\n');
  const stages = new Set<string>();
  const keys = new Set<string>();
  const image = (ref: string) => !stages.has(ref) && keys.add(`image:${ref.replace(/:.*$/, '')}`);
  for (const line of lines) {
    const from = line.match(/^FROM\s+(?:--platform=\S+\s+)?(\S+)(?:\s+AS\s+(\S+))?/i);
    if (from) {
      image(from[1]!);
      if (from[2]) stages.add(from[2]);
      continue;
    }
    for (const m of line.matchAll(/--from=(\S+)/g)) image(m[1]!);
    if (!/^RUN\s/i.test(line)) continue;
    for (const command of line.replace(/^RUN\s+/i, '').split(/&&|\|\||;/)) {
      const words = command.trim().split(/\s+/).map((w) => w.replace(/^['"]|['"]$/g, ''));
      const [tool, sub, sub2] = words;
      if (tool === 'npm' && (sub === 'install' || sub === 'i') && words.includes('-g')) {
        // a version after the name: bun@1.4.3, @openai/codex@0.160.0
        for (const spec of words.slice(2).filter((w) => !w.startsWith('-'))) keys.add(`npm:${spec.replace(/(.)@.*$/, '$1')}`);
      } else if (tool === 'uv' && sub === 'tool' && sub2 === 'install') {
        for (let i = 3; i < words.length; i++) {
          if (words[i] === '--python') keys.add(`python:${words[++i]}`);
          else if (!words[i]!.startsWith('-')) keys.add(`uv:${words[i]!.replace(/[[=<>~!].*$/, '')}`);
        }
      } else if (tool === 'apt-get' && sub === 'install') {
        for (const pkg of words.slice(2).filter((w) => !w.startsWith('-'))) keys.add(`apt:${pkg}`);
      }
    }
  }
  return [...keys].sort();
}

const dockerfileArg = (dockerfile: string, name: string) => dockerfile.match(new RegExp(`^ARG ${name}=(\\S+)`, 'm'))?.[1];
const dockerfileImageTag = (dockerfile: string, image: string) => dockerfile.match(new RegExp(`^FROM\\s+${image}:(\\S+)`, 'm'))?.[1];

type SkillsCatalog = { suites: { id: string; repo: string; ref?: string }[]; entries: { id: string; homepage?: string; source: { type: string; repo?: string; ref?: string; suite?: string; marketplace?: string; docs?: string } }[] };
type McpCatalog = { entries: { id: string; homepage?: string }[] };
const KINDS: Kind[] = ['Skills', 'MCP server', 'Tool'];
const github = (url?: string) => url?.match(/^https:\/\/github\.com\/([^/#?]+\/[^/#?]+)/)?.[1]?.replace(/\.git$/, '');

/** the project a catalog skill comes from: `owner/repo` on GitHub, else its home page */
export function catalogProject(entry: SkillsCatalog['entries'][number], suites: SkillsCatalog['suites']): string {
  const s = entry.source;
  if (s.type === 'git' && s.repo) return s.repo;
  if (s.type === 'suite') return suites.find((x) => x.id === s.suite)?.repo ?? s.suite!;
  if (s.type === 'plugin' && s.marketplace) return s.marketplace;
  return github(entry.homepage) ?? github(s.docs) ?? entry.homepage ?? s.docs ?? entry.id;
}

/** every project the Extensions catalog draws on, with what it provides and the release it is pinned to */
export function catalogProjects(root = ROOT): Map<string, { kinds: Set<Kind>; refs: Set<string> }> {
  const skills = JSON.parse(read(root, 'catalog/skills.json')) as SkillsCatalog;
  const mcp = JSON.parse(read(root, 'catalog/mcp.json')) as McpCatalog;
  const projects = new Map<string, { kinds: Set<Kind>; refs: Set<string> }>();
  const add = (project: string, kind: Kind, ref?: string) => {
    const p = projects.get(project) ?? { kinds: new Set(), refs: new Set() };
    p.kinds.add(kind);
    if (ref && ref !== 'latest') p.refs.add(ref);
    projects.set(project, p);
  };
  for (const e of skills.entries) {
    // a bundled skill with a home page is a snapshot of someone's work (the Figure pack, ADR-0076) and is credited; one without is Foundry's own (motion-studio, ADR-0077)
    if (e.source.type === 'bundled' && !e.homepage) continue;
    const ref = e.source.type === 'suite' ? skills.suites.find((x) => x.id === e.source.suite)?.ref : e.source.ref;
    add(catalogProject(e, skills.suites), e.source.type === 'cli' ? 'Tool' : 'Skills', ref);
  }
  for (const e of mcp.entries) add(github(e.homepage) ?? e.homepage ?? e.id, 'MCP server');
  return projects;
}

// "Copyright (c) 2019 GitHub Inc.", "(c) 2026 Lauren Tan", "© Meta"; not the license's own words about copyright notices
const COPYRIGHT = /^\s*(copyright\b|\(c\)\s*\d|©)/i;
const NOT_COPYRIGHT = /^\s*copyright\s+(notice|owner|statement|license|holders?|and\b|law|\[)/i;
const copyrightOf = (...texts: (string | undefined)[]) =>
  [...new Set(texts.flatMap((t) => t?.split('\n') ?? []).filter((l) => COPYRIGHT.test(l) && !NOT_COPYRIGHT.test(l)).map((l) => l.trim()))].slice(0, 3).join('\n') || null;

const repoUrl = (pj: { name: string; repository?: string | { url?: string }; homepage?: string }) => {
  const repo = typeof pj.repository === 'string' ? pj.repository : pj.repository?.url;
  if (!repo) return pj.homepage ?? `https://www.npmjs.com/package/${pj.name}`;
  const short = repo.match(/^(?:github:)?([\w.-]+\/[\w.-]+)$/);
  if (short) return `https://github.com/${short[1]}`;
  return repo
    .replace(/^git\+/, '')
    .replace(/^git:\/\//, 'https://')
    .replace(/^ssh:\/\/git@/, 'https://')
    .replace(/^git@github\.com:/, 'https://github.com/')
    .replace(/\.git$/, '');
};

const LICENSE_FILE = /^(licen[cs]e|copying)/i;
const NOTICE_FILE = /^notice/i;
const clean = (text: string) => text.replace(/\r\n/g, '\n').replace(/\s+$/, '') + '\n';

/** the package's folder: Bun's isolated store (node_modules/.bun), else the hoisted node_modules/<name> */
function packageDir(root: string, id: string, store: string[] | null): string {
  const { name, version } = splitId(id);
  const prefix = `${name.replace('/', '+')}@${version}`;
  const isolated = store?.find((d) => d === prefix || d.startsWith(`${prefix}+`));
  const dir = isolated ? join(root, 'node_modules/.bun', isolated, 'node_modules', name) : join(root, 'node_modules', name);
  const installed = existsSync(join(dir, 'package.json')) && JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version;
  if (installed !== version) throw new Error(`${id} is not installed (node_modules is behind bun.lock): run bun install --frozen-lockfile, then try again`);
  return dir;
}

/**
 * npm packages that ship no license file: the text is their repository's, copied into ./licenses at the release bun.lock
 * pins and checked by hand, so nothing the image carries is credited without its license
 */
const LICENSE_BY_HAND: Record<string, string> = { '@vectorize-io/hindsight-client': 'hindsight-client.txt' };

export function collectCredits(root = ROOT): Credits {
  const texts = new Map<string, string>();
  const keep = (text: string) => {
    const id = createHash('sha1').update(text).digest('hex').slice(0, 12);
    texts.set(id, text);
    return id;
  };
  const storePath = join(root, 'node_modules/.bun');
  const store = existsSync(storePath) ? readdirSync(storePath) : null;

  const packages = productionPackages(readLock(root)).map((id): PackageCredit => {
    const dir = packageDir(root, id, store);
    const pj = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    const files = readdirSync(dir).sort();
    const licenseFiles = files.filter((f) => LICENSE_FILE.test(f));
    const byHand = licenseFiles.length ? undefined : LICENSE_BY_HAND[pj.name];
    if (!licenseFiles.length && !byHand) throw new Error(`${id} ships no license file: copy its repository's into scripts/credits/licenses and name it in LICENSE_BY_HAND before it goes into the image`);
    const text = clean(byHand ? read(root, `scripts/credits/licenses/${byHand}`) : licenseFiles.map((f) => readFileSync(join(dir, f), 'utf8')).join('\n\n'));
    const noticeFile = files.find((f) => NOTICE_FILE.test(f));
    const notice = noticeFile ? clean(readFileSync(join(dir, noticeFile), 'utf8')) : undefined;
    const license = typeof pj.license === 'string' ? pj.license : pj.license?.type ?? 'UNKNOWN';
    return { name: pj.name, version: pj.version, license, url: repoUrl(pj), copyright: copyrightOf(text, notice), text: keep(text), ...(notice && { notice: keep(notice) }) };
  });

  const dockerfile = read(root, 'Dockerfile');
  const licenseText = (file: string) => keep(clean(read(root, `scripts/credits/licenses/${file}`)));
  const tools = TOOLS.map((t): ToolCredit => {
    const v = t.version;
    const version = v == null ? null : typeof v === 'string' ? v : 'arg' in v ? dockerfileArg(dockerfile, v.arg) : dockerfileImageTag(dockerfile, v.image)?.match(/^[\d.]+/)?.[0];
    if (version === undefined) throw new Error(`the Dockerfile no longer gives ${t.name}'s version (scripts/credits/tools.ts)`);
    return { id: t.id, name: t.name, version, license: t.license, url: t.url, copyright: t.copyright, ...(t.text && { text: licenseText(t.text) }), ...(t.notice && { notice: licenseText(t.notice) }), ...(t.note && { note: t.note }) };
  });

  const catalog: CatalogCredit[] = [];
  for (const [project, { kinds, refs }] of catalogProjects(root)) {
    const credit = CATALOG[project];
    if (!credit) throw new Error(`the Extensions catalog draws on ${project}: credit it or say why not in scripts/credits/catalog.ts`);
    if ('excluded' in credit) continue;
    const gh = /^[^/:]+\/[^/]+$/.test(project);
    catalog.push({ project, name: credit.name ?? project, url: credit.url ?? (gh ? `https://github.com/${project}` : project), license: credit.license, kinds: KINDS.filter((k) => kinds.has(k)), ref: refs.size === 1 ? [...refs][0]! : null, featured: !!credit.featured });
  }
  catalog.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));

  return { packages, tools, catalog, texts: Object.fromEntries([...texts].sort(([a], [b]) => a.localeCompare(b))) };
}

export const renderCreditsJson = (c: Credits) => JSON.stringify(c, null, 2) + '\n';

/** THIRD-PARTY-NOTICES.txt: the same notices as the page, as plain text for whoever only has the image */
export function renderNotices(c: Credits): string {
  const heavy = '='.repeat(78);
  const light = '-'.repeat(78);
  // the copyright lines are in the license texts already
  const entry = (title: string, url: string, note: string | undefined, text: string | undefined, notice: string | undefined) =>
    [`${light}\n${title}\n${url}\n${light}`, note, text && c.texts[text], notice && `NOTICE\n\n${c.texts[notice]}`].filter(Boolean).join('\n\n').replace(/\n+$/, '') + '\n';
  return [
    'THIRD-PARTY SOFTWARE NOTICES',
    "Foundry's Docker image includes the open-source software below, each with its version, its license and the copyright\nnotices and license text it asks to be passed on. Foundry shows the same list on its Open source credits page\n(Settings → About & updates).",
    `Generated by scripts/gen-credits.ts from bun.lock and the Dockerfile; do not edit by hand.`,
    `${heavy}\nTOOLS IN THE DOCKER IMAGE\n${heavy}`,
    ...c.tools.map((t) => entry(`${t.name}${t.version ? ` ${t.version}` : ''} — ${t.license}`, t.url, t.note, t.text, t.notice)),
    `${heavy}\nNPM PACKAGES\n${heavy}`,
    ...c.packages.map((p) => entry(`${p.name} ${p.version} — ${p.license}`, p.url, undefined, p.text, p.notice)),
  ].join('\n\n');
}
