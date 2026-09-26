import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { catalogStatus, defaultEnvProbe, findEntry, loadCatalog, type EnvProbe, type WhichFn, defaultWhich } from './catalog.ts';
import { runDoctor } from './doctor.ts';
import { SkillsHints } from './hints.ts';
import { InstallError, installEntry, updateEntry } from './installer.ts';
import { skillsPaths, type SkillsPaths } from './paths.ts';
import { scanSkills } from './scanner.ts';
import { TrashError, listTrash, restoreSkill, trashSkill } from './trash.ts';
import { SkillsUpdateChecker, type UpdateCheckerOptions } from './updates.ts';
import { runSourceUpdate, spawnStreaming, type UpdaterContext } from './updaters.ts';
import type { Catalog, CatalogEntryStatus, DoctorCheck, DoctorReport, InstallResult, InstalledSkill, ScanResult, SessionView, SkillTier, SkillUpdateRun, SkillsOverview, SkillsUpdateReport, TrashEntry } from './types.ts';

export interface BundleResult {
  id: string;
  name: string;
  action: 'plugin' | 'updated' | 'adopted' | 'installed' | 'kept' | 'failed';
  detail: string;
}

export interface SkillsManagerOptions {
  claudeHome: string;
  dataDir: string;
  catalogPath: string;
  claudeBin?: string;
  which?: WhichFn;
  /** whether sessions spawned by this engine will see an env var (default: process.env) */
  envProbe?: EnvProbe;
  log?: (m: string) => void;
  /** hints are disabled when user settings (and thus user skills) are not loaded */
  hintsEnabled?: () => boolean;
  /** which prompt section roles get (default mattpocock) */
  workflowProfile?: () => 'mattpocock' | 'plain';
  /** chosen option per mutually exclusive pack, e.g. { design: 'ui-ux-pro-max' } */
  packs?: () => Record<string, string | undefined>;
  /** receives every updater run (the engine appends it as a `skills.update_run` event) */
  onRun?: (run: SkillUpdateRun) => void;
  updates?: UpdateCheckerOptions;
  updater?: Pick<UpdaterContext, 'spawn' | 'npxBin' | 'timeoutMs'>;
}

export class UpdateBusy extends Error {
  constructor() {
    super('another skills update is still running');
  }
}

export class UninstallRefused extends Error {
  constructor(
    message: string,
    public readonly reason: 'managed-by-gstack' | 'managed-needs-force' | 'not-user-scope' | 'not-found',
  ) {
    super(message);
  }
}

/** Facade over scanner / catalog / installer / trash / doctor. Mutations are serialized. */
export class SkillsManager {
  readonly paths: SkillsPaths;
  readonly hints: SkillsHints;
  readonly checker: SkillsUpdateChecker;
  private catalogCache: Catalog | null = null;
  private catalogMtime = 0;
  private chain: Promise<unknown> = Promise.resolve();
  private lastView: SessionView | null = null;
  private updating: string | null = null;

  constructor(private opts: SkillsManagerOptions) {
    this.paths = skillsPaths(opts.claudeHome, opts.dataDir);
    this.hints = new SkillsHints(() => this.status(), { enabled: opts.hintsEnabled, profile: opts.workflowProfile, packs: opts.packs });
    this.checker = new SkillsUpdateChecker(this.paths, { log: opts.log, ...(opts.updates ?? {}) });
    try {
      if (existsSync(this.paths.sessionViewFile)) this.lastView = JSON.parse(readFileSync(this.paths.sessionViewFile, 'utf8'));
    } catch {}
  }

  catalog(): Catalog {
    // mtime-aware: editing catalog/skills.json takes effect without a restart (`bun --watch` only reloads imported code)
    let mtime = 0;
    try {
      mtime = statSync(this.opts.catalogPath).mtimeMs;
    } catch {}
    if (!this.catalogCache || mtime !== this.catalogMtime) {
      this.catalogCache = loadCatalog(this.opts.catalogPath);
      this.catalogMtime = mtime;
      this.hints.invalidate();
    }
    return this.catalogCache;
  }
  reloadCatalog(): Catalog {
    this.catalogCache = null;
    return this.catalog();
  }

  scan(repoPath?: string): ScanResult {
    return scanSkills(this.paths, { repoPath });
  }
  async status(repoPath?: string): Promise<CatalogEntryStatus[]> {
    return catalogStatus(this.catalog(), this.scan(repoPath), this.paths, this.opts.which ?? defaultWhich, this.opts.envProbe ?? defaultEnvProbe);
  }
  async overview(repoPath?: string): Promise<SkillsOverview> {
    const scan = this.scan(repoPath);
    const catalog = catalogStatus(this.catalog(), scan, this.paths, this.opts.which ?? defaultWhich, this.opts.envProbe ?? defaultEnvProbe);
    return { installed: scan.installed, catalog, duplicates: scan.duplicates, lastSession: this.lastView, scannedAt: scan.scannedAt, skillsDir: scan.skillsDir };
  }
  async doctor(extra: DoctorCheck[] = []): Promise<DoctorReport> {
    // offline: never runs git; shadow detection works from the filesystem alone
    const updates = await this.checker.report(this.scan(), this.catalog(), { offline: true }).catch(() => null);
    return runDoctor({ paths: this.paths, catalog: this.catalog(), statuses: await this.status(), claudeBin: this.opts.claudeBin, which: this.opts.which, updates, packs: this.opts.packs?.(), extra });
  }

  // ---------- sources & updates ----------

  /** Grouped-by-source view with update status. `refresh` fetches upstream; otherwise cached facts (15 min) are reused. */
  updates(opts: { refresh?: boolean; offline?: boolean; repoPath?: string } = {}): Promise<SkillsUpdateReport> {
    return this.checker.report(this.scan(opts.repoPath), this.catalog(), { refresh: opts.refresh, offline: opts.offline });
  }
  /** true while an upstream fetch/check is running */
  refreshing(): boolean {
    return this.checker.busy();
  }
  /** Last report without touching git (null before the first check). */
  cachedUpdates(): SkillsUpdateReport | null {
    return this.checker.cached();
  }
  /** Name of the source currently being updated, if any. */
  updatingSource(): string | null {
    return this.updating;
  }

  /** One-click update of a whole source (or some of its skills). Streams lines via onLine; one run at a time. */
  updateSource(sourceId: string, opts: { names?: string[]; onLine?: (l: string) => void } = {}): Promise<SkillUpdateRun> {
    if (this.updating) return Promise.reject(new UpdateBusy());
    this.updating = sourceId;
    return this.serial(async () => {
      try {
        const report = this.checker.cached() ?? (await this.checker.report(this.scan(), this.catalog(), { offline: true }));
        const source = report.sources.find((s) => s.id === sourceId);
        if (!source) throw new Error(`unknown skills source ${sourceId}`);
        const run = await runSourceUpdate(source, opts.names, { paths: this.paths, catalog: this.catalog(), claudeBin: this.opts.claudeBin, onLine: opts.onLine, log: this.opts.log, ...(this.opts.updater ?? {}) });
        this.opts.onRun?.(run);
        // re-check this source's facts so the page reflects the new state
        await this.checker.report(this.scan(), this.catalog(), { refresh: run.changed.length > 0 }).catch(() => {});
        return run;
      } finally {
        this.updating = null;
      }
    });
  }

  /**
   * Make a bundle (e.g. "mattpocock") fully available: entries satisfied via a plugin are left alone,
   * foundry-managed ones are refreshed, loose older copies are adopted, missing ones installed.
   */
  installBundle(bundle: string, onLine?: (l: string) => void): Promise<{ results: BundleResult[] }> {
    return this.serial(() => this.installEntries(bundle, (e) => e.bundle === bundle, onLine));
  }

  /** Install every member of one option of a mutually exclusive pack (e.g. the chosen design pack). */
  installPack(pack: string, option: string, onLine?: (l: string) => void): Promise<{ results: BundleResult[] }> {
    return this.serial(() => this.installEntries(`pack:${pack}:${option}`, (e) => e.pack === pack && e.packOption === option, onLine));
  }

  private async installEntries(label: string, pick: (e: CatalogEntryStatus['entry']) => boolean, onLine?: (l: string) => void): Promise<{ results: BundleResult[] }> {
    {
      const results: BundleResult[] = [];
      const statuses = await this.status();
      const ictx = { paths: this.paths, log: this.opts.log, claudeBin: this.opts.claudeBin, spawn: this.opts.updater?.spawn ?? spawnStreaming, onLine };
      for (const s of statuses.filter((x) => pick(x.entry) && (x.entry.source.type === 'git' || x.entry.source.type === 'plugin'))) {
        try {
          if (s.entry.source.type === 'plugin') {
            if (s.status === 'installed-via-plugin') results.push({ id: s.entry.id, name: s.entry.name, action: 'plugin', detail: s.detail });
            else {
              const r = await installEntry(s.entry, ictx);
              results.push({ id: s.entry.id, name: s.entry.name, action: r.ok ? 'installed' : 'failed', detail: r.ok ? `plugin ${s.entry.source.plugin}@${s.entry.source.marketplaceId}` : (r.error ?? 'failed') });
            }
            continue;
          }
          if (s.status === 'installed-via-plugin') results.push({ id: s.entry.id, name: s.entry.name, action: 'plugin', detail: s.detail });
          else if (s.status === 'installed') {
            const u = await updateEntry(s.entry, { paths: this.paths, log: this.opts.log });
            results.push({ id: s.entry.id, name: s.entry.name, action: u.changed ? 'updated' : 'kept', detail: u.changed ? `${u.from?.slice(0, 7)} → ${u.to?.slice(0, 7)}` : `at ${u.to?.slice(0, 7)}` });
          } else if (s.status === 'installed-unmanaged') {
            const r = await installEntry(s.entry, { paths: this.paths, log: this.opts.log }, { force: true, refresh: true });
            results.push({ id: s.entry.id, name: s.entry.name, action: 'adopted', detail: `loose copy replaced @ ${r.commit?.slice(0, 7)} (old copy in trash)` });
          } else {
            const r = await installEntry(s.entry, { paths: this.paths, log: this.opts.log }, { refresh: true });
            results.push({ id: s.entry.id, name: s.entry.name, action: r.ok ? 'installed' : 'failed', detail: r.ok ? `@ ${r.commit?.slice(0, 7)}` : (r.error ?? 'failed') });
          }
        } catch (e) {
          results.push({ id: s.entry.id, name: s.entry.name, action: 'failed', detail: String((e as Error).message ?? e) });
        }
      }
      this.opts.onRun?.({ sourceId: `bundle:${label}`, updater: 'foundry', command: ['foundry', 'install-bundle', label], cwd: this.paths.skillsDir, exitCode: results.some((r) => r.action === 'failed') ? 1 : 0, durationMs: 0, outputTail: results.map((r) => `${r.action.padEnd(9)} ${r.name}: ${r.detail}`).join('\n'), changed: results.filter((r) => r.action === 'updated' || r.action === 'adopted' || r.action === 'installed').map((r) => ({ name: r.name, from: null, to: null })), error: null, at: new Date().toISOString() });
      return { results };
    }
  }

  /** Replace loose copies that match catalog entries with foundry-managed installs (old copies → trash). */
  adopt(names: string[], onLine?: (l: string) => void): Promise<SkillUpdateRun[]> {
    return this.serial(async () => {
      const report = await this.checker.report(this.scan(), this.catalog(), { offline: true });
      const runs: SkillUpdateRun[] = [];
      for (const source of report.sources.filter((s) => s.manager === 'hand' && s.skills.some((k) => names.includes(k.name) && k.catalogId))) {
        const run = await runSourceUpdate({ ...source, updater: { kind: 'adopt', command: null, hint: null } }, names, { paths: this.paths, catalog: this.catalog(), claudeBin: this.opts.claudeBin, onLine, log: this.opts.log });
        this.opts.onRun?.(run);
        runs.push(run);
      }
      await this.checker.report(this.scan(), this.catalog(), {}).catch(() => {});
      return runs;
    });
  }

  /** Trash user-level copies that hide a newer plugin skill of the same name. */
  cleanupShadows(names: string[]): Promise<{ trashed: TrashEntry[]; skipped: { name: string; reason: string }[] }> {
    return this.serial(async () => {
      const scan = this.scan();
      const trashed: TrashEntry[] = [];
      const skipped: { name: string; reason: string }[] = [];
      for (const name of names) {
        const row = scan.installed.find((r) => r.scope === 'user' && r.name === name);
        const plugin = scan.installed.find((r) => r.scope === 'plugin' && r.name === name);
        if (!row) skipped.push({ name, reason: 'not a user-level skill' });
        else if (!plugin) skipped.push({ name, reason: 'no plugin skill with this name — nothing is shadowed' });
        else if (row.managedBy === 'gstack' || row.managedBy === 'gstack-copy') skipped.push({ name, reason: 'managed by gstack' });
        else trashed.push(trashSkill(name, this.paths, `shadowed ${plugin.invoke} (plugin copy is newer)`));
      }
      if (trashed.length) this.opts.onRun?.({ sourceId: 'shadows', updater: 'none', command: ['foundry', 'cleanup-shadows', ...trashed.map((t) => t.name)], cwd: this.paths.skillsDir, exitCode: 0, durationMs: 0, outputTail: trashed.map((t) => `trashed ${t.name} → ${t.path}`).join('\n'), changed: [], error: null, at: new Date().toISOString() });
      await this.checker.report(this.scan(), this.catalog(), { offline: true }).catch(() => {});
      return { trashed, skipped };
    });
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.chain.then(fn, fn);
    this.chain = p.catch(() => {});
    return p.finally(() => this.hints.invalidate());
  }

  install(idOrName: string, opts: { force?: boolean; onLine?: (l: string) => void } = {}): Promise<InstallResult> {
    return this.serial(async () => {
      const entry = findEntry(this.catalog(), idOrName);
      if (!entry) throw new InstallError(`${idOrName} is not in the catalog`, 'not-found');
      return installEntry(entry, { paths: this.paths, log: this.opts.log, claudeBin: this.opts.claudeBin, spawn: this.opts.updater?.spawn ?? spawnStreaming, onLine: opts.onLine }, opts);
    });
  }

  /** Install every missing entry of the tiers; `onLine` gets one line per entry (and the plugin CLI's output). */
  installTier(tiers: SkillTier[], onLine?: (l: string) => void): Promise<{ results: (InstallResult & { conflict?: boolean })[] }> {
    return this.serial(async () => {
      const results: (InstallResult & { conflict?: boolean })[] = [];
      const statuses = await this.status();
      for (const s of statuses) {
        if (!tiers.includes(s.entry.tier)) continue;
        if (s.status === 'installed' || s.status === 'installed-via-plugin' || s.status === 'installed-unmanaged') {
          onLine?.(`· ${s.entry.name}: already installed`);
          results.push({ ok: true, id: s.entry.id, name: s.entry.name, path: null, commit: s.commit, manual: null, error: null });
          continue;
        }
        onLine?.(`installing ${s.entry.name}…`);
        try {
          const r = await installEntry(s.entry, { paths: this.paths, log: this.opts.log, onLine });
          onLine?.(r.ok ? `✔ ${r.name}${r.commit ? ` @ ${r.commit.slice(0, 7)}` : ''}` : r.manual ? `→ ${r.name}: run this yourself: ${r.manual.command}` : `✘ ${r.name}: ${r.error}`);
          results.push(r);
        } catch (err) {
          onLine?.(`✘ ${s.entry.name}: ${String((err as Error).message ?? err)}`);
          results.push({ ok: false, id: s.entry.id, name: s.entry.name, path: null, commit: null, manual: null, error: String((err as Error).message ?? err), conflict: err instanceof InstallError && err.code === 'conflict' });
        }
      }
      return { results };
    });
  }

  uninstall(name: string, opts: { force?: boolean } = {}): Promise<{ trash: TrashEntry; note: string | null }> {
    return this.serial(async () => {
      const row = this.scan().installed.find((r) => r.name === name && r.scope === 'user');
      if (!row) throw new UninstallRefused(`${name} is not a user-level skill`, this.scan().installed.some((r) => r.name === name) ? 'not-user-scope' : 'not-found');
      if (row.managedBy === 'gstack') throw new UninstallRefused('gstack is a git clone that owns hooks in settings.json; remove it with its own tooling', 'managed-by-gstack');
      if (row.managedBy && row.managedBy !== 'foundry' && !opts.force) throw new UninstallRefused(`${name} is managed by ${row.managedBy}: ${row.uninstallNote ?? 'pass force to remove anyway'}`, 'managed-needs-force');
      const trash = trashSkill(name, this.paths, `uninstalled via Foundry${row.managedBy ? ` (was managed by ${row.managedBy})` : ''}`);
      this.opts.log?.(`[skills] trashed ${name} → ${trash.path}`);
      return { trash, note: row.uninstallNote };
    });
  }

  /** Uninstall several user-level skills in one go (each to the trash); never throws per item. */
  uninstallMany(names: string[], opts: { force?: boolean } = {}): Promise<{ results: { name: string; ok: boolean; error: string | null; note: string | null }[] }> {
    return this.serial(async () => {
      const results: { name: string; ok: boolean; error: string | null; note: string | null }[] = [];
      for (const name of names) {
        const row = this.scan().installed.find((r) => r.name === name && r.scope === 'user');
        if (!row) {
          results.push({ name, ok: false, error: 'not a user-level skill', note: null });
          continue;
        }
        if (row.managedBy === 'gstack') {
          results.push({ name, ok: false, error: 'gstack is a git clone that owns hooks; remove it with its own tooling', note: null });
          continue;
        }
        if (row.managedBy && row.managedBy !== 'foundry' && !opts.force) {
          results.push({ name, ok: false, error: `managed by ${row.managedBy} (force required)`, note: row.uninstallNote });
          continue;
        }
        try {
          const t = trashSkill(name, this.paths, `uninstalled via Foundry (bulk)${row.managedBy ? ` (was managed by ${row.managedBy})` : ''}`);
          this.opts.log?.(`[skills] trashed ${name} → ${t.path}`);
          results.push({ name, ok: true, error: null, note: row.uninstallNote });
        } catch (e) {
          results.push({ name, ok: false, error: String((e as Error).message ?? e), note: null });
        }
      }
      await this.checker.report(this.scan(), this.catalog(), { offline: true }).catch(() => {});
      return { results };
    });
  }

  /** SKILL.md text + file listing of one installed skill (dir must come from the current scan — no arbitrary paths). */
  viewSkill(dir: string): { name: string; dir: string; invoke: string; skillMd: string | null; files: { path: string; size: number }[] } | null {
    const row = this.scan().installed.find((r) => r.dir === dir);
    if (!row) return null;
    const root = row.symlink && !row.symlink.broken ? row.symlink.target : row.dir;
    const files: { path: string; size: number }[] = [];
    const walk = (d: string, depth: number) => {
      if (depth > 4 || files.length > 200) return;
      let names: string[] = [];
      try {
        names = readdirSync(d);
      } catch {
        return;
      }
      for (const n of names.sort()) {
        if (n === '.git' || n === 'node_modules') continue;
        const p = join(d, n);
        try {
          const st = statSync(p);
          if (st.isDirectory()) walk(p, depth + 1);
          else files.push({ path: p.slice(root.length + 1), size: st.size });
        } catch {}
      }
    };
    walk(root, 0);
    let skillMd: string | null = null;
    try {
      skillMd = readFileSync(join(root, 'SKILL.md'), 'utf8').slice(0, 200_000);
    } catch {}
    return { name: row.name, dir: row.dir, invoke: row.invoke, skillMd, files };
  }

  restore(name: string, opts: { force?: boolean; trashPath?: string } = {}): Promise<{ path: string; entry: TrashEntry }> {
    return this.serial(async () => restoreSkill(name, this.paths, opts));
  }

  trash(): TrashEntry[] {
    return listTrash(this.paths);
  }

  update(name?: string): Promise<{ updated: { name: string; from: string | null; to: string | null }[]; unchanged: string[]; errors: { name: string; error: string }[] }> {
    return this.serial(async () => {
      const out = { updated: [] as { name: string; from: string | null; to: string | null }[], unchanged: [] as string[], errors: [] as { name: string; error: string }[] };
      const rows = this.scan().installed.filter((r) => r.managedBy === 'foundry' && r.marker && (!name || r.name === name));
      for (const r of rows) {
        const entry = findEntry(this.catalog(), r.marker!.catalogId);
        if (!entry) {
          out.errors.push({ name: r.name, error: `catalog entry ${r.marker!.catalogId} no longer exists` });
          continue;
        }
        try {
          const u = await updateEntry(entry, { paths: this.paths, log: this.opts.log });
          if (u.changed) out.updated.push({ name: u.name, from: u.from, to: u.to });
          else out.unchanged.push(u.name);
        } catch (err) {
          out.errors.push({ name: r.name, error: String((err as Error).message ?? err) });
        }
      }
      return out;
    });
  }

  /** Called with the raw `system/init` message of any session: what Claude actually loaded. */
  recordSessionView(raw: any): void {
    if (!raw || !Array.isArray(raw.skills)) return;
    this.lastView = { at: new Date().toISOString(), sessionId: raw.session_id ?? null, skills: raw.skills.map(String), slashCommands: Array.isArray(raw.slash_commands) ? raw.slash_commands.map(String) : [] };
    try {
      mkdirSync(dirname(this.paths.sessionViewFile), { recursive: true });
      writeFileSync(this.paths.sessionViewFile, JSON.stringify(this.lastView));
    } catch {}
  }
  lastSessionView(): SessionView | null {
    return this.lastView;
  }
}

export { InstallError, TrashError };
export type { InstalledSkill };
