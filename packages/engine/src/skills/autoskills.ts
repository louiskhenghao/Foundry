/**
 * Per-goal autoskills run: `npx autoskills` detects the repository's stack and installs matching skills
 * into `<workspace>/.claude/skills`. The engine runs it once per goal in the goal workspace, then tidies
 * up so nothing it wrote reaches a commit: the generated/modified CLAUDE.md is restored and the skill
 * dirs + skills-lock.json are excluded via the repository's `.git/info/exclude`.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
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
export const EXCLUDE_MARKER = '# ai-engine autoskills (project skills installed per goal; never committed)';

/** autoskills only detects stacks from manifests; skip the npx round-trip when there is none. */
export function hasStackManifest(dir: string): boolean {
  return MANIFESTS.some((m) => existsSync(join(dir, m)));
}

export async function nodeMajor(deps: AutoskillsDeps = {}): Promise<number | null> {
  const v = deps.nodeVersion ? await deps.nodeVersion() : (await exec(['node', '-v'], process.cwd(), { timeoutMs: 10_000 }).catch(() => null))?.stdout ?? null;
  const m = v?.match(/v?(\d+)/);
  return m ? Number(m[1]) : null;
}

function skillDirs(ws: string): string[] {
  const d = join(ws, '.claude', 'skills');
  if (!existsSync(d)) return [];
  try {
    return readdirSync(d, { withFileTypes: true })
      .filter((e) => e.isDirectory() && existsSync(join(d, e.name, 'SKILL.md')))
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

/** Run autoskills in `ws` (a worktree of the repository) and clean up after it. Never throws. */
export async function runAutoskills(ws: string, deps: AutoskillsDeps = {}, onLine: (l: string) => void = () => {}): Promise<AutoskillsResult> {
  if (!hasStackManifest(ws)) return { status: 'skipped', skills: [], detail: 'no stack manifest (package.json, pyproject.toml, go.mod, …) in the repository' };
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
  const excluded = await excludeFromGit(ws, [...added.map((n) => `.claude/skills/${n}/`), ...(hadLock ? [] : ['skills-lock.json'])], deps.log);

  if (r.code !== 0 && !added.length) return { status: 'failed', skills: [], detail: `npx autoskills exited ${r.code}: ${r.tail.split('\n').slice(-3).join(' | ').slice(0, 300)}` };
  if (!added.length) return { status: 'skipped', skills: after, detail: after.length ? `nothing new to install (${after.length} project skill(s) already present)` : 'autoskills found no skills for this stack' };
  return { status: 'installed', skills: after, detail: `${added.length} skill(s) installed for this stack${excluded ? '' : ' (could not write .git/info/exclude)'}` };
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
