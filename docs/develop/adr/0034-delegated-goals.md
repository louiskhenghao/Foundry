# ADR-0034: A step that is a project of its own is a Delegated goal, one level deep, landing as one commit

**Status:** accepted · 2026-10-18 · amends ADR-0028

## Context

A goal that spans crafts — research first, a 3D model and a video next to the code of a site — gets one Brief and one
plan. The planner cuts every craft into tasks of one session each, with the understanding and the Decisions of the whole
goal diluted across them, and each craft comes out shallow. Opening one goal per craft gives each the Clarify it
deserves, but the person then sequences the goals by hand and carries the results from one to the next; a Follow-up only
chains finished goals.

A nested task tree — tasks that have tasks — would mean a recursive data model, scheduler and UI, and a planner that plans
at every level.

## Decision

- **Composition, not nesting.** A **Delegated goal** is an ordinary goal with one extra field, `delegatedFrom`, naming the
  main goal and the task it does. The main goal's task points back (`delegatedGoalId`). Everything a goal has — page,
  Clarify, Brief, tasks, reviews, milestones — a Delegated goal has.
- **One level.** A Delegated goal never delegates: its `delegation.allow` is forced off, and a `goal` task in its Brief is
  approved as a feature task.
- **The planner decides, when allowed.** Two switches on the New goal form, both off by default, are kept on the goal
  (`delegation`): *allow* offers the planner the task kind `goal` (the JSON schema handed to it carries the kind only
  then; a kind written without permission is demoted at the Brief), *autoApprove* lets the engine approve the Delegated
  goals' Briefs. The person sees the `goal` tasks on the Brief like any other and may change them.
- **Start and base.** When its task's turn comes (one Delegated goal per main goal at a time), the engine creates the
  Delegated goal with the task's spec as its prompt, the main goal's coding agent, models, discipline and view, the main
  goal's branch as its base branch (nothing is fetched for it), what is left of the main goal's budget, local-only
  delivery and no completion actions of its own. Its Clarify and planner read a `# Part of a larger goal` section: the
  main goal's prompt, understanding and Decisions, and what the tasks before it delivered.
- **Waiting.** A `goal` task reads `running` while its goal works. While the Delegated goal needs the person — an
  interview question, a Brief to approve (or a blocking question on one the engine would approve), a milestone, an
  Escalation — the main goal is `blocked` with a reason that says so, and goes back by itself once the Delegated goal no
  longer needs anyone. Every event of a Delegated goal that changes this ticks the main goal.
- **Landing.** A Delegated goal that ends `done` or `over_delivered` is squash-merged onto the main goal's branch under
  the goal workspace's lock as the task's one Conventional Commit (conflicts go through Merge Attempts, as for a task
  worktree), its git-excluded `artifacts/` copied over, and a summary of what it delivered — its understanding, tasks,
  Decisions, review, what it left open, the files — is written on the task (`task.summary_set`). Every task now inherits
  the goal's `artifacts/` when its worktree is made (cad tasks did already), so a page can use the images made for it.
- **Upstream summaries.** A worker's prompt carries `# What the steps before this one delivered`: the summaries of the
  tasks it depends on, or the commit a plain task landed as. A Delegated goal's Clarify gets the same for its task.
- **Failure.** A Delegated goal that fails has its failed tasks (and what depends on them) restarted in place, with a hint
  saying why, as often as the main task's attempt budget allows (`task.delegation_restarted` counts); then, and when the
  Delegated goal was cancelled or deleted, the main task escalates (`retries_exhausted`, kind `delegation`) and the main
  goal is blocked: retry runs the failed tasks again, skip moves on. Restarting the main task from the task view starts a
  fresh Delegated goal; the old one stays as a goal of its own.
- **Cost.** A Delegated goal's `goal.cost_added` is mirrored to the main goal, so the main goal's budget covers both and
  an overrun escalates there.

## Consequences

- Each craft gets its own interview, Brief and plan, and still lands in one branch, one delivery, with the main goal's
  Decisions honoured; the person never sequences goals by hand.
- A Delegated goal's branch is based on a moving branch: landing may conflict with what other tasks landed meanwhile;
  Merge Attempts resolve it, and the person is told to merge the main branch into the Delegated goal's folder by hand when
  they give up (there is no task worktree to resolve in).
- A main goal with a Delegated goal keeps every other task in a worktree of its own, so the landing never lands onto a
  task's uncommitted work in the goal folder; a task already working there is waited for.
- The goals list folds Delegated goals under their main goal; a Delegated goal whose main goal was deleted stays listed
  on its own, saying whose it was.
- Not done here: Delegated goals running in parallel (the `dependsOn` edges allow it later), a per-step budget estimate by
  the planner (the Delegated goal gets what is left), and a model-written summary (the summary is assembled from the
  goal's records).
