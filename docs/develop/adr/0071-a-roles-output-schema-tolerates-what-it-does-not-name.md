# ADR-0071: A role's output schema tolerates what it does not name

**Status:** accepted · 2026-10-23

## Context

Every role that answers in JSON (the Clarifier, the planner, the reviewers, the likeness judge, Draft with AI…) is
given a JSON schema, made from the zod schema the engine reads the answer with. The coding agent checks the whole
answer against that schema before it reaches Foundry and, when it does not match, hands the answer back to the model
to write again.

The schemas closed every object to the properties they named. A model that echoed a field it had been given (the
planner, handed the Brief skeleton, returned the plan with the skeleton's `styleOptions`, `subjects`, `run`, `apps`
and `openQuestions` beside it), misspelt one (`rubric_`), or added a note of its own (`summary` inside a Subject) had
its whole answer refused, and wrote all of it again: a Brief of twenty kilobytes, at the Clarifier's cost in time
and money, over a field the engine would have dropped. In the data folder at hand, every refusal of that kind was
followed by a second answer that matched.

The same check also refuses an answer that leaves out a property the schema requires. Some of those requirements
were accidents of the zod schema: the likeness judge's `shots` had no default, so a verdict on a Subject it could not
see was refused for naming no shots.

## Decision

- **Properties a schema does not name are allowed, at every level.** The schemas are made with the generator's
  `removeAdditionalStrategy: 'strict'`, through one helper, `jsonSchemaFor`, which every role uses. Only an object
  marked strict in zod closes itself; none is today.
- **The engine's zod schema stays the reader.** It drops what it does not name, so an echoed or misspelt field never
  reaches a Brief, a plan or a verdict. What the schema requires is still required: an answer without `pass` or
  `blockers` is still sent back.
- **A field the model may rightly leave empty has a default.** The likeness judge's `shots` reads as empty when none
  are named.

## Consequences

- An answer is refused only for what is missing or of the wrong shape, never for a field too many.
- A misspelt field (`rubric_` for `rubric`) is dropped in silence instead of refused; the engine then sees the field
  as absent, which its defaults and its own repair turns already handle.
- A new role's schema gets the same tolerance by using the helper; a schema that must close an object does so in
  zod, with `.strict()`, and says why.
