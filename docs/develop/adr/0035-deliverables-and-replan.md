# ADR-0035: A task's Deliverables are a contract, and the planner touches up what follows after a Delegated goal lands

**Status:** accepted · 2026-10-18 · amends ADR-0028 and ADR-0034

## Context

With Delegated goals (ADR-0034) a step can be a project of its own, and the steps after it get a summary of what it
delivered. Two things were still left to luck. Nothing said *where* the files a step made would be: the planner wrote
the next task's spec before the step ran, naming paths and formats it assumed. And the plan is written once (ADR-0028):
when a Delegated goal came back with the data in another shape, or a model under another name, the tasks after it ran
on a stale spec and found out the hard way.

## Decision

- **Deliverables.** A Brief task may name `delivers`: the files it leaves for the tasks after it (repo-relative, under
  `artifacts/` for media and CAD). At approval each becomes a must check of the task (`test -e <path>`, run where the
  task's checks run), and for a `goal` task a goal-level must check of its Delegated goal, whose Clarify is told what it
  must deliver. A worker is told what it must leave behind; the tasks that depend on it read where the files are, next to
  the summary. The planner names them, the person edits them on the Brief page, the task drawer opens them. A landing
  that misses a promised file notes it; the Delegated goal's own review already held it to the promise.
- **Replan.** When a Delegated goal lands, one bounded planner session (read-only, the planner role and model, 20 turns,
  $2) reads the summary and the delivered files and returns revisions for the downstream tasks that have not started:
  the whole new spec, and the full start-file and Deliverables lists or null. It never adds, drops or reorders tasks and
  never touches checks or titles. It runs between the landing and the task's `done`, so the tasks it may touch cannot
  start meanwhile; what began anyway keeps its spec. Each change is one `task.revised` event with the reason, shown on
  the task and in the Activity tab. A session that returns nothing usable, or a goal with no budget left, leaves the
  specs alone and says so; nothing in it can fail the landing.
- Both apply to every kind of task: Deliverables on any task, the Replan only after a Delegated goal lands.

## Consequences

- The next step finds the files where the plan said, or the step that promised them does not land; downstream prompts
  carry paths, not guesses.
- The plan is still written once; what changes after a Delegated goal lands is the wording of unstarted tasks, by one
  bounded session, visible and attributable. The DAG, the checks and the human's Decisions are never rewritten by it.
- Each landing of a Delegated goal costs one more short planner session when downstream tasks are left.
- Not done here: a Replan after an ordinary task lands (a plain task's summary is its commit; a later ADR may extend
  it), and Deliverables with globs or folders whose contents are checked (only existence is).
