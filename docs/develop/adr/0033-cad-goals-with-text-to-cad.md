# ADR-0033: CAD goals with text-to-cad, behind a Desktop apps & printers switch

- Status: accepted · 2026-10-16 · amends ADR-0008 (goal natures), ADR-0016 (MCP servers allowed per server) and ADR-0015 (the after-merge tidy-up)

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
  home: `?file=` with the absolute path of the assembly when one was exported (a STEP whose name says assembly, or has
  asm, assy or stack as a word of its own), else of the newest STEP, from the workspace while the goal runs and from the
  output folder once delivered. The link is built when the card reads it, so a running viewer follows a newer assembly;
  the model is kept for ten seconds and dropped at every landing or delivery, since every status poll asks for it, and
  a cad goal's delivery records the model it picked by the exports' own times (`goal.artifacts_delivered` `model`), so
  the output folder, perhaps a network share, is never searched for it.
  It is never put on the tailnet: cadgen serves any file it is given the path of, with no root to keep it in, so there it
  would hand this computer's files to every device on the tailnet. Opened at an address other than localhost, the card
  says it opens only on Foundry's computer, with the viewer's localhost address as the link, for that computer reached
  by its network name.
- **A milestone of files shows the task's own files.** A milestone of a cad, image or video task shows what that task
  produced: the files its landing copied into the goal workspace, recorded as `task.artifacts_landed` (a goal from
  before that falls back to the files changed since the task's first attempt). Its images and up to four clips, the
  ones the milestone and the task's manifest name first, are copied to the goal's screenshots folder under names drawn
  from what they copy (path, size, time): two files never share a copy, a rerun over unchanged files copies nothing, and
  a clip over 200 MB is named instead. Models and drawings are named, and the card links them (the delivered copy once
  the goal folder is gone); a task that landed nothing has nothing to look at. The card shows the pictures whole, the
  screenshots route serves every format collected, and there is no walkthrough of a preview such a goal does not have.
  The paused card lists the goal's other artifacts only where that evidence does not show them. A finished goal's
  Transfer leaves behind the clip copies of files its output folder received (a failed, cancelled or undelivered goal
  carries them); the pictures travel, and a tile whose copy is not on this computer says so (one this browser cannot
  play opens the file instead).
- **Exports travel with the tasks.** A cad task's worktree starts with the goal workspace's `artifacts/` (what earlier
  tasks exported), the way it gets project skills and style samples: a drawing or an assembly needs the parts' STEP,
  and artifacts never come through git. What a task inherited and left untouched is not copied back at integration, so
  a task that finishes later never puts an older copy over a newer export. A manual merge resolution lands the task's
  artifacts the same way before its worktree goes. The throw-away worktrees that run the goal's checks (the merge
  baseline, a manual merge resolution, the stacked delivery) get artifacts too: without them every check that measures
  an export read as "already failing" and merges were judged blind to it. Those copies happen only for goals that keep
  artifacts, never over a file git tracks (a repository's own `artifacts/` folder comes through git), and never at the
  cost of the checks: a failed copy is noted. A merge attempt's baseline takes its artifacts from the worktree the merge
  happens in (a task's own on a catch-up), so both sides of the comparison measure the same exports, and a resolution's
  worktree gets the goal's artifacts and then the task's changes, after its squash merge. A squash that conflicts at
  integration (another task landed between the task's last catch-up and its squash) has its merge attempt checked in
  the goal workspace with the task's changed exports laid over the goal's, after the baseline measured the goal as it
  was (only when there are must checks to read them): what they cover is saved beside the progress folder with a list
  of what they write and its digest, and put back when the merge does not land, only where a file still holds what the
  overlay wrote and never through a link; a file that cannot be read or put back keeps its entry, and the list keeps
  only those (an overlay folder, or a task's, that is not a real folder is refused). What is left is undone again at
  engine start, before a merge attempt's baseline (an attempt fails rather than measure over what cannot be), before
  a cad task inherits the exports, before a manual resolution copies them and before the delivery; a task's landing
  undoes its own first, so what it leaves alone is the goal's, and forgets the entries for the files it then writes.
  Landings take the goal workspace's lock, so none interleaves with an overlay or its undo, and a task's commit and its
  exports land in one locked step, after a merge attempt and a manual resolution alike (whose checks also copy the
  goal's exports under that lock, and whose Finish lands only while the task still waits on its merge). A manual
  resolution's checks and its baseline read one copy of the goal's exports, taken without the lock unless an overlay
  is in place or the exports changed while it was taken, so it neither waits for another task's merge nor measures
  exports one laid over. A merge attempt's commit that git would not take back is named on its escalation, which keeps
  the goal blocked while it is open. Nothing builds on it meanwhile: integrations, catch-ups, new task worktrees and
  manual resolutions settle it first (a task whose checks passed waits to land), and an answer, a manual resolution's
  start or a restart (an aborted goal's too) takes it back before going on, or is refused, saying to reset by hand or to
  revert it under commits that landed on top. Whether it is settled is read from its branch (a take-back moves only the
  branch checked out there), and a revert is recognised by its exact changes, not its message. Catch-ups and new task worktrees read the goal branch under the goal
  workspace's lock, so never a merge attempt's commit before its checks finish (the catch-up before a task starts is
  skipped while another task's merge holds the lock). A merge attempt records the commit it makes (`attempt.committed`) and
  takes it back before it concludes (one git refuses concludes once its escalation names the commit): one the engine
  stopped during, its take-back included, has that commit, and only that one, taken back at the next start, the
  worktree's other changes kept; one git refuses then, or one with commits on top of it, is named on an escalation the
  same way. A task still merging at the next start (landing, or waiting to land, its merge attempt cut off included)
  runs again, its attempt given back. A second answer to an escalation while
  the first is being applied is refused. The artifacts listing follows
  no symbolic link and leaves out what Finder and Windows leave in a folder (`.DS_Store`, `._` sidecars, `Thumbs.db`,
  `desktop.ini`), so none of those is landed, delivered or opened as the model, and no copy writes through one: each file is copied beside its destination and renamed over it, so
  a copy cut short leaves the old file, and the copies run off the event loop (a disk that cannot clone copies hundreds
  of MB while the server keeps answering). A landing leaves files git tracks to the commit, still copies the other files
  when one fails (a folder it cannot read counts as failed), records the failures for the milestone, and then keeps the
  task's worktree; a task that worked in the goal workspace records the files it changed there. A failure is settled by
  any later landing that brought the same file, by this task or another (the goal workspace holds the newer copy, which
  a copy of the old one must not replace), and a folder that could not be read once a later landing of the task brought
  files from under it, or a retry read it through (`settled`); a folder's retry never copies a file a landing brought
  after the folder failed, and a failure it narrows to a subfolder keeps the folder's age. The delivery first copies
  again what is still outstanding, as a landing of its own, which it records only when something came over or changed;
  a goal that keeps artifacts records its delivery even when there is nothing to copy, so no tick delivers it again, and
  one that ran again after its delivery began (a restart, told by the order of the events, not their times) is
  delivered again when it finishes, while its progress folder still holds artifacts. It replaces only the copies it made
  there: a file changed in the output folder since, before its copy or while it ran, is left as it is, now and on later
  deliveries, a delivery that did not have the file included (the new version stays in the progress folder). The
  identity of each copy as it was made (inode, size, time) and the goal's last state change when the delivery began
  (its event id, which a Transfer keeps) are recorded with it. The after-merge
  tidy-up (ADR-0015) of a goal that keeps artifacts also waits while files exist nowhere else: an artifact no output
  folder received, one written after its delivery began (`goal.artifacts_delivered` `startedAt`), or one whose copy in
  the output folder is gone, of another size, or neither the copy the delivery made nor a file of the same content
  (another goal delivering into the same folder replaced it, or it was changed there; a network share that changes inode
  numbers falls back to the content) (style samples and files git tracks aside), or a file a kept task worktree still holds that
  its landing could not copy; it waits for a delivery still copying, which runs it once its files are there (the hold
  is recorded as waiting, so a delivery that ended while the engine was stopped still does; a hold of any other kind
  waits for a refresh or a button). **Clean up anyway** removes them too, once any copy in flight has ended: it waits
  half a minute at most, for that copy and for the goal workspace's lock, then holds and asks to be pressed again (a
  copy into a share that stopped answering never ends until Foundry restarts), and removes nothing of a goal restarted
  while it waited; a restart is refused while it removes the folders. A goal running again
  after its merge is never tidied up, not even anyway, and one that finished again after its merge is not tidied up on
  its own (what it made since is in no merge). A restart from the task reruns it, which makes them
  again. Baselines of a goal run one at a time, are keyed by the contents of the exports they measure (one digest per
  file, read as a stream that lets the server answer, not their sizes and times, which a re-export can keep), are not
  measured at all for a goal with no must command checks, and count nothing as already failing when those exports
  cannot be copied. A manual resolution holds work while its
  squash merge, a change to a tracked file, or a commit past its recorded start is there (untracked leftovers do not
  count), so a page load never starts it over under the person's edits, and a Finish cut short after its commit is
  completed by the next one (finished up, when the commit had already landed). A session merged from an older tip of the
  task branch (before a retry) is replaced, and Finish runs only while the task still waits on its merge. The exports a resolution lands follow the code it kept: none when it kept the goal's side throughout,
  only the ones the goal lacks when it kept the goal's side for some of the task's files.

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
  earlier without the `latest` ref (the add says "already exists" and the install follows that other ref). An export a
  check rewrites while an overlay is in place stays as the check left it. A task working in the goal workspace while
  another task's conflicted integration is checked there loses what it had not committed when that attempt fails (its
  abort did so already before the take-back). A goal restarted after its merge is not delivered again: what it makes
  then stays on the goal branch. A re-delivery checks the output folder's file right before it renames its copy over
  it: an edit saved in that instant can still be replaced. A task branch that merged an unverified commit before this release is not checked for
  it when it lands.
