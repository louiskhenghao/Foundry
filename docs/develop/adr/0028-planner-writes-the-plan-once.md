# ADR-0028: The planner writes the task plan once, in a session of its own

**Status:** accepted · 2026-10-08 · amends ADR-0013 and ADR-0018

## Context

The turn that writes the Brief took 8–14 minutes across the five most recent interviews, against 25–45 seconds for a
round of questions. Nearly all of it was the plan being generated twice. With Claude, the Clarifier called the
`planner` sub-agent (2–9 minutes, 8–44k output tokens), then typed the same plan again into the Brief as one structured
output (3–5 minutes, 43–71 KB). With Codex, a separate planner session proposed tasks and the Clarifier reviewed and
re-typed them. At about 100 output tokens a second, a plan's size is its time.

## Decision

- The Clarifier writes a Brief skeleton (`BriefSkeleton`): understanding, Areas, assumptions, goal-level checks, style
  options, how to run it, and `planningNotes` — what it found that the planner needs. It never writes tasks.
- Right after, the engine runs the planner as its own read-only session, for both backends, with the Planner model and
  effort. It returns `PlanOutput`: tasks, task-level checks and the estimate. The engine merges it into the Brief as
  written; nobody types it again.
- An unusable plan gets one more try in the same session; an Area without tasks gets one repair turn there. A plan that
  never comes leaves one task per Area and a blocking question on the Brief, rather than a failed goal.
- A whole Brief with tasks is still accepted from the Clarifier (older sessions, a model that ignored the schema), and
  then no planner runs.

## Consequences

- The plan is generated once: the Brief turn loses the re-typing (3–5 minutes on the measured goals).
- The Clarifier no longer reviews the plan. What it knows reaches the planner through `planningNotes`, and the human
  reviews the plan on the Brief page as before.
- The planner's prompt carries the goal, the interview answers, the nature rules, the overview and the skeleton, so it
  rarely needs to explore again.
