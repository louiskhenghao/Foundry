import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SkillsPaths } from './paths.ts';
import type { TrashEntry } from './types.ts';

const META = '.trash.json';

export class TrashError extends Error {
  constructor(
    message: string,
    public readonly code: 'not-found' | 'exists' | 'refused',
  ) {
    super(message);
  }
}

/** Move `<skillsDir>/<name>` into the trash. Symlinks: only the link is removed (recorded so restore can recreate it). */
export function trashSkill(name: string, paths: SkillsPaths, reason: string): TrashEntry {
  const src = join(paths.skillsDir, name);
  let st: ReturnType<typeof lstatSync>;
  try {
    st = lstatSync(src);
  } catch {
    throw new TrashError(`${name} is not installed`, 'not-found');
  }
  mkdirSync(paths.trashDir, { recursive: true });
  const trashedAt = new Date().toISOString();
  const dest = join(paths.trashDir, `${name}-${trashedAt.replace(/[:.]/g, '-')}`);
  const entry: TrashEntry = { name, trashedAt, path: dest, reason, wasSymlink: st.isSymbolicLink(), symlinkTarget: null };
  if (st.isSymbolicLink()) {
    entry.symlinkTarget = readlinkSync(src);
    mkdirSync(dest, { recursive: true });
    unlinkSync(src);
  } else {
    try {
      renameSync(src, dest);
    } catch {
      // cross-device: copy, verify, then remove source
      cpSync(src, dest, { recursive: true });
      if (!existsSync(join(dest, 'SKILL.md')) && existsSync(join(src, 'SKILL.md'))) throw new TrashError('copy to trash failed verification', 'refused');
      rmSync(src, { recursive: true, force: true });
    }
  }
  writeFileSync(join(dest, META), JSON.stringify(entry, null, 2));
  return entry;
}

export function listTrash(paths: SkillsPaths): TrashEntry[] {
  if (!existsSync(paths.trashDir)) return [];
  const out: TrashEntry[] = [];
  for (const d of readdirSync(paths.trashDir)) {
    try {
      out.push(JSON.parse(readFileSync(join(paths.trashDir, d, META), 'utf8')));
    } catch {}
  }
  return out.sort((a, b) => b.trashedAt.localeCompare(a.trashedAt));
}

/** Restore the most recent trash entry for `name` (or a specific trash path). */
export function restoreSkill(name: string, paths: SkillsPaths, opts: { force?: boolean; trashPath?: string } = {}): { path: string; entry: TrashEntry } {
  const entry = opts.trashPath ? listTrash(paths).find((e) => e.path === opts.trashPath) : listTrash(paths).find((e) => e.name === name);
  if (!entry) throw new TrashError(`nothing in trash for ${name}`, 'not-found');
  const dest = join(paths.skillsDir, entry.name);
  if (existsSync(dest) || isSymlink(dest)) {
    if (!opts.force) throw new TrashError(`${entry.name} already exists in ${paths.skillsDir}`, 'exists');
    trashSkill(entry.name, paths, 'replaced by restore');
  }
  mkdirSync(paths.skillsDir, { recursive: true });
  if (entry.wasSymlink && entry.symlinkTarget) {
    symlinkSync(entry.symlinkTarget, dest);
    rmSync(entry.path, { recursive: true, force: true });
  } else {
    rmSync(join(entry.path, META), { force: true });
    try {
      renameSync(entry.path, dest);
    } catch {
      cpSync(entry.path, dest, { recursive: true });
      rmSync(entry.path, { recursive: true, force: true });
    }
  }
  return { path: dest, entry };
}

function isSymlink(p: string): boolean {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}
