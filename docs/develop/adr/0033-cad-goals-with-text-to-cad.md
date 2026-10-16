# ADR-0033: CAD goals with text-to-cad, behind a Desktop apps & printers switch

- Status: accepted · 2026-10-16 · amends ADR-0008 (goal natures) and ADR-0016 (MCP servers allowed per server)

## Context

People asked Foundry to design things, not only to write software: a bracket for a pipe, a gear train, an enclosure
for a board, a robot's description files. [text-to-cad](https://github.com/earthtojake/text-to-cad) (MIT) gives a
coding agent exactly that: twelve skills on top of build123d and OpenCASCADE (run through `cadgen`, installed with
uv), STEP as the main output with STL, 3MF and GLB on request, engineering drawings, DXF cut profiles, URDF/SRDF/SDF
files, printability (DfAM) and manufacturability (DFM) checks, headless slicing, a browser viewer, and two hand-offs
that open desktop apps on the person's computer (Bambu Connect / Bambu Studio for printing, OrcaSlicer's window).
It ships as a plugin for Claude Code and for Codex, with an MCP server (`cad`) whose tools are read-only viewer
operations plus a telemetry switch. It sends usage statistics by default and checks for updates once a day.

Foundry's natures (ADR-0008) knew code, documents, research and media. CAD fits none: it is code work (a Python source
that builds geometry, checks that measure it) whose deliverables are files outside git, like media.

## Decision

- **A nature `cad`, and a scenario `cad`.** A cad goal is code work with a geometry kernel: model presets use the
  Code table, the view stays the default (not Simple), TDD is *preferred* (the geometry checks are written before the
  model), Ponytail applies, the audit can run. The Clarifier makes the manufacturing process and the key dimensions
  with their unit blocking questions unless the prompt states them; material, tolerances and fits, mating parts,
  build volume and extra formats are assumptions; no style proposals. The planner cuts one task per part or
  assembly, drawings and robot description files after the parts they describe, with Python geometry checks as
  command checks and a DfAM/DFM check for the named process. Code goals get the same skills in their `cad`-scenario
  tasks. The cheap nature classifier offers `cad` only where text-to-cad is installed; a cad goal created without it
  waits before Clarify, with the install one click away on its page.
- **Sources in the repository, exports as artifacts.** The build123d source is committed where the repository keeps
  such things (else `cad/`); STEP and the other formats, and the front, top, right and isometric snapshots of every
  deliverable, live under `artifacts/` (kept out of git, delivered to the output folder) and are listed in the
  manifest under `docs/artifacts/`. Reviewers read the snapshots and run the geometry checks; a deliverable without
  snapshots, a missing export or a dimension off the Brief is a blocker; the person is the final judge at milestones.
  The worker renders the snapshots, like media workers render their files: the engine never calls cadgen itself.
  The cad skill's own examples write exports beside the source (`STEP/`, `STL/`, `snapshots/`); the planner, worker
  and reviewer prompts say that Foundry's layout overrides them, so nothing generated is committed twice. Nothing
  committed may reach into the coding agent's plugin folder (its path carries the plugin's version and differs per
  machine and agent): a check that needs one of the skills' tools, such as the DfAM measurer, runs a copy the task puts
  in the repository with its licence. Both rules came from the first real run, whose checks did each of these.
- **text-to-cad is one plugin, a bundle in the catalog.** Twelve entries share the plugin source (the marketplace
  ref `latest`, spelled `#latest` for Claude and `--ref latest` for Codex); the Setup page shows one card. A plugin
  source can now declare the MCP servers it ships, with their deny lists, and a warm-up: once installed, the `cad`
  server is allowed for sessions under the prefix the coding agent gives a plugin's server (Claude Code
  `mcp__plugin_text-to-cad_cad`, Codex `mcp__cad`), with `cad_telemetry` denied (a session never flips the person's
  setting) and the page-only tools `cad_http`, `cad_sync` and `cad_capture_reply` denied too (through them a session
  could reach the viewer's own routes, one of which opens a file manager); the other tools are read-only by the
  server's own annotation, which Foundry takes at its word. Then the plugin's own pinned cadgen command runs once with
  `--version`, so the CAD runtime (Python 3.13 and OpenCASCADE, a few hundred MB) downloads while the person watches
  the Setup page, not inside the first attempt. The install is a background operation (a request would not survive a
  warm-up of minutes); the warm-up runs outside the skills queue and gets the session's switches, never its keys; a
  failed warm-up is reported, the install stands and the first attempt downloads the runtime. A plugin already on disk
  (installed by hand) gets the same allow and warm-up when its bundle is installed, and a page asking whether the plugin
  is there lets a waiting cad goal go on. uv is detected, not installed, by Foundry; the Docker image does not carry
  cadgen.
- **Foundry's processes stay quiet.** Every session runs with `CADGEN_TELEMETRY=0` and `CADGEN_UPDATE_CHECK=0`;
  the person's own use of text-to-cad keeps its settings.
- **Desktop apps & printers is a switch, off by default.** No skill orders or prints by itself, but two hand them to
  apps on this computer. The Safety switch gates them: off, the gated catalog entries (the Bambu hand-off) are left
  out of the skills sections, and the boundary hook, now also on the Skill tool, refuses them under their bare or
  plugin-prefixed name (`text-to-cad:bambu-labs`, which is how a plugin skill is invoked) and refuses the opener
  commands: `open` with any argument (on macOS it always brings an app up), `xdg-open`, `osascript`, `Start-Process`,
  `bambu-connect://`, and the slicers' own programs unless the command carries their headless switches. The hook greps
  the Bash command alone, at command position, never the call's other fields, so a cwd or a description that names an
  app blocks nothing. It is a guard for a model following a skill, not a sandbox: a program launched under another
  name passes. A refused command is a boundary item in the Inbox with its own wording (Approve runs it once); a
  refused skill is noted on the goal. Headless slicing, SendCutSend preflight reports and step.parts lookups stay
  available. It is separate from REA's "MCP tools that run or change things": running untrusted third-party code is
  one risk, operating the person's own apps another.
- **The viewer is the person's.** text-to-cad's `cadgen viewer` is listed as a preview app of every cad goal, started
  only by a person from the milestone or preview card, with the plugin's pinned command on a preview port; walkthroughs,
  self-checks and integrations never start it, do not count it (a cad goal with no app of its own still has "nothing to
  run"), and an integration's restart of the running apps leaves it alone. It opens on the goal's model, not on its
  home: `?file=` with the absolute path of the assembly when one was exported (a STEP named for an assembly or a stack),
  else of the newest STEP, from the workspace while the goal runs and from the output folder once delivered.
- **A milestone of files shows the files.** A milestone of a cad, image or video task records what the task left under
  `artifacts/` (images as screenshots, a video as a clip, the model files named), copied to the goal's screenshots
  folder like a walkthrough's, so the milestone card and the notification channels show the snapshots; there is no
  walkthrough of a preview such a goal does not have.
- **Exports travel with the tasks.** A cad task's worktree starts with the goal workspace's `artifacts/` (what earlier
  tasks exported), the way it gets project skills and style samples: a drawing or an assembly needs the parts' STEP,
  and artifacts never come through git. What a task inherited and left untouched is not copied back at integration, so
  a task that finishes later never puts an older copy over a newer export.

## Consequences

- `GoalNature`, `TaskScenario`, `SkillScenario` and the Brief's LLM-facing enums carry `cad`; `ARTIFACT_NATURES`
  (image, video, cad) names the natures whose deliverables are artifacts, `MEDIA_NATURES` keeps its fast-pace meaning.
- The catalog plugin source has `ref`, `mcpServers` and `warmup`; `CatalogEntry.gate` names a Settings switch an entry
  needs; `mcpToolPolicy` reads plugin-shipped deny lists from the skills catalog next to the MCP catalog's.
- `safety.desktopApps` (`FOUNDRY_DESKTOP_APPS`) reaches sessions as `FOUNDRY_DESKTOP_PATTERNS`,
  `FOUNDRY_SLICER_PATTERNS`, `FOUNDRY_HEADLESS_PATTERNS` and `FOUNDRY_DENIED_SKILLS`; the boundary script reads
  `tool_name`, refuses on the Skill tool too, and tells the engine why (`x-foundry-reason`: boundary, desktop or skill).
  Codex has no Skill tool: for it the gate is the skills sections plus the shell patterns.
- A bundle install is a background operation on its own channel (the Setup page and the goal page follow it and poll
  its record); `/api/cad` tells the New goal form and the goal page whether the plugin and uv are there, for the coding
  agent asked about, and wakes a waiting cad goal.
- Not done: the viewer's bind
  address in Docker (unverified), a `cad` file preview in the task drawer (STEP/STL show as binaries), per-tool allow
  lists for the plugin's server (its remaining tools are read-only by its own annotation), and a marketplace added
  earlier without the `latest` ref (the add says "already exists" and the install follows that other ref).
