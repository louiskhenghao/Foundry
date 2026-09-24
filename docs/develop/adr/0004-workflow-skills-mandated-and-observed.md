# ADR-0004: Workflow skills are mandated per role and task kind, and their use is observed

**Status:** accepted · 2026-08-21

## Context

Since the second round the engine has told each Role which installed catalog skills are "relevant" in a single line. That is advice, and advice in a prompt is routinely ignored under time pressure. The user wants Matt Pocock's engineering workflow (`mattpocock/skills`) woven into how the engine works, not merely available.

Upstream, that workflow has two layers. *User-invoked* skills orchestrate (`grill-with-docs → to-spec → to-tickets → implement`, `triage`, `wayfinder`, `setup-matt-pocock-skills`); they carry `disable-model-invocation: true`, expect an issue tracker and `docs/agents/*` files in the repository, and reference sibling files by relative path. *Model-invoked* skills hold reusable discipline (`tdd`, `diagnosing-bugs`, `code-review`, `codebase-design`, `domain-modeling`, `resolving-merge-conflicts`, `prototype`, `research`, `grilling`).

The engine already *is* the orchestration layer: Clarify is the grilling, the Brief is the spec, Tasks are the tickets, Attempts are the implementation, Reviewers are the review. Re-running the orchestration skills inside sessions would write tracker files into the user's repository and fight the engine's own loop.

The host also has two divergent copies of the same skills — a Claude Code plugin and older loose copies of the same names — and roles have real constraints: the Clarifier is read-only (`domain-modeling` wants to write docs; `grilling` wants to interview a human who is not there), the Task Reviewer is a cheap, short session (`code-review` spawns sub-agents).

## Decision

1. **Orchestration stays in the engine; only discipline skills are invoked.** The principles of the user-invoked skills (explore before asking, assumptions vs blocking questions, tracer-bullet vertical slices with explicit blocking edges, two review axes, hunk-by-hunk conflict resolution) are written into `roles/*.md`. Sessions are told never to run setup or ticketing skills and never to write `docs/agents/*`.
2. **The catalog declares workflow rules.** A catalog entry may carry `workflow: [{ role, mandate: must|prefer, when: <task kind>|any, instruction }]`. The prompt builder emits one `# Workflow skills` section per session listing the applicable rules with the invoke name actually loaded on this machine, plus the old "other installed skills" line. Nothing is mandated that is not installed.
3. **Mandates follow the roles' real constraints.** Worker: `tdd` must (feature, refactor), `diagnosing-bugs` must (bug), `prototype` prefer (research), `codebase-design` prefer. Merger: `resolving-merge-conflicts` must. Goal Reviewer: `code-review` prefer, with the base branch named as its fixed point. Clarifier and Task Reviewer get principles in their role files but no mandated invocations.
4. **Tasks have a kind.** The Brief labels each task feature / bug / refactor / research / chore; synthetic tasks are typed by the engine (review fixes and CI fixes are bugs, base-branch syncs are chores).
5. **Use is observed, not assumed.** The runner records every `Skill` tool invocation from the stream; `attempt.finished` and `session.usage` carry `skillsUsed`. The Task Reviewer is told which skills were mandated and which were invoked; a missing invocation is a *note* the next Attempt reads, never a blocker — the diff is judged on its merits.
6. **Plugin copies win.** When a skill exists both as a plugin skill and as a loose user-level copy, prompts use the plugin invoke (it is the copy `claude plugin update` keeps fresh); the loose copy is reported as a shadow and can be trashed.
7. **The profile is a switch.** `FOUNDRY_WORKFLOW=plain` restores the one-line hint for hosts that do not want the workflow.

## Consequences

- Installing or updating a workflow skill changes the next session's instructions without code changes; the catalog is the place to tune mandates.
- Observability is per session and per skill, so "did the worker actually do TDD?" has an answer in the task drawer and the activity log.
- Mandates are not enforcement: a worker can still skip a skill. The reviewer note and the observation report make that visible and self-correcting on the next Attempt; hard-failing an otherwise correct diff for a process miss would be the wrong trade.
- The engine never runs `setup-matt-pocock-skills`, so repositories are not modified on the user's behalf beyond the goal's own work.
