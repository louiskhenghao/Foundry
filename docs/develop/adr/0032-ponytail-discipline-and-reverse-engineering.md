# ADR-0032: Ponytail as a per-goal discipline, an audit at the end, and reverse engineering with REA

**Status:** accepted · 2026-10-16 · amends [ADR-0004](0004-workflow-skills-mandated-and-observed.md) (workflow skills) and [ADR-0016](0016-mcp-servers-allowed-per-server.md) (MCP servers)

## Context

Two things the person wanted in the code workflow. First, less code: the Ponytail skill ("the lazy senior dev", one
prompt plus review and audit skills) makes an agent reuse what the codebase, the standard library and the installed
dependencies already have and write the smallest complete change. Foundry already mandated Matt Pocock's skills (TDD,
diagnosing bugs, code review), so Ponytail had to fit next to them without reviewing twice or arguing about tests.
Second, learning from shipped software: REA (one MCP server with 207 tools) reverse engineers binaries, JavaScript and
Electron apps, .NET, Android packages and websites on the person's computer. A goal that says "a search like the one in
that app" had no way to find out how that app does it, and an unattended worker with REA's tools could also launch the
target, attach a debugger or change a connected phone. REA itself has no server-side filter: every tool is registered
and advertised, with effects only as hints.

## Decision

- **Ponytail is a discipline switch next to TDD,** on by default for new and existing goals, applied from a goal's
  next session, with a switch in Settings, on the New goal form, on the Brief and on the Overview. The `ponytail`,
  `ponytail-review` and `ponytail-audit` skills are catalog entries installed from git as a bundle (never Ponytail's
  hooks, which write global state and apply to every session of the person's own agent). Work that is not code (docs,
  research, media) never sees it.
- **TDD decides how tests are written; Ponytail how much code.** Both rules reach a worker when both are on; the
  Ponytail rule says so. The planner gets a lean-planning section. `ponytail-review` replaces `code-review` for task
  and goal reviews while the switch is on and the skill is installed (preferred for the many task reviews, required for
  the one goal review); only its must-fix findings are blockers, the rest goes into the notes and from there into the
  pull request. Review frequency does not change.
- **An optional audit at the end.** Chosen per goal in the Brief's Completion section (Settings default off): once
  every task has landed, `ponytail-audit` maps the branch and ranks what to fix. Must-fix findings in the code the goal
  changed (the files themselves, named exactly; a folder holding one is not a match, or the auditor could promote any
  finding into a fix task) become fix tasks (bounded), run before the final walkthrough and the review; every finding
  stays on the Completion card with the fix task it became, and a follow-up goal can be started with the rest. One pass
  per goal, the goal review's cost cap; a goal with no budget left skips it.
- **REA is an optional MCP server with a disclaimer and a deny list.** Its catalog entry carries the disclaimer the
  person confirms once before installing (lawful use, what leaves the computer, which native engines it needs) and the
  names of the tools that run the target, attach a debugger, touch a connected device or write files where the caller
  says (the evidence bundle). Those are denied in sessions
  by name, through `--disallowedTools` for Claude and a deny list in the Codex guard, until a Settings switch opens
  them; static analysis works at once. The filter is Foundry's, because REA has none. A list of names holds only for
  the version it was written against, so the catalog pins `rea-agents` to a version and a bump re-checks the list.
  When the catalog itself cannot be read there is no list to apply: then no MCP server reaches an unattended session
  until it is fixed (the Setup page says so), rather than every tool reaching it.
- **A goal can have references.** The New goal form takes up to five (a URL or a path, and which feature to look at).
  Before Clarify, a capped session studies them with REA and writes a report with its evidence. The report is an
  attachment, so every later session reads it, and a document under `docs/reference/` on the goal branch, so it ships
  with the code. The Clarifier grounds the Brief in it; a goal that only asks to understand the reference is of nature
  research and delivers the report. Workers get the same rules: learn the behaviour, never copy the code. Re-run Clarify
  investigates again first; the Brief page can investigate again on its own. Without REA the investigation is skipped
  and recorded, and Clarify goes on. The session reads third-party content with a shell at hand, so only the report is
  committed and whatever else it left in the worktree is discarded; the report is marked as third-party content for the
  sessions that read it, and credentials typed into a URL never reach the report or its commit. The Brief cannot be
  approved, nor Clarify re-run, while an investigation runs; a goal that skips Clarify takes no reference.
- **Native engines are the person's.** REA analyses websites, JavaScript and Electron apps, .NET and Android packages
  without them; native apps and binaries need Hopper, Ghidra or IDA, which Foundry detects and reports on the Setup page
  but never installs.

## Considered options

- **Install the Ponytail plugin with its hooks.** Rejected: the hooks inject themselves into every session of the
  person's own Claude Code and Codex, write a global flag and nudge the status line. Foundry needs the prompt, per goal.
- **Ponytail's light test rule instead of TDD, or the two mutually exclusive.** Rejected: TDD is the discipline the
  person already chose; Ponytail's "one small test" is about the amount of code, not about when tests are written.
- **Run both review skills at the final review.** Rejected: two reviews of the same diff cost time and money, which
  was the person's main worry; one skill reviews, and the Brief's own checks still judge the spec.
- **Audit only as a report, or audit the whole repository into fix tasks.** Rejected: a report alone is ignored, and
  fixing every old problem of a repository inside a feature goal makes the pull request unreviewable. Must-fix findings
  in the goal's own code are fixed; the rest is a follow-up the person starts.
- **Allow all of REA's tools, or restrict with REA's own configuration.** Rejected: REA offers no filter, and an
  unattended worker must not run the target or change a phone by default. A name list in the catalog is reviewable and
  updated as data.
- **Let the Clarifier use REA itself.** Rejected: Clarify runs read-only with no MCP servers, and the report must exist
  before the Brief and outlive it. A separate capped session, whose report is an attachment, keeps both.
- **Keep the report only as an attachment.** Rejected by the person: committed under `docs/reference/`, it documents
  for the repository why the implementation looks the way it does.

## Consequences

- Goals from before this release turn Ponytail on from their next session; the Overview switch turns it off.
- A reviewer's notes now reach the pull request body of a stacked delivery (they never did: the field read did not exist).
- `GoalWorkflow`, `GoalCompletion`, `Goal` and the MCP catalog schema gained fields with defaults, so older events
  replay unchanged; `goal.audit_finished`, `goal.references_set`, `goal.investigation_requested`,
  `goal.investigation_finished` and `goal.ponytail_set` are new events.
- The deny list must follow REA's releases: a renamed dynamic tool is allowed until the catalog names it again. The
  Settings switch is global, not per goal.
- A reference's report reaches the model provider like any attachment; the disclaimer says so.
