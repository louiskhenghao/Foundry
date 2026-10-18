# ADR-0036: Delegated goals run side by side within the goal's parallel limit, each with a share of the budget

**Status:** accepted · 2026-10-18 · amends ADR-0034

## Context

ADR-0034 ran one Delegated goal per main goal at a time and gave it everything the main goal had left to spend. In the
first real run the research step and the 3D model were independent, yet only ordinary tasks ran in parallel: the
Delegated goal held the queue. The `dependsOn` edges already said which steps had to wait for which.

## Decision

- The scheduler starts every ready `goal` task whose dependencies are done, as many at a time as the main goal's
  `maxConcurrent` (the same parallel limit as its sessions); the edges keep the order between steps that need each
  other. A ready goal task past the limit waits, and the task drawer says so.
- Each Delegated goal gets a share of the main goal's cost budget, not what is left in full: the `budgetUsd` the
  planner wrote on the step (edited on the Brief like any field, kept within what is left), else an even share of what
  is left among the goal tasks still to land. The time left is not divided: they run side by side. A main goal with no
  cost limit gives none.
- Landings stay serial: each takes the goal workspace's lock, and the goal's own tasks keep worktrees of their own while
  any Delegated goal is under way (as before).

## Consequences

- Independent steps of a goal run at the same time; a goal whose plan has two crafts next to each other takes about as
  long as its longest one.
- More sessions at once draw on the account's usage: the parallel limit is the knob, as for sessions.
- A badly split budget starves a step: the planner's `budgetUsd` is a share of its own estimate, and the person sees
  and edits it on the Brief; an exceeded share escalates on the Delegated goal as any budget does.
