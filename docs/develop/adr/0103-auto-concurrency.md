# ADR-0103: Auto concurrency reads the machine and slows a coding agent near its 5-hour limit

**Status:** accepted · 2026-11-16

## Context

How many agent sessions run at once is one number in Settings, **Concurrent agent sessions**, 3 by default and the same
on an 8 GB laptop and an 18-core workstation. People asked for it to follow the computer. One installation's ledger
(90 days, 521 task starts) put the number in proportion: 79% of the starts waited less than a minute for a slot, and a
goal's own **Parallel sessions** (3 by default) and its plan (four in ten tasks marked not parallelizable) held tasks back
more often than the global number did. On a large machine the number is rarely what limits a run; on a small one,
three sessions with their builds and test runs can make everything slower.

The scarce resource is often the account. A Claude Code subscription has a 5-hour window, and when it runs out every
session running is cut at once; each resumes after the reset with its whole context read again from scratch (the
prompt cache does not live that long). The same ledger shows twelve such cuts. Every Claude Code session already says
how much of the window its account has used: its rate-limit events carry `unifiedWindows.five_hour.utilization`.

## Decision

**Settings → Concurrency: Fixed (the default) or Auto** (`engine.concurrency`).

- **Fixed** is today's behaviour: at most **Concurrent agent sessions** at once.
- **Auto** works the number out from the machine: half its cores, and one session for every 2 GB of memory beyond the
  first 4, at least 1 and at most 16 (an 18-core, 48 GB machine: 9; 10 cores and 16 GB: 5; 8 cores and 8 GB: 2). While
  the one-minute load average is above the core count, half that. The engine reads the machine when it starts, every 30
  seconds after, and when the setting changes; a lower number never stops a session, it holds the next ones back.
- **Under Auto, a coding agent near the end of its 5-hour window runs one task at a time.** When the last session of its
  current account reported the window at 90% or more and the window has not reset, the scheduler starts a task of that
  coding agent's goals only while none runs, and the task drawer says why. The goal's activity says it once per window.
  With auto switch on and another account free there is no hold: the next account takes over instead.

Settings shows under the setting how many run now and why; the per-goal **Parallel sessions** is unchanged.

## Consequences

- Auto on a large machine runs more sessions at once than 3: goals finish sooner and the 5-hour window empties sooner.
  The hold softens the landing: one session cut by the limit instead of nine.
- The hold looks at the window only through the sessions' own reports: an account used elsewhere since its last Foundry
  session is not seen until the next one says so. The engine keeps no extra reads of the usage service for it.
- Memory is read as the machine's total, not as what is free: macOS reports little memory as free even when much is
  available, and a figure that swings with the file cache would make the limit swing with it.
- Fixed stays the default; changing it is one setting, applied at once.

## Alternatives considered

- **Raise the default number.** The same number cannot suit an 8 GB laptop and a workstation.
- **Free memory instead of total memory.** Unreliable on macOS (above).
- **Slow down from the claude.ai usage reading.** It costs a request per read and is rate-limited itself (ADR-0099); the
  sessions' own events carry the same figure for free.
