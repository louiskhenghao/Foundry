import type { Theme, ThemeEntry } from '../schema/theme.ts';

/**
 * Wayfinding: the web UI read as a sign system. Concrete grey and graphite carry everything the agents do; signal yellow
 * hangs only where you are needed; the other signal colours (RAL's red, green, blue and violet) mark failures, passes,
 * information and reviews, and the sections of a page are coded like the lines of a metro map. Atkinson Hyperlegible,
 * made for telling 0 from O and 1 from l, for text and numbers. Poster titles, leaning stage plates, labels in capitals.
 */
export const WAYFINDING: Theme = {
  name: 'Wayfinding',
  description: 'Concrete grey and graphite, with signal yellow only where you are needed.',
  fonts: {
    sans: "'Atkinson Hyperlegible Next Variable', 'Atkinson Hyperlegible Next', ui-sans-serif, system-ui, sans-serif",
    mono: "'Atkinson Hyperlegible Mono Variable', 'Atkinson Hyperlegible Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
  },
  shape: { radius: 10, slant: -14, texture: 'grain' },
  layout: { nav: 'top', header: 'poster', stages: 'plates', labels: 'caps', signs: 'strip', surface: 'raised' },
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
    codes: ['#2563c7', '#1f8a4c', '#7a4fc4', '#dd6b1f', '#c0325f', '#0e8a8a', '#b8409a', '#6f8a12'],
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
    codes: ['#6aa1f2', '#4cc78a', '#ad8cf0', '#f59a55', '#f06f95', '#3cc8c3', '#e07ac4', '#b7cf4f'],
  },
};

/**
 * Classic: the look Foundry had before themes — Tailwind's zinc greys, an emerald button, a hue per section, modest
 * titles, labels as written, a numbered line of stages. The app's stylesheet draws its colours.
 */
export const CLASSIC: Theme = {
  name: 'Classic',
  description: 'Zinc greys with an emerald button: the look Foundry had before themes.',
  fonts: {
    sans: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
    mono: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  },
  shape: { radius: 8, slant: 0, texture: 'none' },
  layout: { nav: 'top', header: 'compact', stages: 'steps', labels: 'plain', signs: 'card', surface: 'flat' },
  light: {
    page: '#ebebed',
    panel: '#ffffff',
    inset: '#f4f4f5',
    line: '#d6d6dc',
    lineStrong: '#c4c4cc',
    ink: '#18181b',
    inkSoft: '#52525b',
    inkFaint: '#71717a',
    band: '#ffffff',
    bandInk: '#18181b',
    accent: '#10b981',
    you: '#d97706',
    work: '#2563eb',
    ok: '#059669',
    bad: '#e11d48',
    extra: '#7c3aed',
    codes: ['#0284c7', '#059669', '#7c3aed', '#d97706', '#e11d48', '#0d9488', '#c026d3', '#65a30d'],
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
    codes: ['#38bdf8', '#34d399', '#a78bfa', '#fbbf24', '#fb7185', '#2dd4bf', '#e879f9', '#a3e635'],
  },
};

export const DEFAULT_THEME_ID = 'wayfinding';

export const BUILTIN_THEMES: ThemeEntry[] = [
  { id: 'wayfinding', theme: WAYFINDING, builtIn: true },
  { id: 'classic', theme: CLASSIC, builtIn: true, stock: true },
];
