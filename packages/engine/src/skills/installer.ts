import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { exec } from '../git/git.ts';
import { pluginInstallCommand } from './catalog.ts';
import { LEGACY_MARKER_FILE, MARKER_FILE, type SkillsPaths } from './paths.ts';
import { trashSkill } from './trash.ts';
import { FoundryMarker, type CatalogEntry, type InstallResult } from './types.ts';

export class InstallError extends Error {
  constructor(
    message: string,
    public readonly code: 'conflict' | 'manual' | 'not-found' | 'git' | 'refused',
    public readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export interface InstallContext {
  paths: SkillsPaths;
  log?: (m: string) => void;
  /** for plugin sources: the claude binary and a streaming spawner (tests inject both) */
  claudeBin?: string;
  spawn?: (argv: string[], cwd: string, onLine: (l: string) => void, opts?: { timeoutMs?: number }) => Promise<{ code: number | null; tail: string }>;
  onLine?: (l: string) => void;
}

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
        const head = src.ref ? `origin/${src.ref}` : 'origin/HEAD';
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

/** Find the skill directory inside the cache: explicit path first, else `**\/<name>/SKILL.md`. */
export function locateSkillDir(cacheDir: string, entry: CatalogEntry): string {
  if (entry.source.type !== 'git') throw new InstallError('not a git entry', 'manual');
  if (entry.source.path) {
    const d = join(cacheDir, entry.source.path);
    if (existsSync(join(d, 'SKILL.md'))) return d;
  }
  const glob = new Bun.Glob(`**/${entry.name}/SKILL.md`);
  const hits = [...glob.scanSync({ cwd: cacheDir, dot: false })].filter((h) => !h.includes('node_modules/')).sort((a, b) => a.length - b.length);
  if (hits[0]) return join(cacheDir, hits[0].slice(0, -'/SKILL.md'.length));
  if (existsSync(join(cacheDir, 'SKILL.md')) && basename(cacheDir) === entry.name) return cacheDir;
  throw new InstallError(`SKILL.md for ${entry.name} not found in ${entry.source.repo}${entry.source.path ? ` (path ${entry.source.path})` : ''}`, 'not-found');
}

/**
 * Install a Claude Code marketplace plugin with the official CLI (non-interactive). The marketplace is
 * added first (an "already exists" failure is fine), then the plugin. Skills land wherever Claude Code
 * keeps plugins; the scanner picks them up as `installed-via-plugin`.
 */
export async function installPlugin(entry: CatalogEntry, ctx: InstallContext): Promise<InstallResult> {
  if (entry.source.type !== 'plugin') throw new InstallError('not a plugin entry', 'manual');
  const src = entry.source;
  const manual = { command: pluginInstallCommand(src), docs: src.docs ?? null };
  const claude = ctx.claudeBin ?? Bun.which('claude');
  if (!claude || !ctx.spawn) return { ok: false, id: entry.id, name: entry.name, path: null, commit: null, manual, error: claude ? 'no spawner configured' : 'claude CLI not found' };
  const onLine = ctx.onLine ?? (() => {});
  const add = await ctx.spawn([claude, 'plugin', 'marketplace', 'add', src.marketplace], ctx.paths.claudeHome, onLine, { timeoutMs: 180_000 });
  if (add.code !== 0 && !/already|exists/i.test(add.tail)) {
    return { ok: false, id: entry.id, name: entry.name, path: null, commit: null, manual, error: `claude plugin marketplace add failed: ${add.tail.slice(-300)}` };
  }
  const inst = await ctx.spawn([claude, 'plugin', 'install', `${src.plugin}@${src.marketplaceId}`], ctx.paths.claudeHome, onLine, { timeoutMs: 300_000 });
  if (inst.code !== 0 && !/already installed/i.test(inst.tail)) {
    return { ok: false, id: entry.id, name: entry.name, path: null, commit: null, manual, error: `claude plugin install failed: ${inst.tail.slice(-300)}` };
  }
  ctx.log?.(`[skills] installed plugin ${src.plugin}@${src.marketplaceId}`);
  return { ok: true, id: entry.id, name: entry.name, path: null, commit: null, manual: null, error: null };
}

export async function installEntry(entry: CatalogEntry, ctx: InstallContext, opts: { force?: boolean; refresh?: boolean } = {}): Promise<InstallResult> {
  if (entry.source.type === 'plugin') return installPlugin(entry, ctx);
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
