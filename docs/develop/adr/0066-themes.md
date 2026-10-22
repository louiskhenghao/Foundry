# ADR-0066: Themes: the web UI's colours, fonts and corners as data, Wayfinding by default

**Status:** accepted · 2026-10-22 · amended by [ADR-0067](0067-theme-layout-and-colours.md) (layout is part of a theme; category colours; states in their signal colours)

## Context

The web UI was written dark-first in Tailwind's zinc ramp and a dozen colour families (about 2,300 zinc classes and 1,300 others), with light mode an override of the zinc ramp and three accent steps. Its look was lifted to Wayfinding: the UI read as a sign system, concrete grey and graphite for everything the agents do, signal yellow only where the person is needed, the RAL signal colours for failures, passes, information and reviews, Atkinson Hyperlegible for text and numbers. People also want to keep the earlier look, and to make their own.

Rewriting every class into tokens was out of reach, so whatever carries a theme has to reach the pages the redesign did not touch. And a theme comes from people's own files: it must not become a way to put arbitrary CSS on the page (attribute-selector exfiltration, `url()` requests, a `</style>` break-out).

## Decision

**A Theme is data, never CSS** (`core/src/schema/theme.ts`): a name, a light and a dark palette (page, panel, line and ink required; inset, lineStrong, inkSoft, inkFaint, band, bandInk, accent, you, work, ok, bad and extra worked out when left out), fonts (a sans and a mono font list, up to three https stylesheets) and a shape (corner radius, the lean of the stage plates, a page grain). Every value is checked to be exactly a hex colour, a font list (letters, digits, spaces, quotes, commas), a number in range, or an https address without quotes, spaces or parentheses; unknown keys are refused. Nothing else reaches the stylesheet.

**The stylesheet is generated** (`themeCss`, `core/src/theme/palette.ts`). It sets the theme's own names (`bg-page`, `text-ink-soft`, `bg-you` with `text-on-you`, `text-ok-ink`…) and points Tailwind's ramps at the palette: zinc runs from page to ink, and each colour family takes a signal (amber, orange, yellow → you; sky, blue, cyan, indigo → work; emerald, green, lime → ok; rose, red, pink → bad; violet, fuchsia, purple, teal → extra), its light steps the readable text colour, its middle the fill, its dark steps tints toward the panel. So every existing class follows a theme without being rewritten. A signal colour used as text is moved lighter or darker in OKLab, keeping its hue, until it reads at 4.5:1 on panel, page and inset; text on a fill is whichever of page, panel and ink reads best. The top bar has a palette of its own (`.theme-band`), its band colour as the page, so a graphite bar in light mode reads and its main button turns light. The selectors are doubled (`:root:root`) so they win over the app's stylesheet whichever loads first.

**Two themes are built in.** Wayfinding is the default. Classic is the app's own stylesheet: index.css names its colours by pointing at Tailwind's ramps, and it generates nothing; its theme data exists for its picture in Settings and for copies. Each coding agent's colour (Claude Code orange, Codex blue, Antigravity teal) is fixed in every theme: it says who did the work, never a signal.

**The choice is per browser**, as light and dark already were: the theme's id, the mode (light, dark, or the computer's) and the generated stylesheet are kept in localStorage, and index.html applies that stylesheet before the first paint. Custom themes are files, `themes/<id>.json` in the data folder. `GET /api/themes` lists the built-in ones and every readable file, with a sentence for each file that cannot be used; `POST /api/themes` writes a copy of a theme to edit, next to `theme.schema.json` (the schema as JSON Schema, which the copy names) so an editor checks and explains the file; `POST /api/themes/open` opens the folder in an editor. The page reads the files again whenever its window comes to the front, and a file that does not parse keeps the last look that worked.

**Layout is not a theme.** The redesign's structure (the Needs you signs and boards of the Goals page, the stage rail, the task squares, Graph | List) is shared by every theme. A theme changes colours, fonts, corners, the lean of the stage plates and the page's grain.

## Consequences

- A theme reaches only what is written in the theme's names or Tailwind's ramps. A fixed colour (`text-white`, a hex in a style) stays as written, so new UI is written in the theme's names.
- Under a generated theme, the dozen colour families collapse into five signals: sky and blue, violet and fuchsia no longer differ. Classic keeps them because it generates nothing, and a copy of Classic is drawn by the generator, so it is close to Classic but not the same.
- A theme's stylesheet address is fetched by every browser that uses the theme. Only https is allowed, and only whoever can write the data folder can add one; the API copies themes but never writes their content.
- The generated stylesheet is about 24 KB, kept in localStorage per browser.
- Themes do not travel with Transfer; copying the file is enough.
