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
- **text-to-cad is one plugin, a bundle in the catalog.** Twelve entries share the plugin source (the marketplace
  ref `latest`, spelled `#latest` for Claude and `--ref latest` for Codex); the Setup page shows one card. A plugin
  source can now declare the MCP servers it ships, with their deny lists, and a warm-up: once installed, `mcp__cad`
  is allowed for sessions (only `cad_telemetry` denied, so a session never flips the person's setting) and the
  plugin's own pinned cadgen command runs once with `--version`, so the CAD runtime (Python 3.13 and OpenCASCADE, a
  few hundred MB) downloads while the person watches the Setup page, not inside the first attempt. uv is detected,
  not installed, by Foundry; the Docker image does not carry cadgen.
- **Foundry's processes stay quiet.** Every session runs with `CADGEN_TELEMETRY=0` and `CADGEN_UPDATE_CHECK=0`;
  the person's own use of text-to-cad keeps its settings.
- **Desktop apps & printers is a switch, off by default.** No skill orders or prints by itself, but two hand them to
  apps on this computer. The Safety switch gates them: off, the gated catalog entries (the Bambu hand-off) are hidden
  from sessions, and the boundary hook, now also on the Skill tool, refuses them and the opener commands (`open -a`,
  files opened by extension, `xdg-open`, `Start-Process`, `bambu-connect://`, Bambu Studio). Headless slicing,
  SendCutSend preflight reports and step.parts lookups stay available. It is separate from REA's "MCP tools that run
  or change things": running untrusted third-party code is one risk, operating the person's own apps another.
- **The viewer is the person's.** text-to-cad's `cadgen viewer` is listed as a preview app of every cad goal, started
  only by a person from the milestone or preview card, with the plugin's pinned command on a preview port; walkthroughs
  never start it.

## Consequences

- `GoalNature`, `TaskScenario`, `SkillScenario` and the Brief's LLM-facing enums carry `cad`; `ARTIFACT_NATURES`
  (image, video, cad) names the natures whose deliverables are artifacts, `MEDIA_NATURES` keeps its fast-pace meaning.
- The catalog plugin source has `ref`, `mcpServers` and `warmup`; `CatalogEntry.gate` names a Settings switch an entry
  needs; `mcpToolPolicy` reads plugin-shipped deny lists from the skills catalog next to the MCP catalog's.
- `safety.desktopApps` (`FOUNDRY_DESKTOP_APPS`) reaches sessions as `FOUNDRY_DESKTOP_PATTERNS` and
  `FOUNDRY_DENIED_SKILLS`; the boundary script reads `tool_name` and refuses on the Skill tool too. Codex has no Skill
  tool: for it the gate is the hidden prompt plus the shell patterns.
- A bundle install streams on its own operation channel (the Setup page follows it); `/api/cad` tells the New goal
  form and the goal page whether the plugin and uv are there.
- Not done: a deep link from a milestone to the model in the viewer (the viewer opens on its home), the viewer's bind
  address in Docker (unverified), a `cad` file preview in the task drawer (STEP/STL show as binaries), and
  per-tool allow lists for the plugin's server (its tools are read-only today).
