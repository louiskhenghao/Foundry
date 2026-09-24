import { readFileSync, realpathSync } from 'node:fs';

export const MODEL_FAMILIES = ['fable', 'mythos', 'opus', 'sonnet', 'haiku'] as const;
export type ModelFamily = (typeof MODEL_FAMILIES)[number];

export interface DiscoveredModel {
  id: string;
  family: ModelFamily;
  /** numeric version parts for ordering, e.g. [5, 1] for claude-fable-5-1, [4, 5, 20251001] for a dated id */
  version: number[];
  /** the newest id of its family — what the dropdowns show by default */
  newest: boolean;
}

const ID = /claude-(fable|mythos|opus|sonnet|haiku)-(\d+(?:-\d+)*)(?![0-9a-z-]*-v\d)/g;

/**
 * The model ids a Claude Code binary knows about, read straight from its bytes. Free and offline; it lists what the CLI
 * can name, not what an account may use — the alias probes of a sync tell those apart. Compound ids
 * (claude-fable-5-mythos-5), provider variants (…-v1) and odd tails are dropped.
 */
export function modelsInBinary(binaryPath: string): DiscoveredModel[] {
  let text: string;
  try {
    text = readFileSync(realpathSync(binaryPath)).toString('latin1');
  } catch {
    return [];
  }
  const found = new Map<string, DiscoveredModel>();
  for (const m of text.matchAll(ID)) {
    const id = m[0];
    const parts = m[2]!.split('-').map(Number);
    // a family id has a major version 1–9 and at most one minor, optionally a date: claude-opus-4-1-20250805
    if (parts[0]! < 1 || parts[0]! > 9) continue;
    const date = parts.find((p) => p > 20_000_000);
    const nums = parts.filter((p) => p < 100);
    if (nums.length > 2 || (date && parts.indexOf(date) !== parts.length - 1)) continue;
    if (/-5-5[0-9]/.test(id) || /-3-55$/.test(id)) continue; // typo-like artefacts in the bundle (haiku-3-55)
    found.set(id, { id, family: m[1] as ModelFamily, version: parts, newest: false });
  }
  const byFamily = new Map<ModelFamily, DiscoveredModel[]>();
  for (const d of found.values()) byFamily.set(d.family, [...(byFamily.get(d.family) ?? []), d]);
  for (const list of byFamily.values()) {
    list.sort((a, b) => compareVersions(b.version, a.version));
    // newest = highest major.minor, preferring the undated alias-like id over a dated snapshot of the same version
    const top = list[0]!;
    const sameVersion = list.filter((d) => d.version.slice(0, 2).join('.') === top.version.filter((p) => p < 100).slice(0, 2).join('.'));
    const pick = sameVersion.find((d) => !d.version.some((p) => p > 20_000_000)) ?? top;
    pick.newest = true;
  }
  return [...found.values()].sort((a, b) => MODEL_FAMILIES.indexOf(a.family) - MODEL_FAMILIES.indexOf(b.family) || compareVersions(b.version, a.version));
}

function compareVersions(a: number[], b: number[]): number {
  const na = a.filter((p) => p < 100);
  const nb = b.filter((p) => p < 100);
  for (let i = 0; i < Math.max(na.length, nb.length); i++) {
    const d = (na[i] ?? 0) - (nb[i] ?? 0);
    if (d) return d;
  }
  // same version: the dated snapshot sorts below the undated id
  return (a.some((p) => p > 20_000_000) ? 0 : 1) - (b.some((p) => p > 20_000_000) ? 0 : 1);
}
