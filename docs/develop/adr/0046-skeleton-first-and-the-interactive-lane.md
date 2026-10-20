# ADR-0046: The Brief skeleton shows first, and a session a person waits for runs beyond the limit

**Status:** accepted · 2026-10-20 · amends ADR-0028; builds on ADR-0013

## Context

After the last interview answer, the Brief took 191–361 seconds to appear (measured on the goals of mid-October 2026):
the Clarifier's skeleton turn 100–200 seconds, then the planner 60–180 seconds. All of it was spent behind one
"Clarifying…" card with a live log that stands still while an answer is written. The person could not read what the
Clarifier had understood until the planner was done with it, although the understanding, the Areas, the assumptions
and the goal-level checks were written minutes earlier and the plan never changes them.

Two more things made the wait feel wrong. With the concurrency limit full of workers, a new goal's Clarify queued
behind them for as long as a task takes, and nothing said so: the card showed a timer and nothing else. And the
Activity tab listed the interview's events by their type names.

## Decision

- **Skeleton first.** When the Clarifier writes its Brief skeleton, the engine stores it at once as the goal's Brief
  (`brief.skeleton_proposed`, the `briefs` row marked `skeleton`) and starts the planner. The goal stays `clarifying`;
  the Brief page shows the skeleton, editable: understanding, title, Areas, assumptions, questions, goal-level checks,
  how to run it, style directions. Approval, Re-run Clarify, Revise, Draft and the Subjects' tools wait for the plan.
  The planner's result is filled into the Brief *as it stands then* (`fillPlan`): tasks, task-level checks and the
  estimate come in, everything the person edited stays; a task of an Area they deleted is dropped with its checks, and
  an Area they added gets the usual "no tasks yet" question. A save that crosses the plan's arrival still takes only the
  skeleton fields (`skeleton: true` on the request), so it cannot wipe the tasks. A page holding unsaved edits merges
  the plan in the same way.
- **The interactive lane.** A `RunSpec` has a lane. Sessions a person is waiting for — the nature classifier, the
  Clarifier's turns, the planner, a Draft, a Revise — run in the `interactive` lane: they may use one slot beyond
  `engine.maxConcurrent` and go before queued work; interactive sessions queue behind each other, and work never passes
  work. Workers still fill the limit, so throughput does not drop; the overrun is at most one session.
- **The wait is a step.** When every slot is taken, the slot beyond the limit included, the engine records
  `clarify.stage: queued` before starting the session, and the goal page shows it on the step it holds up, with a
  timer; the stage itself follows once the session has its slot, and is not recorded again when it already shows, so
  a repair turn does not restart the timer. Finished steps show how long they took, summed from the goal's events.
- **Cancel kills Clarify.** The classifier, Clarify, planner, Draft and Revise sessions are tracked as the goal's
  background sessions; cancelling or deleting the goal kills them, and a killed session's answer is not written (a
  cancelled goal never comes back as `awaiting_brief_approval`).
- The classifier and the repository overview (graphify may build its graph first) run side by side in
  `prepareClarify`; the interview ends (`interview.finished`) when the skeleton is written, not when the plan is.
- Activity describes the interview, a Revise, the skeleton and the Clarify steps in sentences, and the live log of a
  goal under investigation shows REA's session, not an empty Clarify channel.

## Consequences

- The person reads and corrects the Brief 1–3 minutes earlier and the planner's work lands around their edits. The
  time to the first visible Brief is still the Clarifier's skeleton turn; that is the next thing to measure and shorten.
- The engine may run `maxConcurrent + 1` sessions. The agents monitor and the usage ledger count that session like any
  other. Operators who set the limit to what their machine can bear should expect one more.
- A Brief row now carries `skeleton`; a replay rebuilds it from the events. Older goals never have it set.
- Codex workers are no longer told that every mandated skill was "not invoked" on their next attempt: a backend that
  reports no skill invocations gets the workflow restated instead.
