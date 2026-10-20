# ADR-0059: Revert — a merged delivery undone through a pull request, on the person's click

**Status:** accepted · 2026-10-21 · builds on [ADR-0003](0003-engine-only-remote-actions-under-human-policy.md) and [ADR-0015](0015-bring-merged-work-to-the-local-checkout.md)

## Context

A goal's work reaches the base branch through a pull request Foundry opens and, under the policy, merges (ADR-0003).
When the merged work turns out wrong — a feature that breaks something the checks did not cover, a change the person
regrets — the way back was git: the FAQ's "How do I undo?" sent them to GitHub's Revert button. Foundry knows every
merge it made (the pull requests and their merge commits, `delivery.merged`), has the remote and the `gh` session,
and already notices merges and fast-forwards the person's base afterwards (ADR-0015). Undoing a merge is a mechanical
act that needs no model.

## Decision

- **A Revert is an act on the delivery, not a goal.** Under a delivery that ended `merged`, **Revert…** opens a
  pull request that undoes it: a branch from the base branch as it is online, one revert commit per merged pull
  request — a stack's from the top down, a merge commit with `-m 1`, a rebase merge's commits as a range — pushed, and
  a pull request with the merges, the person's reason and the merge danger in its description. Nothing about the goal
  changes: its state, branch, page and history stay; the revert is one more record on the delivery, with a
  **reverted** tag on the page once it merged.
- **Merged right away only when asked.** The dialog's **Merge it right away** merges the pull request with the
  policy's merge method, arming GitHub's auto-merge under branch protection as a delivery does; otherwise the pull
  request waits for the person. Either way its merge is noticed by the pull request watch, and the aftermath is a
  merge's: the remote branch deleted when the policy says so, the person's base fast-forwarded when that is safe.
- **It refuses what it cannot know or do.** A Local only goal, a delivery finished by hand (`by_you`), a merge commit
  not recorded, a merge no longer on the base, a running delivery, an open revert, a goal already reverted. A revert
  that conflicts with what the base got since is refused with the files, and the branch is not opened: the person
  reverts by hand or starts a follow-up goal. Only git and gh run; no model.
- **Built in a throw-away worktree** of the person's repository beside the goal's own folders, removed once the
  branch is pushed or the revert failed; the person's checkout is touched only as after a merge.

## Considered options

- **A revert goal** (a goal of a special kind that follows the merged one). Rejected: a goal brings Clarify, a Brief,
  tasks and a worker session to a task that is one `git revert`; a follow-up goal remains the way to *fix forward*.
- **GitHub's own Revert button.** It stays the way for merges Foundry did not make; for the ones it did, a click on the
  goal's page keeps the reason, the outcome and the notifications with the goal, and merges when asked.
- **Reverting locally on the person's base branch.** Rejected: ADR-0003 keeps the base branch out of the engine's
  hands; a pull request keeps the person's checks and reviews in the loop.
- **Undoing a deploy as part of the revert.** Rejected: a host's rollback is its own act (ADR-0058); a redeploy of the
  reverted base is the person's click on the Deploy card.

## Consequences

- `DeliveryState` gained `reverts` (`DeliveryRevert`), four events (`delivery.revert_started`, `_finished`, `_merged`,
  `_closed`) and `revert` as a step name in the command audit; older events replay unchanged.
- `GhClient` gained `prCommits` (the count behind a rebase merge's range); the fake records it at creation.
- The pull request watch covers a revert's open pull request for the same 14 days; a delivery merged long ago is not
  finished again on its account.
- A revert pull request is a pull request of the person's repository like any other: CI runs on it, branch protection
  applies, and its merge is theirs to undo in turn.
