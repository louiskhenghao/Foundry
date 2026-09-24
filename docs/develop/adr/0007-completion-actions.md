# ADR-0007: Completion actions: docs on the goal branch, graph refresh after delivery

**Status:** accepted · 2026-08-26

## Context

Three consistency problems remained once a goal finished:

1. **Documentation drifted.** Nothing generated or updated documents, and generating them per task would describe intermediate states that later tasks (and goal-review fix cycles) overwrite.
2. **The knowledge graph went stale.** graphify indexes the repository as a *context provider* during Clarify and attempts, but nothing re-indexed after a goal's code actually landed — the graph described the codebase as it was before the goal.
3. **Empty repositories got nothing.** autoskills ran once at Brief approval, found no stack manifest, and never retried — so the very goal that scaffolds a project ran all of its tasks without project skills.

## Decisions

1. **Completion actions are chosen once, at Brief approval.** `Goal.completion { graphRefresh, docs }` is set by `goal.completion_set` when the Brief is approved: the Expert Brief page offers a Completion card; an untouched card (and Simple mode, and API callers) lets the engine infer defaults from the Brief — any coding scenario ⇒ graph refresh + PRD + README update, a `CHANGELOG.md` in the repo ⇒ changelog, pending Decisions ⇒ confirmation sheet. Nothing asks the user again at Done.

2. **Docs are generated after the goal review passes and before the goal turns done** (`runDocsGeneration`, role `documenter`, strong model, ≤ $3). The session may only produce documentation: non-doc changes are discarded, the doc files land as one `docs:` commit on the goal branch. That makes the docs part of the same delivery unit as the code — one PR, one review, one merge — instead of a separate artifact that can diverge. Rejected alternatives: a docs task in the DAG (runs before goal-review fix cycles, so it can describe code that then changes) and storing docs outside the repo (no version link to the code).

3. **The graph refresh runs where the delivered code lives, after delivery.** Local-mode goals refresh the goal workspace at done; delivered goals fast-forward the user's checkout (the existing `pullFastForward`, the only operation allowed to touch it) and refresh there. `graphify update` runs when on PATH; `gitnexus analyze` the same way (pathfinding for a tool not yet integrated — absent means `skipped`, never an error). Recorded as `goal.completion_ran`; failures are notes, never blockers.

4. **autoskills retries after each landed task while skipped for `no stack manifest`.** The skip is now recorded (previously silent), and the integrate path calls back in; the first task that creates a manifest triggers the install, and live task worktrees receive the skills.

## Consequences

- A finished coding goal ships a `docs:` commit in its PR by default; users who do not want that untick the docs on the Brief page (or the whole feature stays off for non-coding goals).
- `goal.completion_set` / `goal.docs_generated` / `goal.completion_ran` join the event log; `Goal.completion` is a defaulted field — replay required after deploy.
- The graph refresh may run `graphify` in the user's checkout; it only ever fast-forwards (never merges) and skips with a recorded reason when the checkout is dirty or diverged.
