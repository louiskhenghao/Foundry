# 0003 — Remote actions are performed only by the engine, only under a policy the human chose

Date: 2026-08-21
Status: Accepted

## Context

From the start, the model has been confined to its git worktree: a `PreToolUse` hook blocks `git push`, `gh pr create`, deploys and the like, and any attempt to cross that boundary is Escalation trigger 3. The Goal's output was a local branch, and the only push in the system was a human-clicked button.

Users want the loop closed: initialise git where there is none, create the GitHub repository, open a pull request, resolve conflicts with the base branch, wait for CI, fix it, merge. Doing that by loosening the hook would hand remote side effects to a model that is explicitly allowed to fail and retry; doing it through new Escalations would turn every delivery into a chain of interruptions.

## Decision

1. **The hook stays.** Workers, reviewers, mergers and fix-CI attempts still cannot leave the worktree.
2. **Remote actions are engine code** behind a per-Goal `DeliveryPolicy` (`local` by default, else `push`, `pr`, `pr-automerge`) that the human selects when creating the Goal or later with an explicit Deliver action that first shows the exact plan. Selecting the policy is the authorisation.
3. **A closed set of guarded helpers** performs the side effects: a single `pushBranch` (fixed argv, never `--force`, never the base branch), a single remote-branch delete (never the base branch), and a `GhClient` for repository creation, pull requests, checks and merges. The base branch is pushed exactly once, when a brand-new repository was just created.
4. **Everything is an event** (`delivery.*`, including `delivery.command` with the exact argv, cwd, exit code and output tail), so delivery is auditable, resumable and idempotent after a restart.
5. **GitHub identity comes from the official `gh` CLI** (device-flow login). ai-engine never stores a token. Without `gh`, delivery degrades to git-only (`push` to an existing or URL-given remote).
6. **Existing mechanisms are reused**, not duplicated: conflicts with the base branch go through the Merge Attempt machinery; failing CI spawns a bounded fix task exactly like a failed Goal review; an exhausted fix budget is the existing Escalation trigger 2.

## Consequences

- No new Escalation triggers; the closed set of five is unchanged.
- Auto-merge happens only when all of: the policy says so, checks pass (or none are configured and the policy allows it), GitHub reports the PR mergeable, and the PR is open. Branch protection degrades to GitHub's own auto-merge, otherwise the PR is left open.
- The engine's `remote add` / `fetch` act on the user's repository configuration (the worktree shares it). This is intended and logged; the user's working tree is never touched.
- Rebase as a merge method happens only on GitHub's side; locally the engine never rewrites history.
