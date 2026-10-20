import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve, sep } from 'node:path';
import { exec } from '../git/git.ts';
import { pluginInstallCommand, type PluginSource } from './catalog.ts';
import { LEGACY_MARKER_FILE, MARKER_FILE, type SkillsPaths } from './paths.ts';
import { trashSkill } from './trash.ts';
import { installSuite } from './suites.ts';
import { FoundryMarker, type CatalogEntry, type InstallResult } from './types.ts';
import { InstallError, type InstallContext } from './install-types.ts';

export { InstallError };
export type { InstallContext };

const cloneUrl = (src: Extract<CatalogEntry['source'], { type: 'git' }>) => src.url ?? `https://github.com/${src.repo}.git`;

/** Default history depth of a cache clone: enough for per-skill "last changed" dates and old-copy matching. */
export const CACHE_DEPTH = 100;

/**
 * Clone (or refresh) the source repo into the cache; returns the checkout dir.
 * The cache is the engine's private read-only copy: on refresh it is fetched (deepened) and hard-reset to the remote head.
 */
export async function ensureCache(src: Extract<CatalogEntry['source'], { type: 'git' }>, ctx: InstallContext, refresh = false, opts: { depth?: number } = {}): Promise<string> {
  const [owner, name] = src.repo.split('/') as [string, string];
  const dir = join(ctx.paths.cacheDir, owner, name);
  const depth = opts.depth ?? CACHE_DEPTH;
  if (existsSync(join(dir, '.git'))) {
    if (refresh) {
      const f = await exec(['git', 'fetch', '-q', `--deepen=${depth}`, 'origin'], dir, { timeoutMs: 120_000 });
      if (f.code !== 0) ctx.log?.(`[skills] git fetch failed for ${src.repo}: ${f.stderr.slice(-300)}`);
      else {
        // a ref that is a tag (a pinned release, v1.3.1) is fetched by name and reset to as such; a branch as origin/<ref>
        if (src.ref) await exec(['git', 'fetch', '-q', 'origin', 'tag', src.ref], dir, { timeoutMs: 60_000 });
        const tag = src.ref && (await exec(['git', 'rev-parse', '-q', '--verify', `refs/tags/${src.ref}^{commit}`], dir, { timeoutMs: 10_000 })).code === 0;
        const head = src.ref ? (tag ? `refs/tags/${src.ref}` : `origin/${src.ref}`) : 'origin/HEAD';
        const r = await exec(['git', 'reset', '-q', '--hard', head], dir, { timeoutMs: 60_000 });
        if (r.code !== 0) {
          // origin/HEAD may be unset on older clones: fall back to the fetched tip
          await exec(['git', 'reset', '-q', '--hard', 'FETCH_HEAD'], dir, { timeoutMs: 60_000 });
        }
      }
    }
    return dir;
  }
  mkdirSync(join(ctx.paths.cacheDir, owner), { recursive: true });
  const args = ['git', 'clone', '-q', '--depth', String(depth), ...(src.ref ? ['--branch', src.ref] : []), cloneUrl(src), dir];
  const r = await exec(args, ctx.paths.cacheDir, { timeoutMs: 180_000 });
  if (r.code !== 0) {
    rmSync(dir, { recursive: true, force: true });
    throw new InstallError(`git clone failed for ${src.repo}: ${r.stderr.trim().slice(-400)}`, 'git');
  }
  return dir;
}

/** Honor an explicit native path; only path-less entries may discover `**\/<name>/SKILL.md`. */
export function locateSkillDir(cacheDir: string, entry: CatalogEntry): string {
  if (entry.source.type !== 'git') throw new InstallError('not a git entry', 'manual');
  if (entry.source.path) {
    const d = join(cacheDir, entry.source.path);
    if (existsSync(join(d, 'SKILL.md'))) return d;
    throw new InstallError(`SKILL.md for ${entry.name} not found in ${entry.source.repo} (path ${entry.source.path})`, 'not-found');
  }
  const glob = new Bun.Glob(`**/${entry.name}/SKILL.md`);
  const hits = [...glob.scanSync({ cwd: cacheDir, dot: false })].filter((h) => !h.includes('node_modules/')).sort((a, b) => a.length - b.length);
  if (hits[0]) return join(cacheDir, hits[0].slice(0, -'/SKILL.md'.length));
  if (existsSync(join(cacheDir, 'SKILL.md')) && basename(cacheDir) === entry.name) return cacheDir;
  throw new InstallError(`SKILL.md for ${entry.name} not found in ${entry.source.repo}${entry.source.path ? ` (path ${entry.source.path})` : ''}`, 'not-found');
}

/**
 * Install a marketplace plugin with the backend's own CLI (non-interactive): Claude Code's `claude plugin`, or Codex's
 * `codex plugin`. The marketplace is added first (an "already exists" failure is fine), then the plugin. Skills land
 * wherever the CLI keeps plugins; the scanner picks them up as `installed-via-plugin`.
 */
export async function installPlugin(entry: CatalogEntry, ctx: InstallContext): Promise<InstallResult> {
  if (entry.source.type !== 'plugin') throw new InstallError('not a plugin entry', 'manual');
  const src = entry.source;
  const codex = ctx.paths.provider === 'codex';
  const name = codex ? 'codex' : 'claude';
  const manual = { command: pluginInstallCommand(src, ctx.paths.provider), docs: src.docs ?? null };
  const bin = (codex ? ctx.codexBin : ctx.claudeBin) ?? Bun.which(name);
  if (!bin || !ctx.spawn) return { ok: false, id: entry.id, name: entry.name, path: null, commit: null, manual, error: bin ? 'no spawner configured' : `${name} CLI not found` };
  const onLine = ctx.onLine ?? (() => {});
  const add = await ctx.spawn([bin, 'plugin', 'marketplace', 'add', ...(codex ? [src.marketplace, ...(src.ref ? ['--ref', src.ref] : [])] : [src.ref ? `${src.marketplace}#${src.ref}` : src.marketplace])], ctx.paths.claudeHome, onLine, { timeoutMs: 180_000 });
  if (add.code !== 0 && !/already|exists/i.test(add.tail)) {
    return { ok: false, id: entry.id, name: entry.name, path: null, commit: null, manual, error: `${name} plugin marketplace add failed: ${add.tail.slice(-300)}` };
  }
  const inst = await ctx.spawn([bin, 'plugin', codex ? 'add' : 'install', `${src.plugin}@${src.marketplaceId}`], ctx.paths.claudeHome, onLine, { timeoutMs: 300_000 });
  if (inst.code !== 0 && !/already installed/i.test(inst.tail)) {
    return { ok: false, id: entry.id, name: entry.name, path: null, commit: null, manual, error: `${name} plugin ${codex ? 'add' : 'install'} failed: ${inst.tail.slice(-300)}` };
  }
  ctx.log?.(`[skills] installed plugin ${src.plugin}@${src.marketplaceId}`);
  return { ok: true, id: entry.id, name: entry.name, path: null, commit: null, manual: null, error: null };
}

/** an MCP server as a plugin's own config starts it */
export interface PluginMcpServer {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

/** the server's arguments up to its `mcp` subcommand (else all but the last): the base of its other commands, a warm-up or the viewer */
export const serverBaseArgs = (args: string[]): string[] => {
  const at = args.lastIndexOf('mcp');
  return at >= 0 ? args.slice(0, at) : args.slice(0, -1);
};

/** an MCP server as the plugin's own config starts it (its manifest's `mcpServers` holds the map or names a file inside the plugin); null when it ships none by that name */
export function readPluginMcpServer(installPath: string, provider: 'claude' | 'codex' | undefined, name: string): PluginMcpServer | null {
  try {
    const manifest = JSON.parse(readFileSync(join(installPath, provider === 'codex' ? '.codex-plugin' : '.claude-plugin', 'plugin.json'), 'utf8')) as { mcpServers?: string | Record<string, unknown> };
    let servers: Record<string, unknown> | undefined;
    if (typeof manifest.mcpServers === 'string') {
      const file = resolve(installPath, manifest.mcpServers);
      // a plugin's config stays inside the plugin: a manifest pointing elsewhere is not followed
      if (!file.startsWith(resolve(installPath) + sep)) return null;
      servers = (JSON.parse(readFileSync(file, 'utf8')) as { mcpServers?: Record<string, unknown> }).mcpServers;
    } else servers = manifest.mcpServers;
    const server = (servers ?? {})[name] as { command?: string; args?: string[]; env?: Record<string, string> } | undefined;
    return server?.command ? { command: server.command, args: server.args ?? [], env: server.env } : null;
  } catch {
    return null;
  }
}

/** keys and tokens stay out of a plugin's warm-up: a `--version` run needs only the switches (CADGEN_*) */
const SECRET_ENV = /KEY|TOKEN|SECRET|PASSWORD/i;

/**
 * After a plugin install: run a shipped MCP server's own command once with `warmup.args` in place of its `mcp` subcommand,
 * so a runtime it downloads on first start (text-to-cad: Python and OpenCASCADE, hundreds of MB) arrives while the person
 * watches, not inside the first task's attempt. The command and its pinned version come from the plugin's MCP config.
 */
export async function warmupPlugin(src: PluginSource, installPath: string, ctx: InstallContext): Promise<{ ok: boolean; detail: string }> {
  const w = src.warmup;
  if (!w) return { ok: true, detail: 'nothing to warm up' };
  if (!ctx.spawn) return { ok: false, detail: 'no spawner configured' };
  try {
    const server = readPluginMcpServer(installPath, ctx.paths.provider, w.mcpServer);
    if (!server) return { ok: false, detail: `the plugin ships no MCP server named ${w.mcpServer}` };
    const argv = [server.command, ...serverBaseArgs(server.args), ...w.args];
    ctx.onLine?.(`${w.note}: ${argv.join(' ')}`);
    const env = { ...(server.env ?? {}), ...Object.fromEntries(Object.entries(ctx.env ?? {}).filter(([k]) => !SECRET_ENV.test(k))) };
    const r = await ctx.spawn(argv, installPath, ctx.onLine ?? (() => {}), { timeoutMs: 20 * 60_000, env });
    return r.code === 0 ? { ok: true, detail: 'runtime ready' } : { ok: false, detail: `exit ${r.code}: ${r.tail.slice(-200)}` };
  } catch (err) {
    return { ok: false, detail: String((err as Error).message ?? err) };
  }
}

export async function installEntry(entry: CatalogEntry, ctx: InstallContext, opts: { force?: boolean; refresh?: boolean } = {}): Promise<InstallResult> {
  if (entry.source.type === 'plugin') return installPlugin(entry, ctx);
  if (entry.source.type === 'suite') {
    // the whole suite installs once; every member entry reports the same copy (ADR-0049)
    const id = entry.source.suite;
    const suite = ctx.suites?.find((s) => s.id === id);
    if (!suite) throw new InstallError(`${id} is not a workflow suite of this catalog`, 'not-found');
    const r = await installSuite(suite, ctx, { refresh: opts.refresh });
    return { ok: true, id: entry.id, name: entry.name, path: r.path, commit: r.commit, manual: null, error: null };
  }
  if (entry.source.type !== 'git') {
    return { ok: false, id: entry.id, name: entry.name, path: null, commit: null, manual: { command: entry.source.install, docs: entry.source.docs ?? null }, error: 'manual installation required' };
  }
  const dest = join(ctx.paths.skillsDir, entry.name);
  const existing = existsSync(dest) || isSymlink(dest);
  if (existing) {
    const marker = readMarker(dest);
    if (marker?.catalogId !== entry.id && !opts.force) {
      throw new InstallError(`${entry.name} already exists in ${ctx.paths.skillsDir} and was not installed by foundry`, 'conflict', { name: entry.name, path: dest, managed: marker ? 'foundry' : 'other' });
    }
    if (marker?.catalogId === entry.id && !opts.force && !opts.refresh) {
      return { ok: true, id: entry.id, name: entry.name, path: dest, commit: marker.commit, manual: null, error: null };
    }
  }
  const cache = await ensureCache(entry.source, ctx, opts.refresh ?? false);
  const srcDir = locateSkillDir(cache, entry);
  const commit = (await exec(['git', 'rev-parse', 'HEAD'], cache)).stdout.trim() || null;
  const prev = existing ? readMarker(dest) : null;
  if (existing) trashSkill(entry.name, ctx.paths, opts.force ? 'replaced by forced install' : 'replaced by update');
  mkdirSync(ctx.paths.skillsDir, { recursive: true });
  cpSync(srcDir, dest, { recursive: true, dereference: true });
  const marker: FoundryMarker = {
    catalogId: entry.id,
    repo: entry.source.repo,
    url: entry.source.url,
    ref: entry.source.ref ?? null,
    commit,
    path: relative(cache, srcDir),
    installedAt: prev?.installedAt ?? new Date().toISOString(),
    updatedAt: prev ? new Date().toISOString() : undefined,
  };
  writeFileSync(join(dest, MARKER_FILE), JSON.stringify(marker, null, 2));
  ctx.log?.(`[skills] installed ${entry.name} from ${entry.source.repo}${commit ? ' @ ' + commit.slice(0, 7) : ''}`);
  return { ok: true, id: entry.id, name: entry.name, path: dest, commit, manual: null, error: null };
}

/** Re-install from a refreshed cache. Returns from/to commits. */
export async function updateEntry(entry: CatalogEntry, ctx: InstallContext): Promise<{ name: string; from: string | null; to: string | null; changed: boolean }> {
  const dest = join(ctx.paths.skillsDir, entry.name);
  const from = readMarker(dest)?.commit ?? null;
  const r = await installEntry(entry, ctx, { refresh: true, force: true });
  return { name: entry.name, from, to: r.commit, changed: from !== r.commit };
}

export function readMarker(dir: string): FoundryMarker | null {
  for (const file of [MARKER_FILE, LEGACY_MARKER_FILE]) {
    try {
      return FoundryMarker.parse(JSON.parse(readFileSync(join(dir, file), 'utf8')));
    } catch {}
  }
  return null;
}

function isSymlink(p: string): boolean {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}
