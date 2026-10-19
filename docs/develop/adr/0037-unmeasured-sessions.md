# ADR-0037: A session cut before its result line is unmeasured — its cost is unknown, not zero

**Status:** accepted · 2026-10-18 · amends ADR-0001 · amended by ADR-0043 (an estimate at the model's measured rate, never counted)

## Context

ADR-0001 drives the host `claude` CLI and takes cost, turns and usage from its final `result` line. A session the
engine kills — at the attempt's time limit, idle, by hand — or that dies never writes one. The runner then made up a
result with `costUsd: 0` and `numTurns: 0`, the engine booked $0 on the goal and wrote a ledger row of zeros, and the
task drawer showed the session as free. In the first Delegated-goal run a worker session that ran the full 20 minutes
and read nine million cached tokens appeared as $0 / 0 turns, and the goal's total was wrong by an unknown amount with
nothing saying so. The glossary already said *unknown is not zero* about account quotas; the session accounting broke
the rule.

The stream itself does not hold the answer: Claude Code repeats each API message's usage on every line of that message
(one per content block), and that usage is the message's opening one, whose output count is its first few tokens. The
session's own record — Claude Code's transcript under `<claude home>/projects/`, with a file per helper agent — carries
the final counts, and the engine already reads those files for the Agents page.

## Decision

- The runner tallies every API message's usage from the stream as it arrives, one entry per message id, the larger
  count per field winning. When the CLI exits without a result line after a session had started, it reads the session's
  own record for the final counts and returns `numTurns` (messages of the main conversation, what `num_turns` counts),
  `usage` and `modelUsage` from the tally, with `costStatus: 'unavailable'`. `costUsd` stays 0 and means unknown.
- Every session record (`AttemptSession.costAvailable`) and ledger row (`usage_ledger.cost_status`) says whether its
  cost was reported. The task total, the attempt's session list, the goal's cost meter, the task graph and the Usage
  page count the sessions they leave out and say so (**+N unmeasured**, **unknown**, `*`); nothing presents a partial
  sum as the whole, and the attempt's activity gets a warning note when a session ends unmeasured.
- No price table. Tokens times list prices would give a number, but prices differ per model and tier, cache and batch
  discounts change, and an estimate shown as a measurement is the same lie with more digits. Unknown is shown as
  unknown.
- Codex is unchanged: it reports no dollar cost at all, and its sessions were already marked unavailable.

## Consequences

- A goal's USD budget cannot be enforced against unmeasured sessions: the meter shows what is known and how much is
  not; the time budget still holds.
- Turns and tokens of a cut session are measured, not guessed — except the message in flight when the process died,
  which no record holds.
- A ledger migration adds `cost_status`; rows from before carry null and count as reported, which is what they were.
- A process that never started a session (spawn or sign-in failure before init) keeps `costStatus: 'reported'` with
  $0: nothing ran, nothing was spent.
