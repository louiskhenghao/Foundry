# ADR-0098: A goal remembers the skills its sessions were given, as they read then

**Status:** accepted · 2026-11-13 · builds on ADR-0047 and ADR-0049

## Context

A goal's Overview had a **Project skills** card that showed one thing: the names autoskills installed for the
repository's stack (`goal.autoskills`). Yet a session is told about skills from several places. The `# Workflow skills`
section of every role's prompt names the workflow suite's rules (ADR-0049: `MUST` and `Prefer`, from the catalog
entries installed on the machine, under the goal's suite and packs), then the other installed entries relevant to the
role and scenario, then the project skills. None of that reached the card: a person reading a finished goal could not
tell that its workers had been told to use `tdd` and `impeccable`, that the reviewers had `code-review`, or that a
worker had invoked `diagnosing-bugs` on its own. Only the Task drawer's **Skills** cell listed what one attempt invoked,
as bare names.

The harder problem is time. Skills iterate: the Extensions page updates plugins, suites move releases, hand-installed
copies are edited. A goal that ran in October followed the `impeccable` of October. Opening the skill from the goal
a month later and reading today's copy would misdescribe what the goal did; a reviewer of the goal's work needs what
the sessions actually read. Nothing in Foundry kept that text.

## Decision

- **Every prompt's section is mirrored by a record.** `formatWorkflowSection` gained a sibling, `offeredSkills`, that
  returns the same input's skills as data: the rules with their mandate (a skill with a MUST and a Prefer rule counts as
  MUST), the other installed entries the section lists (`available`), the project skills (`project`); under the plain
  suite, the one-line hint's entries. The engine's `skillsSection(goal, role, opts)` builds a role's section with the
  goal's suite and packs and records what it names — every caller (Clarify, the planner, the worker, both reviewers,
  the merger, the documenter, the style sample) goes through it. The project skills are also recorded when autoskills
  installs them, since every worker of the goal is told about them.
- **The text is kept content-addressed.** When a skill is recorded, its SKILL.md is read from the copy the session will
  load (the user folder, the plugin, the suite's copy, the goal workspace for a project skill) and written once under
  `<data>/skill-snapshots/<git blob sha>.md`. One copy per content, however many goals and roles saw it; a skill that
  changes while a goal runs gets a second record and the card says so. The record is a `goal.skills_seen` event per role
  carrying name, invoke, source (Foundry's install, a plugin, a suite, bundled, project, a linked folder, by hand,
  unknown), mandate, sha, folder, version and origin — appended only for the (role, invoke, content) pairs the goal has
  not recorded yet, so a goal with fifty sessions holds a handful of these events.
- **What a session chose itself is recorded after the session.** `recordSessionUsage`, the one funnel every finished
  session passes, records the invoked skills no prompt of the goal named (`invoked`), resolved against the machine's
  installed copies as they are at that moment — the closest Foundry can come to what the session read, since the
  invocation is only known once the session ends.
- **The card shows every skill by how it was told.** The Overview's **Skills** card lists Workflow (must marked),
  Project, Available and Also invoked, with how many sessions invoked each (joined from `attempt.finished` and
  `session.usage`; Codex and Antigravity report none, so their cards say so). A click opens the skill **as the goal saw
  it**; when the installed copy has changed since, **As installed now** sits beside it. The Task drawer's invoked skills
  open the same window. A goal from before the record keeps its project skills by name from `goal.autoskills` and opens
  the installed copy with a line saying no copy was kept.
- **A Transfer carries the copies.** The export stages the `skill-snapshots` files the goal's records name; the import
  keeps them under their sha, so a goal moved to another computer opens what it saw there too.

## Consequences

- A goal's page tells the whole truth about its skills: what every role was told, with what weight, and what was
  actually invoked — the place to look when a result is better or worse than expected after a skill update.
- The data folder grows by the distinct SKILL.md contents sessions saw: a few kilobytes per version of each skill, not
  per goal. The folder is listed in the backup table and is optional to keep; without it the card still lists the skills
  and opens the installed copies.
- What a session did with a skill it was told about is beyond the record: Foundry sees invocations (Claude Code) but not
  reading, so a project skill a worker read without invoking shows no count. The record says what the session was given
  and what it called, not what it followed.
- The recorded copy is of the SKILL.md alone. A skill's other files (scripts, references) are not kept; the window
  says so by showing one file.
- `goal.skills_seen` is informational: no projection changes a goal row, so goals from earlier releases load unchanged
  and the view is computed from the events on request.
