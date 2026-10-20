# ADR-0049: Workflow suites — a goal fixes whose skills its roles follow

**Status:** accepted · 2026-10-20 · amends ADR-0004 and ADR-0047

## Context

Since ADR-0004 the roles follow Matt Pocock's engineering workflow: the catalog's workflow rules say which skill a
role must or should invoke for a kind of task, and a Settings switch (`workflow.profile`, `mattpocock` or `plain`)
turned the rules on or off for every goal at once. ADR-0047 pinned that suite to one release.

A second suite is arriving: pstack (`michael-denyer/pstack-claude`, a Claude Code and Codex port of Lauren Tan's
pstack) brings its own discipline — `tdd` that starts a bug fix from the failing test, `thermo-nuclear-review`, a
`reflect` retrospective — and a person may want one goal on it and the next on Matt Pocock's. A global switch cannot
say that, and flipping it while goals run would move a goal's rules under its feet. Three things had to be settled.

**What the choice is called.** "Pack" was the obvious word and is taken: a Design, Image or Video Pack is a set of
skills for one kind of task, mutually exclusive, chosen in Settings only (`pack` and `packOption` on catalog
entries). A suite is a different thing — whose skills every role follows — so it gets its own name.

**Where it lives.** The global switch has to become a per-goal fact, like TDD, Ponytail and pace already are.

**How pstack is loaded without its hook.** pstack ships one hook, a SessionStart that tells every session to route
through its `poteto-mode` playbooks; its documented off-switch is a line in the global `~/.claude/pstack-models.md`,
which would also change the person's own sessions. The first plan was `--settings '{"disableAllHooks":true}'` for
every Foundry session. That is not possible: Foundry's own guards — the boundary guard that stops pushes, deploys
and desktop apps, the skill guard, the rm guard and the SessionStart canary that kills an attempt when hooks are
not active — reach the session through that same `--settings` JSON, and `disableAllHooks` switches them off too.

## Decision

- **The term is Workflow suite**, shown as **Powered by** in the UI. Three values: `mattpocock` (the default),
  `pstack`, `plain`. The stored field keeps its name: `settings.workflow.profile` is the default for new goals and
  `goal.workflow.profile` the goal's own, fixed when the goal is created and never changed by Settings afterwards.
- **Where it is chosen.** The New goal form in Expert view (prefilled from Settings); Simple view takes the default.
  A Follow-up starts from the earlier goal's suite, a Delegated goal takes its main goal's. The goal page and the
  Brief show the suite as a chip; the goals list only when it is not the default. The CLI takes `--suite`.
- **Old goals.** A goal from before this ADR has no `profile`; its sessions follow the Settings default at session
  time, as they always did. Nothing is backfilled.
- **The dials stay.** TDD, Ponytail and pace are still the goal's own switches; the suite only decides which skill
  carries a mandate (pstack's `tdd` or Matt Pocock's). A role the chosen suite has no skill for falls back to Matt
  Pocock's, then to plain.
- **pstack is loaded from a hook-less copy.** Foundry manages a clone of the plugin pinned to one tag (v0.9.93),
  materialises a plugin directory with its skills and manifest but no `hooks/`, and passes that to `--plugin-dir`
  for Claude sessions; Codex sessions get the skills linked into the goal workspace. Foundry's guards keep their
  hooks; the person's own user-level hooks keep running inside Foundry sessions, as before.
- **Every prompt names the suite** ("This engine follows pstack's engineering workflow"), so a session and a reader
  of its transcript know whose rules applied.

## Consequences

- `WorkflowProfile` is one enum in core, used by Settings and the goal; `SkillsHints` takes the goal's suite per call
  (`SectionOpts.profile`) and keeps the Settings default as its fallback; every caller passes `engine.workflowProfileOf(goal)`.
- The Settings field moves from the Skills card to New goal defaults, where the other per-goal defaults are.
- The pstack rules, the catalog entries that carry them, the managed clone and the Codex linking are the next
  block; until they land, a goal on `pstack` follows Matt Pocock's rules (the fallback) under pstack's name.
- Telemetry matches skill names by their suffix, so `/pstack:tdd` and `/tdd` are both `tdd`.
