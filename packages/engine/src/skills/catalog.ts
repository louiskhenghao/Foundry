import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SkillsPaths } from './paths.ts';
import { Catalog, type CatalogEntry, type CatalogEntryStatus, type ScanResult } from './types.ts';

export class CatalogError extends Error {}

export function loadCatalog(path: string): Catalog {
  if (!existsSync(path)) throw new CatalogError(`catalog not found: ${path}`);
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new CatalogError(`catalog is not valid JSON: ${String(err)}`);
  }
  const parsed = Catalog.safeParse(json);
  if (!parsed.success) throw new CatalogError(`catalog invalid: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  const ids = new Set<string>();
  for (const e of parsed.data.entries) {
    if (ids.has(e.id)) throw new CatalogError(`duplicate catalog id ${e.id}`);
    ids.add(e.id);
  }
  return parsed.data;
}

export function findEntry(catalog: Catalog, idOrName: string): CatalogEntry | null {
  return catalog.entries.find((e) => e.id === idOrName) ?? catalog.entries.find((e) => e.name === idOrName) ?? catalog.entries.find((e) => e.aliases.includes(idOrName)) ?? null;
}

/** Invoke string to use in prompts for an installed catalog entry: plugin copy first (it is the one that gets updated), then user dir. */
export function preferredInvoke(entry: CatalogEntry, scan: ScanResult): string | null {
  const plugin = scan.installed.find((r) => r.scope === 'plugin' && r.name === entry.name);
  const user = scan.installed.find((r) => r.scope === 'user' && r.name === entry.name && !r.symlink?.broken && !r.unparsable);
  return entry.invoke ?? plugin?.invoke ?? user?.invoke ?? null;
}

export type WhichFn = (bin: string) => string | null;
export const defaultWhich: WhichFn = (bin) => Bun.which(bin);

/** does a session spawned by this engine see this env var? (the engine may add settings-sourced vars on top of process.env) */
export type EnvProbe = (name: string) => boolean;
export const defaultEnvProbe: EnvProbe = (name) => !!process.env[name];

export function catalogStatus(catalog: Catalog, scan: ScanResult, paths: SkillsPaths, which: WhichFn = defaultWhich, envProbe: EnvProbe = defaultEnvProbe): CatalogEntryStatus[] {
  const withEnv = (s: Omit<CatalogEntryStatus, 'missingEnv'>): CatalogEntryStatus => ({ ...s, missingEnv: s.entry.requiresEnv.filter((n) => !envProbe(n)) });
  return catalog.entries.map((entry) => withEnv(statusOf(entry, scan, paths, which)));
}

function statusOf(entry: CatalogEntry, scan: ScanResult, paths: SkillsPaths, which: WhichFn): Omit<CatalogEntryStatus, 'missingEnv'> {
  {
    const user = scan.installed.find((r) => r.scope === 'user' && r.name === entry.name && !r.symlink?.broken);
    const plugin = scan.installed.find((r) => r.scope === 'plugin' && r.name === entry.name);
    const manual =
      entry.source.type === 'cli' || entry.source.type === 'manual'
        ? { command: entry.source.install, docs: entry.source.docs ?? null }
        : entry.source.type === 'plugin'
          ? { command: pluginInstallCommand(entry.source), docs: entry.source.docs ?? null }
          : null;
    // plugin-first: the plugin copy is the one `claude plugin update` keeps fresh; a loose user copy of the same name is usually older
    const installedInvoke = plugin?.invoke ?? user?.invoke ?? null;

    if (entry.source.type === 'cli') {
      const bin = which(entry.source.detect);
      // a command-line tool with no skill folder of its own is installed as soon as its binary is on PATH
      if (!entry.source.skill) return bin ? { entry, status: 'installed', installedInvoke: null, commit: null, detail: `${entry.source.detect} at ${bin}`, manual } : { entry, status: 'missing', installedInvoke: null, commit: null, detail: `${entry.source.detect} not installed`, manual };
      const skill = !!user || !!plugin;
      if (bin && skill) return { entry, status: 'installed', installedInvoke, commit: null, detail: `${entry.source.detect} at ${bin}; skill present`, manual };
      if (bin || skill) return { entry, status: 'partial', installedInvoke, commit: null, detail: bin ? `${entry.source.detect} found but skill dir missing` : `skill present but ${entry.source.detect} not on PATH`, manual };
      return { entry, status: 'missing', installedInvoke: null, commit: null, detail: `${entry.source.detect} not installed`, manual };
    }
    if (entry.source.type === 'manual') {
      const present = existsSync(join(paths.skillsDir, entry.source.detectDir));
      return { entry, status: present ? 'installed-unmanaged' : 'missing', installedInvoke: present ? (installedInvoke ?? `/${entry.name}`) : null, commit: null, detail: present ? `${entry.source.detectDir}/ present` : 'not installed', manual };
    }
    if (entry.source.type === 'plugin') {
      // the plugin is "installed" when any of its skills is on disk under the expected plugin id
      const viaPlugin = scan.installed.find((r) => r.scope === 'plugin' && r.plugin?.name === entry.source.type && false) ?? scan.installed.find((r) => r.scope === 'plugin' && (r.plugin?.id === `${(entry.source as { plugin: string }).plugin}@${(entry.source as { marketplaceId: string }).marketplaceId}` || r.plugin?.name === (entry.source as { plugin: string }).plugin));
      if (viaPlugin) return { entry, status: 'installed-via-plugin', installedInvoke: plugin?.invoke ?? viaPlugin.invoke, commit: viaPlugin.plugin?.gitCommitSha ?? null, detail: `plugin ${viaPlugin.plugin?.id}${viaPlugin.plugin?.version ? ` v${viaPlugin.plugin.version}` : ''}`, manual };
      if (user) return { entry, status: 'installed-unmanaged', installedInvoke, commit: null, detail: `present in ${paths.skillsDir} (${user.managedBy ?? 'hand-installed'})`, manual };
      return { entry, status: 'missing', installedInvoke: null, commit: null, detail: 'plugin not installed', manual };
    }
    if (user?.marker?.catalogId === entry.id) return { entry, status: 'installed', installedInvoke, commit: user.marker.commit, detail: `installed by Foundry from ${user.marker.repo}${user.marker.commit ? ' @ ' + user.marker.commit.slice(0, 7) : ''}`, manual: null };
    if (user) return { entry, status: 'installed-unmanaged', installedInvoke, commit: null, detail: `present in ${paths.skillsDir} (${user.managedBy ?? 'hand-installed'})`, manual: null };
    if (plugin) return { entry, status: 'installed-via-plugin', installedInvoke, commit: null, detail: `provided by plugin ${plugin.plugin?.id}`, manual: null };
    return { entry, status: 'missing', installedInvoke: null, commit: null, detail: 'not installed', manual: null };
  }
}

export const SATISFIED: CatalogEntryStatus['status'][] = ['installed', 'installed-unmanaged', 'installed-via-plugin'];

/** The binary of a catalog entry that is only a command-line tool (no skill to invoke), else null. */
export function cliOnly(entry: CatalogEntry): string | null {
  return entry.source.type === 'cli' && !entry.source.skill ? entry.source.detect : null;
}

/** How a session should be told to use an entry: invoke a skill, or run a command-line tool. */
export function useLabel(s: CatalogEntryStatus): string {
  const bin = cliOnly(s.entry);
  return bin ? `the \`${bin}\` command-line tool` : (s.entry.invoke ?? s.installedInvoke ?? `/${s.entry.name}`);
}

/** The two `claude plugin` commands that install a marketplace plugin (also what the human is told to run). */
export function pluginInstallCommand(src: Extract<CatalogEntry['source'], { type: 'plugin' }>): string {
  return `claude plugin marketplace add ${src.marketplace} && claude plugin install ${src.plugin}@${src.marketplaceId}`;
}
