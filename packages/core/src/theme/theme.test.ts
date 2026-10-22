import { describe, expect, test } from 'bun:test';
import { Theme, parseTheme } from '../schema/theme.ts';
import { BUILTIN_THEMES, CLASSIC, WAYFINDING } from './builtins.ts';
import { contrast, mix, readable } from './color.ts';
import { entryCss, fillPalette, paletteVars, themeCss } from './palette.ts';

/** the declarations of one block of a generated stylesheet, by variable name */
const blockOf = (css: string, selector: string): Record<string, string> => {
  const line = css.split('\n').find((l) => l.startsWith(`${selector}{`));
  if (!line) throw new Error(`no block ${selector}`);
  return Object.fromEntries(
    line
      .slice(selector.length + 1, -1)
      .split(';')
      .map((d) => [d.slice(0, d.indexOf(':')), d.slice(d.indexOf(':') + 1)]),
  );
};

const minimal = { name: 'Paper', light: { page: '#f4f1ea', panel: '#fffdf8', line: '#e2dccf', ink: '#2b2622' }, dark: { page: '#16130f', panel: '#201c17', line: '#36302a', ink: '#efe9df' } };

describe('colour arithmetic', () => {
  test('contrast follows WCAG: black on white is 21, a colour on itself is 1', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#abc', '#aabbcc')).toBeCloseTo(1, 5);
  });
  test('a mix runs from one colour to the other', () => {
    expect(mix('#112233', '#ddeeff', 0)).toBe('#112233');
    expect(mix('#112233', '#ddeeff', 1)).toBe('#ddeeff');
  });
  test('a colour that does not read is moved until it does, keeping its hue; one that reads is left alone', () => {
    const ochre = readable('#ffc61a', ['#ffffff']);
    expect(contrast(ochre, '#ffffff')).toBeGreaterThanOrEqual(4.5);
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(ochre.slice(i, i + 2), 16));
    expect(r! > g! && g! > b!).toBe(true); // still a yellow-orange, not a grey
    expect(readable('#ffc61a', ['#141920'])).toBe('#ffc61a');
  });
});

describe('theme files', () => {
  test('the built-in themes are valid theme files', () => {
    for (const e of BUILTIN_THEMES) expect(Theme.safeParse(e.theme).success).toBe(true);
  });
  test('a theme needs only page, panel, line and ink in each mode', () => {
    expect(parseTheme(JSON.stringify(minimal))).toEqual({ theme: minimal });
  });
  test('what is wrong is said in words, with where', () => {
    expect(parseTheme('{ "name": "x", ')).toEqual({ error: expect.stringContaining('not valid JSON') });
    const bad = (patch: object) => parseTheme(JSON.stringify({ ...minimal, ...patch }));
    expect(bad({ light: { ...minimal.light, page: 'red' } })).toEqual({ error: 'light.page: a colour is written #rgb or #rrggbb, e.g. #1f2933' });
    expect(bad({ light: { ...minimal.light, pannel: '#fff' } })).toEqual({ error: 'light.pannel: not a theme setting' });
    expect(bad({ dark: undefined })).toEqual({ error: 'dark: Required' });
  });
  test('only colours, font names, numbers and https addresses get in: nothing that could carry other CSS', () => {
    const fonts = (f: object) => Theme.safeParse({ ...minimal, fonts: f }).success;
    expect(fonts({ sans: '"Inter", ui-sans-serif, sans-serif' })).toBe(true);
    expect(fonts({ sans: 'Inter; } body { display: none' })).toBe(false);
    expect(fonts({ sans: 'x</style><script>' })).toBe(false);
    expect(fonts({ stylesheets: ['https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap'] })).toBe(true);
    expect(fonts({ stylesheets: ['http://example.com/a.css'] })).toBe(false);
    expect(fonts({ stylesheets: ['https://example.com/a.css");}body{background:url("x'] })).toBe(false);
    expect(Theme.safeParse({ ...minimal, light: { ...minimal.light, ink: '#000;color:red' } }).success).toBe(false);
  });
});

describe('the generated stylesheet', () => {
  const css = themeCss(WAYFINDING);
  const dark = blockOf(css, ':root:root');
  const light = blockOf(css, ':root:root.light');

  test("the app's grey ramp runs from the page to the ink, in both modes", () => {
    expect(dark['--color-zinc-950']).toBe('#0b0e12');
    expect(dark['--color-zinc-100']).toBe('#e9edf2');
    expect(light['--color-zinc-950']).toBe('#e5e8ec');
    expect(light['--color-zinc-900']).toBe('#ffffff');
  });
  test('every colour family takes its signal: emerald is ok, amber is you, rose is bad', () => {
    expect(light['--color-emerald-500']).toBe('#237f52');
    expect(light['--color-amber-500']).toBe('#ffc61a');
    expect(dark['--color-rose-600']).toBe('#ff6b5e');
  });
  test('signal text reads on panels and pages, and text on a signal fill reads on it', () => {
    for (const [block, mode] of [[light, 'light'], [dark, 'dark']] as const) {
      const p = WAYFINDING[mode];
      for (const s of ['you', 'work', 'ok', 'bad', 'extra']) {
        expect(contrast(block[`--color-${s}-ink`]!, p.panel)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(block[`--color-${s}-ink`]!, p.page)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(block[`--color-on-${s}`]!, block[`--color-${s}`]!)).toBeGreaterThanOrEqual(3);
      }
    }
    // signal yellow is a fill; its text on white turns ochre, and the sign's own text is graphite
    expect(light['--color-you-ink']).not.toBe('#ffc61a');
    expect(light['--color-on-you']).toBe('#11151b');
  });
  test('fonts, corners and the lean of the stage plates come from the theme', () => {
    expect(dark['--font-sans']).toStartWith("'Atkinson Hyperlegible Next Variable'");
    expect(dark['--radius-lg']).toBe('10px');
    expect(dark['--radius-md']).toBe('7.5px');
    expect(dark['--slant']).toBe('-14deg');
    expect(Number(light['--texture-opacity'])).toBeGreaterThan(0);
  });
  test('the dark top bar of light mode gets its own colours, and its main button turns light', () => {
    const band = blockOf(css, ':root:root.light .theme-band');
    expect(band['color-scheme']).toBe('dark');
    expect(band['--color-zinc-950']).toBe('#11151b');
    expect(band['--color-zinc-100']).toBe('#ffffff');
    expect(band['--color-accent']).toBe('#ffffff');
    expect(contrast(band['--color-you-ink']!, '#11151b')).toBeGreaterThanOrEqual(4.5);
  });
  test('a top bar in the page colours adds no block; Classic, drawn by the app itself, adds nothing at all', () => {
    expect(themeCss({ ...minimal, name: 'Paper' })).not.toContain('.theme-band');
    expect(entryCss(BUILTIN_THEMES.find((e) => e.id === 'classic')!)).toBe('');
    expect(themeCss(CLASSIC)).toContain('--color-zinc-950:#09090b');
  });
  test('a minimal theme still gets every colour, its hints readable', () => {
    const p = fillPalette(minimal.light, 'light');
    expect(contrast(p.inkFaint, p.panel)).toBeGreaterThanOrEqual(4.5);
    const v = paletteVars(p);
    expect(Object.values(v).every((c) => /^#[0-9a-f]{6}$/.test(c))).toBe(true);
    expect(v['you']).toBe('#d97706');
  });
  test('font stylesheets are imported first', () => {
    const css = themeCss({ ...minimal, fonts: { sans: '"Inter", sans-serif', stylesheets: ['https://fonts.googleapis.com/css2?family=Inter'] } });
    expect(css.split('\n')[0]).toBe('@import url("https://fonts.googleapis.com/css2?family=Inter");');
  });
});
