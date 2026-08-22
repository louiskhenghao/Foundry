/**
 * Update checker: groups installed skills by source, compares each installation with the upstream
 * repository (engine-private cache clone, deepened so per-path history exists) and reports
 * up-to-date / outdated / modified per skill and per source. Facts are persisted so the page loads instantly.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { exec as defaultExec } from '../git/git.ts';
import { CACHE_DEPTH, ensureCache } from './installer.ts';
import type { SkillsPaths } from './paths.ts';
import { readMarketplaces, type MarketplaceInfo } from './scanner.ts';
import { candidatesFor, dirFingerprint, localDirOf, pathInRepoOf, skillMdBlob, sourceOf, type Candidate, type SourceKey } from './sources.ts';
import type { Catalog, InstalledSkill, ScanResult, SkillSource, SkillSourceRow, SkillsUpdateReport, UpdaterKind } from './types.ts';

interface PathFact {
  commit: string;
  at: string;
  exact: boolean;
}
interface RepoFacts {
  head: string;
  headAt: string;
  checkedAt: string;
  paths: Record<string, PathFact>;
  error?: string;
}
interface Persisted {
  checkedAt: string | null;
  repos: Record<string, RepoFacts>;
  report: SkillsUpdateReport | null;
}

export interface UpdateCheckerOptions {
  exec?: typeof defaultExec;
  log?: (m: string) => void;
  ttlMs?: number;
  depth?: number;
  /** clone URL override per repo (tests use file://) */
  urlFor?: (repo: string) => string | undefined;
}

const BLOB_HISTORY = 80;

export class SkillsUpdateChecker {
  private persisted: Persisted;
  private exec: typeof defaultExec;
  private ttl: number;
  private inFlight: Promise<SkillsUpdateReport> | null = null;

  constructor(
    private paths: SkillsPaths,
    private opts: UpdateCheckerOptions = {},
  ) {
    this.exec = opts.exec ?? defaultExec;
    this.ttl = opts.ttlMs ?? 15 * 60_000;
    this.persisted = this.load();
  }

  private load(): Persisted {
    try {
      const j = JSON.parse(readFileSync(this.paths.updatesFile, 'utf8'));
      return { checkedAt: j.checkedAt ?? null, repos: j.repos ?? {}, report: j.report ?? null };
    } catch {
      return { checkedAt: null, repos: {}, report: null };
    }
  }
  private save(): void {
    try {
      mkdirSync(dirname(this.paths.updatesFile), { recursive: true });
      writeFileSync(this.paths.updatesFile, JSON.stringify(this.persisted));
    } catch {}
  }

  busy(): boolean {
    return this.inFlight !== null;
  }

  /** Last report without touching git (may be null or stale). */
  cached(): SkillsUpdateReport | null {
    if (!this.persisted.report) return null;
    return { ...this.persisted.report, stale: this.isStale() };
  }
  isStale(now = Date.now()): boolean {
    return !this.persisted.checkedAt || now - Date.parse(this.persisted.checkedAt) > this.ttl;
  }

  /**
   * Build the report. `refresh` forces git fetches; otherwise upstream facts are reused while fresh.
   * `offline` never runs git (doctor uses it).
   */
  report(scan: ScanResult, catalog: Catalog, o: { refresh?: boolean; offline?: boolean } = {}): Promise<SkillsUpdateReport> {
    // offline builds never wait behind a network refresh (the doctor and the first page load use them)
    if (o.offline) return this.build(scan, catalog, o);
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.build(scan, catalog, o).finally(() => (this.inFlight = null));
    return this.inFlight;
  }

  private async build(scan: ScanResult, catalog: Catalog, o: { refresh?: boolean; offline?: boolean }): Promise<SkillsUpdateReport> {
    const marketplaces = [...readMarketplaces(this.paths.marketplacesFile).values()];
    const now = new Date().toISOString();
    const needGit = !o.offline && (o.refresh || this.isStale());

    // 1. group rows by source; hand-installed rows are matched to a candidate source
    type Group = { key: SourceKey; rows: { row: InstalledSkill; pathInRepo: string | null; candidate: Candidate | null }[] };
    const groups = new Map<string, Group>();
    const add = (key: SourceKey, row: InstalledSkill, pathInRepo: string | null, candidate: Candidate | null) => {
      const g = groups.get(key.id) ?? { key, rows: [] };
      g.rows.push({ row, pathInRepo, candidate });
      groups.set(key.id, g);
    };
    for (const row of scan.installed) {
      const key = sourceOf(row, this.paths);
      if (key) {
        add(key, row, pathInRepoOf(row), null);
        continue;
      }
      const cands = candidatesFor(row.name, catalog, this.paths, marketplaces);
      if (!cands.length) {
        add({ id: 'unknown', kind: 'unknown', label: 'Hand-installed · origin unknown', manager: 'hand', repo: null, url: null, homepage: null }, row, null, null);
        continue;
      }
      // prefer a candidate whose bytes we can actually compare
      const c = cands.find((x) => x.dir) ?? cands[0]!;
      add(c.source, row, c.pathInRepo, c);
    }

    // 2. upstream facts per GitHub repo
    const repos = [...new Set([...groups.values()].map((g) => g.key.repo).filter((r): r is string => !!r))];
    if (needGit) {
      for (const repo of repos) {
        const urlOverride = this.opts.urlFor?.(repo) ?? [...groups.values()].find((g) => g.key.repo === repo && g.key.url?.startsWith('file://'))?.key.url ?? undefined;
        try {
          await ensureCache({ type: 'git', repo, url: urlOverride }, { paths: this.paths, log: this.opts.log }, true, { depth: this.opts.depth ?? CACHE_DEPTH });
          this.persisted.repos[repo] = await this.repoFacts(repo, now);
        } catch (e) {
          this.persisted.repos[repo] = { ...(this.persisted.repos[repo] ?? { head: '', headAt: '', paths: {} }), checkedAt: now, error: String((e as Error).message ?? e).slice(0, 300) };
        }
      }
      this.persisted.checkedAt = now;
    }

    // 3. per-row status
    const sources: SkillSource[] = [];
    const shadowed: string[] = [];
    for (const g of groups.values()) {
      const facts = g.key.repo ? this.persisted.repos[g.key.repo] : undefined;
      const cache = g.key.repo ? this.cacheDir(g.key.repo) : null;
      const rows: SkillSourceRow[] = [];
      // local git commands on an existing clone are fine offline; only fetching needs the network
      const gitOk = !!cache && existsSync(join(cache, '.git'));
      for (const { row, pathInRepo, candidate } of g.rows) {
        rows.push(await this.rowStatus(g.key, row, pathInRepo, candidate, facts, cache, catalog, gitOk));
      }
      for (const r of rows) if (r.shadowedBy && (r.status === 'outdated' || r.status === 'modified' || r.match?.relation === 'older')) shadowed.push(r.name);
      const local = this.localOf(g.key, g.rows.map((x) => x.row));
      const updater = updaterFor(g.key, rows);
      const determinable = rows.filter((r) => r.status !== 'unknown' && r.status !== 'broken');
      sources.push({
        id: g.key.id,
        kind: g.key.kind,
        label: g.key.label,
        manager: g.key.manager,
        repo: g.key.repo,
        homepage: g.key.homepage,
        local,
        upstream: facts?.head ? { commit: facts.head, committedAt: facts.headAt, checkedAt: facts.checkedAt } : null,
        updateAvailable: determinable.length ? rows.some((r) => r.status === 'outdated') : null,
        updater,
        error: facts?.error ?? null,
        skills: rows.sort((a, b) => a.name.localeCompare(b.name)),
      });
    }
    sources.sort((a, b) => Number(b.updateAvailable === true) - Number(a.updateAvailable === true) || b.skills.length - a.skills.length || a.label.localeCompare(b.label));
    const report: SkillsUpdateReport = { checkedAt: this.persisted.checkedAt ?? now, stale: this.isStale(), sources, shadowed: [...new Set(shadowed)].sort() };
    this.persisted.report = report;
    this.save();
    return report;
  }

  private cacheDir(repo: string): string {
    const [owner, name] = repo.split('/') as [string, string];
    return join(this.paths.cacheDir, owner, name);
  }

  private async repoFacts(repo: string, now: string): Promise<RepoFacts> {
    const dir = this.cacheDir(repo);
    const head = await this.exec(['git', 'log', '-1', '--format=%H%x09%cI'], dir, { timeoutMs: 30_000 });
    const [sha = '', at = ''] = head.stdout.trim().split('\t');
    const prev = this.persisted.repos[repo];
    // keep previously computed path facts only if HEAD is unchanged
    return { head: sha, headAt: at, checkedAt: now, paths: prev && prev.head === sha ? prev.paths : {} };
  }

  private async pathFact(repo: string, pathInRepo: string): Promise<PathFact | null> {
    const facts = this.persisted.repos[repo];
    if (!facts?.head) return null;
    if (facts.paths[pathInRepo]) return facts.paths[pathInRepo]!;
    const dir = this.cacheDir(repo);
    const r = await this.exec(['git', 'log', '-1', '--format=%H%x09%cI', '--', pathInRepo], dir, { timeoutMs: 30_000 });
    const [commit = '', at = ''] = r.stdout.trim().split('\t');
    if (!commit) return null;
    const total = Number((await this.exec(['git', 'rev-list', '--count', 'HEAD'], dir, { timeoutMs: 30_000 })).stdout.trim()) || 0;
    const forPath = Number((await this.exec(['git', 'rev-list', '--count', 'HEAD', '--', pathInRepo], dir, { timeoutMs: 30_000 })).stdout.trim()) || 0;
    // if the path changed in every commit we can see, the history is probably cut by the shallow boundary
    const fact: PathFact = { commit, at, exact: forPath < total };
    facts.paths[pathInRepo] = fact;
    return fact;
  }

  /** Does the local SKILL.md match any historical version of the upstream path? Returns that commit. */
  private async olderCommit(repo: string, pathInRepo: string, localBlob: string): Promise<{ commit: string; at: string } | null> {
    const dir = this.cacheDir(repo);
    const log = await this.exec(['git', 'log', `-n`, String(BLOB_HISTORY), '--format=%H%x09%cI', '--', pathInRepo], dir, { timeoutMs: 30_000 });
    const commits = log.stdout.trim().split('\n').filter(Boolean).map((l) => l.split('\t') as [string, string]);
    if (!commits.length) return null;
    const r = await this.exec(['git', 'rev-parse', '-q', ...commits.map(([c]) => `${c}:${pathInRepo}/SKILL.md`)], dir, { timeoutMs: 30_000 });
    const blobs = r.stdout.trim().split('\n');
    const idx = blobs.findIndex((b) => b === localBlob);
    if (idx < 0) return null;
    const [commit, at] = commits[idx]!;
    return { commit, at };
  }

  private async rowStatus(key: SourceKey, row: InstalledSkill, pathInRepo: string | null, candidate: Candidate | null, facts: RepoFacts | undefined, cache: string | null, catalog: Catalog, gitOk: boolean): Promise<SkillSourceRow> {
    const catalogId = candidate?.catalogEntry?.id ?? row.marker?.catalogId ?? catalog.entries.find((e) => e.name === row.name || e.aliases.includes(row.name))?.id ?? null;
    const shadowedBy = row.scope === 'user' ? (row.duplicateOf.find((i) => i.includes(':')) ?? null) : null;
    const local = {
      commit: row.marker?.commit ?? row.plugin?.gitCommitSha ?? null,
      installedAt: row.marker?.installedAt ?? row.lock?.installedAt ?? row.plugin?.installedAt ?? null,
      updatedAt: row.marker?.updatedAt ?? row.lock?.updatedAt ?? row.plugin?.lastUpdated ?? null,
      version: row.version ?? row.plugin?.version ?? null,
    };
    const base: SkillSourceRow = { name: row.name, invoke: row.invoke, description: row.description, dir: row.dir, scope: row.scope, managedBy: row.managedBy, status: 'unknown', local, pathInRepo, upstream: null, match: null, shadowedBy, duplicateOf: row.duplicateOf, catalogId, actions: [] };
    if (row.symlink?.broken || row.unparsable) return { ...base, status: 'broken', actions: row.canUninstall ? ['uninstall'] : [] };

    // upstream dir to compare against: cache clone path, else the candidate's own dir (marketplace clone / ~/.agents)
    let upstreamDir: string | null = null;
    let rel = pathInRepo;
    if (cache && existsSync(cache)) {
      if (rel && existsSync(join(cache, rel, 'SKILL.md'))) upstreamDir = join(cache, rel);
      else {
        const hit = [...new Bun.Glob(`**/${row.name}/SKILL.md`).scanSync({ cwd: cache, dot: false })].filter((h) => !h.includes('node_modules/')).sort((a, b) => a.length - b.length)[0];
        if (hit) {
          upstreamDir = join(cache, hit.slice(0, -'/SKILL.md'.length));
          rel = hit.slice(0, -'/SKILL.md'.length);
        }
      }
    }
    if (!upstreamDir && candidate?.dir) upstreamDir = candidate.dir;
    if (row.managedBy === 'gstack') upstreamDir = cache; // whole clone vs whole clone

    const fact = key.repo && rel && gitOk && facts?.head ? await this.pathFact(key.repo, rel).catch(() => null) : (key.repo && rel && facts?.paths[rel]) || null;
    const upstream = fact ? { commit: fact.commit, committedAt: fact.at, exact: fact.exact } : null;
    const out: SkillSourceRow = { ...base, pathInRepo: rel, upstream };

    const localDir = localDirOf(row);
    const localFp = dirFingerprint(localDir);
    const upFp = upstreamDir ? dirFingerprint(upstreamDir) : null;

    if (localFp && upFp && localFp === upFp) {
      out.status = 'up-to-date';
      if (candidate) out.match = { relation: 'identical', olderCommit: null, olderAt: null };
    } else if (upFp) {
      const blob = skillMdBlob(localDir);
      const older = key.repo && rel && blob && gitOk && facts?.head ? await this.olderCommit(key.repo, rel, blob).catch(() => null) : null;
      if (older) {
        out.status = 'outdated';
        out.match = { relation: 'older', olderCommit: older.commit, olderAt: older.at };
      } else if (upstream && local.installedAt && Date.parse(upstream.committedAt) > Date.parse(local.updatedAt ?? local.installedAt)) {
        out.status = 'outdated';
        if (candidate) out.match = { relation: 'differs', olderCommit: null, olderAt: null };
      } else if (!upstream && !candidate) {
        out.status = 'unknown';
      } else {
        out.status = 'modified';
        if (candidate) out.match = { relation: 'differs', olderCommit: null, olderAt: null };
      }
    } else {
      out.status = 'unknown';
    }

    // actions
    const actions: SkillSourceRow['actions'] = [];
    if (out.status === 'outdated' && (key.manager === 'ai-engine' || key.manager === 'agents-cli' || key.manager === 'plugin')) actions.push('update');
    if (key.manager === 'hand' && catalogId && out.status !== 'up-to-date') actions.push('adopt');
    if (shadowedBy && (out.status === 'outdated' || out.status === 'modified' || out.match?.relation === 'older')) actions.push('trash-shadow');
    if (row.canUninstall) actions.push('uninstall');
    out.actions = actions;
    return out;
  }

  private localOf(key: SourceKey, rows: InstalledSkill[]) {
    const first = rows[0];
    const dates = rows.map((r) => r.marker?.installedAt ?? r.lock?.installedAt ?? r.plugin?.installedAt ?? null).filter((d): d is string => !!d).sort();
    const updated = rows.map((r) => r.marker?.updatedAt ?? r.lock?.updatedAt ?? r.plugin?.lastUpdated ?? null).filter((d): d is string => !!d).sort();
    return {
      commit: first?.marker?.commit ?? first?.plugin?.gitCommitSha ?? null,
      version: key.manager === 'plugin' ? (first?.plugin?.version ?? null) : null,
      installedAt: dates[0] ?? null,
      updatedAt: updated.at(-1) ?? null,
    };
  }
}

function updaterFor(key: SourceKey, rows: SkillSourceRow[]): SkillSource['updater'] {
  const kind: UpdaterKind = key.manager === 'ai-engine' ? 'ai-engine' : key.manager === 'agents-cli' ? 'agents-cli' : key.manager === 'plugin' ? 'plugin' : key.manager === 'gstack' ? 'hint' : key.manager === 'hand' ? (rows.some((r) => r.catalogId) ? 'adopt' : 'none') : 'none';
  const pluginId = key.id.startsWith('plugin:') ? key.id.slice('plugin:'.length) : null;
  const mkt = pluginId?.includes('@') ? pluginId.split('@').slice(1).join('@') : null;
  switch (kind) {
    case 'agents-cli':
      return { kind, command: ['npx', '-y', 'skills@latest', 'update', '-g', '-y', '-a', 'claude-code'], hint: null };
    case 'plugin':
      return { kind, command: ['claude', 'plugin', 'marketplace', 'update', mkt ?? '', '&&', 'claude', 'plugin', 'update', pluginId ?? '', '-y'], hint: 'Restart Claude sessions afterwards; the engine picks the new version up on its next session.' };
    case 'ai-engine':
      return { kind, command: null, hint: null };
    case 'adopt':
      return { kind, command: null, hint: 'Replace these loose copies with ai-engine-managed installs from the catalog (old copies go to the trash).' };
    case 'hint':
      return { kind, command: null, hint: 'gstack updates itself: run /gstack-upgrade inside Claude Code.' };
    default:
      return { kind: 'none', command: null, hint: null };
  }
}

export type { MarketplaceInfo };
