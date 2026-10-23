# ADR-0070: The doctor reads a skill's bytes once

**Status:** accepted · 2026-10-23

## Context

The doctor runs on every page load (the app shell asks it once, the Setup banner again, then every minute) and
compares each installed skill with its upstream byte for byte: a fingerprint of every file under the skill's folder,
and of the folder it came from. Nothing kept those fingerprints between runs, and the walk took in whatever a skill's
folder held. One hand-installed skill carried its own `node_modules` and test fixtures: 21,000 of the 23,000 files the
doctor read, 1.7 GB in all, hashed again on every run.

The hashing is synchronous, so the server answered nothing else meanwhile. The Goals list, asked at the same moment,
took the doctor's time to appear: about four seconds, for a query that takes three milliseconds.

The report also matched every hand-installed skill to a source by searching all the clones Foundry has (the
marketplaces' and the skills cache's, some 17,000 files) once per skill.

## Decision

- **`node_modules` is not part of a skill's bytes.** The fingerprint leaves such folders out, as it leaves out `.git`.
  Upstream never holds them (git ignores them), so taking them in only made a skill with installed dependencies read
  as modified.
- **A folder's hashes are kept until its files change.** The walk records each file's path, size and modification
  time; a folder whose files still match is answered from the last hashes without a read. A file rewritten with the
  same size and time is not seen until something else in the folder changes: the trade accepted for a report that
  costs a stat walk instead of a read of everything.
- **The clones are indexed once per report.** The skill folders of each clone are found in one walk, and every
  skill of the report is matched from that index. The index lives for one report, so a clone that changed is read
  afresh by the next.
- **One doctor run answers everyone who asks while it runs.** Concurrent asks for the same coding agent share the run
  under way instead of starting their own.

## Consequences

- The doctor's blocking work falls from seconds to the stat walk; the Goals list no longer waits for it.
- A skill whose only change is a rewrite with the same size and time reads as unchanged until its folder changes
  elsewhere. The Extensions page's own refresh re-reads nothing either; a restart of Foundry does.
- The hashes are held in memory for the life of the server: a few hundred entries, one per folder fingerprinted.
