import { BUILTIN_THEMES, DEFAULT_THEME_ID, entryCss, type ThemeEntry, type ThemeProblem } from '@foundry/core/browser';
import { create } from 'zustand';
import { api } from './api.ts';

/**
 * The look of this browser's Foundry (ADR-0066): which Theme, and light or dark. Both are kept in this browser only, so
 * each person and each device picks their own; the themes themselves come from the server (built-in ones and the files
 * in its data folder). The chosen theme's stylesheet is kept too, so index.html puts it in place before the first paint.
 */
export type Mode = 'light' | 'dark' | 'system';

/** 'light' or 'dark'; unset = follow the computer */
const MODE_KEY = 'foundry.theme';
const ID_KEY = 'foundry.themeId';
const CSS_KEY = 'foundry.themeCss';
const STYLE_ID = 'foundry-theme';

const read = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string | null) => {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {}
};

const systemQuery = () => (typeof window === 'undefined' ? undefined : window.matchMedia?.('(prefers-color-scheme: light)'));
const storedMode = (): Mode => {
  const m = read(MODE_KEY);
  return m === 'light' || m === 'dark' ? m : 'system';
};
const isLight = (mode: Mode) => (mode === 'system' ? !!systemQuery()?.matches : mode === 'light');

interface ThemeState {
  /** the built-in themes, then the server's theme files once they are read */
  themes: ThemeEntry[];
  problems: ThemeProblem[];
  /** the server's themes folder */
  dir: string | null;
  id: string;
  mode: Mode;
  /** what the page shows now: light, or dark */
  light: boolean;
}

export const useTheme = create<ThemeState>(() => ({ themes: BUILTIN_THEMES, problems: [], dir: null, id: read(ID_KEY) ?? DEFAULT_THEME_ID, mode: storedMode(), light: isLight(storedMode()) }));

function paint(entry: ThemeEntry) {
  const css = entryCss(entry);
  let style = document.getElementById(STYLE_ID);
  if (!style) {
    style = document.createElement('style');
    style.id = STYLE_ID;
    document.head.appendChild(style);
  }
  if (style.textContent !== css) style.textContent = css;
  write(CSS_KEY, css || null);
}

export function selectTheme(id: string) {
  const entry = useTheme.getState().themes.find((t) => t.id === id);
  if (!entry) return;
  write(ID_KEY, id === DEFAULT_THEME_ID ? null : id);
  useTheme.setState({ id });
  paint(entry);
}

export function setMode(mode: Mode) {
  write(MODE_KEY, mode === 'system' ? null : mode);
  const light = isLight(mode);
  document.documentElement.classList.toggle('light', light);
  useTheme.setState({ mode, light });
}

let loading: Promise<void> | null = null;
/** Reads the themes again: a theme file edited in an editor shows as soon as this window is back in front. */
export function loadThemes(): Promise<void> {
  loading ??= api
    .themes()
    .then(({ themes, problems, dir }) => {
      const { id } = useTheme.getState();
      useTheme.setState({ themes, problems, dir });
      const entry = themes.find((t) => t.id === id);
      if (entry) paint(entry);
      // a file being edited that does not parse right now keeps its last good look; a theme that is gone gives way
      else if (!problems.some((p) => p.file === `${id}.json`)) selectTheme(DEFAULT_THEME_ID);
    })
    .catch(() => {})
    .finally(() => {
      loading = null;
    });
  return loading;
}

/** Before the first render: the chosen theme in place (a built-in one at once, a custom one once the server answers). */
export function initTheme() {
  const { id, mode } = useTheme.getState();
  const builtIn = BUILTIN_THEMES.find((t) => t.id === id);
  if (builtIn) paint(builtIn);
  setMode(mode);
  systemQuery()?.addEventListener('change', () => useTheme.getState().mode === 'system' && setMode('system'));
  void loadThemes();
  window.addEventListener('focus', () => void loadThemes());
}
