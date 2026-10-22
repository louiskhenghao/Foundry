# ADR-0067: Themes lay the pages out, and colour categories and states

**Status:** accepted · 2026-10-23 · amends ADR-0066

## Context

With Wayfinding (ADR-0066) the dozen colour families of the old UI collapsed into five signals, and the redesign drew states in graphite, so much of the colour that told things apart was gone: the Brief's sections and Areas, the Credits page, the side menus, a goal's state plate and its checks. People also asked that a theme be more than a palette: each theme with a style and a layout of its own. ADR-0066 had kept layout out of themes on purpose.

## Decision

**Category colours.** A palette may list up to eight `codes`, hex like every colour; fewer repeat, and a palette without them gets eight hues that read in its mode. They tell things of a kind apart (the Brief's sections, Areas, extension sources, groups of credits) and never say how something stands. The generator writes `--color-code-N`, `--color-code-N-ink` (moved until it reads at 4.5:1, as the signals are) and `--color-on-code-N`; Classic names Tailwind's own hues (sky, emerald, violet, amber, rose, teal, fuchsia, lime), so its sections and Areas look as they did. Pages use them through `CODES` and `code(i)` in `ui.tsx`.

**States in their signal colours.** Done, passed, merged and delivered are green (`ok`), at work blue (`work`), in review violet (`extra`), failed red (`bad`), waiting for the person yellow (`you`), not started hollow: the state plate, the task squares, the stage rail, check lists. Graphite is left to the chrome.

**A display font.** `fonts.display` sets page titles and other large headings; left out, the text font.

**Layout is part of a theme.** `layout` names six choices, each one of a few words, so a theme still holds no CSS: `nav` top | side, `header` poster | compact, `stages` plates | steps, `labels` caps | small-caps | plain, `signs` strip | card, `surface` raised | flat. A choice left out is Wayfinding's. `theme.ts` puts the chosen theme's layout on `<html>` as data attributes and keeps it in localStorage, so `index.html` sets it before the first paint, and hands it to components through `useLayout`. What is styling follows in CSS: the `caps` utility takes the theme's label case, `--surface-shadow` its surfaces, and the variants `header-compact:`, `signs-card:` and `nav-side:` the rest. What is structure follows in React: the shell's side column, the stage rail as plates or steps. Labels of 11.5px and under stay in capitals in every theme; at that size the capitals are what makes them read.

**Three built-in themes.** Wayfinding: a top bar, poster titles, leaning plates, capitals, yellow strips, raised cards. Ledger, new: paper and ink, titles in Fraunces (bundled through `@fontsource-variable/fraunces`, OFL, downloaded only where a theme names it), a side column, numbered steps, small capitals, cards with a highlighter edge, flat cards. Classic: the layout Foundry had before themes, compact titles, labels as written, numbered steps, cards with an amber edge, flat cards.

**On a phone** the plates become slim segments with the current stage's tag, name and note in a line under them, and a side column becomes the top bar.

## Consequences

- ADR-0066's guarantee stands: a theme file can only change how Foundry looks. A layout choice is a word from a fixed list; it can move the navigation and redraw titles, stages, labels and signs, but it cannot hide, remove or rename anything.
- New UI writes titles' capitals with `caps` and tiny labels with `uppercase tracking-[0.08em]`, page titles with `PageHeader` or `PAGE_TITLE`, categories with `code()`, states with the signals, and gives anything coloured `on-you` inside a strip a `signs-card:` alternative.
- The built-in themes reach the browser from the server, which serves `BUILTIN_THEMES`: after changing one in development, restart the server.
- The generated stylesheet grows by 24 variables per mode.
