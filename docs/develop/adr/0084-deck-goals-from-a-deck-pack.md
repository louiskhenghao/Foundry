# ADR-0084: Deck goals — native PPTX decks from a Deck pack in a Python environment Foundry keeps, the Brief standing in for the skill's confirmations, behind a beta switch

**Status:** accepted · 2026-11-02 · builds on [ADR-0005](0005-scenario-skills-and-settings.md), [ADR-0076](0076-figure-goals-from-a-bundled-figure-pack.md) and [ADR-0083](0083-diagram-goals-from-a-diagram-pack.md)

## Context

Hugo He publishes **ppt-master**, an agent skill that turns a topic or a set of documents into a natively editable
PowerPoint deck: real DrawingML shapes, text, charts and tables, transitions, speaker notes, designed page by page as
SVG under a design spec and compiled by its own Python scripts. The person wanted it in Foundry as a kind of goal of its
own, with a Brief, a check and previews, as figures and diagrams got.

The skill differs from the others Foundry carries in four ways. It needs **Python 3.10 or newer with a set of packages**
(python-pptx, PyMuPDF, skia-pathops, uharfbuzz, numpy…), where every skill so far needed at most python3 itself; the
person's Mac has Python 3.9. It is **78 MB** and carries an **integrity guard** that refuses to run when its files are
altered. Its default route has a **two-stage confirmation** a person normally answers on a page the skill serves, and a
**Quick** profile that skips the confirmation but also skips the per-slide previews and cannot resume. And it keeps a
**project folder** of its own (sources, design spec, page SVGs, exports) that it creates under the current folder by
default, which in a goal's workspace would be inside git. Eight decisions were settled with the person through dialogs;
the ones that shape the system are here. The feature ships as a **beta** behind `beta.deck`.

## Decision

- **A nature of its own, `deck`.** A media nature (judged by eye, the fast pace, Simple view, the Media model table)
  and an artifact nature; tasks carry the scenario `deck`; TDD and Ponytail are off. The Clarifier classifies an `auto`
  goal as deck only while the beta is on — off, a deck verdict is document work — and gets a `# Nature: deck` section:
  **one task per deck**, from plan to export, never one per slide (the skill plans, designs and compiles in one run);
  what the Brief settles (audience and occasion, purpose and core message, page range, canvas, language, sources,
  speaker notes, animations, AI pictures only when an image key is set) and 2–4 style options, since a deck's look is a
  real choice. No build or test checks.
- **The deck is committed, with the drawings of its pages.** The finished deck is `decks/<name>.pptx` in the
  repository (or where it keeps decks), named in `delivers`, and the skill's project folder sits beside it at
  `decks/<name>/` (the skill's `project_manager.py init <name> --dir decks`): the design spec and lock, every page's
  drawing (`svg_output/`), the per-slide previews (`svg_final/`), notes, images and icons are committed, so anyone with
  the skill can rebuild the deck and the repository shows every slide; the project's working folders (`exports/`,
  `backup/`, `validation/`, `analysis/`, `live_preview/`, `sources/`) are kept out by a `.gitignore` the task writes.
  The first design kept the deck an Artifact for the Output Folder alone, as images are; the live run delivered a
  repository holding nothing but a manifest — text about a deck nobody could rebuild or see — which is not what a person
  who asked for a deck in their project expects (the lesson ADR-0076 had drawn for figures). A deck is small (tens of
  kilobytes to a few megabytes) and its sources are text; it belongs in the repository like a document does. The deck
  nature is therefore a media nature but not an artifact one: no Output Folder; the deck comes with the branch.
- **A Python environment Foundry keeps.** A `git` catalog source may declare `python: { requirements, version }`. On
  install Foundry runs `uv venv --python <version>` under `<dataDir>/python/<skill>` — uv fetches that Python itself,
  so the system's Python does not matter — and `uv pip install -r <requirements>` into it; the marker records the
  environment and the requirements' hash. A deck task's session gets that environment's `bin` first on its `PATH` (and
  `VIRTUAL_ENV`), so the skill's own `python3 …` commands run with its packages, unchanged. Without uv the skill is
  still installed and the pack reads *partial*; the doctor checks uv, the environment (it imports python-pptx) and
  Chromium. The Docker image needs nothing new: uv and a Python 3.12 are there since graphify and markitdown.
- **The pack, pinned to a release.** `workflow.deckPack` (ppt-master or none) installs like the other packs, at the tag
  `v6.8.0`; the skill's files are copied as published, since its guard refuses altered files. What Foundry wants
  different — where the project goes, no confirmation page, no browser — is said in the worker's prompt.
- **The Brief stands in for the confirmations; the default route stays.** The skill itself allows the person to
  "explicitly delegate" confirmation, in which case the agent makes the Stage-1 decision, derives Stage 2 and presents
  one summary. The worker is told exactly that: the Brief's answers are the submitted values, never launch the
  confirmation page or server, never wait. The default route is kept over Quick because it writes the design spec and
  lock Foundry's resumed session picks up from, and it builds the per-slide previews (`svg_final/`) the person sees. A
  deck task's session may run 60 minutes before Foundry cuts and resumes it.
- **The deck check.** When a deck task lands, Foundry reads each delivered PPTX as the zip it is (a small reader of its
  own: the central directory, inflate), fails the task on a file that is not a deck, a deck with no slides or a slide
  with neither text nor picture, runs the skill's own `pptx_delivery_check.py` with the environment's Python (its JSON
  report; `failed` fails the task), and renders the previews beside the deck to PNGs in the goal's screenshots folder
  for the task's drawer, the milestone card and the reviewers. Without Chromium the previews are not rendered and the
  check says so; the count and the delivery check still run.
- **Pictures.** The image keys the engine already hands to every session (OpenAI, Gemini) reach the skill, which reads
  them from the process environment before its own `.env`; the Clarifier offers AI-generated pictures only when a key
  is set, default none. No key is required for a deck.
- **Beta.** `beta.deck`, off by default: the Slides kind, the Deck skills row, `--nature deck`, the doctor's checks and
  the Clarifier's deck sections stay hidden, and `createGoal` refuses the nature; deck goals made before still open.

## Consequences

- A person on any coding agent can ask for a deck — a pitch, a lecture, a report, a document turned into slides — and
  get an editable PPTX committed with its sources, its slides previewed in Foundry and visible in the repository, for the
  worker's tokens and time (a deck is a long task: tens of pages drawn as SVG). Four templates start it.
- The `python` field on git sources is a platform piece: any later skill with Python requirements uses it. Foundry
  now manages Python environments under its data folder, one per skill, replaced on every install of that skill.
- The skill's packages (PyMuPDF is AGPL) are installed by the person's own install into their data folder, never into
  Foundry's image or repository; the credits page names ppt-master under its MIT license and nothing more.
- The deck check trusts the skill's own delivery check for the deck's internals and adds only what is cheap and
  objective (a zip that opens, slides that exist and are not empty); the content is the reviewer's and the person's.
- Not done: narration audio and video (the skill can; a deck goal does not), the skill's template mode from a person's
  own `.pptx` (the Brief may name one, the worker follows), a per-goal pack choice (one member), Adjust re-entering a
  finished deck's project (an adjustment resumes the task's session, which finds the project folder in the repository).

## Alternatives considered

- **The Quick profile**, which asks nothing. Rejected: no previews for the person, no design spec to resume from when a
  session is cut, and the skill's own advice is that Quick removes traceability, not interaction alone.
- **Asking the person to install the Python packages** (the doctor showing the pip command). Rejected: the Mac's
  Python is 3.9, the packages need 3.10+, and the Docker user would have to run pip inside the container; uv makes the
  environment, Python included, in one step on both.
- **The deck as an Artifact for the Output Folder alone** (the first design, as for images). Rejected after the live
  run: the repository and its pull request carried only the manifest. Committing the PPTX with its page drawings makes
  the repository the place the deck is rebuilt from; a change rewrites a small binary, which git takes in its stride.
- **The skill's own `.env` for the image keys.** Rejected: the keys already reach every session from Settings, and the
  skill reads the process environment first.
- **Converting the PPTX to images with LibreOffice** for the previews. Rejected: the skill's default route already leaves
  one self-contained SVG per slide, rendered by the Chromium Foundry has.
