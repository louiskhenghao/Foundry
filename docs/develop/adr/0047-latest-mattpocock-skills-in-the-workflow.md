# ADR-0047: The latest mattpocock skills, pinned, in Foundry's workflow

**Status:** accepted · 2026-10-20 · amends ADR-0004 and ADR-0040 · amended by [ADR-0068](0068-moving-a-workflow-suite-to-another-release.md) (the person may move the suite to a later release)

## Context

`mattpocock/skills` has grown since ADR-0004 wove its discipline skills into the roles. Release v1.3.1 adds
`writing-for-agents` (how to write what an agent reads), `retro` (a retrospective of a session, with seven categories
of improvement to the agent's environment), `pr` (a pull request body template: Summary, Evidence, Merge Danger), and
more orchestration skills (`implement-spec`, `grill-with-docs`, `grill-me`, `improve-codebase-architecture`, `handoff`).
Only `pr` and `writing-for-agents` among the new ones are model-invocable; the rest carry
`disable-model-invocation` and expect a person.

Two things about the existing integration were unsaid. The catalog installed the skills from the repository's default
branch, so an upstream change could alter a mandated skill between two goals. And the skills assume a human and a
tracker that Foundry's sessions do not have: `tdd` asks to agree the seams under test with the user, `code-review` looks
for an issue tracker, `grilling` waits for answers inside a turn, `to-tickets` publishes tickets.

## Decision

- **Pinned.** Every mattpocock entry's git source carries `ref: v1.3.1`. A refresh of the cache fetches the tag and
  resets to it, never to a moving branch; a newer release is adopted by changing the ref in the catalog, its rules
  reviewed with it.
- **`writing-for-agents`.** A worker MUST invoke it when the task's files include `AGENTS.md`, `CLAUDE.md` or a skill
  folder (`.claude/skills/`, `.agents/skills/`): a workflow rule may now name `whenFiles`, matched against the task's
  `relevantFiles` by file name anywhere, by path, or by folder. The Documenter and the Learnings session — two new
  `SkillRole`s, `documenter` and `learnings` — are told to prefer it.
- **`retro`.** A Claude goal's Learnings session opens with the skill's slash name, which starts a user-only skill
  headlessly; what the retro would present to a person becomes notebook entries. Its categories (navigation, automated
  checks, coding standards, global AGENTS.md, tool economy, no-ops, information access) are the session's lens whether
  or not the skill is installed, and for Codex, which has no slash commands. The session may read the goal's transcripts
  (listed in its prompt) and call a skill, with eight turns and fifty cents; its prompt is kept next to its transcript.
- **`pr`.** The engine writes a pull request body after the template — Summary (what was understood and the tasks as a
  tree under their Areas), the person's Decisions, Evidence (the acceptance checks and the reviewer's notes), Merge
  Danger (the door, two-way for a merge that a revert of its merge commit undoes, and the blast radius from the diff's
  size). No model writes it: the engine knows all of it. Stacked task PRs get the same sections for the task alone.
- **The seams the skills expect.** The Clarifier's role says a round is one JSON output of the whole frontier, never a
  wait inside a turn (`grilling`'s method, with the engine carrying the conversation); the planner's role carries
  `to-tickets`' slicing rules (vertical slices, prefactoring first, expand–contract for wide refactors, specs that say
  what to build from the user's side). The `tdd` rules say the seams are given by the task spec and its checks; the
  `code-review` rule and the Goal Reviewer's prompt say the spec is in the prompt and there is no tracker.
- **Never run.** `implement-spec`, `grill-with-docs`, `grill-me` and `improve-codebase-architecture` join the never-run
  line. Not adopted: `implement`, `implement-spec`, `triage`, `wayfinder`, `improve-codebase-architecture`, `handoff`
  (orchestration or conversation with a person, which Foundry's loop is).

## Consequences

- A task that edits an agent-facing file carries one more MUST, and the reviewer sees it as any mandate; such files
  should come out shorter and better pointed.
- A Learnings session costs up to fifty cents instead of thirty, may read transcripts, and is a retrospective in shape.
  Entries read like a retrospective's findings: a pointer that was missing, a check that would have caught a mistake.
- Pull request bodies change shape. Readers of the old `## Goal` / `## Acceptance` sections find them as Summary and
  Evidence.
- Installing or updating a mattpocock skill now needs the tag to exist upstream; it does (v1.3.1).
