# ADR-0082: The data folder is chosen in Settings, and the engine starts again in its own process

**Status:** accepted · 2026-11-02 · builds on [ADR-0010](0010-self-update.md) and [ADR-0030](0030-transfer-between-computers.md); amends the restart rule of Settings

## Context

A Foundry keeps everything it has — the event log, Settings, transcripts, uploads, access tokens, the coding agents'
added accounts, templates, themes — in one data folder: `data/` in the checkout for the Claude launch profile,
`data-<provider>/` for the others, or wherever `FOUNDRY_DATA_DIR` points. Moving it (to a bigger disk, out of the
checkout) or keeping two sets apart meant stopping Foundry, moving files by hand and starting it with another
environment. The folder cannot be a Setting: Settings live inside it. And a Setting marked *restart* told the person to
press Ctrl-C in a terminal and start Foundry again — out of reach from a phone, and from a service.

## Decision

- **The choice lives with the person, not with a folder:** `~/.foundry/config.json` (`FOUNDRY_HOME` moves it), one
  folder per launch profile, and the folders a Foundry had before. The environment still wins: with `FOUNDRY_DATA_DIR`
  set, or in the Docker image (the folder is the volume), Settings shows the folder and offers no change. A chosen folder
  that is not there at a start (a disk not mounted) is not made: the default opens, with a notice, and the choice is kept
  for the next start. The CLI resolves the folder the same way.
- **A folder is tested before anything moves**, without a change to it: an absolute path that is not the folder in use
  nor inside or around it; a Foundry folder, an empty one, or refused when it holds other things; writable; room on the
  disk, and room for a copy; for a Foundry folder, the launch profile it belongs to and whether a newer Foundry wrote
  its database (a migration this build does not know). Every change to the path asks for a new test.
- **Three ways in:** a Foundry folder is *opened*; an empty one *starts blank*, or takes a *copy* of the current data,
  made while the engine is stopped, in which the paths that pointed into the old folder (transcripts, check output)
  point into the copy. Repositories and progress folders are outside the data folder; both folders share them. The old
  folder is never removed.
- **The switch is a restart**, refused while a goal is at work (clarifying, running, in review: the person pauses it
  first) or a session is in flight, and confirmed with the impact spelled out and a box to tick. `foundry serve` is a
  loop: the engine and the HTTP server stop and start again in the same process, so the port is kept under `bun --watch`,
  launchd, systemd and Docker alike. A folder whose boot fails is put back: the loop starts the folder before again and
  leaves a notice for Settings. The same loop gives the Settings marked *restart* a **Restart now** button.

## Consequences

- `~/.foundry/config.json` is a second place a Foundry's state is decided from; a backup of the data folder alone does
  not remember which folder was in use. `foundry serve` prints the folder it opened, as before.
- `defaultConfig` carries `foundryHome`, `dataDirSource` and `dataDirMissing`; a test run never reads the person's
  `~/.foundry`. The `version` file in a data folder says which Foundry last opened it.
- The engine gains a restart gate and `goalsAtWork()`; the server a `serveLoop` and `/api/data-dir` routes; the CLI's
  `serve` runs the loop. An engine started another way (tests, an embedding) answers a restart request with 409.
- Nothing migrates between launch profiles: a folder that belongs to another coding agent is refused, as at start.
