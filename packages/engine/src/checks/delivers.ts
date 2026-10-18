import type { CheckSpec } from '@foundry/core';

/** the name of the engine-made must check for one Deliverable: `Delivers <path>` */
export const DELIVERS_CHECK_PREFIX = 'Delivers ';

const quote = (p: string) => `'${p.replace(/'/g, `'\\''`)}'`;

/** the must check a Deliverable is: the file (or folder) exists where the task lands */
export function deliversCheckSpec(path: string): Extract<CheckSpec, { type: 'command' }> {
  return { type: 'command', cmd: `test -e ${quote(path)}`, timeoutMs: 60_000, expectExitCode: 0 };
}

export const deliversCheckName = (path: string): string => `${DELIVERS_CHECK_PREFIX}${path}`;

/** a Deliverable is one path inside the repository (or under artifacts/): relative, no `..`, no glob, no shell */
export function validDeliverable(path: string): boolean {
  const p = path.trim();
  if (!p || p.length > 500) return false;
  if (p.startsWith('/') || p.startsWith('~') || /^[a-zA-Z]:[\\/]/.test(p)) return false;
  if (p.split('/').some((seg) => seg === '..')) return false;
  if (/[*?[\]{}$`\n\r]/.test(p)) return false;
  return true;
}

/** the planner's (or the person's) Deliverables as the Brief keeps them: trimmed, `./` dropped, invalid ones left out, no repeats */
export function cleanDeliverables(paths: readonly string[] | undefined): string[] {
  const out: string[] = [];
  for (const raw of paths ?? []) {
    const p = raw.trim().replace(/^\.\//, '').replace(/\/+$/, '');
    if (validDeliverable(p) && !out.includes(p)) out.push(p);
  }
  return out;
}
