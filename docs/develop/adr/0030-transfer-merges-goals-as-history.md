# ADR-0030: Transfer merges goals into another Foundry as history, and unfinished ones can be reattached

**Status:** accepted · 2026-10-09

## Context

People move to a new computer and want Foundry to keep what it knew: settings, presets, keys and past goals. The only
way today is the manual backup of [updates-and-backup.md](../../operate/updates-and-backup.md): stop the engine, tar the
whole data folder, restore it to the same paths and launch profile. That replaces the receiver's state outright, needs
the repositories mounted at the old paths, and carries everything or nothing. The event log stores absolute paths
(repository, workspace, transcripts, check output), and coding-agent sessions are tied to the computer and directory
they ran in, so a goal cannot simply carry on elsewhere.

## Decision

- **A Transfer merges, it does not restore.** The person exports a Transfer file with the categories they tick:
  Settings without keys, Keys & secrets, Goals (one by one or all, with their attachments) and, separately, session
  transcripts. Import adds to whatever the receiver already has: Settings are offered section by section (imported
  side preselected); a goal whose id the receiver already has is skipped and reported, never replaced or duplicated.
- **Never transferred:** sign-ins, skills, MCP servers and native plugins (they belong to each coding agent's home,
  ADR-0017/0019/0020), and the settings that only make sense on one computer: the Engine (install) section and the
  address in notification links.
- **Goals arrive as history.** An imported goal is readable (Brief, Decisions, timeline, cost) and can be followed by
  a Follow-up, but does nothing until it is **reattached**. Reattach maps its repository to a checkout on this
  computer (matched automatically when the same path has the same remote, otherwise chosen by the person, at import or
  later) and restores the goal branch from a git bundle the Transfer file carries for every unfinished goal, so it does
  not depend on the branch having been pushed. An attempt the Transfer cut off is followed by a fresh attempt that
  consumes no retry: sessions do not travel, so a Continuation is impossible.
- **Exporting changes nothing on the exporting instance.** A Transfer file is a snapshot. If the person keeps a goal
  running there and reattaches it here too, the two diverge; the reattach warns about it rather than locking the
  source.
- **Keys & secrets are encrypted with a password the person sets**, and are absent unless ticked. Nothing else in the
  file is encrypted, so a file without secrets needs no password.
- **The Transfer file is versioned and only moves forward.** A file from an older release imports into a newer one
  (its events are upgraded the way replay already upgrades old events, ADR-0002); a file from a newer release is
  refused with a request to update the receiver first.
- Export and import are offered in Settings and as `foundry export` / `foundry import` over the same core; the command
  line is the reliable path for large files (transcripts).

## Considered options

- **Full backup and restore with a UI.** Rejected: it duplicates the documented tar backup and cannot merge into an
  instance that already has goals.
- **Only into an empty Foundry.** Rejected: a special case of merging, and it fails the person who already started
  goals on the new computer.
- **Fully resumable goals, as if never moved.** Rejected: sessions, worktrees, previews and absolute paths are bound to
  the old computer; history first with an explicit reattach keeps the common case (history, costs, follow-ups) simple.
- **Pause or cancel the goal on the exporting side.** Rejected by the person: an export should be a plain snapshot.
- **Secrets in plain text with a warning, or never exported.** Rejected: a Transfer file travels by USB stick and
  chat; retyping every key defeats the purpose.

## Consequences

- The Transfer file format becomes a compatibility contract, like the event log: fields are only ever added with
  defaults, and the import must keep reading every older version.
- Absolute paths in imported events are rewritten (or left unresolvable until reattach) on import; anything that reads
  a path from an event must cope with a goal whose repository is not mapped yet.
- A transcript that was not transferred shows as "stayed on the computer it came from", not as an error.
- A preview environment for an unmapped repository waits until that repository is mapped.
