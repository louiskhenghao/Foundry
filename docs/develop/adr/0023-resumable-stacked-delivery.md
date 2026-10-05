# ADR-0023: A stacked delivery resumes, replays onto the base, and reads its switches live

**Status:** accepted · 2026-10-05 · amends [ADR-0003](0003-engine-only-remote-actions-under-human-policy.md) (no force push)

## Context

A stacked delivery (one PR per task) failed in ways that made it hard to finish:

- A fix-CI commit was recorded like a task commit, so the next run computed a different stack and deleted the "stale"
  branches. Deleting a PR's branch makes GitHub close the PR, so every re-run closed all open PRs and opened new ones.
- After the bottom PR is squash-merged, `main` holds its changes as one new commit while the next branch still holds the
  original commits. Merging `main` into that branch then conflicts on the same lines, and a model-driven Merge Attempt
  (with local goal checks) ran for every PR. That made deliveries slow.
- The policy could only be changed by starting a new run, so turning off "Wait for CI checks" for a PR stuck on CI was
  impossible while the run waited.
- The docs commit written when the goal finished was on the goal branch but in no stacked PR. The after-merge check
  compared the goal branch's content with `main`, so it reported "not up to date" for a fully merged goal.

## Decision

- **Branches are reused, never deleted to rebuild.** `build-stack` keeps every stacked branch that exists and builds
  only the missing entries, each on top of the entry below as it is now. If something cannot be built while open PRs
  exist, the delivery stops instead of falling back to one PR.
- **Fix-CI commits on the PR's own branch.** A `delivery-fix` task is not a stack entry; its commit travels with its PR.
- **Replay after a squash merge.** To bring the base into stacked branch *n*, Foundry finds where the branch left
  branch *n−1*: the newest recorded tip of *n−1* (as built, pushed, or before a replay) that branch *n* still contains.
  It runs `git rebase --onto origin/<base> <that point>`. Only branch *n*'s own commits are replayed, and no model is
  involved. If the replay conflicts, it is aborted and the base is merged in instead, with Merge Attempts for the
  conflicts. The goal's checks run locally on such a resolution only when the repository has no CI.
- **Force with lease, for stacked branches only.** A replayed branch replaces its remote copy with
  `git push --force-with-lease=refs/heads/<branch>:<sha last seen>`. The goal branch and the base branch are never
  force-pushed. If the lease is refused (someone pushed to the branch), the replay is dropped: the branch is reset to
  the remote copy, the base is merged in, and it is pushed normally. A note records why.
- **Switches are live.** `delivery.policy_saved` stores a policy without starting a run. A running delivery reads
  *Wait for CI checks*, *Merge when no checks*, *Auto-resolve conflicts*, *Delete the remote branch* and the fix-CI
  budget at each step. Mode, unit, merge method, base and remote are refused while a run goes or PRs are open
  (switching between the two PR modes is allowed when idle). Changing them needs **Start over**, which closes the open
  PRs with a comment and deletes the stacked branches; merged work stays merged.
- **Resume** (`delivery.policy_set` source `resume`) is the default way to continue a stopped or partial delivery.
- **The docs commit is the last stack entry** when there are two or more task commits. `goal.docs_generated` records
  its ref; older events name it in their detail.
- **"Your local base has the work"** is decided by the last merged PR's merge commit being an ancestor of the local
  base, provided no stack entry is still undelivered. Otherwise the content comparison decides as before.
- The read model records per PR what the UI labels: the current step (`activity`), `ciSkipped`, `branchDeleted` and
  how it was synced (`current`, `rebased`, `merged`, `resolved`).

## Consequences

- An open stacked PR's history is rewritten once after the PR below merges. Reviewers who fetched it see a
  force-update; review comments stay attached to the PR.
- A PR someone pushed to is never overwritten, but then gets a merge commit rather than a clean replay.
- The guide's rule "Foundry never force-pushes" now reads "never force-pushes the goal branch or the base".
