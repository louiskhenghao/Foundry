/**
 * Mutually exclusive skill packs. A pack is a Settings choice (e.g. which design skill set the roles
 * follow); catalog entries declare `pack` + `packOption`, and only entries of the chosen option take
 * part in prompts. Browser-safe (no node imports).
 */
import type { CatalogEntry } from './types.ts';

export interface PackOption {
  id: string;
  label: string;
  summary: string;
  homepage: string | null;
}

export const DESIGN_PACK_OPTIONS: PackOption[] = [
  { id: 'ui-ux-pro-max', label: 'UI/UX Pro Max', summary: 'Plugin with searchable style, palette, font-pairing, product-type and UX-guideline databases; workers consult it before writing UI.', homepage: 'https://github.com/nextlevelbuilder/ui-ux-pro-max-skill' },
  { id: 'frontend-design', label: 'Anthropic frontend-design', summary: "Anthropic's guidance for distinctive, intentional UI: deliberate palette, typography and layout choices instead of templated defaults.", homepage: 'https://github.com/anthropics/skills' },
  { id: 'impeccable', label: 'Impeccable', summary: '/impeccable with 23 sub-commands (craft, polish, critique, audit, …) built on frontend-design; the goal reviewer runs its critique.', homepage: 'https://github.com/pbakaus/impeccable' },
  { id: 'bencium', label: 'Bencium design pack', summary: 'bencium-impact-designer (anti-generic UI), design-audit for the reviewer and typography rules.', homepage: 'https://github.com/bencium/bencium-marketplace' },
  { id: 'garden', label: 'Garden web-design-engineer', summary: "ConardLi's web-design-engineer: pages, landing pages, dashboards and prototypes from 25 design recipes.", homepage: 'https://github.com/ConardLi/garden-skills' },
  { id: 'none', label: 'None', summary: 'No design skill is mandated; UI tasks rely on the worker alone.', homepage: null },
];

/** Is this entry visible given the chosen pack options? Entries without a pack always are. */
export function packAllows(entry: Pick<CatalogEntry, 'pack' | 'packOption'>, chosen: Record<string, string | undefined>): boolean {
  if (!entry.pack) return true;
  const pick = chosen[entry.pack];
  if (!pick || pick === 'none') return false;
  return entry.packOption === pick;
}

/** Catalog entries that belong to one option of a pack. */
export function packEntries(entries: CatalogEntry[], pack: string, option: string): CatalogEntry[] {
  return entries.filter((e) => e.pack === pack && e.packOption === option);
}
