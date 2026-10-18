# ADR-0040: Learnings — what a folder's goals taught, written when a goal ends and given to the next goals there

**Status:** accepted · 2026-10-18

## Context

Every goal starts Clarify from the repository alone. What an earlier goal in the same folder paid to find out — the
command the tests need, a port the dev server must take, a pitfall that cost attempts, a preference the person stated
in an answer — is gone unless the person repeats it, or a Follow-up happens to carry it (and a Follow-up carries one
earlier goal's background, chosen by the person). The record to learn from is already there: the Brief and its
Decisions, the escalations and their answers, the hints, the observation reports of failed attempts, the warnings, the
final review.

## Decision

- Each project folder (a goal's `repoPath`) keeps a notebook of **Learnings**: at most 30 entries of at most 300
  characters, each with a kind (build, test, run, structure, convention, preference, pitfall), who wrote it (Foundry or
  the person) and the goal it came from.
- When a goal ends done, over-delivered or failed, one session on the goal's cheap (housekeeping) model, with no tools
  and a small budget, reads that record beside the notebook and returns the whole notebook after the goal: kept, merged,
  added, dropped. The engine keeps the person's entries word for word whatever the session returned, keeps the origin
  of the entries it kept, clips and de-duplicates. A cancelled goal, and one that never reached its Brief, teach
  nothing. Sessions for one folder run one after another, each merging into the notebook as it is when it ends.
- Clarify is given the whole notebook (the person's entries first); every attempt a short form of at most 1,500
  characters, the operational kinds first. The notebook is a starting point: where the code says otherwise, the code
  wins.
- The notebook is a read model of a global `learnings.set` event carrying the whole list. It has no goal on its
  envelope, so a Transfer of a goal never carries one computer's notebook to another; the goal's activity gets a note.
- The person sees and edits it on a Learnings page (in the ⚙ menu, linked from a goal's page and the New goal form);
  what they add or change becomes theirs. A switch (`workflow.learnings`, on by default) stops the learning sessions;
  the notebook is still given to goals, since the person may keep entries of their own.

## Consequences

- A goal's end costs one cheap session more (a few cents), counted in the goal's cost and the usage ledger as
  `learnings`.
- A wrong learning misleads later goals until someone removes it; the page shows where each came from, and the
  prompt says the code wins.
- Folders are keyed by path: a repository cloned twice has two notebooks.
