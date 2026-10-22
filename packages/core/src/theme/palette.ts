import type { Theme, ThemeEntry, ThemePalette } from '../schema/theme.ts';
import { bestOn, contrast, isDark, mix, readable } from './color.ts';

/** Every colour of one mode, the ones a theme left out worked out. */
export type Palette = Required<ThemePalette>;

const SIGNALS = ['you', 'work', 'ok', 'bad', 'extra'] as const;
type Signal = (typeof SIGNALS)[number];

/** the signal colours of a palette that leaves them out: Classic's */
const SIGNAL_DEFAULTS: Record<'light' | 'dark', Record<Exclude<Signal, 'extra'>, string>> = {
  light: { you: '#d97706', work: '#2563eb', ok: '#059669', bad: '#e11d48' },
  dark: { you: '#fbbf24', work: '#60a5fa', ok: '#34d399', bad: '#fb7185' },
};

export function fillPalette(p: ThemePalette, mode: 'light' | 'dark'): Palette {
  const d = SIGNAL_DEFAULTS[mode];
  const inset = p.inset ?? mix(p.page, p.panel, 0.5);
  const work = p.work ?? d.work;
  return {
    page: p.page,
    panel: p.panel,
    line: p.line,
    ink: p.ink,
    inset,
    lineStrong: p.lineStrong ?? mix(p.line, p.ink, 0.25),
    inkSoft: p.inkSoft ?? mix(p.ink, p.panel, 0.3),
    inkFaint: p.inkFaint ?? readable(mix(p.ink, p.panel, 0.45), [p.panel, inset]),
    band: p.band ?? p.page,
    bandInk: p.bandInk ?? p.ink,
    accent: p.accent ?? p.ink,
    you: p.you ?? d.you,
    work,
    ok: p.ok ?? d.ok,
    bad: p.bad ?? d.bad,
    extra: p.extra ?? work,
  };
}

/**
 * The top bar's own palette: its band colour as the page and its ink as the text. A dark band in light mode takes the
 * signal colours of the theme's dark mode, so a yellow count or a red dot in it still reads.
 */
function bandPalette(theme: Theme, mode: 'light' | 'dark'): Palette {
  const own = fillPalette(theme[mode], mode);
  const other = mode === 'light' ? 'dark' : 'light';
  const base = isDark(own.band) === isDark(own.page) ? own : fillPalette(theme[other], other);
  const { band, bandInk } = own;
  return {
    ...base,
    page: band,
    panel: mix(band, bandInk, 0.06),
    inset: mix(band, bandInk, 0.1),
    line: mix(band, bandInk, 0.16),
    lineStrong: mix(band, bandInk, 0.32),
    ink: bandInk,
    inkSoft: mix(bandInk, band, 0.28),
    inkFaint: mix(bandInk, band, 0.42),
    band,
    bandInk,
    // a graphite button on a graphite bar would vanish: there the main button takes the bar's ink
    accent: contrast(own.accent, band) >= 3 ? own.accent : bandInk,
  };
}

/** which signal each of Tailwind's colour families stands for in the app's classes */
const FAMILIES: Record<string, Signal> = {
  amber: 'you',
  orange: 'you',
  yellow: 'you',
  sky: 'work',
  blue: 'work',
  cyan: 'work',
  indigo: 'work',
  emerald: 'ok',
  green: 'ok',
  lime: 'ok',
  rose: 'bad',
  red: 'bad',
  pink: 'bad',
  violet: 'extra',
  fuchsia: 'extra',
  purple: 'extra',
  teal: 'extra',
};

/**
 * The CSS variables of one palette: the theme's own names (bg-page, text-ink-soft, bg-you, text-on-you, text-you-ink…)
 * and Tailwind's colour ramps the app's classes are written in, pointed at the theme: zinc runs from page to ink, each
 * colour family takes its signal — light steps for text, the middle for fills, dark steps toward the panel for tints.
 */
export function paletteVars(p: Palette): Record<string, string> {
  const on = (fill: string) => bestOn(fill, [p.page, p.panel, p.ink]);
  const text = (c: string) => readable(c, [p.panel, p.page, p.inset]);
  const v: Record<string, string> = {
    page: p.page,
    panel: p.panel,
    inset: p.inset,
    line: p.line,
    'line-strong': p.lineStrong,
    ink: p.ink,
    'ink-soft': p.inkSoft,
    'ink-faint': p.inkFaint,
    'on-ink': on(p.ink),
    band: p.band,
    'band-ink': p.bandInk,
    'band-ink-soft': mix(p.bandInk, p.band, 0.3),
    'band-line': mix(p.band, p.bandInk, 0.16),
    'band-hover': mix(p.band, p.bandInk, 0.08),
    accent: p.accent,
    'on-accent': on(p.accent),
    'accent-ink': text(p.accent),
  };
  for (const s of SIGNALS) {
    v[s] = p[s];
    v[`on-${s}`] = on(p[s]);
    v[`${s}-ink`] = text(p[s]);
  }
  const zinc: Record<number, string> = { 50: p.ink, 100: p.ink, 200: mix(p.inkSoft, p.ink, 0.75), 300: mix(p.inkSoft, p.ink, 0.5), 400: p.inkSoft, 500: p.inkFaint, 600: mix(p.inkFaint, p.lineStrong, 0.5), 700: p.lineStrong, 800: p.line, 900: p.panel, 950: p.page };
  for (const [k, c] of Object.entries(zinc)) v[`zinc-${k}`] = c;
  for (const [family, s] of Object.entries(FAMILIES)) {
    const ink = v[`${s}-ink`]!;
    const fill = p[s];
    const steps: Record<number, string> = { 50: ink, 100: ink, 200: ink, 300: ink, 400: ink, 500: fill, 600: fill, 700: mix(fill, p.panel, 0.25), 800: mix(fill, p.panel, 0.55), 900: mix(fill, p.panel, 0.72), 950: mix(fill, p.panel, 0.84) };
    for (const [k, c] of Object.entries(steps)) v[`${family}-${k}`] = c;
  }
  return v;
}

const px = (n: number) => `${Number(n.toFixed(2))}px`;
const block = (selector: string, decls: string[]) => `${selector}{${decls.join(';')}}`;
const colours = (v: Record<string, string>) => Object.entries(v).map(([k, c]) => `--color-${k}:${c}`);

/**
 * The stylesheet that draws the app in `theme`: dark mode on `:root`, light mode on `:root.light`, the top bar
 * (`.theme-band`) in its own colours. Doubled `:root` so it wins over the app's stylesheet wherever either is loaded.
 */
export function themeCss(theme: Theme): string {
  const r = theme.shape?.radius ?? 8;
  const grain = theme.shape?.texture === 'grain';
  const shared = [
    ...(theme.fonts?.sans ? [`--font-sans:${theme.fonts.sans}`] : []),
    ...(theme.fonts?.mono ? [`--font-mono:${theme.fonts.mono}`] : []),
    `--radius-xs:${px(r / 4)}`,
    `--radius-sm:${px(r / 2)}`,
    `--radius-md:${px(r * 0.75)}`,
    `--radius-lg:${px(r)}`,
    `--radius-xl:${px(r * 1.5)}`,
    `--radius-2xl:${px(r * 2)}`,
    `--slant:${theme.shape?.slant ?? 0}deg`,
  ];
  const dark = fillPalette(theme.dark, 'dark');
  const light = fillPalette(theme.light, 'light');
  const out = [
    ...(theme.fonts?.stylesheets ?? []).map((u) => `@import url("${u}");`),
    block(':root:root', [...shared, `--texture-opacity:${grain ? 0.14 : 0}`, ...colours(paletteVars(dark))]),
    block(':root:root.light', [`--texture-opacity:${grain ? 0.3 : 0}`, ...colours(paletteVars(light))]),
  ];
  for (const [mode, p, sel] of [['dark', dark, ':root:root .theme-band'], ['light', light, ':root:root.light .theme-band']] as const) {
    // a top bar in the page's own colours needs nothing of its own
    if (p.band === p.page && p.bandInk === p.ink) continue;
    const band = bandPalette(theme, mode);
    out.push(block(sel, [`color-scheme:${isDark(band.band) ? 'dark' : 'light'}`, ...colours(paletteVars(band))]));
  }
  return out.join('\n');
}

/** what a theme entry adds to the page: nothing for the stock look, its generated stylesheet for any other */
export const entryCss = (e: ThemeEntry): string => (e.stock ? '' : themeCss(e.theme));
