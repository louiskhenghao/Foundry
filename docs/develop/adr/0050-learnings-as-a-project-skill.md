# ADR-0050: A folder's Learnings are also a project skill for the person's own sessions

**Status:** accepted · 2026-10-20 · builds on ADR-0040 and ADR-0049

## Context

Since ADR-0040 a repository folder keeps a notebook of what Foundry's goals learned there — how to build, test and
run it, where things live, its conventions, the person's preferences, the pitfalls — and every later goal in the
folder is given it. The person's own coding-agent sessions in that repository are not: the notebook lives in Foundry's
store, and nothing in the repository says it exists. A person who runs Claude Code or Codex by hand in a folder Foundry
has worked in starts from less than Foundry does.

The Learnings session also opens with a suite's retrospective skill (ADR-0047: `retro`). pstack's counterpart,
`reflect`, spawns three reviewer subagents and routes its findings into skill edits — neither fits a housekeeping
session capped at eight turns and half a dollar that must change nothing but the notebook.

## Decision

- **The notebook is written into the repository as a project skill**, `foundry-learnings`, under `.claude/skills`
  (Claude Code) and `.agents/skills` (Codex), as a SKILL.md with a description a session matches on and the entries
  grouped by kind, the person's marked ✎. The two paths are kept out of git through `.git/info/exclude`.
- **It follows the notebook.** It is rewritten on every `learnings.set` (the session's merge or the person's edit on
  the Learnings page), refreshed when a goal starts in the folder, and removed with the last entry. A skill of that
  name the person wrote themselves is never touched: Foundry recognises its own file by a line in it.
- **A switch**, *Share Learnings with your own sessions* (`workflow.learningsSkill`, on), turns the export off and
  removes the files; the notebook itself and what goals are given are unaffected.
- **Foundry's sessions are unchanged.** They run in worktrees, where an excluded file is not, and keep getting the
  notebook in their prompts.
- **On the pstack suite the Learnings session reflects** in one session: pstack's `reflect` is named as the method and
  its lenses — judgment, tooling, the divergent view, and what structure would enforce better than a note — are given
  as text; the skill is not invoked and no skill is edited. Other suites keep the `retro` opener when it is installed.

## Consequences

- The Extensions page lists `foundry-learnings` among a repository's project skills; it is managed by Foundry's
  export, not installed or updated there.
- A folder that is not a git repository gets no file (nothing could keep it out of version control).
- The Learnings page is the only place to edit the entries: the file says so and is overwritten.
