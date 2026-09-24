# ADR-0014: Model presets per goal nature

**Status:** accepted · 2026-09-24 · supersedes the tier parts of ADR-0006

## Context

Every session ran on one of three model tiers — strong, worker, cheap — each bound to a fixed set of stages. Choosing
Fable for Clarify also put every merge attempt and goal review on Fable, the most expensive single sessions; the worker
tier drove every task attempt whatever the task; and prose or media goals paid code-grade prices for work judged by eye.
The Settings page described routing by task difficulty that did not exist, and its labels went stale when a tier changed.

## Decision

- A **model preset** names the model of every action — Clarify, Planner, Simple / Standard / Complex tasks, merge
  attempts, the goal and task reviewers, the documenter, feedback triage, hints and style samples — in three tables:
  Code (and unclassified goals), Docs & research, and Media. Presets use aliases (fable, opus, sonnet, haiku) so they
  follow new releases.
- Four presets ship (Max, Production, Balanced, Economy). They can be edited and reset; people can create, rename and
  delete their own. Settings picks one preset per goal nature (Code = Production, Docs & Media = Balanced by default); a
  goal may pick another at creation.
- A session reads its goal's preset when it starts, so edits reach goals in flight.
- The Clarifier rates each task simple, standard or complex, which picks its row; the last attempt of a budget of two
  or more, and every retry the human grants, run on the Complex row.
- Rows name models directly — no tier indirection. A model found unavailable is remembered per goal (replaced by the next
  fallback). The strong and worker tiers are removed; the cheap tier remains only as the housekeeping model for one-turn
  chores.
- A model sync reads the model ids the installed CLI knows and resolves the aliases, so dropdowns never need a typed id.

## Consequences

- The expensive actions can be put on cheaper models independently (e.g. merges on Opus while Clarify stays on Fable).
- More to explain: twelve actions × three natures. The shipped presets carry the defaults so most people only pick one.
- Settings written by earlier versions move once to the default presets, with a note listing the old tiers.
