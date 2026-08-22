/**
 * Where does an installed skill come from? Pure, synchronous helpers: map scanner rows to a source
 * (GitHub repo via ai-engine / npx skills / Claude plugin, gstack clone, project dir) and fingerprint
 * directories so copies can be compared byte-for-byte with their upstream.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { MARKER_FILE, type SkillsPaths } from './paths.ts';
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

export const GSTACK_REPO = 'garrytan/gstack';

/** Resolve the source of a scanner row from its provenance metadata; null = hand-installed (needs matching). */
export function sourceOf(row: InstalledSkill, paths: SkillsPaths): SourceKey | null {
  if (row.scope === 'project') {
    const repoRoot = row.dir.replace(/\/\.claude\/skills\/.*$/, '');
    return { id: `project:${repoRoot}`, kind: 'project', label: `Project skills · ${basename(repoRoot)}`, manager: 'project', repo: null, url: null, homepage: null };
  }
  if (row.scope === 'plugin' && row.plugin) {
    const repo = row.plugin.marketplaceRepo;
    return { id: `plugin:${row.plugin.id}`, kind: 'plugin', label: repo ?? row.plugin.id, manager: 'plugin', repo, url: repo ? `https://github.com/${repo}` : null, homepage: repo ? `https://github.com/${repo}` : null };
  }
  if (row.managedBy === 'ai-engine' && row.marker) {
    return { id: `ai-engine:${row.marker.repo}`, kind: 'github', label: row.marker.repo, manager: 'ai-engine', repo: row.marker.repo, url: row.marker.url ?? `https://github.com/${row.marker.repo}`, homepage: `https://github.com/${row.marker.repo}` };
  }
  if (row.managedBy === 'agents-cli') {
    const repo = row.lock?.source ?? null;
    return { id: `agents-cli:${repo ?? 'unknown'}`, kind: repo ? 'github' : 'unknown', label: repo ?? 'npx skills (unknown source)', manager: 'agents-cli', repo, url: row.lock?.sourceUrl ?? (repo ? `https://github.com/${repo}` : null), homepage: repo ? `https://github.com/${repo}` : null };
  }
  if (row.managedBy === 'gstack' || row.managedBy === 'gstack-copy') {
    return { id: 'gstack', kind: 'gstack', label: 'gstack', manager: 'gstack', repo: GSTACK_REPO, url: `https://github.com/${GSTACK_REPO}`, homepage: `https://github.com/${GSTACK_REPO}` };
  }
  return null;
}

/** Path of the skill inside its source repository, when the provenance says so. */
export function pathInRepoOf(row: InstalledSkill): string | null {
  if (row.marker?.path) return row.marker.path;
  if (row.lock?.skillPath) return row.lock.skillPath.replace(/\/SKILL\.md$/, '');
  if (row.plugin?.skillPath) return row.plugin.skillPath;
  if (row.managedBy === 'gstack-copy') return row.name;
  if (row.managedBy === 'gstack') return '.';
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

const IGNORED = new Set([MARKER_FILE, '.git', '.DS_Store', 'manifest.json', '.trash.json']);

/** Sorted list of [relpath, blob sha1] for every regular file under dir (ignoring our marker and VCS noise). */
export function dirFiles(dir: string): [string, string][] {
  const out: [string, string][] = [];
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
      if (st.isDirectory()) walk(p);
      else if (st.isFile()) out.push([relative(dir, p), gitBlobSha1(readFileSync(p))]);
    }
  };
  walk(dir);
  return out;
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
 * Where could a hand-installed `name` have come from? In order: catalog entries (name or alias),
 * marketplace clones (same dir name), ~/.agents/skills/<name>.
 */
export function candidatesFor(name: string, catalog: Catalog, paths: SkillsPaths, marketplaces: MarketplaceInfo[]): Candidate[] {
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
        const hit = [...new Bun.Glob(`**/${e.name}/SKILL.md`).scanSync({ cwd: cache, dot: false })].filter((h) => !h.includes('node_modules/')).sort((a, b) => a.length - b.length)[0];
        if (hit) {
          dir = join(cache, hit.slice(0, -'/SKILL.md'.length));
          rel = relative(cache, dir);
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
      const hit = [...new Bun.Glob(`**/${name}/SKILL.md`).scanSync({ cwd: c.dir, dot: false })].filter((h) => !h.includes('node_modules/')).sort((a, b) => a.length - b.length)[0];
      if (!hit) continue;
      const repo = c.repo;
      if (out.some((x) => x.source.repo === repo)) continue;
      out.push({ source: { id: `hand:${repo}`, kind: 'github', label: repo ?? c.dir, manager: 'hand', repo, url: repo ? `https://github.com/${repo}` : null, homepage: repo ? `https://github.com/${repo}` : null }, pathInRepo: hit.slice(0, -'/SKILL.md'.length), dir: join(c.dir, hit.slice(0, -'/SKILL.md'.length)), catalogEntry: null, via: 'marketplace' });
    }
  }
  const agents = join(paths.agentsSkillsDir, name);
  if (existsSync(join(agents, 'SKILL.md')) && !out.length) {
    out.push({ source: { id: 'hand:agents', kind: 'local', label: '~/.agents/skills copy', manager: 'hand', repo: null, url: null, homepage: null }, pathInRepo: null, dir: agents, catalogEntry: null, via: 'agents' });
  }
  return out;
}
