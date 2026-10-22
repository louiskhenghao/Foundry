/**
 * Workflow suite releases (ADR-0068). Each suite Foundry keeps sits at one release tag: Matt Pocock's skills (a catalog
 * bundle of git entries from one repository) and pstack (a catalog suite). The catalog pins one; the person may move a
 * suite to a later release on the Extensions page, after a forecast of the skills that release removes, deprecates and
 * adds. The newer of the catalog's pin and the person's choice is the one used, so a Foundry release never moves a suite
 * back. The release facts come from an engine-private probe repository per suite: tags from `git ls-remote`, each tag's
 * tree fetched alone (`--depth 1`), never touching the cache clones the installer and the update check use.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { exec as defaultExec } from '../git/git.ts';
import type { SkillsPaths } from './paths.ts';
import type { Catalog, CatalogEntry, ForecastSkill, ReleaseForecast, ScanResult, SuiteReleaseView } from './types.ts';

/** stable release tags only (v1.3.1, 0.9.101): a pre-release or a floating tag is never offered */
export const RELEASE_TAG = /^v?\d+(\.\d+)*$/;

/** a Workflow suite Foundry keeps at one release */
export interface SuiteRelease {
  id: string;
  label: string;
  /** a bundle of git entries in one repository (mattpocock), or a catalog suite (pstack) */
  kind: 'bundle' | 'suite';
  repo: string;
  /** clone URL override (tests use file://) */
  url?: string;
  homepage: string | null;
  /** the catalog's pin */
  catalogRef: string;
  /** a suite's plugin root inside the repository */
  path: string | null;
}

/** what one release ships: every skill folder by name, the ones under a `deprecated/` folder, and the published set */
export interface TagSkills {
  skills: Record<string, string>;
  deprecated: string[];
  /** a bundle's plugin manifest list, or a suite's skills folder; null = no manifest (every skill folder counts) */
  published: string[] | null;
}

type GitSource = Extract<CatalogEntry['source'], { type: 'git' }>;

export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map(Number);
  const pb = b.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/** the release in use: the newer of the catalog's pin and the person's choice */
export function effectiveRef(catalogRef: string, chosen: string | undefined): string {
  return chosen && RELEASE_TAG.test(chosen) && RELEASE_TAG.test(catalogRef) && compareVersions(chosen, catalogRef) > 0 ? chosen : catalogRef;
}

/** the suites of a catalog that sit at a release: its `suites`, and each bundle whose git entries share one repository and tag */
export function suiteReleases(catalog: Catalog): SuiteRelease[] {
  const out: SuiteRelease[] = catalog.suites.map((s) => ({ id: s.id, label: s.label, kind: 'suite', repo: s.repo, url: s.url, homepage: s.homepage, catalogRef: s.ref, path: s.path }));
  const bundles = new Map<string, CatalogEntry[]>();
  for (const e of catalog.entries) {
    if (!e.bundle || e.source.type !== 'git' || !e.source.ref || !RELEASE_TAG.test(e.source.ref) || out.some((x) => x.id === e.bundle)) continue;
    bundles.set(e.bundle, [...(bundles.get(e.bundle) ?? []), e]);
  }
  for (const [id, entries] of bundles) {
    const srcs = entries.map((e) => e.source as GitSource);
    const first = srcs[0]!;
    // one repository at one tag, or it is not a suite at a release
    if (srcs.some((s) => s.repo !== first.repo || s.ref !== first.ref)) continue;
    out.push({ id, label: id, kind: 'bundle', repo: first.repo, url: first.url, homepage: entries.find((e) => e.homepage)?.homepage ?? `https://github.com/${first.repo}`, catalogRef: first.ref!, path: null });
  }
  return out;
}

/**
 * The catalog with each suite at its release in use. A bundle's entry follows its skill when that release keeps it under
 * another folder (the path from the release's facts); a skill the release no longer ships keeps its path and is not found.
 */
export function withReleases(catalog: Catalog, chosen: Record<string, string>, pathsAt: (repo: string, ref: string) => Record<string, string> | null): Catalog {
  const moved = suiteReleases(catalog).filter((r) => effectiveRef(r.catalogRef, chosen[r.id]) !== r.catalogRef);
  if (!moved.length) return catalog;
  const refs = new Map(moved.map((r) => [r.id, effectiveRef(r.catalogRef, chosen[r.id])] as const));
  return {
    ...catalog,
    suites: catalog.suites.map((s) => ({ ...s, ref: refs.get(s.id) ?? s.ref })),
    entries: catalog.entries.map((e) => {
      const ref = e.bundle ? refs.get(e.bundle) : undefined;
      if (!ref || e.source.type !== 'git' || ref === e.source.ref) return e;
      const at = pathsAt(e.source.repo, ref)?.[e.name];
      return { ...e, source: { ...e.source, ref, ...(at ? { path: at } : {}) } };
    }),
  };
}

/** a release's skills from its file list (`git ls-tree -r --name-only`) and, for a bundle, its plugin manifest's `skills` */
export function tagSkills(rel: Pick<SuiteRelease, 'kind' | 'path'>, files: string[], manifestSkills: string[] | null): TagSkills {
  const skills: Record<string, string> = {};
  const deprecated: string[] = [];
  const root = rel.kind === 'suite' && rel.path ? `${rel.path.replace(/\/$/, '')}/skills/` : null;
  for (const f of files) {
    if (!f.endsWith('/SKILL.md') || f.includes('node_modules/')) continue;
    const dir = dirname(f);
    // a suite ships the folders right under its plugin's skills/
    if (root && (!dir.startsWith(root) || dir.slice(root.length).includes('/'))) continue;
    const name = basename(dir);
    if (dir.split('/').includes('deprecated')) {
      deprecated.push(name);
      continue;
    }
    // the shortest path wins, as the installer's search does
    if (!skills[name] || dir.length < skills[name]!.length) skills[name] = dir;
  }
  const published = root ? Object.keys(skills) : manifestSkills ? manifestSkills.map((p) => basename(p.replace(/\/$/, ''))) : null;
  return { skills, deprecated: [...new Set(deprecated)].sort(), published: published ? [...new Set(published)].sort() : null };
}

/** the skills a release ships, plus the catalog's skills of that suite the release still holds */
function shipped(t: TagSkills, catalogNames: string[]): Set<string> {
  return new Set([...(t.published ?? Object.keys(t.skills)), ...catalogNames.filter((n) => t.skills[n])]);
}

const versionOf = (ref: string) => ref.replace(/^v/, '');
const headingAt = (line: string, ref: string) => /^#{1,3}\s/.test(line) && new RegExp(`(^|[^\\d.])${versionOf(ref).replace(/\./g, '\\.')}($|[^\\d.])`).test(line);
/** a changeset line's lead (PR link, commit link, thanks) is noise in a forecast */
const cleanNote = (l: string) => l.replace(/^\s*[-*]\s*/, '').replace(/^(\[#\d+\]\([^)]*\)\s*)?(\[`[0-9a-f]+`\]\([^)]*\)\s*)?(Thanks \[@[^\]]+\]\([^)]*\)!\s*-\s*)?/, '').trim();

const FATE = /renam|remov|delet|deprecat|merg|replac|retir|drop/i;

/** the changelog's part after `from` up to `to` (newest first): its headings, and per name the first lines that mention it */
export function changelogNotes(text: string | null, fromRef: string, toRef: string, names: string[]): { headlines: string[]; notes: Record<string, string[]> } {
  const notes: Record<string, string[]> = Object.fromEntries(names.map((n) => [n, [] as string[]]));
  if (!text) return { headlines: [], notes };
  const lines = text.split('\n');
  const start = lines.findIndex((l) => headingAt(l, toRef));
  if (start < 0) return { headlines: [], notes };
  const stop = lines.findIndex((l, i) => i > start && headingAt(l, fromRef));
  const part = lines.slice(start, stop > start ? stop : Math.min(lines.length, start + 400));
  const headlines = part.filter((l) => /^##\s/.test(l)).map((l) => l.replace(/^#+\s*/, '').trim()).slice(0, 12);
  for (const n of names) {
    const mention = new RegExp(`\`/?${n.replace(/[-]/g, '\\-')}\``);
    // a line that says what became of it (renamed, removed, merged) before a line that only names it
    const said = part.filter((l) => !/^#/.test(l) && mention.test(l)).map(cleanNote).filter(Boolean);
    notes[n] = [...said.filter((l) => FATE.test(l)), ...said.filter((l) => !FATE.test(l))].slice(0, 2).map((l) => (l.length > 280 ? `${l.slice(0, 279)}…` : l));
  }
  return { headlines, notes };
}

/** what moving a suite from one release to another changes, with the catalog's rules for what goes */
export function forecastBetween(rel: SuiteRelease, catalog: Catalog, from: { ref: string; skills: TagSkills }, to: { ref: string; skills: TagSkills }, changelog: string | null): ReleaseForecast {
  const ofSuite = catalog.entries.filter((e) => (rel.kind === 'suite' ? e.source.type === 'suite' && e.source.suite === rel.id : e.bundle === rel.id && e.source.type === 'git'));
  const names = ofSuite.map((e) => e.name);
  const a = shipped(from.skills, names);
  const b = shipped(to.skills, names);
  const gone = [...a].filter((n) => !b.has(n)).sort();
  const { headlines, notes } = changelogNotes(changelog, from.ref, to.ref, gone);
  const removed: ForecastSkill[] = gone.map((name) => {
    const entries = ofSuite.filter((e) => e.name === name);
    const rules = [...new Map(entries.flatMap((e) => e.workflow.map((w) => [`${w.role}:${w.mandate}`, { role: w.role, mandate: w.mandate }] as const))).values()];
    return { name, deprecated: to.skills.deprecated.includes(name), inCatalog: entries.length > 0, rules, notes: notes[name] ?? [] };
  });
  return { from: from.ref, to: to.ref, removed, added: [...b].filter((n) => !a.has(n)).sort(), kept: [...a].filter((n) => b.has(n)).length, headlines };
}

/** a marketplace's pinned ref as Claude Code recorded it (known_marketplaces.json), null when it follows a branch */
export function marketplaceRef(file: string, marketplace: string | null): string | null {
  if (!marketplace) return null;
  try {
    const ref = JSON.parse(readFileSync(file, 'utf8'))?.[marketplace]?.source?.ref;
    return typeof ref === 'string' && ref ? ref : null;
  } catch {
    return null;
  }
}

/** how this computer has a suite: the suite's own copy, a Claude plugin from its repository (first: prompts use it), Foundry's copies */
export function installedAs(rel: SuiteRelease, scan: ScanResult, paths: Pick<SkillsPaths, 'marketplacesFile'>): (NonNullable<SuiteReleaseView['installed']> & { pluginId?: string; marketplace?: string | null }) | null {
  if (rel.kind === 'suite') {
    const s = scan.suites.find((x) => x.id === rel.id);
    return s ? { as: 'suite', ref: s.ref } : null;
  }
  const plugin = scan.installed.find((r) => r.scope === 'plugin' && r.plugin?.marketplaceRepo === rel.repo && !r.plugin.id.startsWith('suite:'));
  if (plugin?.plugin) return { as: 'plugin', ref: marketplaceRef(paths.marketplacesFile, plugin.plugin.marketplace), pluginId: plugin.plugin.id, marketplace: plugin.plugin.marketplace };
  const copy = scan.installed.find((r) => r.scope === 'user' && r.managedBy === 'foundry' && r.marker?.repo === rel.repo);
  return copy ? { as: 'git', ref: copy.marker!.ref } : null;
}

interface ReleaseFacts {
  repo: string;
  checkedAt: string | null;
  error: string | null;
  /** stable release tags upstream, newest first */
  tags: string[];
  sets: Record<string, TagSkills>;
}

export interface ReleaseCheckerOptions {
  exec?: typeof defaultExec;
  log?: (m: string) => void;
  /** how long a tag list stays fresh (default 6 h: releases are rare) */
  ttlMs?: number;
}

/** The release facts of every suite: tags, each fetched tag's skills, and its changelog for forecasts. Persisted. */
export class SuiteReleaseChecker {
  private facts: Record<string, ReleaseFacts>;
  private exec: typeof defaultExec;
  private ttl: number;
  private inFlight = new Map<string, Promise<void>>();
  private sets = 0;

  constructor(
    private paths: SkillsPaths,
    private opts: ReleaseCheckerOptions = {},
  ) {
    this.exec = opts.exec ?? defaultExec;
    this.ttl = opts.ttlMs ?? 6 * 3600_000;
    try {
      this.facts = JSON.parse(readFileSync(this.paths.releasesFile, 'utf8')).releases ?? {};
    } catch {
      this.facts = {};
    }
  }

  private save(): void {
    try {
      mkdirSync(dirname(this.paths.releasesFile), { recursive: true });
      writeFileSync(this.paths.releasesFile, JSON.stringify({ releases: this.facts }));
    } catch {}
  }

  of(id: string): ReleaseFacts | undefined {
    return this.facts[id];
  }
  /** goes up whenever a release's skills become known: the catalog overlay's paths may change with it */
  get version(): number {
    return this.sets;
  }
  stale(id: string, now = Date.now()): boolean {
    const at = this.facts[id]?.checkedAt;
    return !at || now - Date.parse(at) > this.ttl;
  }
  /** a release's skill folders by name, when its tag was fetched: what the catalog overlay needs to follow a moved skill */
  pathsAt(repo: string, ref: string): Record<string, string> | null {
    return Object.values(this.facts).find((f) => f.repo === repo)?.sets[ref]?.skills ?? null;
  }

  /** the engine's probe repository for a suite: no checkout, only the tags it fetched */
  private async probe(rel: SuiteRelease): Promise<string> {
    const [owner, name] = rel.repo.split('/') as [string, string];
    const dir = join(this.paths.cacheDir, '.releases', owner, name);
    if (!existsSync(join(dir, '.git'))) {
      mkdirSync(dir, { recursive: true });
      await this.exec(['git', 'init', '-q'], dir);
      await this.exec(['git', 'remote', 'add', 'origin', rel.url ?? `https://github.com/${rel.repo}.git`], dir);
    }
    return dir;
  }

  /** refresh the tag list (one at a time per suite) */
  refresh(rel: SuiteRelease): Promise<void> {
    const running = this.inFlight.get(rel.id);
    if (running) return running;
    const p = (async () => {
      const f: ReleaseFacts = this.facts[rel.id] ?? { repo: rel.repo, checkedAt: null, error: null, tags: [], sets: {} };
      const r = await this.exec(['git', 'ls-remote', '--tags', '--refs', 'origin'], await this.probe(rel), { timeoutMs: 60_000 }).catch((e) => ({ code: 1, stdout: '', stderr: String(e) }));
      f.repo = rel.repo;
      f.checkedAt = new Date().toISOString();
      if (r.code !== 0) f.error = `git ls-remote failed for ${rel.repo}: ${r.stderr.trim().slice(-300)}`;
      else {
        f.error = null;
        f.tags = r.stdout
          .split('\n')
          .map((l) => l.split('\trefs/tags/')[1]?.trim() ?? '')
          .filter((t) => RELEASE_TAG.test(t))
          .sort((a, b) => compareVersions(b, a));
      }
      this.facts[rel.id] = f;
      this.save();
    })().finally(() => this.inFlight.delete(rel.id));
    this.inFlight.set(rel.id, p);
    return p;
  }

  /** one release's skills, fetched once and remembered */
  async skillsAt(rel: SuiteRelease, ref: string): Promise<TagSkills> {
    const known = this.facts[rel.id]?.sets[ref];
    if (known) return known;
    const dir = await this.fetchTag(rel, ref);
    const files = (await this.exec(['git', 'ls-tree', '-r', '--name-only', `refs/tags/${ref}`], dir, { timeoutMs: 30_000 })).stdout.split('\n').filter(Boolean);
    let manifest: string[] | null = null;
    if (rel.kind === 'bundle') {
      const m = await this.exec(['git', 'show', `refs/tags/${ref}:.claude-plugin/plugin.json`], dir, { timeoutMs: 10_000 });
      try {
        const skills = m.code === 0 ? JSON.parse(m.stdout).skills : null;
        manifest = Array.isArray(skills) ? skills.map(String) : null;
      } catch {}
    }
    const set = tagSkills(rel, files, manifest);
    const f = (this.facts[rel.id] ??= { repo: rel.repo, checkedAt: null, error: null, tags: [], sets: {} });
    f.sets[ref] = set;
    this.sets++;
    this.save();
    return set;
  }

  /** the changelog a release carries (CHANGELOG.md or CHANGES.md at its root), from the probe repository */
  async changelogAt(rel: SuiteRelease, ref: string): Promise<string | null> {
    const dir = await this.fetchTag(rel, ref);
    for (const file of ['CHANGELOG.md', 'CHANGES.md']) {
      const r = await this.exec(['git', 'show', `refs/tags/${ref}:${file}`], dir, { timeoutMs: 10_000 });
      if (r.code === 0) return r.stdout;
    }
    return null;
  }

  async forecast(rel: SuiteRelease, catalog: Catalog, from: string, to: string): Promise<ReleaseForecast> {
    const [a, b] = [await this.skillsAt(rel, from), await this.skillsAt(rel, to)];
    return forecastBetween(rel, catalog, { ref: from, skills: a }, { ref: to, skills: b }, await this.changelogAt(rel, to));
  }

  private async fetchTag(rel: SuiteRelease, ref: string): Promise<string> {
    if (!RELEASE_TAG.test(ref)) throw new Error(`${ref} is not a release tag`);
    const dir = await this.probe(rel);
    const have = await this.exec(['git', 'rev-parse', '-q', '--verify', `refs/tags/${ref}^{commit}`], dir, { timeoutMs: 10_000 });
    if (have.code === 0) return dir;
    const r = await this.exec(['git', 'fetch', '-q', '--depth', '1', '--no-tags', 'origin', `refs/tags/${ref}:refs/tags/${ref}`], dir, { timeoutMs: 120_000 });
    if (r.code !== 0) throw new Error(`git fetch of ${rel.repo} ${ref} failed: ${r.stderr.trim().slice(-300)}`);
    this.opts.log?.(`[skills] release facts: fetched ${rel.repo} ${ref}`);
    return dir;
  }
}

/**
 * Move a Claude plugin's marketplace to another release tag, as the CLI allows it: the marketplace entry in Claude Code's
 * settings is what a re-add must match, so its ref changes first; the re-add re-clones at the tag; the plugin update
 * installs that release (up or down).
 */
export async function repinPlugin(o: {
  settingsJson: string;
  claude: string;
  repo: string;
  marketplace: string;
  pluginId: string;
  to: string;
  cwd: string;
  spawn: (argv: string[], cwd: string, onLine: (l: string) => void, opts?: { timeoutMs?: number }) => Promise<{ code: number | null; tail: string }>;
  onLine: (l: string) => void;
}): Promise<{ ok: boolean; error: string | null }> {
  try {
    const settings = JSON.parse(readFileSync(o.settingsJson, 'utf8'));
    const entry = settings?.extraKnownMarketplaces?.[o.marketplace];
    if (entry?.source && typeof entry.source === 'object') {
      entry.source.ref = o.to;
      writeFileSync(o.settingsJson, `${JSON.stringify(settings, null, 2)}\n`);
      o.onLine(`✓ ${o.settingsJson}: extraKnownMarketplaces.${o.marketplace} → ${o.to}`);
    }
  } catch {}
  for (const argv of [
    [o.claude, 'plugin', 'marketplace', 'add', `${o.repo}#${o.to}`],
    [o.claude, 'plugin', 'update', o.pluginId, '-y'],
  ]) {
    o.onLine(`$ ${argv.join(' ')}`);
    const r = await o.spawn(argv, o.cwd, o.onLine, { timeoutMs: 300_000 });
    if (r.code !== 0) return { ok: false, error: `${argv.slice(1, 4).join(' ')} exited ${r.code}: ${r.tail.slice(-200)}` };
  }
  return { ok: true, error: null };
}
