# ADR-0063: A goal that changes several repositories does it through companion repositories and delegated goals

**Status:** accepted · 2026-10-21 · builds on [ADR-0034](0034-delegated-goals.md) and [ADR-0035](0035-deliverables-and-replan.md)

## Context

A goal is bound to one repository: its branch, progress folder, checks, previews and delivery all live there. Real
changes often span two — a backend and the frontend that calls it, a library and the app that uses it — and today
that is two goals the person coordinates by hand, with the interface between them in their head. Making the goal
itself span repositories (a branch and a delivery per repository inside one goal) would touch every part of the engine
that assumes one folder. Delegated goals (ADR-0034) already run a part of a goal as a goal of its own, with its own
Clarify, plan, tasks, checks and page, and report back with a summary the next tasks read (ADR-0035).

## Decision

- **Companion repositories on the goal.** The New goal form (and `foundry goal new --also <path>`) names the other
  folders a goal changes; each is a repository on a branch, not the goal's own, named once. They are kept on the goal
  (`companions`) and shown on its page.
- **Each companion's part is a `goal` task bound to it.** Delegation is on for such a goal. The Clarifier and the
  planner read a *Companion repositories* section — each folder's top level, package and README — and plan a
  companion's part as one task of kind `goal` with `repo` set to that folder; only a path the goal named survives
  approval. The person sees it on the Brief with the folder's name and may change it like any task.
- **The delegated goal works there, on that repository's own base branch,** created from the companion's branch as it
  is (not from the main goal's branch), told that it is a companion of the main repository and may read it there for
  the interface. It lands nothing on the main goal's branch: when it finishes, its summary becomes the task's, the
  Deliverables it promised are checked on its own branch, the replan runs, and the task is done. Its branch stays in
  its repository.
- **Delivered together, one pull request per repository.** When the main goal is delivered with a mode other than
  Local only, each companion's delegated goal is given the same policy (its own remote and base branch) and delivers
  itself: the main pull request lists the companions and their pull requests, each companion's says which goal it is
  part of. The Delivery tab shows the companions' deliveries with links to their goals, where each can be re-checked,
  resumed or reverted on its own.
- **One repository's extras stay its own.** The main goal's preview, self-check, QA, walkthroughs, deploy and
  screenshots cover the main repository; a companion's delegated goal has its own.

## Considered options

- **A goal with several branches and deliveries inside it.** Rejected: every assumption of one folder — the progress
  folder, worktrees, checks, previews, the delivery pipeline, after-merge, the page — would fork; delegation already
  gives each repository a whole goal.
- **Two goals the person links by hand (a Follow-up in the other repository).** Rejected as the only way: it leaves
  the interface uncoordinated and nothing delivers them together; it stays possible.
- **Landing the companion's work in the main repository as a submodule or vendored copy.** Rejected: nothing of the
  companion belongs in the main repository.
- **Starting the companion's goal from a branch of the main goal.** Rejected: the branches are of different
  repositories; the main goal's work reaches a companion only through what the summaries and specs say.

## Consequences

- `Goal.companions` (`GoalCompanion`), `BriefTask.repo` and `Task.repo`, `CreateGoalInput.companions`;
  `engine/src/companions.ts` (the prompt section, the pull request extras, delivering the companions);
  `createDelegatedGoal` and `landDelegation` in `delegation.ts`; `Engine.deliver` delivers the companions.
- A companion's delegated goal is a goal in the list like any delegated goal, with its folder's name beside it on the
  main goal's page.
- A goal task bound to a companion has no landing conflict to resolve and no artifacts to copy; a Deliverable it
  promised is looked for on its own branch.
