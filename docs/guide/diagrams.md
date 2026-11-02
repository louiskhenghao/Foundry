# Diagram goals (beta)

A **diagram** is a drawing a reader learns from: how a system is put together, how a request flows, who does what in a process, what happened when, which plan brings the revenue. You describe it in a sentence; a goal of kind **Diagrams** draws it as one self-contained web page with the drawing inside as an SVG, and exports the SVG beside it, ready for a README, a docs page, a wiki or a slide. The page opens in any browser, offline.

Diagrams are a **beta** feature: off until you switch it on, and marked **Beta** where it appears.

The drawing is done by one skill Foundry installs for you, **diagram-design** by Cathryn Lavery: 45 kinds of diagram — architecture, flowchart, sequence, state machine, data model, timeline, swimlane, quadrant, radar, tree, org chart, layer stack, Venn, pyramid, Gantt, Sankey, kanban, user journey, deployment, dependency graph, UML class, database schema, and the chart kinds (bar, line, scatter, treemap, heatmap, waterfall) — in a light, a dark and a full editorial look, with one accent colour, hairline borders and no shadows. It keeps to nine parts a diagram; what needs more becomes an overview and a detail. It can redraw a draw.io, Mermaid or Excalidraw file you give it, and it can take a brand's colours and fonts from a website.

## Switching it on

1. **Settings → Beta → Diagram goals**: on. **Diagrams** appears among the kinds of goal on the New goal form, and **Diagram skills** under Settings → Skills.
2. **Settings → Skills → Diagram skills**: **diagram-design** is chosen already; press **Install**. Foundry clones the skill's repository at one fixed version into your coding agent's skills folder, so a goal always draws with the same skill until a Foundry update moves it on. The pack works like the Design, Image and Video packs: one choice, or **None**.
3. The tools, which the Setup page's doctor lists while the pack is chosen:
   - **Chromium** (Settings → Preview & self-check → **Install Chromium**): Foundry opens every finished page in it to make sure the page runs, and renders the PNG. Without it every diagram task fails its check.
   - **python3**: the skill exports the SVG and checks its own page with two small scripts that need nothing beyond Python itself. The Docker image has it.

No image model and no API key are involved: the whole cost is the worker's tokens and time, like a code goal's. A diagram takes a few minutes.

## Asking for a diagram

On the New goal form pick **Diagrams**. Describe what the drawing should show, as you would to a colleague: *the order service and what it talks to*; *how a refund request is handled, with who approves what*; *a timeline of the migration*; *which plan brings most of the revenue, from these numbers*. One diagram per goal is the easy case; several diagrams become several tasks. The six templates under **Diagrams** — **Architecture diagram**, **Process or flow diagram**, **Sequence diagram**, **Timeline or roadmap**, **Data model from the code** and **Chart from data** — ask for the parts, the steps, the messages, the dates or the numbers and fill in the rest.

Diagrams is a media kind of goal: the form switches to **Simple** and ticks **Fast mode**, and an optional **Output folder** appears (it receives the PNG Foundry renders; the page and the SVG go into the repository). The Brief then settles, before anything is drawn, what each diagram must show and its kind, where it will be read (a README, a wiki, a slide, a link card — the size follows), and once for the goal the look (light, dark or full editorial), the fonts (the skill's web fonts, or system fonts when the page must open offline) and the brand: the skill's own palette, or a website address whose colours and fonts the skill reads. You approve it as any Brief; from the command line it is `foundry goal new "…" --repo <path> --nature diagram`.

When you give a website for the brand, the first task writes the brand's colours and fonts into the repository as `docs/diagrams/style-guide.md`, and every later diagram in that repository follows it; delete the file to go back to the skill's palette. The skill's own installed files are never changed.

## Diagrams inside other goals

While the pack is installed and the beta is on, a **Documents**, **Research** or **Code** goal may draw too. When a reader would learn more from a drawing than from a paragraph — an architecture in a README, the flow in a design document, a timeline in a report — Foundry plans the diagram as a task of its own, before the writing task that uses it, and the document embeds the SVG as a markdown image pointing at `diagrams/<name>.svg`, which GitHub renders. Such a task is drawn and checked exactly like a diagram goal's; the Brief shows it among the tasks, and you can drop it there like any other.

## What you get

Each diagram is one self-contained `.html` page **committed in the repository** at `docs/diagrams/<name>.html` unless your repository keeps diagrams elsewhere, with its SVG beside it at `docs/diagrams/<name>.svg`; a push, a pull request or an auto-merge carries both. The branch also records a manifest: the diagram's kind, what it shows and what was assumed. Foundry's own PNG render of the drawing, at twice the pixel size, goes under `artifacts/` in the progress folder (never in git); the optional **Output folder** receives it.

When a task lands, Foundry itself opens the page in a headless browser: a page that throws, logs an error or has no SVG fails the task, which goes round again, and so does a page the skill's own self-check refuses (its rules for a safe, complete, accessible single file). The **Have a look** card and the task's drawer show the screenshot Foundry took and link the page; the drawer lists the page and the SVG under **Files**. Clicking the page opens it in the preview, running, in a sandbox with no access to Foundry; **Source** shows the file, **Open in a new tab** opens it on its own.

A page loads its fonts from Google Fonts when it is opened, unless the Brief chose system fonts; without a connection the drawing still shows in the system's fonts. Outside Foundry, double-click the file: it is a plain web page.

## Changing a diagram

Once the goal is done, small changes go through **Adjust the result** on the goal page (beta, see [Adjusting the result](./getting-the-result.md#adjusting-the-result)): *add the cache between the gateway and the orders service*, *make the queue the focus*. The session that drew the diagram picks up where it left off and redraws; Foundry opens the page headless again, and keeps the earlier page under **Before it**. For a different diagram, or once the goal's work was merged, ask as a follow-up: **Continue with a follow-up…**, with the change in words. The new goal starts from the finished one, so the worker finds the page and the brand file where it left them.

## Credits

diagram-design is by [Cathryn Lavery](https://github.com/cathrynlavery/diagram-design), MIT licensed; Foundry installs it from its repository at one fixed version and moves that version on with its releases. See the Open source credits page under Settings → About & updates.
