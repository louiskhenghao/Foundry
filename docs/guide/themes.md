# Themes

> English · [中文](./themes.zh.md)

A theme sets how Foundry looks: its colours in light and dark mode, its fonts, the shape of its corners and its layout: where the navigation sits, and how titles, the stages, labels and what waits for you are drawn. It never changes what a page shows. Three themes come with Foundry, and you can add your own.

## Choosing a theme

Open **Settings → Appearance**, or **Appearance** in the ⚙ menu at the right of the top bar. Each theme shows as a small picture drawn in its own colours and layout, with its layout in a few words under it (**Top bar** or **Side column**, **Poster titles**, **Numbered steps** and so on): press it to use that theme. Under the themes, **Light or dark** offers **Light**, **Dark** and **Same as this computer**, which follows the light or dark setting of your computer or phone. **Light mode** / **Dark mode** in the ⚙ menu switches between the two in one press.

Both are kept in this browser, so each person and each device picks their own. A change applies at once; there is nothing to save.

![Settings → Appearance: the three built-in themes, light or dark, and how to make your own](images/appearance.png)

## The built-in themes

| Theme | What it looks like |
|---|---|
| **Wayfinding** (the default) | Foundry read as a sign system. Concrete grey and graphite, and signal yellow only where you are needed; how things stand shows in signal colours (green done, blue at work, violet in review, red failed), and the sections of a page are coded like the lines of a metro map. A graphite top bar, poster titles, leaning stage plates, labels in capitals, a faint grain on the page, and Atkinson Hyperlegible, a typeface made to tell 0 from O and 1 from l. |
| **Ledger** | Foundry as a book of record. Paper and ink, titles set in Fraunces, a blue-black main button and a highlighter's yellow-green where you are needed. The pages hang off a column down the left, the stages are a numbered line, titles are in small capitals, what waits for you is a card with a highlighter edge, and cards lie flat on the paper. |
| **Classic** | The look Foundry had before themes: zinc greys, an emerald main button and the system's own font, with modest titles, labels as written, the stages as a numbered line, and what waits for you as a card with an amber edge. |

## Make your own theme

1. In **Settings → Appearance**, press **Make a copy** under the theme closest to what you want. Foundry writes it as a file in the themes folder, under a name of its own (for example `wayfinding-copy.json`), and puts it in use.
2. Open the file in an editor. **Open in VS Code** (named after the editor found on this computer; with several, **Open in an editor** lets you choose) is on your theme's card and in the note **Make a copy** leaves. **Open the folder** opens the whole themes folder in an editor or file manager, and the card shows the folder's path with **copy**. Change the colours, the fonts, the corners or the layout. An editor that reads JSON Schema, such as VS Code, checks each value and explains every setting as you type: the file names `theme.schema.json`, which Foundry keeps next to it.
3. Save the file and come back to the Foundry window. Foundry reads the theme files again whenever its window comes to the front, so the change shows at once. **Read the files again** does the same by hand.

A file with a mistake is listed under **Make your own theme** with what to fix, for example `my-theme.json — light.page: a colour is written #rgb or #rrggbb`. While the file is wrong, the theme keeps the last look that worked.

A theme of your own has a **⋯** menu on its card. **Rename…** gives it a new name, and its file takes the name too: this browser keeps wearing it, another browser that wore it goes back to Wayfinding. **Make a copy** starts another theme from it, **Export the file** saves its file to your computer, and **Delete…** removes the file. **Import a theme file**, next to **Open the folder**, brings in a theme file from elsewhere, one exported from another Foundry or written by hand: Foundry checks it as it checks the folder's files, says what to fix when something is wrong, and puts it in use.

The themes folder is `themes/` in Foundry's data folder; the Appearance card shows where that is on your computer. Every `.json` file in it except `theme.schema.json` is a theme, named after the file: lowercase letters, digits and hyphens, and not `wayfinding`, `ledger` or `classic`, which are taken. To share a theme, export its file and import it on the other Foundry, or copy the file into that Foundry's themes folder.

## The theme file

A theme needs a name and four colours for each mode. Everything else is optional, and Foundry works out what is left out. The smallest theme:

```json
{
  "name": "Paper",
  "light": { "page": "#f4f1ea", "panel": "#fffdf8", "line": "#e2dccf", "ink": "#2b2622" },
  "dark": { "page": "#16130f", "panel": "#201c17", "line": "#36302a", "ink": "#efe9df" }
}
```

A fuller one, with every setting:

```json
{
  "$schema": "./theme.schema.json",
  "name": "Night shift",
  "description": "Ink on warm paper, cobalt for the main button.",
  "fonts": {
    "sans": "\"Inter\", ui-sans-serif, system-ui, sans-serif",
    "display": "\"Fraunces\", Georgia, serif",
    "mono": "\"JetBrains Mono\", ui-monospace, monospace",
    "stylesheets": ["https://fonts.googleapis.com/css2?family=Inter:wght@400..800&family=JetBrains+Mono:wght@400..700&family=Fraunces:opsz,wght@9..144,600..900&display=swap"]
  },
  "shape": { "radius": 6, "slant": 0, "texture": "none" },
  "layout": { "nav": "side", "header": "compact", "stages": "steps", "labels": "small-caps", "signs": "card", "surface": "flat" },
  "light": {
    "page": "#f4f1ea", "panel": "#fffdf8", "inset": "#f8f4ec", "line": "#e2dccf", "lineStrong": "#a89f8f",
    "ink": "#2b2622", "inkSoft": "#4a433c", "inkFaint": "#6f665c",
    "band": "#2b2622", "bandInk": "#fffdf8", "accent": "#2747b8",
    "you": "#f2b705", "work": "#2747b8", "ok": "#2e7d4f", "bad": "#c0392b", "extra": "#7b4fa6",
    "codes": ["#2747b8", "#2e7d4f", "#7b4fa6", "#c4651b", "#c0392b", "#1f7f7a", "#a8487a", "#7a7a1f"]
  },
  "dark": {
    "page": "#16130f", "panel": "#201c17", "inset": "#28231d", "line": "#36302a", "lineStrong": "#6d6458",
    "ink": "#efe9df", "inkSoft": "#d3cabd", "inkFaint": "#a59b8e",
    "band": "#0e0c09", "bandInk": "#efe9df", "accent": "#8fa8ff",
    "you": "#f2b705", "work": "#8fa8ff", "ok": "#6cc08b", "bad": "#ff7b6b", "extra": "#c6a3e8",
    "codes": ["#8fa8ff", "#6cc08b", "#c6a3e8", "#f0a35e", "#ff7b6b", "#5cc7c0", "#e98fbf", "#c8c35c"]
  }
}
```

### Colours

Each mode, `light` and `dark`, has its own colours, written `#rrggbb` (or `#rgb`).

| Setting | What it paints | If it is left out |
|---|---|---|
| `page` | the page behind everything | required |
| `panel` | cards, boards, menus and dialogs | required |
| `line` | hairlines and borders | required |
| `ink` | text | required |
| `inset` | code blocks, table heads and boxes inside a card | between page and panel |
| `lineStrong` | field borders, empty task squares and scrollbars | line, a step toward ink |
| `inkSoft` | secondary text | ink, a third of the way to panel |
| `inkFaint` | hints, timestamps and labels | ink, halfway to panel, kept readable |
| `band` | the top bar | page |
| `bandInk` | text and icons in the top bar | ink |
| `accent` | the main button, the chosen tab and option, focus rings | ink |
| `you` | what waits for you: the Needs you signs, the Inbox count, approvals | amber |
| `work` | an agent at work (a running goal or task, a check that runs) and information: links, notes | blue |
| `ok` | done, passing, merged, delivered, added lines | green |
| `bad` | failed, errors, danger, removed lines | red |
| `extra` | reviews, merges and other things that need telling apart | the `work` colour |
| `codes` | up to eight colours that tell things of a kind apart, never how something stands: the Brief's sections, Areas, extension sources, groups of credits. Fewer than eight repeat. | eight hues that read in the mode: blue, green, violet, orange, pink, teal, magenta, lime |

You pick each of `you`, `work`, `ok`, `bad` and `extra` once, and each of the `codes`. Where one is used as text on a card, Foundry darkens it (in light mode) or lightens it (in dark mode) until it reads, keeping its hue: a bright yellow `you` becomes ochre in text. Text on a filled sign or button gets whichever of the theme's colours reads best on it.

Every colour in Foundry follows the theme, on pages this guide does not show too. The coding agents' own colours (Claude Code's orange, Codex's blue, Antigravity's teal) stay the same in every theme, so who did the work is always recognisable.

### Fonts

| Setting | What it is |
|---|---|
| `sans` | the text font, as a CSS font list, for example `"Inter", ui-sans-serif, sans-serif`. Left out: the system's own font. |
| `display` | page titles and other large headings (Ledger sets them in Fraunces). Left out: the text font. |
| `mono` | numbers, times, paths and code. Left out: the system's monospace font. |
| `stylesheets` | up to three `https://` addresses of stylesheets that load the fonts, for example from Google Fonts. Fonts installed on the computer need none. |

A font list holds only font names, quotes, commas and spaces.

### Shape

| Setting | What it is |
|---|---|
| `radius` | the corner radius of a card in pixels, 0 to 24 (Wayfinding 10, Classic 8, Ledger 4). Buttons and chips get proportionally less; 0 makes every corner square. |
| `slant` | how far the stage plates lean, in degrees, −30 to 30 (Wayfinding −14, Classic 0). |
| `texture` | `grain` lays a faint grain on the page behind the cards (Wayfinding); `none` leaves it plain. |

### Layout

Each choice is one of a few names. A choice the file leaves out takes Wayfinding's, the first in each list.

| Setting | Choices |
|---|---|
| `nav` | `top`: the pages in a bar across the top. `side`: a column down the left on a screen 1280px wide or more, with **New goal**, the pages, the Inbox and, at its foot, usage, accounts and ⚙ (Ledger). A narrower screen gets the top bar. |
| `header` | `poster`: page titles in very large type. `compact`: a modest title line (Classic). |
| `stages` | `plates`: a goal's five stages as large leaning plates, slim segments on a phone. `steps`: a numbered line of steps (Ledger, Classic). |
| `labels` | `caps`: card titles and headings in capitals. `small-caps`: in small capitals (Ledger). `plain`: as written (Classic). Labels of 11px and under stay in capitals in every theme. |
| `signs` | `strip`: what waits for you is a band in the `you` colour. `card`: a card with an edge, its icon and its waiting time in the `you` colour (Ledger, Classic). |
| `surface` | `raised`: cards and boards with a soft shadow. `flat`: hairlines only (Ledger, Classic). |

## What a theme cannot do

A theme file holds only colours, font lists, numbers, https stylesheet addresses and the layout's named choices. Foundry refuses anything else, so a theme can change how Foundry looks and nothing more. It can move the navigation to the side and draw titles, stages, labels and signs its own way; it never hides, removes or renames anything on a page.
