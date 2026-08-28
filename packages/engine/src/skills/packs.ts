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

export const IMAGE_PACK_OPTIONS: PackOption[] = [
  { id: 'gpt-image-2', label: 'GPT Image 2', summary: 'Prompt-engineering skill for GPT Image 2 with 80+ structured templates (posters, UI, product shots, infographics); generates via an OpenAI-compatible endpoint or hands the prompt to the host agent.', homepage: null },
  { id: 'none', label: 'None', summary: 'No image skill is mandated; image tasks rely on the worker alone.', homepage: null },
];

export const VIDEO_PACK_OPTIONS: PackOption[] = [
  { id: 'web-video-presentation', label: 'Web video presentation', summary: 'Turns a script or article into a click-driven 16:9 web presentation (cinematic HTML, optional narration audio) — video-as-a-web-page rather than a rendered file.', homepage: 'https://github.com/ConardLi/garden-skills' },
  { id: 'mmx-cli', label: 'MiniMax CLI', summary: 'MiniMax platform CLI (mmx): text/image-to-video generation and narration audio, rendered to real video files.', homepage: 'https://www.npmjs.com/package/mmx-cli' },
  { id: 'none', label: 'None', summary: 'No video skill is mandated; video tasks rely on the worker alone.', homepage: null },
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
