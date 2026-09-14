# ADR-0011: Progress folders next to the repository

**Status:** accepted (2026-09-14)

## Context

Goal and task worktrees lived under Foundry's data directory (`data/worktrees/<goal>/…`). A person who wants to see how far
a goal has come had to know that path, open Foundry's install folder and find a worktree named by an opaque id — or wait for
delivery. The goal branch cannot be switched to in the user's checkout either (git refuses a branch checked out elsewhere),
which the UI wrongly suggested. Mid-goal verification (milestones and previews, planned next) needs a place the human
already knows.

## Decision

- Each goal's workspace is a **progress folder next to the repository**: `<repo-parent>/<repo-name>-foundry/<folder>/`,
  where `<folder>` is the goal title up to its first sentence break (≤40 chars, its own language kept — a slug would delete
  every Chinese character) plus the last six characters of the goal id. Settings → Engine → *Progress folders*
  (`engine.workspacesRoot`, `FOUNDRY_WORKSPACES_ROOT`) moves the root: `<root>/<repo-name>/<folder>/`. Fixed at creation;
  never renamed.
- The engine's own worktrees stay out of sight and out of the goal worktree: `<root>/.foundry/<folder>/{tasks/<id>,
  delivery, resolve/<id>, baseline}`. Nesting them inside the goal worktree was rejected — docs generation and merges run
  `git add -A` there and would sweep nested worktrees up.
- `Goal.workspaceDir` records the folder (`goal.workspace_set` when set later); `null` means the legacy layout, which every
  path helper still resolves, so nothing is rewritten in place.
- At engine start, before any session runs, goals still in flight on the legacy layout are moved with `git worktree move`
  (goal, live task and resolve worktrees; delivery and baseline scratch worktrees are dropped and rebuilt on demand). A goal
  whose move fails stays put with a note. Finished goals are left alone.
- Docker: the same rule, so folders land on the `/repos` bind mount where the host can see them (uid 1000 ownership applies).

## Consequences

- People open, run and read a goal's work in a folder they recognise, at any point — the base for milestones and previews.
- One more place on disk next to every repository Foundry works on; deleting a goal removes its folder and its `.foundry/`
  sibling.
- Path helpers take a goal (id + folder) instead of an id; every caller was updated, tests included.
