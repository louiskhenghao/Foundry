/**
 * Per-goal autoskills run: `npx autoskills` detects the repository's stack and installs matching skills
 * into `<workspace>/.claude/skills`. The engine runs it once per goal in the goal workspace, then tidies
 * up so nothing it wrote reaches a commit: the generated/modified CLAUDE.md is restored and the skill
 * dirs + skills-lock.json are excluded via the repository's `.git/info/exclude`.
 */
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { exec, git } from '../git/git.ts';
import { spawnStreaming } from './updaters.ts';

export interface AutoskillsDeps {
  spawn?: typeof spawnStreaming;
  /** `node -v` → "v22.3.0"; injected in tests */
  nodeVersion?: () => Promise<string | null>;
  log?: (m: string) => void;
  timeoutMs?: number;
}

export interface AutoskillsResult {
  status: 'installed' | 'skipped' | 'failed';
  skills: string[];
  detail: string;
}

const MANIFESTS = ['package.json', 'build.gradle', 'build.gradle.kts', 'pom.xml', 'pyproject.toml', 'requirements.txt', 'go.mod', 'Cargo.toml', 'Gemfile', 'composer.json', 'pubspec.yaml'];
export const EXCLUDE_MARKER = '# foundry autoskills (project skills installed per goal; never committed)';

/** autoskills only detects stacks from manifests; skip the npx round-trip when there is none. */
export function hasStackManifest(dir: string): boolean {
  return MANIFESTS.some((m) => existsSync(join(dir, m)));
}

export async function nodeMajor(deps: AutoskillsDeps = {}): Promise<number | null> {
  const v = deps.nodeVersion ? await deps.nodeVersion() : (await exec(['node', '-v'], process.cwd(), { timeoutMs: 10_000 }).catch(() => null))?.stdout ?? null;
  const m = v?.match(/v?(\d+)/);
  return m ? Number(m[1]) : null;
}

/**
 * Installed project skills, by name. autoskills writes some of them as symlinks
 * (`.claude/skills/<n>` → `../../.agents/skills/<n>`), and `Dirent.isDirectory()` is false for a symlink —
 * so the only reliable test is whether `<n>/SKILL.md` resolves.
 */
function skillDirs(ws: string): string[] {
  const d = join(ws, '.claude', 'skills');
  if (!existsSync(d)) return [];
  try {
    return readdirSync(d, { withFileTypes: true })
      .filter((e) => (e.isDirectory() || e.isSymbolicLink()) && existsSync(join(d, e.name, 'SKILL.md')))
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

function isLink(ws: string, name: string): boolean {
  try {
    return lstatSync(join(ws, '.claude', 'skills', name)).isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * Top-level directories inside the workspace that installed skills point at (autoskills keeps the real
 * content in `.agents/skills/…` and symlinks it). They must be excluded too, or the links become dangling
 * for anyone who checks the branch out.
 */
function linkTargetRoots(ws: string, names: string[]): string[] {
  const d = join(ws, '.claude', 'skills');
  const roots = new Set<string>();
  // both sides through realpath: the workspace path itself may run through symlinks (/var → /private/var on macOS)
  const base = (() => {
    try {
      return realpathSync(ws);
    } catch {
      return ws;
    }
  })();
  for (const n of names) {
    const p = join(d, n);
    try {
      if (!lstatSync(p).isSymbolicLink()) continue;
      const rel = relative(base, realpathSync(p));
      const top = rel.split('/')[0];
      if (top && !rel.startsWith('..') && top !== '.claude') roots.add(top);
    } catch {}
  }
  return [...roots].sort();
}

/** Run autoskills in `ws` (a worktree of the repository) and clean up after it. Never throws. */
export async function runAutoskills(ws: string, deps: AutoskillsDeps = {}, onLine: (l: string) => void = () => {}): Promise<AutoskillsResult> {
  if (!hasStackManifest(ws)) return { status: 'skipped', skills: [], detail: 'no stack manifest (package.json, pyproject.toml, go.mod, …) in the repository yet — retried after each task until one appears' };
  const major = await nodeMajor(deps);
  if (major == null || major < 22) return { status: 'skipped', skills: [], detail: major == null ? 'node is not on PATH (autoskills needs Node ≥ 22)' : `node v${major} is too old for autoskills (needs ≥ 22)` };

  const before = new Set(skillDirs(ws));
  const claudeMd = join(ws, 'CLAUDE.md');
  const hadClaudeMd = existsSync(claudeMd);
  const claudeMdBefore = hadClaudeMd ? readFileSync(claudeMd, 'utf8') : null;
  const lockPath = join(ws, 'skills-lock.json');
  const hadLock = existsSync(lockPath);

  const spawn = deps.spawn ?? spawnStreaming;
  const r = await spawn(['npx', '-y', 'autoskills@latest', '-y', '--agent', 'claude-code'], ws, onLine, { timeoutMs: deps.timeoutMs ?? 4 * 60_000 });

  // 1. CLAUDE.md: autoskills generates/edits it; the skills themselves are what matters, so put it back
  if (existsSync(claudeMd)) {
    if (!hadClaudeMd) rmSync(claudeMd, { force: true });
    else if (readFileSync(claudeMd, 'utf8') !== claudeMdBefore) writeFileSync(claudeMd, claudeMdBefore!);
  }
  const after = skillDirs(ws);
  const added = after.filter((n) => !before.has(n));

  // 2. keep the installed skills out of git: per-skill excludes (never the whole .claude/skills, the repo may track its own)
  const targets = linkTargetRoots(ws, added);
  // a trailing slash only matches directories, and a symlinked skill is a *file* to git — so pattern by kind
  const skillPatterns = added.map((n) => `.claude/skills/${n}${isLink(ws, n) ? '' : '/'}`);
  const excluded = await excludeFromGit(ws, [...skillPatterns, ...targets.map((t) => `${t}/`), ...(hadLock ? [] : ['skills-lock.json'])], deps.log);
  // a previous (buggy) run may have let these reach the index: a tracked symlink into an excluded dir is a
  // dangling link for everyone who checks the branch out, so drop it from the index (the file stays on disk)
  const untracked = await untrackSkillLinks(ws, after, deps.log);

  if (r.code !== 0 && !added.length) return { status: 'failed', skills: [], detail: `npx autoskills exited ${r.code}: ${r.tail.split('\n').slice(-3).join(' | ').slice(0, 300)}` };
  if (!added.length) return { status: 'skipped', skills: after, detail: `${after.length ? `nothing new to install (${after.length} project skill(s) already present)` : 'autoskills found no skills for this stack'}${untracked ? `; ${untracked} stale tracked link(s) removed from the index` : ''}` };
  return { status: 'installed', skills: after, detail: `${added.length} skill(s) installed for this stack${targets.length ? ` (content in ${targets.map((t) => `${t}/`).join(', ')})` : ''}${untracked ? `; ${untracked} stale tracked link(s) removed from the index` : ''}${excluded ? '' : ' (could not write .git/info/exclude)'}` };
}

/** Append patterns to the repository's `.git/info/exclude` (shared by every worktree), idempotently. Returns false when the repo is not writable. */
export async function excludeFromGit(ws: string, patterns: string[], log?: (m: string) => void): Promise<boolean> {
  if (!patterns.length) return true;
  const common = await git(['rev-parse', '--git-common-dir'], ws);
  if (common.code !== 0) return false;
  const dir = common.stdout.trim();
  const excludeFile = join(dir.startsWith('/') ? dir : join(ws, dir), 'info', 'exclude');
  try {
    mkdirSync(dirname(excludeFile), { recursive: true });
    const current = existsSync(excludeFile) ? readFileSync(excludeFile, 'utf8') : '';
    const lines = new Set(current.split('\n').map((l) => l.trim()));
    const fresh = patterns.filter((p) => !lines.has(p));
    if (!fresh.length) return true;
    const block = `${current.endsWith('\n') || !current ? '' : '\n'}${lines.has(EXCLUDE_MARKER) ? '' : EXCLUDE_MARKER + '\n'}${fresh.join('\n')}\n`;
    writeFileSync(excludeFile, current + block);
    return true;
  } catch (err) {
    log?.(`[autoskills] could not update ${excludeFile}: ${String(err)}`);
    return false;
  }
}

/** Drop project-skill symlinks from the index when git still tracks them (leftovers of a run that failed to exclude them). */
export async function untrackSkillLinks(ws: string, names: string[], log?: (m: string) => void): Promise<number> {
  const tracked = await git(['ls-files', '--', '.claude/skills'], ws);
  if (tracked.code !== 0) return 0;
  const inIndex = new Set(tracked.stdout.split('\n').filter(Boolean));
  const stale = names.filter((n) => inIndex.has(`.claude/skills/${n}`) && isLink(ws, n));
  if (!stale.length) return 0;
  const r = await git(['rm', '-r', '--cached', '-q', '--', ...stale.map((n) => `.claude/skills/${n}`)], ws);
  if (r.code !== 0) {
    log?.(`[autoskills] could not untrack stale skill links: ${r.stderr.slice(0, 200)}`);
    return 0;
  }
  return stale.length;
}

/** Give a task worktree the goal workspace's project skills (they are git-excluded, so a checkout lacks them). */
export function copyProjectSkills(fromWs: string, toWs: string): number {
  const src = join(fromWs, '.claude', 'skills');
  if (!existsSync(src)) return 0;
  const dest = join(toWs, '.claude', 'skills');
  let n = 0;
  for (const name of skillDirs(fromWs)) {
    if (existsSync(join(dest, name))) continue;
    cpSync(join(src, name), join(dest, name), { recursive: true, dereference: true });
    n++;
  }
  return n;
}
