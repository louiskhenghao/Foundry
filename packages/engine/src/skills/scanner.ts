import { existsSync, lstatSync, readFileSync, readdirSync, readlinkSync, realpathSync, statSync } from 'node:fs';
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
  const own = scanUserDir(paths);
  const shared = paths.provider === 'codex' ? sharedAgentSkills(paths, own) : [];
  const rows: InstalledSkill[] = [...own, ...shared, ...(paths.provider === 'codex' ? scanCodexPlugins(paths) : scanPlugins(paths))];
  if (opts.repoPath) rows.push(...scanProject(opts.repoPath, paths.provider === 'codex' ? '.agents' : '.claude'));
  markDuplicates(rows);
  return { installed: rows, duplicates: [...new Set(rows.filter((r) => r.duplicateOf.length).map((r) => r.name))].sort(), scannedAt: new Date().toISOString(), skillsDir: paths.skillsDir };
}

// ---------- Codex: the shared ~/.agents/skills folder ----------

/**
 * Skills in ~/.agents/skills that Codex loads besides its own. They can be uninstalled from the Codex side, except one
 * that Claude Code also uses through a link in its skills folder (the community `skills` CLI links installs into
 * ~/.claude/skills): removing it would break Claude Code's copy, so that one is left to the Claude side.
 */
function sharedAgentSkills(paths: SkillsPaths, own: InstalledSkill[]): InstalledSkill[] {
  const claudeUses = paths.claudeSkillsDir ? claudeLinksInto(paths.claudeSkillsDir, paths.agentsSkillsDir) : new Map<string, string>();
  return scanUserDir({ ...paths, skillsDir: paths.agentsSkillsDir })
    .filter((s) => !own.some((row) => row.name === s.name))
    .map((s) => {
      const via = claudeUses.get(realOr(s.dir));
      if (via) return { ...s, canUninstall: false, uninstallNote: `Claude Code uses it through ${via}. Uninstall it on the Claude Code side first, so Claude Code is not left with a broken link.` };
      if (!s.canUninstall || s.managedBy === 'gstack') return { ...s, canUninstall: false, uninstallNote: s.uninstallNote ?? s.hint ?? 'Managed by its own tooling; remove it there.' };
      return { ...s, uninstallNote: s.uninstallNote ?? `Shared with every agent that reads ${paths.agentsSkillsDir}; moved to the trash, where it can be restored.` };
    });
}

/** resolved skill folder in `agentsDir` → the entry of Claude's skills folder that reaches it (as a link, or via a linked SKILL.md) */
function claudeLinksInto(claudeDir: string, agentsDir: string): Map<string, string> {
  const out = new Map<string, string>();
  const agentsReal = realOr(agentsDir);
  for (const name of safeReaddir(claudeDir)) {
    const entry = join(claudeDir, name);
    for (const target of [realOr(entry), dirname(realOr(join(entry, 'SKILL.md')))]) {
      if (target.startsWith(agentsReal + '/')) {
        const skill = join(agentsReal, relative(agentsReal, target).split('/')[0]!);
        if (!out.has(skill)) out.set(skill, entry);
      }
    }
  }
  return out;
}

function realOr(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
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

// ---------- Codex plugins ----------

/** `[plugins."<name>@<marketplace>"]` tables of Codex's config.toml that are not switched off (`enabled = false`) */
export function codexEnabledPlugins(configToml: string): string[] {
  let text = '';
  try {
    text = readFileSync(configToml, 'utf8');
  } catch {
    return [];
  }
  const out: string[] = [];
  let current: string | null = null;
  let enabled = true;
  const flush = () => current && enabled && out.push(current);
  for (const line of text.split('\n')) {
    const table = /^\s*\[(.+)\]\s*$/.exec(line);
    if (table) {
      flush();
      current = /^plugins\."([^"]+@[^"]+)"$/.exec(table[1]!.trim())?.[1] ?? null;
      enabled = true;
      continue;
    }
    const on = /^\s*enabled\s*=\s*(true|false)\b/.exec(line);
    if (current && on) enabled = on[1] === 'true';
  }
  flush();
  return out;
}

/**
 * Skills of the plugins Codex has on: each enabled plugin's newest version folder in plugins/cache/<marketplace>/<name>/,
 * read through its manifest (Codex's own, or a Claude Code one, which Codex also installs). Codex updates and removes
 * them itself (`codex plugin`), so Foundry lists them but leaves them alone.
 */
export function scanCodexPlugins(paths: SkillsPaths): InstalledSkill[] {
  const out: InstalledSkill[] = [];
  for (const id of codexEnabledPlugins(join(paths.claudeHome, 'config.toml'))) {
    const [pluginName, marketplace] = [id.split('@')[0]!, id.split('@').slice(1).join('@')];
    const installPath = newestDir(join(paths.pluginsDir, 'cache', marketplace, pluginName));
    if (!installPath) continue;
    let repo: string | null = null;
    try {
      const src = String(JSON.parse(readFileSync(join(installPath, '.codex-marketplace-install.json'), 'utf8')).source ?? '');
      repo = src.replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '') || null;
    } catch {}
    const pluginMeta = { id, name: pluginName, version: basename(installPath), installPath, marketplace, marketplaceRepo: repo, marketplaceClone: null, gitCommitSha: null, installedAt: null, lastUpdated: null, skillPath: null as string | null };
    for (const skillDir of pluginSkillDirs(installPath)) {
      const name = basename(skillDir);
      const row = base(name, skillDir, 'plugin', `/${pluginName}:${name}`);
      row.plugin = { ...pluginMeta, skillPath: relative(installPath, skillDir) };
      row.managedBy = 'plugin';
      row.canUninstall = false;
      row.hint = `managed by Codex plugin ${id} — Extensions → Plugins, or \`codex plugin\``;
      out.push(row);
    }
  }
  return out;
}

/** the most recently written subfolder (a plugin's installed version), not the `latest` alias */
function newestDir(dir: string): string | null {
  const dirs = safeReaddir(dir)
    .filter((n) => n !== 'latest' && !n.startsWith('.'))
    .map((n) => join(dir, n))
    .filter((d) => {
      try {
        return statSync(d).isDirectory();
      } catch {
        return false;
      }
    });
  if (!dirs.length) return existsSync(join(dir, 'latest')) ? join(dir, 'latest') : null;
  return dirs.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]!;
}

function pluginSkillDirs(installPath: string): string[] {
  // Codex's manifest first, then Claude Code's: a plugin may ship either or both
  let manifest: any = {};
  for (const m of ['.codex-plugin', '.claude-plugin']) {
    try {
      manifest = JSON.parse(readFileSync(join(installPath, m, 'plugin.json'), 'utf8'));
      break;
    } catch {}
  }
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

export function scanProject(repoPath: string, agentDir = '.claude'): InstalledSkill[] {
  const root = join(repoPath, agentDir, 'skills');
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
