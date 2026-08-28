import { existsSync, lstatSync, readFileSync, readdirSync, readlinkSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { parseSkillMd } from './frontmatter.ts';
import { LEGACY_MARKER_FILE, MARKER_FILE, type SkillsPaths } from './paths.ts';
import { FoundryMarker, type AgentsLockRecord, type InstalledSkill, type ScanResult } from './types.ts';

export interface ScanOptions {
  /** also scan <repo>/.claude/skills */
  repoPath?: string;
}

/** Pure filesystem scan of user, plugin and (optionally) project skills. */
export function scanSkills(paths: SkillsPaths, opts: ScanOptions = {}): ScanResult {
  const rows: InstalledSkill[] = [...scanUserDir(paths), ...scanPlugins(paths)];
  if (opts.repoPath) rows.push(...scanProject(opts.repoPath));
  markDuplicates(rows);
  return { installed: rows, duplicates: [...new Set(rows.filter((r) => r.duplicateOf.length).map((r) => r.name))].sort(), scannedAt: new Date().toISOString(), skillsDir: paths.skillsDir };
}

// ---------- user dir ----------

export function scanUserDir(paths: SkillsPaths): InstalledSkill[] {
  if (!existsSync(paths.skillsDir)) return [];
  const lock = readAgentsLock(paths.agentsLock);
  const out: InstalledSkill[] = [];
  for (const name of readdirSync(paths.skillsDir).sort()) {
    if (name.startsWith('.')) continue;
    const dir = join(paths.skillsDir, name);
    let st: ReturnType<typeof lstatSync>;
    try {
      st = lstatSync(dir);
    } catch {
      continue;
    }
    if (st.isSymbolicLink()) {
      out.push(classifySymlink(name, dir, paths, lock));
      continue;
    }
    if (!st.isDirectory()) continue;
    out.push(classifyDir(name, dir, paths));
  }
  return out;
}

function base(name: string, dir: string, scope: InstalledSkill['scope'], invoke: string): InstalledSkill {
  const skillMd = join(dir, 'SKILL.md');
  const fm = readFrontmatter(skillMd);
  return {
    name,
    scope,
    invoke,
    dir,
    skillMd: fm ? skillMd : null,
    description: fm?.description ?? '',
    version: fm?.version ?? null,
    managedBy: null,
    marker: null,
    plugin: null,
    lock: null,
    symlink: null,
    manifest: null,
    duplicateOf: [],
    canUninstall: scope === 'user',
    uninstallNote: null,
    hint: null,
    unparsable: !fm,
  };
}

function readFrontmatter(skillMd: string) {
  try {
    if (!statSync(skillMd).isFile()) return null;
    return parseSkillMd(readFileSync(skillMd, 'utf8'));
  } catch {
    return null;
  }
}

function classifySymlink(name: string, dir: string, paths: SkillsPaths, lock: Map<string, AgentsLockRecord>): InstalledSkill {
  let target = '';
  try {
    const raw = readlinkSync(dir);
    target = isAbsolute(raw) ? raw : resolve(dirname(dir), raw);
  } catch {}
  const broken = !target || !existsSync(target);
  const row = base(name, dir, 'user', `/${name}`);
  row.symlink = { target, broken };
  const underAgents = target.startsWith(paths.agentsSkillsDir + '/') || target === join(paths.agentsSkillsDir, name);
  if (underAgents || lock.has(name)) {
    row.managedBy = 'agents-cli';
    row.lock = lock.get(name) ?? null;
    row.uninstallNote = `Only the link is removed; ${paths.agentsSkillsDir}/${name} and .skill-lock.json stay. Run \`npx skills remove ${name}\` to finish.`;
  } else {
    row.managedBy = 'symlink';
    row.uninstallNote = `Only the link is removed; target ${target || '?'} stays.`;
  }
  if (broken) row.hint = `broken link → ${target || '?'}`;
  return row;
}

function classifyDir(name: string, dir: string, paths: SkillsPaths): InstalledSkill {
  const row = base(name, dir, 'user', `/${name}`);
  // 2. gstack root (git clone that also owns hooks in settings.json)
  if (name === 'gstack' && existsSync(join(dir, '.git'))) {
    row.managedBy = 'gstack';
    row.canUninstall = false;
    row.hint = 'managed by gstack (git clone; settings.json hooks point here) — update with /gstack-upgrade';
    return row;
  }
  // 3. our marker (legacy name kept readable so pre-rename installs stay managed)
  for (const file of [MARKER_FILE, LEGACY_MARKER_FILE]) {
    const markerPath = join(dir, file);
    if (!existsSync(markerPath)) continue;
    try {
      row.marker = FoundryMarker.parse(JSON.parse(readFileSync(markerPath, 'utf8')));
      row.managedBy = 'foundry';
      return row;
    } catch {}
  }
  // 4. manifest.json (garden-skills style)
  const manifestPath = join(dir, 'manifest.json');
  if (existsSync(manifestPath)) {
    try {
      const m = JSON.parse(readFileSync(manifestPath, 'utf8'));
      row.manifest = { name: m.name ?? null, version: m.version ?? null, homepage: m.homepage ?? null };
      row.managedBy = 'manifest';
      if (!row.version && m.version) row.version = String(m.version);
      return row;
    } catch {}
  }
  // 5. gstack flattened copy
  const gstackTwin = join(paths.skillsDir, 'gstack', name, 'SKILL.md');
  if (row.skillMd && existsSync(gstackTwin) && sameFile(row.skillMd, gstackTwin)) {
    row.managedBy = 'gstack-copy';
    row.uninstallNote = `copy of gstack/${name}; gstack's flatten step may recreate it on /gstack-upgrade`;
    return row;
  }
  return row;
}

function sameFile(a: string, b: string): boolean {
  try {
    const sa = statSync(a);
    const sb = statSync(b);
    if (sa.size !== sb.size) return false;
    return readFileSync(a).equals(readFileSync(b));
  } catch {
    return false;
  }
}

/** Full lock records keyed by skill name (the CLI's hash is its own algorithm; we keep it only for display). */
export function readAgentsLock(file: string): Map<string, AgentsLockRecord> {
  const out = new Map<string, AgentsLockRecord>();
  try {
    const j = JSON.parse(readFileSync(file, 'utf8'));
    const skills = j.skills ?? j;
    for (const [k, v] of Object.entries<any>(skills)) {
      if (!v || typeof v !== 'object') continue;
      out.set(k, {
        source: str(v.source),
        sourceType: str(v.sourceType),
        sourceUrl: str(v.sourceUrl),
        skillPath: str(v.skillPath),
        skillFolderHash: str(v.skillFolderHash ?? v.computedHash),
        installedAt: str(v.installedAt),
        updatedAt: str(v.updatedAt),
      });
    }
  } catch {}
  return out;
}
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

// ---------- plugins ----------

interface InstalledPluginRecord {
  scope?: string;
  installPath?: string;
  version?: string;
  installedAt?: string;
  lastUpdated?: string;
  gitCommitSha?: string;
}

export interface MarketplaceInfo {
  name: string;
  repo: string | null;
  clone: string | null;
  lastUpdated: string | null;
}

/** ~/.claude/plugins/known_marketplaces.json → name → {repo, clone} */
export function readMarketplaces(file: string): Map<string, MarketplaceInfo> {
  const out = new Map<string, MarketplaceInfo>();
  try {
    const j = JSON.parse(readFileSync(file, 'utf8'));
    for (const [name, v] of Object.entries<any>(j)) {
      if (!v || typeof v !== 'object') continue;
      const src = v.source ?? {};
      const repo = src.source === 'github' && typeof src.repo === 'string' ? src.repo : typeof src.url === 'string' ? src.url.replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '') : null;
      out.set(name, { name, repo, clone: str(v.installLocation), lastUpdated: str(v.lastUpdated) });
    }
  } catch {}
  return out;
}

export function scanPlugins(paths: SkillsPaths): InstalledSkill[] {
  const file = join(paths.pluginsDir, 'installed_plugins.json');
  if (!existsSync(file)) return [];
  let registry: Record<string, InstalledPluginRecord | InstalledPluginRecord[]>;
  try {
    const j = JSON.parse(readFileSync(file, 'utf8'));
    registry = j.plugins ?? j;
  } catch {
    return [];
  }
  const marketplaces = readMarketplaces(paths.marketplacesFile);
  const out: InstalledSkill[] = [];
  for (const [id, recOrList] of Object.entries(registry)) {
    const list = Array.isArray(recOrList) ? recOrList : [recOrList];
    const rec = list.find((r) => r && typeof r === 'object' && (r.scope ?? 'user') === 'user') ?? list[0];
    if (!rec || typeof rec !== 'object') continue;
    const pluginName = id.split('@')[0]!;
    const marketplace = id.includes('@') ? id.split('@').slice(1).join('@') : null;
    const mkt = marketplace ? marketplaces.get(marketplace) : undefined;
    const installPath = rec.installPath ? (isAbsolute(rec.installPath) ? rec.installPath : join(paths.pluginsDir, rec.installPath)) : null;
    const pluginMeta = {
      id,
      name: pluginName,
      version: rec.version ?? null,
      installPath: installPath ?? '',
      marketplace,
      marketplaceRepo: mkt?.repo ?? null,
      marketplaceClone: mkt?.clone ?? null,
      gitCommitSha: str(rec.gitCommitSha),
      installedAt: str(rec.installedAt),
      lastUpdated: str(rec.lastUpdated),
      skillPath: null as string | null,
    };
    if (!installPath || !existsSync(installPath)) {
      const row = base(pluginName, installPath ?? '', 'plugin', `/${pluginName}`);
      row.plugin = pluginMeta;
      row.managedBy = 'plugin';
      row.canUninstall = false;
      row.unparsable = true;
      row.hint = `plugin ${id}: install path missing — \`claude plugin install ${id}\``;
      out.push(row);
      continue;
    }
    for (const skillDir of pluginSkillDirs(installPath)) {
      const name = basename(skillDir);
      const row = base(name, skillDir, 'plugin', `/${pluginName}:${name}`);
      row.plugin = { ...pluginMeta, skillPath: relative(installPath, skillDir) };
      row.managedBy = 'plugin';
      row.canUninstall = false;
      row.hint = `managed by plugin ${id} — \`claude plugin update ${id}\` or /plugin`;
      out.push(row);
    }
  }
  return out;
}

function pluginSkillDirs(installPath: string): string[] {
  let manifest: any = {};
  try {
    manifest = JSON.parse(readFileSync(join(installPath, '.claude-plugin', 'plugin.json'), 'utf8'));
  } catch {}
  const skills = manifest.skills;
  const dirs: string[] = [];
  if (Array.isArray(skills)) {
    for (const p of skills) {
      const d = resolve(installPath, String(p));
      if (existsSync(join(d, 'SKILL.md'))) dirs.push(d);
    }
  } else {
    const root = resolve(installPath, typeof skills === 'string' ? skills : 'skills');
    if (existsSync(root)) {
      for (const name of safeReaddir(root)) {
        const d = join(root, name);
        if (existsSync(join(d, 'SKILL.md'))) dirs.push(d);
      }
    }
  }
  return dirs.sort();
}

// ---------- project ----------

export function scanProject(repoPath: string): InstalledSkill[] {
  const root = join(repoPath, '.claude', 'skills');
  if (!existsSync(root)) return [];
  const out: InstalledSkill[] = [];
  for (const name of safeReaddir(root)) {
    if (name.startsWith('.')) continue;
    const dir = join(root, name);
    try {
      if (!statSync(dir).isDirectory()) continue; // follows symlinks
    } catch {
      continue;
    }
    const row = base(name, dir, 'project', `/${name}`);
    row.managedBy = 'project';
    row.canUninstall = false;
    row.hint = `project skill in ${root} — edit it in the repository`;
    try {
      const st = lstatSync(dir);
      if (st.isSymbolicLink()) row.symlink = { target: resolve(dirname(dir), readlinkSync(dir)), broken: false };
    } catch {}
    out.push(row);
  }
  return out;
}

function safeReaddir(dir: string): string[] {
  try {
    return readdirSync(dir).sort();
  } catch {
    return [];
  }
}

// ---------- duplicates ----------

export function markDuplicates(rows: InstalledSkill[]): void {
  const byName = new Map<string, InstalledSkill[]>();
  for (const r of rows) byName.set(r.name, [...(byName.get(r.name) ?? []), r]);
  for (const group of byName.values()) {
    if (group.length < 2) continue;
    for (const r of group) r.duplicateOf = group.filter((x) => x !== r).map((x) => x.invoke);
  }
}
