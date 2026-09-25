# ADR-0015: Bring merged work to the local checkout, then tidy up

**Status:** accepted · 2026-09-25 · amends the "only the user moves the local base branch" rule of the base-sync design (`git/sync.ts`)

## Context

A goal delivered as *PR + auto-merge* ended with its pull request merged on GitHub and nothing changed on the user's
machine. The local base branch still pointed at the commit the goal started from, and the goal page gave no hint.
To look for one, it compared against a remote-tracking ref that had not been fetched since the merge, so it saw
nothing to pull. The progress folder, the task worktrees and the local goal branches all stayed behind.

A PR that merged after the ten-minute auto-merge wait, or one the user merged by hand in *Open a PR* mode, was never
noticed at all. The user opened their repository, found it empty, and had to pull it by hand.

Until now the engine only ever moved the local base branch when the user pressed **Pull into my checkout**. That kept
Foundry from ever touching the user's checkout unasked.

## Decision

- **After a merge, the engine brings the work home.** It fetches the base branch and fast-forwards the local branch.
  This happens only when the fast-forward is safe:
  - the local branch has no commits of its own;
  - when the branch is checked out, the checkout has no uncommitted changes.

  Otherwise nothing moves, and the goal page says why next to a **Pull into my checkout** button. The setting
  `delivery.updateLocalBase` (Settings → Git & delivery, on by default) turns this off.
- **Then it tidies up, when nothing can be lost.** It removes the progress folder, the task and delivery worktrees, the
  local goal branch and the stacked branches. Screenshots, review records and the goal's history stay. It does this
  only when:
  - the local base branch contains the goal's work, compared by content so that squash and rebase merges count;
  - the progress folder has no uncommitted changes.

  In any other case everything stays, and the goal page offers **Clean up anyway**. Goals delivered as Local only,
  Push branch, or with a PR that never merged are never tidied.
- **Late merges are noticed.** Goals whose delivery left a PR open are checked with `gh pr view` every five minutes for
  fourteen days, and whenever their page opens. A merge runs the steps above and notifies through the Delivery
  switch. A PR closed without merging is recorded, and nothing is removed.
- **The goal page shows three facts:** merged on GitHub, local base up to date, workspace cleaned up. Each unfinished
  one shows its reason.

## Consequences

- The user's checkout can now change without a click, but only by a fast-forward the user could not have done
  differently. No merge, rebase, stash or checkout ever happens on their behalf.
- Deleting a merged goal's folders loses nothing that is not already in the base branch. Everything the engine can't
  prove is there stays.
- A goal restarted after its cleanup gets a fresh goal branch from the base branch, which already holds its work.
- The PR check is one `gh` call per open PR every five minutes. It costs no model usage.
