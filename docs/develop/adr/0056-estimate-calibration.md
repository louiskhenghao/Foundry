# ADR-0056: The Brief's estimate is read with how far earlier goals ran from theirs

**Status:** accepted · 2026-10-21 · builds on ADR-0014 and ADR-0054

## Context

Every Brief estimates a cost and a time, and the Auto budget proposes twice that. The estimate is the Clarifier's
guess from the plan; what the goal then costs depends on the repository, the person's way of answering, the model
preset, and the kind of work, none of which the Clarifier can measure. The record to measure it against is already
kept: a finished goal has its Brief's estimate, its cost, and its active time (the Timeline). Nobody compared them,
so a folder whose goals run at twice the estimate every time was estimated the same way the next time, and a
scheduled run (ADR-0054) was given a budget from an estimate nobody corrected.

## Decision

- **A calibration is a pair of factors**, cost and time, each the median of actual ÷ estimate over earlier goals:
  finished (done or over-delivered), with an approved Brief that was not a skeleton, with an estimate above zero,
  and with the actual measured (a Codex goal has a time but no cost; a goal that spent nothing measured has none).
  A ratio outside 0.05–20 is a broken sample, not a lesson. Fewer than three usable samples say nothing.
- **The folder first, then the nature.** The goal's own folder calibrates when it has three such goals; else every
  folder's goals of the same nature (code, docs and research, media) on this computer; else there is no
  calibration. The goal being estimated is never its own sample. The samples the factor rests on are shown.
- **The estimate is shown as written, with what it likely comes to**: one sentence on the Brief's estimate card
  ("Earlier goals in this folder ran at 1.6× the estimated cost and 1.3× the estimated time (median of 5 finished
  goals): likely about $12 and 45 min"), with a note when the samples disagree widely. The Clarifier's number is not
  rewritten: the person sees both.
- **The Auto budget proposes twice the calibrated estimate**, on the Brief page, in a chat's "Approve and run", for an
  automatic Brief and for a scheduled run the engine approves. A budget the person set is not touched; the card
  still warns when the (uncalibrated) estimate exceeds it.

## Consequences

- A folder's first three goals get no calibration; a new computer gets none until three goals of a nature finish.
- The factor is a median over goals of every size: a folder of tiny goals that overran teaches a large goal the same
  factor. The samples are shown so the person can judge; a wide spread is said.
- A failed or cancelled goal teaches nothing here (its work was not finished, so its cost says little about the
  estimate); the Learnings session may still learn from a failed one.
