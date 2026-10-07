import { existsSync, readdirSync, readFileSync, rmSync, rmdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { git } from './git.ts';

/**
 * Agent guidance that tools write into a repository on their own: `gitnexus analyze` adds a marked section to CLAUDE.md
 * and AGENTS.md and installs skills under .claude/skills. Foundry runs gitnexus itself (the graph refresh), and a
 * person's global hooks can make a session run it, so these files would show up as uncommitted changes, or ride along in
 * a task's commit, in goals that never asked for them.
 */
const GUIDANCE_FILES = ['CLAUDE.md', 'AGENTS.md'];
const TOOL_SKILL_DIRS = ['.claude/skills/gitnexus', '.claude/skills/generated'];
/** the section gitnexus keeps between its markers, with the blank lines it adds around it */
const TOOL_BLOCK = /\n*<!-- gitnexus:start -->[\s\S]*?<!-- gitnexus:end -->\n?/g;
const hasBlock = (text: string | null) => !!text && /<!-- gitnexus:start -->/.test(text);

export interface GuidanceSnapshot {
  files: Record<string, string | null>;
  dirs: string[];
}

/** what the guidance files and tool skill folders look like before a tool runs */
export function snapshotGuidance(ws: string): GuidanceSnapshot {
  return { files: Object.fromEntries(GUIDANCE_FILES.map((f) => [f, read(join(ws, f))])), dirs: ['.claude', '.claude/skills', ...TOOL_SKILL_DIRS].filter((d) => existsSync(join(ws, d))) };
}

/** put the guidance files and tool skill folders back as they were at the snapshot; returns what it put back */
export function restoreGuidance(ws: string, snap: GuidanceSnapshot): string[] {
  const restored: string[] = [];
  for (const f of GUIDANCE_FILES) {
    const before = snap.files[f] ?? null;
    if (read(join(ws, f)) === before) continue;
    if (before === null) rmSync(join(ws, f), { force: true });
    else writeFileSync(join(ws, f), before);
    restored.push(f);
  }
  for (const d of TOOL_SKILL_DIRS) {
    if (snap.dirs.includes(d) || !existsSync(join(ws, d))) continue;
    rmSync(join(ws, d), { recursive: true, force: true });
    restored.push(d);
  }
  // folders the tool created only to hold its skills
  for (const d of ['.claude/skills', '.claude']) if (!snap.dirs.includes(d)) removeIfEmpty(join(ws, d));
  return restored;
}

/**
 * Before a commit: a gitnexus section the file did not have at HEAD is taken out again (the file is removed when that
 * section was all of it), and tool skill folders git neither tracks nor ignores are deleted. Ignored files are never
 * staged, so they are left alone; a section already committed stays. Returns what it took out.
 */
export async function dropToolGuidance(cwd: string): Promise<string[]> {
  const dropped: string[] = [];
  const ignored = async (p: string) => (await git(['check-ignore', '-q', '--', p], cwd)).code === 0;
  for (const f of GUIDANCE_FILES) {
    const now = read(join(cwd, f));
    if (!hasBlock(now) || (await ignored(f))) continue;
    const head = await git(['show', `HEAD:${f}`], cwd);
    const before = head.code === 0 ? head.stdout : null;
    if (hasBlock(before)) continue;
    const without = now!.replace(TOOL_BLOCK, '\n').replace(/\n{3,}/g, '\n\n');
    if (before === null && !without.trim()) rmSync(join(cwd, f), { force: true });
    else writeFileSync(join(cwd, f), before !== null && without.trim() === before.trim() ? before : without.replace(/^\n+/, ''));
    dropped.push(f);
  }
  for (const d of TOOL_SKILL_DIRS) {
    if (!existsSync(join(cwd, d)) || (await ignored(d))) continue;
    if ((await git(['ls-files', '--', d], cwd)).stdout.trim()) continue;
    rmSync(join(cwd, d), { recursive: true, force: true });
    dropped.push(d);
  }
  if (dropped.some((d) => d.startsWith('.claude/'))) for (const d of ['.claude/skills', '.claude']) removeIfEmpty(join(cwd, d));
  return dropped;
}

function read(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

function removeIfEmpty(dir: string): void {
  try {
    if (readdirSync(dir).length === 0) rmdirSync(dir);
  } catch {
    /* not there, or not empty */
  }
}
