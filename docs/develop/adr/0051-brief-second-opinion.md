# ADR-0051: A second opinion on the Brief

**Status:** accepted · 2026-10-20 · amended 2026-10-20 (the room of a goal review; written in the background) · builds on ADR-0045 and ADR-0049

## Context

A Brief is written by one session and approved by one person. Revise (ADR-0045) re-plans it in the light of the
person's decisions, but it is the same role rereading its own work. Nothing reads the Brief the way a second engineer
would before the team commits to it: against the repository, as the person's stand-in, looking for what is missing,
too big, in the wrong order, or not decided by any check.

The suites Foundry can run on (ADR-0049) have no skill for this. Matt Pocock's `grilling` needs a person in the loop;
pstack's `architect` and `interrogate` spread a design or a diff over several models. A second opinion that asks
questions is a first opinion, and one that spends four models on a plan nobody has approved is a cost nobody asked for.

## Decision

- **A built-in Brief-reviewer role** (`roles/brief-reviewer.md`), the same under every suite: it reads the Brief and the
  repository read-only and returns the revised Brief with a change summary — the Revise output — never a question.
- **On the goal reviewer's model row** (`goalReviewer`), not the Clarifier's: a different model from the one that wrote
  the Brief whenever the preset says so, which is what makes it a second opinion. With the room of a goal review, not
  of a Revise: 60 turns, a worker session's budget bounded by what is left of the goal's and never under $6, twenty
  minutes, and one nudge for the answer when the session ran out first. (As shipped in v2.2.0 it was capped like a
  Revise — 40 turns, $3, five minutes — and ran out on a repository of a few hundred files before the reviewer answered.)
- **On demand and by itself.** The Brief page has a **Second opinion** button while the Brief awaits approval. With
  Settings → *Second opinion on every Brief* on, one runs by itself when a Brief fills in — not for an auto-Brief
  (nobody reads it) nor for a Delegated goal the engine approves itself.
- **Written in the background.** The request that asks for one returns at once (202); the goal detail says one is
  being written, then carries it. (In v2.2.0 the request waited for the session and was cut by the server's idle
  timeout before the reviewer finished.)
- **Kept as an event.** `brief.second_opinion` records the revised Brief and the summary; the page shows it after a
  reload as a diff against the Brief as it is now, in the same checklist a Revise proposal uses, and says when the
  Brief changed since. The person applies the rows they take; nothing is applied by itself. One that did not come in
  is kept the same way — `brief.second_opinion_failed`, why — and the page says so until one does.
- **Costed as the goal's** (`goal.cost_added` source `second-opinion`, a Second opinion span on the timeline).

## Consequences

- A second opinion on a Brief that was then edited is shown as stale, not hidden: its rows may still be right.
- Once the Brief is approved nothing can be applied; the event stays as a record of what was proposed.
- The transcript channel of the Brief page (`draft-<goal>`) also carries the second opinion's session.
- A Draft or Revise is still awaited by its request: bounded (40 turns, $3, five minutes), with the server's idle timeout
  at Bun's maximum (255 s). One that runs longer is cut at the request, not in the engine; the shape of this decision is
  there for it if it ever needs one.
