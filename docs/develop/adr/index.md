# Architecture decision records

Decisions that are hard to reverse, surprising without context, and the result of a real trade-off. Newest last. A
record is never rewritten when a later decision changes it; its status says what replaced or amended it.

| # | Decision | Status |
|---|---|---|
| [0001](0001-drive-host-claude-cli-not-agent-sdk.md) | Drive the host `claude` CLI rather than the Agent SDK | accepted · 2026-08-21 |
| [0002](0002-event-log-as-source-of-truth.md) | Append-only event log as the source of truth | accepted · 2026-08-21 |
| [0003](0003-engine-only-remote-actions-under-human-policy.md) | Remote actions are performed only by the engine, only under a policy the human chose | accepted · 2026-08-21 · amended by ADR-0012 (a sixth escalation trigger, `milestone`) |
| [0004](0004-workflow-skills-mandated-and-observed.md) | Workflow skills are mandated per role and task kind, and their use is observed | accepted · 2026-08-21 |
| [0005](0005-scenario-skills-and-settings.md) | Scenario-selected skills, exclusive design packs, per-goal autoskills, and a settings file | accepted · 2026-08-22 |
| [0006](0006-model-registry-and-fallback.md) | No hard-coded model knowledge: a learned registry and a fallback chain | accepted · 2026-08-22 · partly superseded by ADR-0014 (goal model snapshot per tier; doctor checks tiers) |
| [0007](0007-completion-actions.md) | Completion actions: docs on the goal branch, graph refresh after delivery | accepted · 2026-08-26 |
| [0008](0008-non-code-goals.md) | Non-code goals: nature, git substrate, media artifacts outside git | accepted · 2026-08-26 |
| [0009](0009-multi-engine-roadmap.md) | Multi-engine roadmap: codex (and others) as swappable runners | proposed · 2026-08-27 · deferred, nothing implemented |
| [0010](0010-self-update-via-docker-hub-and-watchtower.md) | Self-update: Docker Hub as version source, watchtower as the docker updater | accepted · 2026-08-28 |
| [0011](0011-progress-folders-next-to-the-repo.md) | Progress folders next to the repository | accepted · 2026-09-14 |
| [0012](0012-milestones-previews-and-the-self-check.md) | Milestones, previews and the headless self-check | accepted · 2026-09-14 |
| [0013](0013-clarify-interview-in-rounds.md) | Clarify interviews the human in rounds | accepted · 2026-09-14 |
| [0014](0014-model-presets-per-goal-nature.md) | Model presets per goal nature | accepted · 2026-09-24 · supersedes the tier parts of ADR-0006 |
