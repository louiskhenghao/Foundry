/**
 * Workflow suites (ADR-0049): a Claude Code plugin Foundry keeps as its own clone, pinned to one release, and gives
 * sessions from a hook-less copy — the plugin's skills, agents and manifest, never its `hooks/`. pstack's SessionStart
 * hook routes every session to its playbooks and can only be switched off globally; Foundry's own guards are hooks in the
 * same session and must stay. So the copy, not the clone, is what `--plugin-dir` loads.
 *
 * Store, under the engine's data dir: `suites/<id>/clone` (git, at the pinned tag) and `suites/<id>/plugin` (the copy),
 * with a marker in the copy. The suite's skills reach the Extensions page as rows of one source (`suite:<id>`), named
 * `<id>:<skill>` so they never shadow a loose or plugin copy of a skill that shares the bare name (pstack's `tdd` and
 * Matt Pocock's `tdd` are different skills). Codex has no plugins: its sessions get the suite's skills linked into the
 * goal workspace as `.agents/skills/<id>-<skill>`.
 */
import type { AgentProvider } from '@foundry/core';
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { exec } from '../git/git.ts';
import { excludeFromGit } from './autoskills.ts';
import { parseSkillMd } from './frontmatter.ts';
import { InstallError, type InstallContext } from './install-types.ts';
import type { SkillsPaths } from './paths.ts';
import type { CatalogSuite, InstalledSkill, InstalledSuite } from './types.ts';

export const SUITE_MARKER = '.foundry-suite.json';

export const SuiteMarker = z.object({
  suite: z.string(),
  repo: z.string(),
  ref: z.string(),
  commit: z.string().nullable(),
  /** the plugin root inside the repo */
  path: z.string(),
  installedAt: z.string(),
  updatedAt: z.string().optional(),
});
export type SuiteMarker = z.infer<typeof SuiteMarker>;

export function suiteDirs(paths: SkillsPaths, id: string): { root: string; clone: string; plugin: string } {
  const root = join(paths.suitesDir, id);
  return { root, clone: join(root, 'clone'), plugin: join(root, 'plugin') };
}

export function readSuiteMarker(pluginDir: string): SuiteMarker | null {
  try {
    return SuiteMarker.parse(JSON.parse(readFileSync(join(pluginDir, SUITE_MARKER), 'utf8')));
  } catch {
    return null;
  }
}

/** the skill folders of a plugin copy (those with a SKILL.md), sorted */
export function suiteSkillNames(pluginDir: string): string[] {
  const dir = join(pluginDir, 'skills');
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(dir, d.name, 'SKILL.md')))
    .map((d) => d.name)
    .sort();
}

/** one installed suite from its store, or null when the copy is not there */
export function readSuite(paths: SkillsPaths, id: string): InstalledSuite | null {
  const { plugin } = suiteDirs(paths, id);
  const marker = readSuiteMarker(plugin);
  if (!marker) return null;
  return { id: marker.suite, dir: plugin, repo: marker.repo, ref: marker.ref, commit: marker.commit, installedAt: marker.installedAt, skills: suiteSkillNames(plugin) };
}

/** every suite in the store */
export function scanSuites(paths: SkillsPaths): InstalledSuite[] {
  if (!existsSync(paths.suitesDir)) return [];
  return readdirSync(paths.suitesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => readSuite(paths, d.name))
    .filter((s): s is InstalledSuite => !!s)
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** how a session names a suite skill: Claude as the plugin's slash command, Codex as the linked folder */
export const suiteInvoke = (provider: AgentProvider, suite: string, skill: string): string => (provider !== 'claude' ? `${suite}-${skill}` : `/${suite}:${skill}`);

/** the Extensions page's rows for an installed suite: one source, names that never collide with a bare skill name */
export function suiteSkillRows(paths: SkillsPaths, s: InstalledSuite): InstalledSkill[] {
  return s.skills.map((skill) => {
    const dir = join(s.dir, 'skills', skill);
    const skillMd = join(dir, 'SKILL.md');
    let fm: ReturnType<typeof parseSkillMd> | null = null;
    try {
      fm = parseSkillMd(readFileSync(skillMd, 'utf8'));
    } catch {}
    return {
      name: `${s.id}:${skill}`,
      scope: 'plugin',
      invoke: suiteInvoke(paths.provider ?? 'claude', s.id, skill),
      dir,
      skillMd: fm ? skillMd : null,
      description: fm?.description ?? '',
      version: fm?.version ?? null,
      managedBy: 'foundry',
      marker: null,
      plugin: { id: `suite:${s.id}`, name: s.id, version: s.ref, installPath: s.dir, marketplace: null, marketplaceRepo: s.repo, marketplaceClone: null, gitCommitSha: s.commit, installedAt: s.installedAt, lastUpdated: null, skillPath: `skills/${skill}` },
      lock: null,
      symlink: null,
      manifest: null,
      duplicateOf: [],
      canUninstall: false,
      uninstallNote: `part of the ${s.id} suite, a Foundry-managed copy; the suite is removed as a whole`,
      hint: null,
      unparsable: !fm,
    };
  });
}

/**
 * Clone the suite at its pinned release (or re-sync an existing clone to it) and materialise the hook-less copy. A copy
 * already at the pin is left alone unless `refresh` asks for the fetch. Returns where the copy is and what it is at.
 */
export async function installSuite(suite: CatalogSuite, ctx: InstallContext, opts: { refresh?: boolean } = {}): Promise<{ path: string; commit: string | null; from: string | null; changed: boolean }> {
  const { root, clone, plugin } = suiteDirs(ctx.paths, suite.id);
  const url = suite.url ?? `https://github.com/${suite.repo}.git`;
  mkdirSync(root, { recursive: true });
  if (!existsSync(join(clone, '.git'))) {
    rmSync(clone, { recursive: true, force: true });
    const r = await exec(['git', 'clone', '-q', '--depth', '1', '--branch', suite.ref, url, clone], root, { timeoutMs: 180_000 });
    if (r.code !== 0) {
      rmSync(clone, { recursive: true, force: true });
      throw new InstallError(`git clone failed for ${suite.repo} @ ${suite.ref}: ${r.stderr.trim().slice(-400)}`, 'git');
    }
  } else if (opts.refresh || !(await atRef(clone, suite.ref))) {
    // the pin moved (a new Foundry release) or a re-sync was asked for: fetch the tag and reset to it, never to a branch tip
    const f = await exec(['git', 'fetch', '-q', '--depth', '1', '--force', 'origin', `tag`, suite.ref], clone, { timeoutMs: 120_000 });
    if (f.code !== 0) throw new InstallError(`git fetch failed for ${suite.repo} @ ${suite.ref}: ${f.stderr.trim().slice(-400)}`, 'git');
    const r = await exec(['git', 'reset', '-q', '--hard', `refs/tags/${suite.ref}`], clone, { timeoutMs: 60_000 });
    if (r.code !== 0) throw new InstallError(`git reset to ${suite.ref} failed for ${suite.repo}: ${r.stderr.trim().slice(-400)}`, 'git');
  }
  const commit = (await exec(['git', 'rev-parse', 'HEAD'], clone)).stdout.trim() || null;
  const prev = readSuiteMarker(plugin);
  if (prev && prev.ref === suite.ref && prev.commit === commit && existsSync(join(plugin, 'skills'))) return { path: plugin, commit, from: prev.commit, changed: false };

  const src = join(clone, suite.path);
  if (!existsSync(join(src, '.claude-plugin', 'plugin.json'))) throw new InstallError(`${suite.repo} @ ${suite.ref} has no Claude Code plugin at ${suite.path}`, 'not-found');
  const tmp = `${plugin}.tmp`;
  rmSync(tmp, { recursive: true, force: true });
  cpSync(src, tmp, { recursive: true, dereference: true });
  // the hook-less copy: skills, agents and the manifest stay; the plugin's hooks never run inside a Foundry session
  rmSync(join(tmp, 'hooks'), { recursive: true, force: true });
  const marker: SuiteMarker = { suite: suite.id, repo: suite.repo, ref: suite.ref, commit, path: suite.path, installedAt: prev?.installedAt ?? new Date().toISOString(), updatedAt: prev ? new Date().toISOString() : undefined };
  writeFileSync(join(tmp, SUITE_MARKER), JSON.stringify(marker, null, 2));
  rmSync(plugin, { recursive: true, force: true });
  renameSync(tmp, plugin);
  ctx.log?.(`[skills] suite ${suite.id} at ${suite.ref}${commit ? ' @ ' + commit.slice(0, 7) : ''} → ${plugin}`);
  return { path: plugin, commit, from: prev?.commit ?? null, changed: prev?.commit !== commit };
}

async function atRef(clone: string, ref: string): Promise<boolean> {
  const head = (await exec(['git', 'rev-parse', 'HEAD'], clone)).stdout.trim();
  const tag = (await exec(['git', 'rev-parse', '-q', '--verify', `refs/tags/${ref}^{commit}`], clone)).stdout.trim();
  return !!head && head === tag;
}

/**
 * Codex: link the suite's skills a workspace needs into `.agents/skills/<id>-<skill>` (git-excluded), idempotently.
 * `skills` are the bare names; only the ones the copy has are linked.
 */
export async function linkSuiteSkills(ws: string, s: InstalledSuite, skills: string[], log?: (m: string) => void): Promise<string[]> {
  const dir = join(ws, '.agents', 'skills');
  const linked: string[] = [];
  for (const skill of skills) {
    if (!s.skills.includes(skill)) continue;
    const target = join(s.dir, 'skills', skill);
    const link = join(dir, `${s.id}-${skill}`);
    try {
      const st = lstatSync(link);
      if (st.isSymbolicLink() || st.isDirectory()) {
        linked.push(`${s.id}-${skill}`);
        continue;
      }
    } catch {}
    mkdirSync(dirname(link), { recursive: true });
    symlinkSync(target, link);
    linked.push(`${s.id}-${skill}`);
  }
  if (linked.length) await excludeFromGit(ws, linked.map((n) => `.agents/skills/${n}`), log);
  return linked;
}
