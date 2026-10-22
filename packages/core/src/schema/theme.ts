import { z } from 'zod';

/**
 * A Theme (ADR-0066): how the web UI looks — its colours in light and dark mode, its fonts and the shape of its corners.
 * Two are built in; anyone can add their own as a JSON file in the data folder's `themes/`. Every value is checked to be
 * exactly a colour, a font list, a number or an https address, so a theme file can change how Foundry looks and nothing else.
 */

const Hex = z.string().regex(/^#(?:[0-9a-fA-F]{3}){1,2}$/, 'a colour is written #rgb or #rrggbb, e.g. #1f2933');
const colour = (what: string) => Hex.describe(what);

/** One mode's colours: four are required, Foundry works out the rest when they are left out. */
export const ThemePalette = z
  .object({
    page: colour('The page behind everything'),
    panel: colour('Cards, boards, menus and dialogs'),
    line: colour('Hairlines and borders'),
    ink: colour('Text'),
    inset: colour('Code blocks, table heads and other boxes inside a card. Default: between page and panel').optional(),
    lineStrong: colour('Field borders, empty task squares and scrollbars. Default: line, a step toward ink').optional(),
    inkSoft: colour('Secondary text. Default: ink, a third of the way toward panel').optional(),
    inkFaint: colour('Hints, timestamps and labels. Default: ink, halfway toward panel').optional(),
    band: colour('The top bar. Default: page').optional(),
    bandInk: colour('Text and icons in the top bar. Default: ink').optional(),
    accent: colour('The main button, the selected tab and focus rings. Default: ink').optional(),
    you: colour('Something waits for you: the Needs you signs, the Inbox count, approvals').optional(),
    work: colour('An agent is working, and information: running goals, links, notes').optional(),
    ok: colour('Done, passing, merged, added lines').optional(),
    bad: colour('Failed, errors, danger, removed lines').optional(),
    extra: colour('Reviews, merges and other categories that need telling apart. Default: work').optional(),
  })
  .strict();
export type ThemePalette = z.infer<typeof ThemePalette>;

/** a CSS font-family list: names, quotes, commas and spaces only */
const FontList = z
  .string()
  .max(200)
  .regex(/^[\p{L}\p{N} ,'"_.-]+$/u, 'a font list holds font names, quotes and commas only, e.g. "Inter", ui-sans-serif, sans-serif');

export const ThemeFonts = z
  .object({
    sans: FontList.describe('Text: a CSS font-family list, e.g. "Inter", ui-sans-serif, sans-serif').optional(),
    mono: FontList.describe('Numbers, times, paths and code: a CSS font-family list').optional(),
    stylesheets: z
      .array(z.string().max(500).regex(/^https:\/\/[^\s"'()<>\\]+$/, 'a stylesheet is an https:// address'))
      .max(3)
      .describe('Up to three https:// stylesheets that load the fonts, e.g. a Google Fonts address')
      .optional(),
  })
  .strict();
export type ThemeFonts = z.infer<typeof ThemeFonts>;

export const ThemeShape = z
  .object({
    radius: z.number().min(0).max(24).describe('Corner radius of a card, in pixels; buttons and chips get proportionally less. 0 = square corners').optional(),
    slant: z.number().min(-30).max(30).describe('How far the stage plates lean, in degrees. 0 = upright').optional(),
    texture: z.enum(['none', 'grain']).describe('grain: a faint grain on the page behind the cards').optional(),
  })
  .strict();
export type ThemeShape = z.infer<typeof ThemeShape>;

export const Theme = z
  .object({
    $schema: z.string().optional(),
    name: z.string().trim().min(1).max(40).describe('The name Settings shows'),
    description: z.string().max(200).describe('One line under the name').optional(),
    fonts: ThemeFonts.optional(),
    shape: ThemeShape.optional(),
    light: ThemePalette.describe('Colours in light mode'),
    dark: ThemePalette.describe('Colours in dark mode'),
  })
  .strict();
export type Theme = z.infer<typeof Theme>;

/** A theme's id is its file name without `.json`: lowercase letters, digits and hyphens. */
export const THEME_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** A theme Foundry knows: built in, or read from `themes/<id>.json` in the data folder. */
export interface ThemeEntry {
  id: string;
  theme: Theme;
  builtIn: boolean;
  /** the app's own stylesheet draws it as it is: nothing is generated for it (Classic) */
  stock?: boolean;
  /** a custom theme's file */
  file?: string;
}

/** A theme file that could not be used, and why — shown in Settings so the person can fix it. */
export interface ThemeProblem {
  file: string;
  error: string;
}

/** Reads one theme file's text: the theme, or a sentence that says what to fix. */
export function parseTheme(text: string): { theme: Theme } | { error: string } {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    return { error: `not valid JSON: ${(e as Error).message}` };
  }
  const r = Theme.safeParse(json);
  if (r.success) return { theme: r.data };
  return {
    error: r.error.issues
      .slice(0, 3)
      .map((i) => (i.code === 'unrecognized_keys' ? `${[...i.path, i.keys.join(', ')].join('.')}: not a theme setting` : `${i.path.join('.') || 'the file'}: ${i.message}`))
      .join('; '),
  };
}
