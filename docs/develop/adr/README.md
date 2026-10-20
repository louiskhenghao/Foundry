# Architecture decision records

Decisions that are hard to reverse, surprising without context, and the result of a real trade-off. Newest last. A
record is never rewritten when a later decision changes it; its status says what replaced or amended it.

| # | Decision | Status |
|---|---|---|
| [0001](0001-drive-host-claude-cli-not-agent-sdk.md) | Drive the host `claude` CLI rather than the Agent SDK | accepted · 2026-08-21 · amended by ADR-0017 and ADR-0037 |
| [0002](0002-event-log-as-source-of-truth.md) | Append-only event log as the source of truth | accepted · 2026-08-21 |
| [0003](0003-engine-only-remote-actions-under-human-policy.md) | Remote actions are performed only by the engine, only under a policy the human chose | accepted · 2026-08-21 · amended by ADR-0012 (a sixth escalation trigger, `milestone`) and ADR-0038 (answers from a chat; boundary commands approved in the Inbox only) and ADR-0041 (host tokens kept for Deploy; every deploy command blocked for sessions) |
| [0004](0004-workflow-skills-mandated-and-observed.md) | Workflow skills are mandated per role and task kind, and their use is observed | accepted · 2026-08-21 · amended by ADR-0017 and ADR-0019 |
| [0005](0005-scenario-skills-and-settings.md) | Scenario-selected skills, exclusive design packs, per-goal autoskills, and a settings file | accepted · 2026-08-22 · amended by ADR-0019 |
| [0006](0006-model-registry-and-fallback.md) | No hard-coded model knowledge: a learned registry and a fallback chain | accepted · 2026-08-22 · partly superseded by ADR-0014 (goal model snapshot per tier; doctor checks tiers) · amended by ADR-0018 |
| [0007](0007-completion-actions.md) | Completion actions: docs on the goal branch, graph refresh after delivery | accepted · 2026-08-26 |
| [0008](0008-non-code-goals.md) | Non-code goals: nature, git substrate, media artifacts outside git | accepted · 2026-08-26 |
| [0009](0009-multi-engine-roadmap.md) | Multi-engine roadmap: codex (and others) as swappable runners | superseded by ADR-0017 |
| [0010](0010-self-update-via-docker-hub-and-watchtower.md) | Self-update: Docker Hub as version source, watchtower as the docker updater | accepted · 2026-08-28 |
| [0011](0011-progress-folders-next-to-the-repo.md) | Progress folders next to the repository | accepted · 2026-09-14 |
| [0012](0012-milestones-previews-and-the-self-check.md) | Milestones, previews and the headless self-check | accepted · 2026-09-14 · preview amended by ADR-0021 |
| [0013](0013-clarify-interview-in-rounds.md) | Clarify interviews the human in rounds | accepted · 2026-09-14 · amended by ADR-0027, ADR-0028 and ADR-0044 |
| [0014](0014-model-presets-per-goal-nature.md) | Model presets per goal nature | accepted · 2026-09-24 · supersedes the tier parts of ADR-0006; amended by ADR-0018 |
| [0015](0015-bring-merged-work-to-the-local-checkout.md) | Bring merged work to the local checkout, then tidy up | accepted · 2026-09-25 · amends the user-only base-branch rule |
| [0016](0016-mcp-servers-allowed-per-server.md) | MCP servers: listed from Claude Code's config, installed at user scope, allowed in goals per server | accepted · 2026-09-28 · amended by ADR-0019 |
| [0017](0017-goal-provider-and-account-isolation.md) | Fixed goal providers, independent accounts and capability-aware reporting | accepted · 2026-10-04 · amended by ADR-0018 and ADR-0019 |
| [0018](0018-codex-role-presets-and-model-discovery.md) | Codex role presets, native model discovery and captured goal settings | accepted · 2026-10-04 · amended by ADR-0028 |
| [0019](0019-provider-scoped-extensions-and-native-status.md) | Provider-scoped extensions, native account quota and read-only history | accepted · 2026-10-04 · amended by ADR-0020 |
| [0020](0020-native-plugin-lifecycle-and-account-ownership.md) | Native plugin lifecycle and server-owned account commands | accepted · 2026-10-04 |
| [0021](0021-multi-app-previews-and-compose-services.md) | Several apps per preview, and the compose services they need | accepted · 2026-10-05 · amends ADR-0012 |
| [0022](0022-preview-environment-outside-the-workspace.md) | Preview environment stays outside the goal's folder | accepted · 2026-10-05 |
| [0023](0023-resumable-stacked-delivery.md) | A stacked delivery resumes, replays onto the base, and reads its switches live | accepted · 2026-10-05 |
| [0024](0024-guided-install-and-shared-host-docker.md) | One installer for both ways to run Foundry, and the host's Docker shared on request | accepted · 2026-10-06 |
| [0025](0025-finished-previews-may-run-in-the-checkout.md) | A finished goal's preview may run in the person's checkout | accepted · 2026-10-07 |
| [0026](0026-tailnet-links-and-served-previews.md) | Messages link on the tailnet, and Foundry serves preview ports there | accepted · 2026-10-07 |
| [0027](0027-interview-depth.md) | The interview has a depth, not a round count | accepted · 2026-10-07 · amends ADR-0013 · amended by ADR-0044 |
| [0028](0028-planner-writes-the-plan-once.md) | The planner writes the task plan once, in a session of its own | accepted · 2026-10-08 · amends ADR-0013 and ADR-0018 |
| [0029](0029-vs-code-in-the-browser.md) | VS Code in the browser, behind a generated password, on loopback and the tailnet | accepted · 2026-10-08 |
| [0030](0030-transfer-merges-goals-as-history.md) | Transfer merges goals into another Foundry as history, and unfinished ones can be reattached | accepted · 2026-10-09 |
| [0031](0031-feature-milestones-with-scripts.md) | A milestone per feature, shown by a Playwright script its task writes | accepted · 2026-10-14 · amends ADR-0012 · amended by ADR-0042 (a Likeness review of each recording) |
| [0032](0032-ponytail-discipline-and-reverse-engineering.md) | Ponytail as a per-goal discipline, an audit at the end, and reverse engineering with REA | accepted · 2026-10-16 · amends ADR-0004 and ADR-0016 |
| [0033](0033-cad-goals-with-text-to-cad.md) | CAD goals with text-to-cad, behind a Desktop apps & printers switch | accepted · 2026-10-16 · amends ADR-0008 and ADR-0016 |
| [0034](0034-delegated-goals.md) | A step that is a project of its own is a Delegated goal, one level deep, landing as one commit | accepted · 2026-10-18 · amends ADR-0028 |
| [0035](0035-deliverables-and-replan.md) | A task's Deliverables are a contract, and the planner touches up what follows after a Delegated goal lands | accepted · 2026-10-18 · amends ADR-0028 and ADR-0034 |
| [0036](0036-parallel-delegated-goals.md) | Delegated goals run side by side within the goal's parallel limit, each with a share of the budget | accepted · 2026-10-18 · amends ADR-0034 |
| [0037](0037-unmeasured-sessions.md) | A session cut before its result line is unmeasured — its cost is unknown, not zero | accepted · 2026-10-18 · amends ADR-0001 · amended by ADR-0043 (an estimate at the model's measured rate, never counted) |
| [0038](0038-chat-answers-from-telegram.md) | Telegram takes answers: buttons and replies go through the app's own calls, and boundary commands stay in the Inbox | accepted · 2026-10-18 · amends ADR-0003 · amended by ADR-0039 |
| [0039](0039-chat-answers-from-discord.md) | Discord takes answers through a bot of the user's, read over the gateway | accepted · 2026-10-18 · amends ADR-0038 |
| [0040](0040-learnings-per-repository.md) | Learnings: what a folder's goals taught, written when a goal ends and given to the next goals there | accepted · 2026-10-18 |
| [0041](0041-deploy-web-apps.md) | Deploy: a finished goal's web app to Vercel, Netlify or Cloudflare Pages, on the person's click | accepted · 2026-10-18 · amends ADR-0003 |
| [0042](0042-subjects-and-the-likeness-review.md) | Subjects with pictures on the Brief, and a Likeness review of each milestone | accepted · 2026-10-18 · amends ADR-0031 |
| [0043](0043-estimate-cut-sessions-at-measured-rates.md) | A cut session's cost is estimated from its tokens at the rate its model was measured at | accepted · 2026-10-19 · amends ADR-0037 |
| [0044](0044-notes-are-decisions.md) | A note from the human is a Decision, asked for or not: an interview round and the Brief page take one | accepted · 2026-10-19 · amends ADR-0013 and ADR-0027 |
| [0045](0045-revise-may-ask-back.md) | A Revise may ask the human a round or two before it proposes; the answers are Decisions | accepted · 2026-10-19 · builds on ADR-0013 and ADR-0044 |
| [0046](0046-skeleton-first-and-the-interactive-lane.md) | The Brief skeleton shows first, editable while the planner works; a session a person waits for may run one beyond the concurrency limit | accepted · 2026-10-20 · amends ADR-0028 |
| [0047](0047-latest-mattpocock-skills-in-the-workflow.md) | The mattpocock suite pinned to v1.3.1; writing-for-agents by file, retro opens the Learnings session, the pr template writes the PR body | accepted · 2026-10-20 · amends ADR-0004 and ADR-0040 |
| [0048](0048-gstack-leaves-foundry.md) | Foundry no longer knows gstack: no catalog entry, no provenance family, no special cases; another tool's skill is a hand-installed skill | accepted · 2026-10-20 |
| [0049](0049-workflow-suites.md) | A goal fixes whose skills its roles follow — mattpocock, pstack or plain — when it is created; pstack loads from a hook-less copy of its pinned plugin | accepted · 2026-10-20 · amends ADR-0004 and ADR-0047 |
| [0050](0050-learnings-as-a-project-skill.md) | A folder's Learnings are also a git-excluded project skill for the person's own sessions; on pstack the Learnings session reflects with reflect's lenses as text | accepted · 2026-10-20 · builds on ADR-0040 and ADR-0049 |
| [0051](0051-brief-second-opinion.md) | A second opinion on a Brief awaiting approval: a built-in Brief-reviewer role on the goal reviewer's model, on demand or once per Brief, kept as an event and shown as a Revise checklist; written in the background with the room of a goal review | accepted · 2026-10-20 · amended 2026-10-20 · builds on ADR-0045 and ADR-0049 |
| [0052](0052-goal-from-an-issue.md) | A goal from a GitHub issue: read once through gh, its thread an attachment, its pull request closes it with `Closes #n`; Foundry writes nothing to the issue | accepted · 2026-10-20 · builds on ADR-0003 |
| [0053](0053-review-comments-addressed-by-the-delivery.md) | Review comments on a pull request (inline, or a request for changes) are addressed by a run of the delivery: a bounded fix task on the branch, pushed, a reply under each; capped by `fixReviewCycles`, more on the person's click | accepted · 2026-10-21 · builds on ADR-0003 and ADR-0052 |
