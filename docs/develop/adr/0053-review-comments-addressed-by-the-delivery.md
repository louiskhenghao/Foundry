# ADR-0053: Review comments on a pull request are addressed by the delivery — a bounded fix task on the branch, a reply under each

**Status:** accepted · 2026-10-21 · builds on ADR-0003 and ADR-0052

## Context

A pull request Foundry opened is reviewed like any other: a person leaves inline comments on the diff, or a review
that requests changes. Until now that was where Foundry's part ended. The person either made the changes by hand on
a branch the engine owns, or wrote a new goal to say what the comment already said. The goal's own machinery for
"the result is not right yet" exists twice already: the goal review's fix tasks, and the delivery's fix-CI task
(ADR-0003), which runs in the pull request's checkout, pushes, and is capped by a policy switch.

Anything written to GitHub is a remote action, which ADR-0003 reserves for engine code under a policy the person
chose. A reply under a comment is such a write; so is a push of a fix. Both have to be the delivery's, never a
session's, and both have to stop when the person says so.

## Decision

- **What counts.** Inline comments on the pull request's diff, and the body of a review that requests changes. An
  approval, a review that only comments, a conversation comment, anything a bot wrote, and Foundry's own replies do
  not. A person who wants Foundry to act writes on the diff or requests changes; a person who wants to talk comments.
- **A look, not a hook.** The watch that already reads a delivery's open pull requests every few minutes, and whenever
  the goal's page is opened (ADR-0015's timer), also reads their review comments. New ones since the last look form a
  **round**, recorded on the delivery with every comment's words, place and author. No webhook, no token beyond `gh`.
- **The delivery runs again to address it.** When the policy's budget allows, the engine starts a run of the delivery
  by itself (`delivery.policy_set` with source `review`). The run reuses the open pull request and, before anything
  else happens to that pull request, a new `fix-review` step runs a bounded fix task in the pull request's own
  checkout, its attempts squashed into one commit, the goal's must checks run on the result, exactly as the fix-CI
  task does. The commit is pushed to the pull request's branch; in a stack, to the branch of the pull request that
  was reviewed, the others untouched. With auto-merge, the checks are then waited for and the merge goes on as before.
- **A reply under each comment**, written by the engine after the push: the commit and the files it changed, or that
  the code was left as it is and why is on the goal page. The reply ends with a hidden mark (`<!-- foundry:review-reply
  -->`), so a later look never takes Foundry's replies for the person's. Nothing else is written to GitHub.
- **Bounded like fix-CI.** The policy gains `fixReviewCycles` (don't fix, up to once by default, up to twice, up to
  three times): rounds the engine addresses by itself over the delivery's life. Beyond it a round waits, the person
  is told where, and **Fix review comments** on the Delivery tab addresses that round on their click. Resume and
  Retry give a fresh budget; a run the engine started for a round does not. A fix task that cannot make the comments
  pass stops the delivery like a CI fix that cannot: one Inbox item, Resume or Mark as delivered.
- The switch is on the delivery form for both pull request modes; a saved switch applies from the running delivery's
  next step like the others.

## Consequences

- A round costs one fix task (worker attempts, a reviewer) and is pushed to a branch the person may be looking at;
  the reply under each comment says what changed, and the task's report on the goal page says why.
- Comments left while a delivery runs are picked up by the next look once it ends; comments on a pull request that
  merged meanwhile are moot and are not read again.
- The watch reads two more endpoints per open pull request per look; within GitHub's rate limits by a wide margin.
- A reviewer who wants no change but a conversation uses a plain comment or a comment-only review, which Foundry
  leaves alone. The guide says so.
