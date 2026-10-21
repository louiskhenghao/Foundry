# ADR-0055: A notebook of the person's own that follows them into every folder

**Status:** accepted · 2026-10-21 · builds on ADR-0040 and ADR-0050

## Context

Learnings (ADR-0040) are kept per project folder: what Foundry's goals learned there, plus what the person added for
that folder. Some of what a person wants is not about a folder at all: the package manager they use, the language
their comments and commit messages are in, a rule every reviewer should hold, a thing they never want done. Until
now they wrote it into each folder's notebook, once per folder, or into the goal's description, once per goal, or
not at all and corrected the result.

## Decision

- **One more notebook, the person's, for every folder.** It is kept beside the folders' under a reserved key (`*`),
  with the same shape and limits (at most 30 entries of 300 characters); only the person writes to it, from the
  Learnings page (**Yours, everywhere**). Foundry's learning sessions never read it as a folder's notebook, so an
  entry is never copied into a folder, merged or dropped.
- **Every goal is given it with its folder's notebook**: Clarify under a line of its own ("what the person wants in
  every project"), every attempt in the short form, where the person's entries already come first.
- **Every folder's exported skill carries it** (ADR-0050), as a last section, "What the person wants in every
  project"; a folder with no notebook of its own gets the skill for the everywhere entries alone, and a change of the
  everywhere notebook rewrites the skill of every folder that has one.
- Like the folders' notebooks it stays on this computer; a Transfer carries none.

## Consequences

- A wish that is wrong for one folder is overridden there by the folder's own entry or by the code, as the prompt
  already says: the code wins. The person can also say it in the folder's notebook.
- The everywhere notebook is a folder in the read model and in the API (`repo=*`); the Learnings page keeps it apart
  and never lists it as a folder.
