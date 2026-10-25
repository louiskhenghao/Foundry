/**
 * Where does an installed skill come from? Pure, synchronous helpers: map scanner rows to a source
 * (GitHub repo via foundry / npx skills / Claude plugin, project dir) and fingerprint
 * directories so copies can be compared byte-for-byte with their upstream.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, type Dirent } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { LEGACY_MARKER_FILE, MARKER_FILE, type SkillsPaths } from './paths.ts';
import type { MarketplaceInfo } from './scanner.ts';
import type { Catalog, CatalogEntry, InstalledSkill, SkillManager, SkillSourceKind } from './types.ts';

export interface SourceKey {
  id: string;
  kind: SkillSourceKind;
  label: string;
  manager: SkillManager;
  repo: string | null;
  url: string | null;
  homepage: string | null;
}

/** what a marker's `repo` says for a skill Foundry ships itself (ADR-0077): no repository to compare against, Foundry's own folder is */
export const BUNDLED_REPO = 'foundry';

/** Resolve the source of a scanner row from its provenance metadata; null = hand-installed (needs matching). */
export function sourceOf(row: InstalledSkill, paths: SkillsPaths): SourceKey | null {
  if (row.scope === 'project') {
    const repoRoot = row.dir.replace(/\/\.(?:claude|agents|codex)\/skills\/.*$/, '');
    return { id: `project:${repoRoot}`, kind: 'project', label: `Project skills · ${basename(repoRoot)}`, manager: 'project', repo: null, url: null, homepage: null };
  }
  // a workflow suite's copy (ADR-0049): one source Foundry re-syncs to its pinned release; no cache clone to compare against
  if (row.scope === 'plugin' && row.plugin?.id.startsWith('suite:')) {
    const homepage = row.plugin.marketplaceRepo ? `https://github.com/${row.plugin.marketplaceRepo}` : null;
    return { id: row.plugin.id, kind: 'suite', label: `${row.plugin.name} suite · ${row.plugin.version ?? '?'}`, manager: 'foundry', repo: null, url: homepage, homepage };
  }
  if (row.scope === 'plugin' && row.plugin) {
    const repo = row.plugin.marketplaceRepo;
    return { id: `plugin:${row.plugin.id}`, kind: 'plugin', label: repo ?? row.plugin.id, manager: 'plugin', repo, url: repo ? `https://github.com/${repo}` : null, homepage: repo ? `https://github.com/${repo}` : null };
  }
  if (row.managedBy === 'foundry' && row.marker?.repo === BUNDLED_REPO) {
    return { id: 'foundry:bundled', kind: 'bundled', label: 'Bundled with Foundry', manager: 'foundry', repo: null, url: null, homepage: null };
  }
  if (row.managedBy === 'foundry' && row.marker) {
    return { id: `foundry:${row.marker.repo}`, kind: 'github', label: row.marker.repo, manager: 'foundry', repo: row.marker.repo, url: row.marker.url ?? `https://github.com/${row.marker.repo}`, homepage: `https://github.com/${row.marker.repo}` };
  }
  if (row.managedBy === 'agents-cli') {
    const repo = row.lock?.source ?? null;
    return { id: `agents-cli:${repo ?? 'unknown'}`, kind: repo ? 'github' : 'unknown', label: repo ?? 'npx skills (unknown source)', manager: 'agents-cli', repo, url: row.lock?.sourceUrl ?? (repo ? `https://github.com/${repo}` : null), homepage: repo ? `https://github.com/${repo}` : null };
  }
  // a linked folder (ADR-0069) is kept where it links: never matched by name to a catalog or plugin skill it may only share a name with
  if (row.managedBy === 'symlink') return { id: 'linked', kind: 'local', label: 'Linked from another folder', manager: 'hand', repo: null, url: null, homepage: null };
  return null;
}

/** Path of the skill inside its source repository, when the provenance says so. */
export function pathInRepoOf(row: InstalledSkill): string | null {
  if (row.marker?.path) return row.marker.path;
  if (row.lock?.skillPath) return row.lock.skillPath.replace(/\/SKILL\.md$/, '');
  if (row.plugin?.skillPath) return row.plugin.skillPath;
  return null;
}

/** The directory whose bytes represent this installation (symlinks are followed to their target). */
export function localDirOf(row: InstalledSkill): string {
  return row.symlink && !row.symlink.broken ? row.symlink.target : row.dir;
}

// ---------- fingerprints ----------

export function gitBlobSha1(buf: Uint8Array): string {
  return createHash('sha1').update(`blob ${buf.byteLength}\0`).update(buf).digest('hex');
}

const IGNORED = new Set([MARKER_FILE, LEGACY_MARKER_FILE, '.git', '.DS_Store', 'manifest.json', '.trash.json']);
/** a skill's installed dependencies: never part of its upstream bytes (git ignores them), and most of the files on disk */
const IGNORED_DIRS = new Set(['node_modules']);

/**
 * What each folder held when it was last hashed: its files' paths, sizes and times, and their hashes. A folder whose
 * files still have those sizes and times is not read again. The doctor fingerprints every installed skill and its
 * upstream on every run; reading them all (gigabytes, with a skill's test fixtures) held the server for seconds.
 */
const hashed = new Map<string, { sig: string; files: [string, string][] }>();

/** Sorted list of [relpath, blob sha1] for every regular file under dir (ignoring our marker, VCS noise and node_modules). */
export function dirFiles(dir: string): [string, string][] {
  const found: { rel: string; path: string; size: number; mtimeMs: number }[] = [];
  const walk = (d: string) => {
    let names: string[];
    try {
      names = readdirSync(d);
    } catch {
      return;
    }
    for (const n of names.sort()) {
      if (IGNORED.has(n)) continue;
      const p = join(d, n);
      let st;
      try {
        st = statSync(p); // follows symlinks
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (!IGNORED_DIRS.has(n)) walk(p);
      } else if (st.isFile()) found.push({ rel: relative(dir, p), path: p, size: st.size, mtimeMs: st.mtimeMs });
    }
  };
  walk(dir);
  const sig = found.map((f) => `${f.rel}\0${f.size}\0${f.mtimeMs}`).join('\n');
  const was = hashed.get(dir);
  if (was && was.sig === sig) return [...was.files];
  const files = found.map((f): [string, string] => [f.rel, gitBlobSha1(readFileSync(f.path))]);
  hashed.set(dir, { sig, files });
  return [...files];
}

export function dirFingerprint(dir: string): string | null {
  if (!existsSync(dir)) return null;
  const files = dirFiles(dir);
  if (!files.length) return null;
  return createHash('sha1').update(files.map(([p, h]) => `${p}\0${h}`).join('\n')).digest('hex');
}

export function skillMdBlob(dir: string): string | null {
  try {
    return gitBlobSha1(readFileSync(join(dir, 'SKILL.md')));
  } catch {
    return null;
  }
}

// ---------- candidates for hand-installed copies ----------

export interface Candidate {
  source: SourceKey;
  /** repo-relative path of the candidate skill dir, when known */
  pathInRepo: string | null;
  /** local directory holding the candidate's bytes (cache clone, marketplace clone or ~/.agents), when present */
  dir: string | null;
  catalogEntry: CatalogEntry | null;
  via: 'catalog' | 'marketplace' | 'agents';
}

/** Skill dirs listed by a marketplace clone's plugin.json (path relative to the clone). */
export function marketplaceSkillDirs(clone: string): { name: string; rel: string; dir: string }[] {
  const out: { name: string; rel: string; dir: string }[] = [];
  const add = (d: string) => existsSync(join(d, 'SKILL.md')) && out.push({ name: basename(d), rel: relative(clone, d), dir: d });
  try {
    const manifest = JSON.parse(readFileSync(join(clone, '.claude-plugin', 'plugin.json'), 'utf8'));
    const skills = manifest.skills;
    if (Array.isArray(skills)) for (const p of skills) add(resolve(clone, String(p)));
    else {
      const root = resolve(clone, typeof skills === 'string' ? skills : 'skills');
      for (const n of safeReaddir(root)) add(join(root, n));
    }
  } catch {}
  if (!out.length) {
    // fall back to a shallow search (skills/<cat>/<name>/SKILL.md or skills/<name>/SKILL.md)
    const root = join(clone, 'skills');
    for (const a of safeReaddir(root)) {
      const da = join(root, a);
      add(da);
      for (const b of safeReaddir(da)) add(join(da, b));
    }
  }
  return out;
}

function safeReaddir(d: string): string[] {
  try {
    return statSync(d).isDirectory() ? readdirSync(d).sort() : [];
  } catch {
    return [];
  }
}

/**
 * Where the skill folders are in each clone (a marketplace's, one of the skills cache's), found once per clone: the
 * hand-installed skills of a machine are matched one by one, and the clones hold thousands of files between them.
 * Made for one report, so a clone that changed is read afresh by the next.
 */
export class SkillDirIndex {
  private byClone = new Map<string, Map<string, string[]>>();

  /** the clone-relative folders named `name` that hold a SKILL.md, the shallowest first (dot folders and node_modules left out) */
  find(clone: string, name: string): string[] {
    let index = this.byClone.get(clone);
    if (!index) {
      const found = (index = new Map<string, string[]>());
      const walk = (d: string, rel: string) => {
        let entries: Dirent[];
        try {
          entries = readdirSync(d, { withFileTypes: true });
        } catch {
          return;
        }
        for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
          const n = e.name;
          if (!e.isDirectory() || n.startsWith('.') || n === 'node_modules') continue;
          const p = join(d, n);
          const r = rel ? `${rel}/${n}` : n;
          if (existsSync(join(p, 'SKILL.md'))) found.set(n, [...(found.get(n) ?? []), r]);
          walk(p, r);
        }
      };
      walk(clone, '');
      for (const rels of found.values()) rels.sort((a, b) => a.length - b.length);
      this.byClone.set(clone, found);
    }
    return index.get(name) ?? [];
  }
}

/**
 * Where could a hand-installed `name` have come from? In order: catalog entries (name or alias),
 * marketplace clones (same dir name), ~/.agents/skills/<name>.
 */
export function candidatesFor(name: string, catalog: Catalog, paths: SkillsPaths, marketplaces: MarketplaceInfo[], index = new SkillDirIndex()): Candidate[] {
  const out: Candidate[] = [];
  for (const e of catalog.entries) {
    if (e.source.type !== 'git') continue;
    if (e.name !== name && !e.aliases.includes(name)) continue;
    const [owner, repoName] = e.source.repo.split('/');
    const cache = join(paths.cacheDir, owner!, repoName!);
    let dir: string | null = null;
    let rel: string | null = e.source.path ?? null;
    if (existsSync(cache)) {
      if (rel && existsSync(join(cache, rel, 'SKILL.md'))) dir = join(cache, rel);
      else {
        const hit = index.find(cache, e.name)[0];
        if (hit) {
          dir = join(cache, hit);
          rel = hit;
        }
      }
    }
    out.push({ source: { id: `hand:${e.source.repo}`, kind: 'github', label: e.source.repo, manager: 'hand', repo: e.source.repo, url: e.source.url ?? `https://github.com/${e.source.repo}`, homepage: `https://github.com/${e.source.repo}` }, pathInRepo: rel, dir, catalogEntry: e, via: 'catalog' });
  }
  for (const m of marketplaces) {
    if (!m.clone || !existsSync(m.clone)) continue;
    for (const s of marketplaceSkillDirs(m.clone)) {
      if (s.name !== name) continue;
      const repo = m.repo ?? m.name;
      if (out.some((c) => c.source.repo === repo)) {
        // catalog candidate for the same repo: fill its dir from the marketplace clone when the cache is missing
        const c = out.find((x) => x.source.repo === repo)!;
        if (!c.dir) {
          c.dir = s.dir;
          c.pathInRepo ??= s.rel;
        }
        continue;
      }
      out.push({ source: { id: `hand:${repo}`, kind: 'github', label: repo, manager: 'hand', repo, url: m.repo ? `https://github.com/${m.repo}` : null, homepage: m.repo ? `https://github.com/${m.repo}` : null }, pathInRepo: s.rel, dir: s.dir, catalogEntry: null, via: 'marketplace' });
    }
  }
  // any clone we already have (marketplace clones, our cache) that contains a <name>/SKILL.md anywhere
  if (!out.length) {
    const clones: { repo: string | null; dir: string }[] = [];
    for (const m of marketplaces) if (m.clone && existsSync(m.clone)) clones.push({ repo: m.repo ?? m.name, dir: m.clone });
    for (const owner of safeReaddir(paths.cacheDir)) for (const r of safeReaddir(join(paths.cacheDir, owner))) clones.push({ repo: `${owner}/${r}`, dir: join(paths.cacheDir, owner, r) });
    for (const c of clones) {
      const hit = index.find(c.dir, name)[0];
      if (!hit) continue;
      const repo = c.repo;
      if (out.some((x) => x.source.repo === repo)) continue;
      out.push({ source: { id: `hand:${repo}`, kind: 'github', label: repo ?? c.dir, manager: 'hand', repo, url: repo ? `https://github.com/${repo}` : null, homepage: repo ? `https://github.com/${repo}` : null }, pathInRepo: hit, dir: join(c.dir, hit), catalogEntry: null, via: 'marketplace' });
    }
  }
  const agents = join(paths.agentsSkillsDir, name);
  if (existsSync(join(agents, 'SKILL.md')) && !out.length) {
    out.push({ source: { id: 'hand:agents', kind: 'local', label: '~/.agents/skills copy', manager: 'hand', repo: null, url: null, homepage: null }, pathInRepo: null, dir: agents, catalogEntry: null, via: 'agents' });
  }
  return out;
}
