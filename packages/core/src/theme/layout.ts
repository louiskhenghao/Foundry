import type { Theme, ThemeLayout } from '../schema/theme.ts';

/** Every layout choice of a theme, the ones it left out filled in (ADR-0067). */
export type Layout = Required<ThemeLayout>;

/** Wayfinding's layout: what a theme that names no layout, or only part of one, gets for the rest. */
export const DEFAULT_LAYOUT: Layout = { nav: 'top', header: 'poster', stages: 'plates', labels: 'caps', signs: 'strip', surface: 'raised' };

export const layoutOf = (theme: Theme): Layout => ({ ...DEFAULT_LAYOUT, ...theme.layout });

/** what a layout choice is called on <html>: data-nav, data-header… (CSS follows them, see the app's index.css) */
export const LAYOUT_KEYS = Object.keys(DEFAULT_LAYOUT) as (keyof Layout)[];
