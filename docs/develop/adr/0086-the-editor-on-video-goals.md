# ADR-0086: The Editor on video goals — HyperFrames' browser editor as a preview app the person starts, a scrubber page for motion-studio films, and Re-render without a session, behind a beta switch

**Status:** accepted · 2026-11-03 · builds on [ADR-0077](0077-the-motion-studio-video-engine.md) and [ADR-0078](0078-adjust-the-result.md); the preview app pattern of the CAD Viewer (text-to-cad, ADR-0064)

## Context

A video goal's result is a film, and the person wanted to open an editor on it from Foundry: to watch the agent's
work as it grows, and to cut, retime and restyle the film themselves once it is done. The idea arrived as "add
Remotion", a React framework with a Studio. Remotion was looked at and set aside on its licence: it is
source-available, free only to individuals and companies of at most three people, and otherwise a Company License per
seat for everyone who writes Remotion code, agents included, with a tier aimed at "prompt-to-video tools" that a
hosted Foundry could be read as. The duty would fall on the owner of the goal's repository, and on the person's own
company. HyperFrames, already a video engine of Foundry's (Apache-2.0, HeyGen), ships what was wanted: `hyperframes
preview` serves a full browser editor — timeline with move, trim and split, inspector, layers, keyframes, captions
word by word, assets, lint and an export queue — whose every change saves straight to the project's files. It binds
to the loopback by default, has no authentication, speaks server-sent events, and cannot be served under a sub-path.

Facts that shaped the design: Foundry's previews open in a new tab, never an iframe, and reach the person's phone
through `tailscale serve`; a preview app a tool brings (the CAD Viewer) is appended to the goal's apps and filtered
out of every start that is not the person's; a HyperFrames project is the folder `hyperframes init` made, marked by
its `hyperframes.json`, with the CLI release pinned in its own `package.json` scripts, needing no `node_modules`; a
motion-studio film is `motion/<slug>/index.html` with `window.seek(t)` and a `?render=1` switch for its own play
loop; an Adjustment already keeps the result aside under `artifacts/.history/<n>/` and lands as a commit of its own;
the artifacts are delivered again only after a `goal.state_changed` to running. The person settled the shape through
dialogs (22 questions and a list of assumptions).

## Decision

- **A beta switch, `beta.editor`** (`FOUNDRY_BETA_EDITOR`), off by default: the Editor rows, the scrubber pages and
  Re-render all hang on it. Nothing of the goal's work changes with it off.
- **The Editor is a preview app of the goal, one per HyperFrames project**, found by scanning the goal's workspace
  for `hyperframes.json` (four levels down, `node_modules` and the engine's folders left out), under the app key
  `editor:<folder>`. Its command is `npx --yes hyperframes@<version> preview --port {port} --no-open --foreground`,
  run in the project's folder, at the release the project's scripts pin, else Foundry's known-good pin
  (`HYPERFRAMES_PIN`); in Docker `HYPERFRAMES_PREVIEW_HOST` is the bind host, since only the preview range is
  published. The preview manager owns its port, process, log, idle stop and tailnet address, as for any app.
- **A person-only app** (`isPersonApp`: the CAD Viewer and the Editor): never counted or started by a milestone, the
  self-check or an integration; left running when the repository's apps restart after a landing; and starting it
  alone installs nothing, since it runs from `npx`. Unlike the CAD Viewer it goes on the tailnet: it serves the
  project's folder, not any path on the computer.
- **During the goal, the agents and the person share the folder.** The Editor row says so; there is no lock. What the
  person saves goes into the agents' next commit or may be overwritten (HyperFrames keeps backups under
  `.hyperframes/backup/`). After the goal finished, the edits are the person's until Re-render.
- **Re-render on a finished HyperFrames goal**, with no session and no cost: refused as an Adjustment is (at work,
  merged, cleaned up, delegated, imported, delivering) and while one runs; then, under the goal's workspace lock, the
  result kept aside under `artifacts/.history/<n>/` (the Adjustments' numbering, `snapshotResult`), every film the
  goal delivered under `artifacts/video/<project>/` made again from its own composition and replaced in place
  (`final-<format>.mp4` from `index-<format>.html`, the first format from `index.html`; `final.mp4` from `index.html`
  when the goal left none) by the CLI with `render --quality delivery`, through the harness's loudness pass when the
  repository carries `video/lib/loudness.mjs` (ADR-0087), and probed with ffprobe; `renders/`, `.hyperframes/`,
  `.thumbnails/` and `.waveform-cache/` excluded from git; the edits committed as `chore(video): edits in the editor
  (edit n)`; and two events: `goal.adjusted` with an Adjustment of the new mode `rerender` (so the AdjustCard's
  numbering, `adjustedSinceDelivery` and a pushed branch or open pull request carry on as after any Adjustment) and
  `goal.rerendered` (the files, the commit, the errors per composition), on which `artifactsDue` delivers the new
  files to the output folder once: a Re-render counts until the delivery recorded after it, whatever state change
  that record names as its start (live, a goal that had gone through its states delivered again on every tick). A
  composition whose render failed is recorded and keeps its earlier file; the others land. The HTTP route answers
  202; the output streams on the channel `rerender-<goal>`.
- **A motion-studio film gets a scrubber page, not a process**: `GET /api/goals/:id/film/:slug` is Foundry's own
  page (format menu, Play, a slider, the keys) with the film's `index.html` in an iframe opened with `?render=1`;
  the film's files are served from `motion/` by `GET /api/goals/:id/film-files/<token>/*` with `sandbox
  allow-scripts`, so the film's code never runs as Foundry (as a figure's page, ADR-0076). The sandbox is an opaque
  origin that sends no cookie and is refused fonts and fetches across origins, so the files are reached under a token
  derived per goal from a secret of the process (only the goal's page hands it out; GET, the `motion/` folder alone)
  and answered with `access-control-allow-origin: *`; its scripts are typed to run, and a message listener appended to
  the page lets the scrubber reach `window.seek` by `postMessage`. Read-only: to change a film, Adjust.
- **The UI**: the Workspace & preview card lists the Editor rows with a chip and the warning while the goal works, and
  the films with Open; the Open menu gets an Editor block that starts the app if need be and opens it (at its tailnet
  address from another device); a Re-render card beside Adjust holds the button, the output, the last result and the
  edits with their kept versions, while the Adjust card lists the Adjustments without them.
- Out of scope for now: a CLI command, the editor's "describe a change to the agent" prompt wired to Adjust,
  HyperFrames' desktop app (`hyperframes open`), a phone layout for the editor, and the quality harness motion-studio
  has (its own ADR when it comes).

## Consequences

- A person can open a real editor on a video goal from Foundry, on their computer or phone, while the agent works and
  after; what they change is rendered, versioned, committed and delivered by Foundry without an agent's time.
- The Editor's process is one more preview app: a HyperFrames goal with nothing else to run shows the Editor alone,
  and automated starts report "nothing to run" as a cad goal's do.
- `AdjustmentMode` gains `rerender`; readers of a goal's Adjustments see entries with no task and the fixed text.
- The film route serves the goal's `motion/` folder to anyone who holds the goal's film-files token, which only the
  goal's page hands out and which changes with every start of Foundry; the Editor itself has no authentication and
  listens on the loopback and the tailnet only. HyperFrames' `.thumbnails/` and `.waveform-cache/` join `renders/`
  and `.hyperframes/` among the folders kept out of git.
- Remotion stays out; the guide's FAQ says why in a line.

## Alternatives considered

- **Remotion as a third engine with its Studio**: rejected on the licence (above); its Studio also binds to every
  interface with no loopback option and edits only `defaultProps`.
- **An iframe inside the goal page behind a reverse proxy**: Foundry has no proxy, the editor needs its Host header
  and server-sent events through it and cannot run under a sub-path; a new tab is what previews do.
- **Re-render through an Adjustment session**: an agent to run a render command costs minutes and money for nothing;
  Foundry runs the CLI itself and keeps the Adjustment's bookkeeping.
- **Picking up the editor's own exports from `renders/`** as the result: no check, no version kept, no commit.
- **A lock on the folder while the goal works**: the editor cannot be made read-only, and the agents' commits already
  carry the person's edits; a warning is honest and cheap.
