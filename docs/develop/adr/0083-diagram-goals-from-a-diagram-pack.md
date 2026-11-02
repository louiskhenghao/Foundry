# ADR-0083: Diagram goals — editorial diagrams from a Diagram pack, committed with their SVG, opened headless by Foundry, behind a beta switch

**Status:** accepted · 2026-11-02 · builds on [ADR-0005](0005-scenario-skills-and-settings.md) and [ADR-0076](0076-figure-goals-from-a-bundled-figure-pack.md)

## Context

Cathryn Lavery publishes **diagram-design**, an agent skill that turns a sentence — *the order service and what it talks
to* — into an editorial diagram: one self-contained HTML page with an inline SVG, in one of 45 types (architecture,
flowchart, sequence, state machine, ER, timeline, swimlane, org chart, Gantt, Sankey, UML class, the chart types…),
one accent colour, hairline borders, no shadows, a budget of nine nodes. It redraws draw.io, Mermaid and Excalidraw
files, exports the SVG with a standard-library Python script, and takes a brand's palette and fonts from a website. The
person wanted it in Foundry so that anyone can ask for a diagram and get one, and wanted it set into the workflow — a
Brief, a check, a preview — rather than left as a loose skill.

A diagram is not a figure (ADR-0076): a figure is a playable object, a diagram is a drawing a reader learns from, and
it belongs as much inside a document or a README as on its own. The skill has two interactive pauses Foundry's
worker cannot honour — a first-run gate that asks whether to customise the style guide to a brand, and a
"confirm before drawing" pause — and its brand onboarding rewrites the installed skill's own `style-guide.md`, which
every goal on the computer shares. Its PNG export needs a Python Playwright Foundry does not install. The repository
publishes no releases; its version field is bumped on every merge. Eight decisions were settled with the person; the
ones that shape the system are here. The feature ships as a **beta** behind `beta.diagram`, as figures did.

## Decision

- **A nature of its own, `diagram`, and a scenario other goals may use.** A diagram goal is a media nature (judged by
  eye, the fast pace by default, Simple view) and an artifact nature (Foundry's PNG renders live under `artifacts/`);
  its tasks carry the scenario `diagram`; model presets use the Media table; TDD and Ponytail are off for diagram work.
  The Clarifier classifies an `auto` goal as diagram only while the beta is on — off, a diagram verdict is document work
  and a diagram goal cannot be made — and gets a `# Nature: diagram` section: one task per diagram, what the Brief must
  settle (what each shows, its type, where it will be read; once for the goal the skin, the fonts and the brand), no
  style options (the skill's design system is the style), no build or test checks. Unlike a figure, a diagram is also a
  task a **document, research or code goal** may carry: while the pack's skill is installed and the beta is on, the
  Clarifier and the planner are told that a figure a reader would learn from is a diagram task of its own, placed before
  the writing task that embeds the SVG; the engine attaches the diagram check to every task of the scenario, whatever the
  goal's nature.
- **The page and the SVG are committed.** A diagram's finished page is a Deliverable at `docs/diagrams/<name>.html`
  (or where the repository keeps diagrams), with its SVG export beside it at `docs/diagrams/<name>.svg`, both named in
  `delivers` and both in the diff; a document embeds the SVG, never the page, so GitHub renders it. The worker exports
  the SVG with the skill's own `scripts/export_svg.py` and makes no PNG: Foundry renders `artifacts/diagrams/<name>.png`
  itself, at twice the pixel size, when the task lands — an Artifact that lands in the goal workspace and the Output
  Folder — so the skill's Playwright exporter is never needed.
- **A Diagram pack, chosen in Settings.** `workflow.diagramPack` (diagram-design or none) chooses and installs like the
  Design, Image, Video and Figure packs, and `packAllows` hides the entry from sessions of other scenarios. There is no
  per-goal choice: the pack has one member. The skill installs from its repository as a `git` catalog source **pinned to
  one commit**, since it publishes no releases; a refresh is a catalog change, reviewed as a diff. Its two scripts the
  worker and the engine run are standard-library Python, so python3 is the whole requirement.
- **The Brief answers the skill's pauses; the brand lives in the repository.** The worker is told that the Brief has
  answered the first-run gate and the confirm-before-drawing pause and never asks. When the Brief names a website for
  the brand, the first diagram task follows the skill's onboarding but writes the result to `docs/diagrams/style-guide.md`
  in the repository, a full copy of the skill's style guide with the brand's tokens, and later tasks read it; the
  installed skill's own files are never edited. The skill's profile library under the home folder is not used: a brand
  kept there would not follow the repository to another computer.
- **The diagram check.** When a diagram task lands, Foundry opens each delivered page in headless Chromium over
  `file://`, fails the task on a script error, a page with no `<svg>` or an empty viewBox, screenshots it for the task's
  drawer and the reviewers, renders the first SVG to the PNG, and runs the skill's own `scripts/self_check.py` on the
  page (its accessible-SVG contract, single-file safety, content inside the viewBox): a page it refuses fails the task.
  A web font the page could not fetch — the skill loads Google Fonts unless the Brief chose system fonts — is noted,
  never a failure. The reviewers read the check's results and open the screenshots; the milestone card shows the shots
  and links the page, which runs in the same sandboxed frame as a figure's.
- **The tools.** The doctor, while the beta is on and the pack is chosen, checks Playwright's Chromium (the check needs
  it) and python3 (the skill's scripts). The Docker image needs nothing new: python3 and Chromium are there since
  ADR-0076.
- **Beta.** `beta.diagram`, off by default. Off: the Diagrams kind, the Diagram skills picker, `--nature diagram`, the
  doctor's checks, the Clarifier's diagram sections and the diagram tasks offered to other goals stay hidden, and
  `createGoal` refuses the nature; diagram goals made before still open and their checks still run.

## Consequences

- A person on any coding agent can ask for a diagram, or for a document whose figures are drawn, and get pages that are
  known to run, with their SVGs in the repository and a PNG in the output folder, for the price of the worker's tokens:
  no image model, no key. A diagram takes a few minutes.
- The pack's skill is pinned to a commit, not a release: a refresh is a Foundry change like any other, and the credits
  page names the project under its MIT license.
- The brand tokens travel with the repository (`docs/diagrams/style-guide.md`), so a later goal on another computer
  draws in the same brand; the skill's own profile library is not used, and a person who keeps profiles there for their
  own sessions is not affected.
- Running the skill's self-check in the engine means a page the skill itself would refuse never passes; it also means a
  stricter rule in a later pin fails tasks that passed before — accepted, since the pin only moves by a reviewed change.
- Not done: a Mermaid or draw.io import as a goal of its own (the worker may redraw a file the Brief names); a per-goal
  pack choice (one member); the Explainer knows nothing special about diagrams.

## Alternatives considered

- **A catalog entry alone, on the docs scenario.** Least change, but the skill's rules would reach every writing task,
  there would be no routing, no check, no PNG and no preview, and the first-run gate would stop every session. Rejected:
  a nature and a scenario of their own are the only shape that does not fight the writing tasks.
- **A figure.** The figure nature already opens pages headless; a diagram could have been a figure style. Rejected: a
  figure is an object to play with, drawn under `figures/` with a see-through shot; a diagram is read, embedded in
  documents, and cut as a task inside other goals, which a figure never is.
- **A bundled snapshot** (ADR-0076's `bundled` source). The author publishes a repository, so a pinned commit gives the
  same stability without carrying 6 MB of examples in Foundry's own repository. Rejected for this skill.
- **The skill's PNG exporter** (`export_png.py`, Python Playwright). Rejected: the engine already has Playwright's
  Chromium open on the page; a second browser install for the same screenshot is waste.
- **Letting the skill customise its installed style guide** from the Brief's brand URL. Rejected: the file is shared by
  every goal on the computer and replaced on the skill's update; the repository copy is the only place that follows the
  project.
