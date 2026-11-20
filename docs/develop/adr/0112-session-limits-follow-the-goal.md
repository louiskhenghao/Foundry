# ADR-0112: Session limits follow the goal's preset and effort

**Status:** accepted · 2026-11-21 · builds on ADR-0085 and ADR-0111

## Context

Every Claude session of a goal has a dollar cap of its own, so that one runaway session cannot spend the goal's budget:
an attempt `attemptMaxCostUsd` ($10), a goal review at least $6, the planner $10 (ADR-0111), a merge $2, a task review
$0.80, a second opinion, a QA or an audit their own. The caps were fixed amounts, the same for a goal on Haiku-priced
Balanced work and one on Fable at xhigh effort. On this computer 18 of 572 attempts (mostly Opus), 7 of 89 goal reviews
(mostly Fable) and 8 of 175 merges stopped at their cap; each stop shows up as a retry, a cut-short plan or a review
without a verdict, which costs more than the cap saved. The owner asked for the caps to be set when a goal is made,
defaulting to Settings and able to follow the model preset or the effort; on 2026-11-21 he chose the scale below.

## Decision

- **A goal's session limits**, captured at creation (`Goal.sessionLimits`): `auto`, or a multiplier from 0.5 to 5.
  Settings → Models & limits → **Session limits** (`sessions.limitScale`, default `auto`) is the default; the New goal
  form (Claude goals) and `foundry goal create --session-limits` set a goal's own. A goal from before has none: `auto`.
- **Auto** (`sessionScale`): the goal's preset gives Max ×3, Production ×2, Balanced ×1, Economy ×1; a preset of the
  person's own counts as the built-in it was made from (`basedOn`), else ×1. An effort of `xhigh` or `max` (the goal's,
  else the Settings default) multiplies that by 1.5. Codex and Antigravity report no dollars: ×1 always.
- **Every goal session's dollar cap** is its base times the scale (`sessionCap`), at the cent: attempts, task and goal
  reviews and their nudges, the planner and its closing turn, Clarify, Draft and Revise, the second opinion, QA, the
  audit, the investigation, a merge, docs, feedback triage, suggestions, likeness, style samples, subject searches,
  walkthrough plans, replans, Conversation answers. The caps that were already kept within what the goal has left
  (attempts, reviews, QA, audit, second opinion, replan) still are (`capWithin`), above their floor.
- **Not scaled**: one-turn housekeeping (classifying, summarising, learnings), model and usage probes, and template drafts,
  which belong to no goal.

## Consequences

- A code goal on the shipped Production preset gets ×2 from now on; Production at xhigh ×3 (an attempt up to $30).
  The goal's own dollar budget still bounds the whole goal, so a larger cap spends sooner only what the goal was given.
- The New goal form shows what Default and Auto come to for the chosen preset and effort.
