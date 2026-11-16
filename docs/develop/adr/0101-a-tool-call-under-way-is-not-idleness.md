# ADR-0101: A tool call under way is not idleness, and a session has 45 minutes

**Status:** accepted · 2026-11-16 · builds on ADR-0037 and ADR-0077

## Context

Every session a coding agent runs for Foundry has two clocks. The wall clock stops the session after the attempt timeout
(Settings → Models & limits, 20 minutes until now; a goal may carry its own, ADR-0077; figure and deck tasks have floors).
The idle limit stops it after five minutes with nothing on its stream. Both exist for a session that hangs: a model that
stopped answering, a tool that never returns. A stopped session is resumed as a Continuation with a fresh allowance, so
nothing is lost but time — and the context it had built, which the resumed session rebuilds from the transcript.

The ledger of one installation's last ninety days says what the clocks actually stopped. Of 572 worker sessions, 91 were
killed: 50 by the wall clock, 41 as idle. Together they held 28.5 of the 86.9 hours workers ran, a third of the worker
time, and 21 of the 50 timed-out sessions never reported a cost (unmeasured, ADR-0037). The killed sessions were not
hung. In every sampled idle kill the last thing the session did was a shell command waiting on a build or a test run,
or polling one in a loop (`sleep 4` a hundred times, `until grep … sleep 5`, a Playwright run, `dotnet test`); a single
tool call writes nothing to the stream while it runs, so five minutes of it read as silence. The sessions the wall clock
cut averaged 171 turns, mid-work. Each kill then costs a continuation that boots a fresh context (an attempt's cache
writes average 95k tokens, against 54k for a bare session start) and often a replay of what the cut session had done.

The worker was never told how long it had, so it could not pace itself: a research task read source after source into
its own context for seventy to ninety turns and was cut writing the report.

## Decision

**A tool call under way is not idleness.** Each runner (Claude Code, Codex, Antigravity) keeps the idle clock stopped
while a tool call is open — a `tool_use` whose `tool_result` has not arrived — and starts it again, from zero, when the
last open call ends (`IdleWatch`). Output while a call is open does not start the clock either. Silence while nothing
runs is the coding agent gone quiet, and that is what the limit is for. The coding agent's own tool timeouts bound a
tool call (Claude Code's shell tool stops a command after two minutes by default, ten at most), and the wall clock
bounds everything, so a tool that truly hangs is still cut, by the wall clock instead of after five minutes.

**A session has 45 minutes by default.** `sessions.attemptTimeoutMin` moves from 20 to 45; a goal's own cap and the
figure and deck floors stand as they were. The runners' own fallback (a spec without a timeout) stays at 20 minutes.

**The worker is told its cap.** The attempt prompt says how many minutes the session has, that it is resumed when cut,
and how to pace itself: write results to files as it goes, and start what may run long in the background and check on
it. A research task is also told to hand each source or question to a sub-agent and keep only the findings with their
citations in its own context, and to write the report section by section.

## Consequences

- A command that runs for six minutes no longer ends the session that started it; the session goes on when the command
  returns. The polling loops workers wrote to stay under five minutes become unnecessary, not harmful.
- A tool that hangs for good is cut by the wall clock — up to 45 minutes instead of five. Accepted: the coding agents
  time their own tools out well before that, and the alternative killed a third of the worker time for a case the
  ledger does not show.
- A session cut at 45 minutes has more to replay than one cut at 20; hence the worker is told the cap and asked to
  write as it goes. The cost cap per session and the turn cap are unchanged and keep bounding what one session spends.
- Goals in flight read the setting at their next session, as every Settings value; a goal with its own cap keeps it.
- The glossary's *Unmeasured session* names the idle limit as it now is; the FAQ and the Settings guide say 45.

## Alternatives considered

- **A longer idle limit (ten or fifteen minutes).** Still kills a twelve-minute test run, and lets a model that really
  stopped answering sit three times longer. The limit's meaning was wrong, not its length.
- **Wall clocks per scenario.** More to explain, and the ledger showed the kills across code, CAD, docs and video alike;
  a goal that needs more has its own cap already (ADR-0077).
- **A graceful stop at the cap** (ask the session to wrap up, then kill). A `-p` session with its stdin closed takes no
  message mid-run; the continuation's message is the nearest thing, and it already exists.
