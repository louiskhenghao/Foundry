import type { Theme, ThemeEntry } from '../schema/theme.ts';

/**
 * Wayfinding: the web UI read as a sign system. Concrete grey and graphite carry everything the agents do; signal yellow
 * hangs only where you are needed; the other signal colours (RAL's red, green, blue and violet) mark failures, passes,
 * information and reviews. Atkinson Hyperlegible, made for telling 0 from O and 1 from l, for text and numbers.
 */
export const WAYFINDING: Theme = {
  name: 'Wayfinding',
  description: 'Concrete grey and graphite, with signal yellow only where you are needed.',
  fonts: {
    sans: "'Atkinson Hyperlegible Next', ui-sans-serif, system-ui, sans-serif",
    mono: "'Atkinson Hyperlegible Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
  },
  shape: { radius: 10, slant: -14, texture: 'grain' },
  light: {
    page: '#e5e8ec',
    panel: '#ffffff',
    inset: '#f0f2f5',
    line: '#d4d9e0',
    lineStrong: '#8a94a1',
    ink: '#11151b',
    inkSoft: '#2c333d',
    inkFaint: '#505966',
    band: '#11151b',
    bandInk: '#ffffff',
    accent: '#11151b',
    you: '#ffc61a',
    work: '#1e4d8c',
    ok: '#237f52',
    bad: '#b3261e',
    extra: '#844c82',
  },
  dark: {
    page: '#0b0e12',
    panel: '#141920',
    inset: '#1b2129',
    line: '#262d36',
    lineStrong: '#67717e',
    ink: '#e9edf2',
    inkSoft: '#c8cfd8',
    inkFaint: '#9aa4b1',
    band: '#05070a',
    bandInk: '#f2f5f8',
    accent: '#e9edf2',
    you: '#ffc61a',
    work: '#6fa0e8',
    ok: '#4fc38a',
    bad: '#ff6b5e',
    extra: '#c99ac6',
  },
};

/** Classic: the look Foundry had before themes — Tailwind's zinc greys, an emerald button. The app's stylesheet draws it. */
export const CLASSIC: Theme = {
  name: 'Classic',
  description: 'Zinc greys with an emerald button: the look Foundry had before themes.',
  fonts: {
    sans: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
    mono: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  },
  shape: { radius: 8, slant: 0, texture: 'none' },
  light: {
    page: '#ebebed',
    panel: '#ffffff',
    inset: '#f4f4f5',
    line: '#d6d6dc',
    lineStrong: '#c4c4cc',
    ink: '#18181b',
    inkSoft: '#52525b',
    inkFaint: '#71717a',
    band: '#ebebed',
    bandInk: '#18181b',
    accent: '#10b981',
    you: '#d97706',
    work: '#2563eb',
    ok: '#059669',
    bad: '#e11d48',
    extra: '#7c3aed',
  },
  dark: {
    page: '#09090b',
    panel: '#18181b',
    inset: '#18181b',
    line: '#27272a',
    lineStrong: '#3f3f46',
    ink: '#f4f4f5',
    inkSoft: '#a1a1aa',
    inkFaint: '#71717a',
    band: '#09090b',
    bandInk: '#f4f4f5',
    accent: '#10b981',
    you: '#fbbf24',
    work: '#60a5fa',
    ok: '#34d399',
    bad: '#fb7185',
    extra: '#a78bfa',
  },
};

export const DEFAULT_THEME_ID = 'wayfinding';

export const BUILTIN_THEMES: ThemeEntry[] = [
  { id: 'wayfinding', theme: WAYFINDING, builtIn: true },
  { id: 'classic', theme: CLASSIC, builtIn: true, stock: true },
];
