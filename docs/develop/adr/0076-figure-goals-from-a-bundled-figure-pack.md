# ADR-0076: Figure goals — interactive isometric figures from a bundled Figure pack, opened headless by Foundry, behind a beta switch

**Status:** accepted · 2026-10-25 · builds on [ADR-0005](0005-scenario-skills-and-settings.md) and [ADR-0073](0073-a-conversation-about-a-goal.md)

## Context

April Zhu publishes two agent skills that turn one sentence — *a kettle that boils and clicks off by itself* — into an
interactive isometric figure: one self-contained HTML page the viewer drags to turn round, presses, and looks inside.
**Colorfigures** draws hand-inked colour on warm paper with working buttons and a See-through of the mechanism;
**iso-glow** draws dark hairline figures where whatever is live glows, with a 3D mode. The person wanted them in
Foundry, so that anyone with Foundry can ask for a figure and get one, and wanted it set into the workflow rather
than left as a loose skill.

The skills do not fit the catalog as it stood. They are published as tarballs on the author's site: no git repository
to pin, no version, only the latest archive, which changes under whoever downloads it. Foundry's catalog sources are a
GitHub repository at a ref, a plugin marketplace, a command-line tool, a workflow suite, or "installed by hand".
Nothing in Foundry can show a page that runs: `/api/files` serves HTML as plain text on purpose, so a worker can never
plant a script that runs as Foundry. The image pack is one setting for every image task and only generates with an API
key; a figure needs no key, and its style is a property of the figure, not of the installation. And the two skills
contradict each other about browsers: Colorfigures checks its own shots from every side in headless Chrome and builds
the page with python3; iso-glow forbids browser automation and tells the agent to open the page in the person's browser,
which a server cannot do. Twenty-six decisions were settled in a design interview; the ones that shape the system are
here. The feature ships as a **beta** behind `beta.figure`, as the Conversation did (ADR-0073).

## Decision

- **A nature of its own, `figure`.** It is a media nature (judged by eye, the fast pace by default, Simple view) and an
  artifact nature (its files live under `artifacts/`, out of git, delivered to the Output Folder); tasks carry the
  scenario `figure`; model presets use the Media table; TDD and Ponytail are off for figure work. The Clarifier
  classifies an `auto` goal as figure only while the beta is on — off, a figure verdict is image work and a figure goal
  cannot be made — and gets a `# Nature: figure` section: one task per figure, what the Brief must settle before anything
  is drawn (how the real object works, the actions, the colour, whether an inside view is wanted, the page's name), no
  style options (the skill's look is the style), no build or test checks. Image goals keep their "no image backend"
  warning; figure goals need no key and never get it.
- **A Figure pack, with a per-goal Style.** `workflow.figurePack` in Settings (Colorfigures, iso-glow or none) chooses and
  installs like the Design, Image and Video packs, and `packAllows` hides the other member from sessions. Unlike those
  packs, a goal may choose the other installed style: `Goal.figurePack` (null = Settings'), set on the New goal form
  (**Style**), by the CLI (`--figure-pack`), or by the Clarifier when the person left it at the default and the goal's
  words clearly ask for the other look (`figurePack` in the Brief output → `goal.figure_pack_set`). `SkillsHints` lays
  the goal's choice over Settings' (`packs` in `SectionOpts`, `engine.packsFor(goal)`), so one MUST rule reaches the
  worker. Old goals read `figurePack` as null.
- **Bundled skills.** A new catalog source, `bundled: { path }`, names a folder under `catalog/` that Foundry ships in its
  own repository and installs by copying into the skills folder, with a marker whose `commit` is the snapshot's sha256
  (from `SOURCE.json`, else the folder's own hash); an installed copy of an older snapshot is replaced on the next
  install or update. `bun scripts/vendor-figure-skills.ts` downloads each author's archive, refuses anything that is
  not a few plain-text files, replaces `catalog/bundled/<name>/` and writes `SOURCE.json` (archive, date, sha256, files,
  bytes). The files stay exactly as published — their LICENSE (MIT) with them, credited on the Open source credits page;
  what Foundry wants different is said in prompts, never patched into the skill.
- **Foundry opens the pages itself.** When a figure task's Brief is approved it gets a must check of type `figure` beside
  its Deliverable checks. After the attempt, with the command checks, `runFigureCheck` opens each page the task
  delivered (its `.html` Deliverables under `artifacts/`, else every page there) in Playwright's headless Chromium over
  `file://`, fails on a script error, a console error, Colorfigures' `data-errors`, or a page that drew nothing (no svg,
  no canvas), screenshots it — and a Colorfigures page's see-through (`?xr=1&labels=1`) — into the goal's screenshots
  folder, and records a `figure.checked` event the task drawer shows. It is objective, like a command: a failing one
  sends the attempt round again. The task and goal reviewers are pointed at the shots and the page's source rather than
  at the diff. iso-glow's rule against browsers is kept: the worker is told not to open one; Foundry is not the worker.
- **What the worker is told.** The pack member's rule mandates the skill and summarises its workflow; `# Figure
  conventions` adds Foundry's rules: the page under `artifacts/` as `delivers` names it, the manifest, no footer or
  credit line on the page (Colorfigures' `credit: false`, iso-glow's footer deleted — the author allows it when asked),
  labels as the skill says, no browser for the person, and what to do when python3 or a Chrome is missing. The task
  reviewer's and goal reviewer's prompts gain figure review sections.
- **The page runs in a sandbox, or not at all.** `/api/goals/:id/artifacts/*.html` and `/api/files?render=1` for an
  `html` file serve `text/html` with `Content-Security-Policy: sandbox allow-scripts`: the page runs, in an opaque
  origin, with none of Foundry's cookies, storage or API; without `render` a page is plain text as before. `html` is a
  file kind of its own, and the file preview shows a page in a sandboxed `<iframe>` with its source a click away and
  "Open in a new tab" (still sandboxed). iso-glow's pages fetch a web font and, in 3D, three.js from a CDN when opened;
  accepted and documented.
- **The tools.** The doctor, while the beta is on and a pack is chosen, checks Playwright's Chromium (the figure check
  needs it), `python3` (the skills' build steps) and, for Colorfigures, a `google-chrome` or `chromium` on PATH or the
  Mac app (its own shots; skipped without one). The Docker image gains `python3-minimal` and a `google-chrome` shim
  (`chromium` linked to it) that starts the Chromium Playwright downloaded for the engine with the flags a root-less
  container needs; without that download it says where to get one and exits.
- **Beta.** `beta.figure`, off by default. Off: the Figures kind, the Figure skills picker, `--nature figure`, the doctor's
  checks and the Clarifier's figure sections stay hidden, and `createGoal` refuses the nature; figure goals made before
  still open, their pages still show.

## Consequences

- A person on any coding agent can ask for a figure and get a page that is known to run, with Foundry's shots beside it,
  for the price of the worker's tokens: no image model, no key. Colorfigures is slow (15–30 minutes and a few hundred
  thousand tokens a figure); iso-glow is quick (about a minute). The Brief is approved by the person as for any media goal.
- The `bundled` source and the per-goal pack override are platform pieces other packs can use (the Motion studio design
  plans the same two); whichever lands second rebases on them.
- The snapshots are Foundry's responsibility now: a refresh is a Foundry release, reviewed as a diff, never a download at
  run time. The authors' names and licenses travel with the files and on the credits page.
- A page runs in the browser of whoever opens the goal, inside a sandbox: scripts a worker writes can never read Foundry's
  session or call its API. The sandbox also means a page cannot remember its viewer's choices (iso-glow's palette memory
  is lost); accepted.
- `html` became its own file kind, so a repository's HTML files open in the preview as pages too (rendered only on request,
  sandboxed), not only as source.
- Not done: a second delivery round or an in-page "adjust" (ADR-0077 plans Adjust on finished goals, figure goals
  included); the Explainer knows nothing special about figures; no per-figure budget cap.

## Alternatives considered

- **A catalog entry alone, in the image scenario.** Least change, but the image pack's MUST and the figure skill's MUST would
  both reach the worker on image tasks, and there would be no routing, no preview and no render check. A fourth image
  pack option would make every image task a figure. Rejected: a nature of its own is the only shape that does not fight
  the existing packs.
- **Download at install time** (an `archive` source with a pinned sha256). The author publishes only the latest tarball, so
  a pinned hash fails to install the day the author updates, until Foundry re-pins. Rejected for the snapshot, which also
  installs offline and in the image. **Installed by hand** (the `manual` source) was rejected because the Docker user
  would have to run a curl inside the container, and the version would be nobody's.
- **Patching the skills** (a bun build step, Playwright instead of Chrome, a footer removed in the template). Each refresh
  of the snapshot would need the patch again, and the files would no longer be the author's. Rejected: the environment
  is made to satisfy the skills, and Foundry's wishes go into prompts.
- **A reviewer's visual pass over the shots, or a second opinion.** A figure is already a few hundred thousand tokens; the
  person looks at the preview and the shots, which is the review that matters. The headless render check is kept because
  it is objective and free.
- **Showing only screenshots, never the running page.** Safer by construction, but the whole point of a figure is to press
  its buttons. The sandbox directive with an opaque origin gives the same safety for a running page.
