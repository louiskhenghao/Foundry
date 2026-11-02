# ADR-0081: Carry over — a Follow-up made to finish what an earlier goal left takes its unfinished tasks as planned and skips Clarify

**Status:** accepted · 2026-11-02 · builds on [ADR-0028](0028-the-plan-is-written-once.md) and [ADR-0080](0080-pause-and-resume.md); amends the Follow-up of [ADR-0034](0034-follow-up-goals.md)

## Context

A Follow-up hands its Clarify a text snapshot of the earlier goal — what was asked, understood, decided, how each task
ended — and starts over: a new Clarify, a new plan, a new Brief to approve. For a goal that stopped with tasks left,
that is the wrong shape of help. The tasks were already planned and approved, with their specs, files and checks; what
the person wants is to finish them, perhaps as a new goal because the old one is over, not to have them planned again.
Resume ([ADR-0080](0080-pause-and-resume.md)) covers going on in the same goal. This covers going on in a new one.

## Decision

- **The Follows card lists the earlier goal's tasks**, the unfinished ones ticked by default when a Follow-up is opened
  from a stopped goal. The ticked ones are **carried over**: the new goal's Brief is written at once from them — their
  specs, files, difficulty, milestones, the order among themselves, the Areas they belong to, their acceptance checks
  and the earlier goal's goal-level checks, the estimate in their share — and the goal goes straight to *awaiting
  approval*. No Clarify runs. The person confirms the Brief as they would any other, and may edit it there.
- **Carrying over and new requirements are not mixed.** While tasks are ticked, the description box holds notes for the
  agents (optional), appended to a sentence that says what the goal finishes. To add new work, untick the tasks: the
  Follow-up is then clarified from what the person writes, as before. Mixing the two would mean a Clarify that plans
  around fixed tasks, which the plan-written-once rule ([ADR-0028](0028-the-plan-is-written-once.md)) has no place for.
- **The earlier goal's carried tasks are skipped there**, with the new goal named in the reason, so a later Resume of the
  earlier goal does not do them twice; the tasks left behind stay as they were. The new goal records which tasks it
  carries (`follows.carried`). A task that is done cannot be carried.
- The new goal starts where a Follow-up starts: from the earlier goal's branch when its work is not on the base yet, so
  the finished tasks' commits are there to build on.

## Consequences

- `follows.carry: string[]` on goal creation; `FollowUpDraft.tasks`; `carryTasks` in follow-up.ts builds the Brief.
  The carried Brief takes the skip-Clarify path of goal creation but stops at approval instead of approving itself.
- Two task transitions the state machine did not have: `pending → skipped` and `ready → skipped`.
- A Delegated goal's step (`goal` kind) carried over becomes a task of the new goal's own: a Follow-up may not delegate.
