# Foundry — Domain Context

This file is a glossary. It defines the language used across the codebase, the UI and conversations. It deliberately contains no implementation detail.

## Core concepts

**Goal**
A user-set objective stated in natural language against a repository. A Goal is finished when all of its Must Checks pass; it is *over-delivered* when its Stretch Checks pass as well. A Goal's output is a local branch. Nothing leaves the machine unless the user chose a Delivery Policy — and then it is the *engine*, never the model, that pushes, opens or merges exactly what the policy says.

**Task**
The smallest unit of work carved out of a Goal during Clarify. Tasks form a DAG through `dependsOn` edges. A Task with no unfinished dependencies is *ready*. Fan-out, fan-in and pipeline are not separate concepts — they are shapes of the DAG.

**Attempt**
One Plan → Act → Observe pass at a Task, performed in a fresh Claude session. An Attempt is made of several sessions — the Worker's segments, the Task reviewer, possibly a Merger — each recorded with its model, cost and turns. A *retry* is simply the next Attempt, fed with the previous Attempt's Observation Report — unless the session can simply carry on (see Continuation). A **Merge Attempt** is an Attempt whose only job is to resolve a merge conflict between two Tasks.

**Continuation**
The next segment of the same Attempt: its Claude session is resumed with everything it already knows, instead of a fresh session that must understand the Task again. The engine continues an Attempt when its session was cut (engine restart, turn or cost cap, timeout) or when the Checks still fail but the segment made progress; a Continuation consumes no retry, and an Attempt is continued at most a few times before a genuine new Attempt (fresh session, Observation Report) takes over. A Merge Attempt's second try is a Continuation of its first.

**Check**
A decidable acceptance item. Every Check belongs to a *tier*:
- **Must** — something the user explicitly asked for. All Must Checks passing means the Goal (or Task) is *done*.
- **Stretch** — something the system proposed during Clarify and the user confirmed. Stretch Checks passing on top of Must Checks means *over-delivered*.

The system never invents scope on its own: a Stretch Check exists only because the user accepted it in the Brief.

**Observation**
The evidence gathered after an Attempt acts: the results of the Task's Checks, the reviewer's verdict, and the list of changed files. The distilled form handed to the next Attempt is the **Observation Report**.

**Reviewer**
A Claude session that reads a diff and judges it. The *Task reviewer* is lightweight and reports blockers only; the *Goal reviewer* judges the whole Goal diff against the Must and Stretch Checks. Reviewer verdicts never override objective Check results.

## Clarify

**Clarify**
The phase between a Goal being created and work starting. The system explores the repository on its own and produces a Brief; the user reviews it once. While the Brief awaits approval it can be *re-run*: the Workspace is rebuilt from a fresh fetch and a new Brief replaces the old one.

**Brief**
The single document the user approves before automation begins. It holds the system's understanding, the Areas the Goal covers, its Assumptions, the proposed Must and Stretch Checks, the proposed Task DAG, a cost estimate, any Questions, and a one-line Conventional Commits title for the whole Goal that becomes the pull request title.

**Area**
A part of the product a Goal covers — a user-facing role or app (student portal, teacher portal…) or the shared groundwork they all need. The Clarifier lists the Areas from the goal and its Attachments; the user can add, rename or delete them. Every Task, every Goal-level Check and every Question belongs to one Area. A Task's commit scope defaults to its Area's slug but is a separate thing.

**Coverage**
Every Area has at least one Task. A Brief that names an Area and plans nothing for it is incomplete: the Clarifier is sent back once to fill the gap, and if it still cannot, the gap becomes a Question for the user — draft Tasks for the Area, or delete it.

**Stage**
A layer of the Task DAG as shown on the Brief page: Tasks of one Stage do not depend on each other and may run in parallel; a Stage starts when the Stages before it are done. A way of reading the DAG, not a separate concept.

**Draft**
The user asking the system, on the Brief page, to write what is missing for one Task (its spec, attributes and Checks), to propose Checks for a Task that already has a spec, or to propose Tasks for an uncovered Area. The result is a **Proposal**: nothing enters the Brief until the user accepts it item by item, and the system never rewrites text the user wrote.

**Assumption**
A statement in the Brief the system is proceeding on unless the user overrides it. Assumptions are accepted by default — leaving one untouched means agreeing with it; rejecting one is a Decision.

**Question**
Something the system could not safely assume. A *blocking* Question must be answered before the Brief can be approved. An answer is a Decision.

**Decision**
A choice the user made on the Brief that the system must honour: the answer to a Question, or a rejected Assumption. Decisions belong to the Goal, not to a Task — every Worker, Reviewer and the pull request receive them verbatim, and a re-run Clarify starts from them instead of asking again. A Decision is *applied* once a Revise honoured it (or the user said no change was needed); changing the answer makes it pending again.

**Revise**
The user asking the system to re-read the Brief in the light of the current Decisions: the Clarifier looks at the repository again (read-only) and proposes what the Decisions imply — changed, added or dropped Tasks, Checks and Areas, an updated understanding. The result is a Proposal accepted item by item; the Brief can still be approved with pending Decisions, it merely says so.

## Human involvement

**Escalation**
The only way the system ever asks a human for anything after the Brief is approved. There are exactly five triggers, and nothing else interrupts the user:
1. a blocking Question in the Brief;
2. a Task exhausted its retry budget with Must Checks still failing;
3. an action that would leave the local workspace (push, pull request, deploy, shared database, paid service);
4. the Goal's cost or time budget was exceeded;
5. the Claude runtime refused a tool call.

**Suggestion**
What the system proposes when a Task is blocked and the user asks: a plain-words diagnosis, the action it recommends (retry with a hint, skip, resolve by hand, raise the budget) and the hint itself. Only a *retry with hint* may be applied on the user's say-so in one click; every other action stays the user's.

**Notification**
A push message sent to a Notification Channel the moment something happens the user would want to know about while away from the app: the system needs them (an Escalation, or a Goal or Task becoming blocked), a Goal ends done, over-delivered or failed, a Delivery opens, merges or fails a pull request, or usage pauses and resumes. Things the user did themselves — cancelling a Goal, answering an Escalation — are never announced back to them, and a Suggestion never notifies, because a Suggestion by definition does not interrupt. A Notification is a hint, not a ledger: one that cannot be delivered is noted and dropped, never queued or replayed. Each family of events has one switch, and the switches apply to every configured Channel alike. A Notification carries a link back to the app only when the user has said where the app can be reached.

**Notification Channel**
A place outside the app where Notifications are sent — Telegram or Discord — configured by the user in Settings. Sending is the engine acting under the user's standing authorisation, exactly like Delivery: the model never sends anything.

**Sign-in**
How the engine gets a Claude session for its own machine. Normally the CLI opens a browser and finishes by itself; where there is no browser (a container, a remote host) it shows a link and a code instead, and the user pastes that code into the Setup page. The engine never sees the password or the token — Claude Code stores the credential.

**Boundary**
The line between the local workspace and the outside world. Crossing it is always an Escalation.

**Budget**
The limits a Goal runs within: estimated cost, elapsed time, concurrent sessions, and Attempts per Task. Exceeding one is an Escalation, not a failure. Cost and time limits may be *unlimited*.

**Budget Preset**
How a Goal's Budget was chosen: *Auto* (no cap while clarifying; the Brief's estimate proposes the budget and the user confirms or edits it when approving), *Quick*, *Thorough*, *Unlimited*, or *Custom*. Auto is the default because most people cannot say in advance what a goal should cost — the estimate is the model's job.

**Attachment**
Something the user hands to a Goal that cannot be said in the prompt: a file (screenshot, PDF, document) kept by the system, or a link. Every session of the Goal receives the Attachments as read-only references; they are never part of the repository.

**Markdown rendition**
The markdown version of an Attachment the system produces ahead of time (documents converted with markitdown, links fetched as a snapshot). Sessions are pointed at the rendition first and at the original only as a fallback; images keep no rendition because the model reads them directly. A rendition can be *ready*, *failed*, *pending* or *skipped*.

## Delivery

**Delivery Policy**
The standing choice the user makes for a Goal about what may happen to its branch once the Goal is finished: *local* (nothing), *push* (the branch is pushed to the remote), *PR* (a pull request is opened), or *PR + auto-merge* (the pull request is merged once its checks pass). Its *unit* says how finely: *goal* (one branch, one pull request) or *task* (one per Task, as a PR Stack). Choosing a policy is the user's authorisation; it replaces neither the Boundary nor Escalation for anything the policy does not cover.

**Task Commit**
The single commit a finished Task becomes on the Goal branch. Whatever a Task's Attempts did, the engine squashes it into one commit whose message follows Conventional Commits — the type from the Task Kind (feature → `feat`, bug → `fix`, …), the scope and subject from the Brief. Every commit the engine makes, including sync merges, follows the same standard; the model never commits.

**PR Stack**
A *task*-unit Delivery: the Task Commits are re-applied one by one on top of the remote base branch, each step becoming a branch and a pull request based on the one below it, titled with the Task Commit's header. The stack is merged bottom-up; a Task Commit that cannot be re-applied makes the engine fall back to one pull request for the whole Goal and say so.

**Delivery**
The engine carrying out a Delivery Policy after a Goal is finished: syncing the Goal branch with the base branch (conflicts are resolved by a Merge Attempt), pushing, opening the pull request, waiting for its checks, fixing them a bounded number of times, merging, and tidying the remote branch. Every remote action is recorded with the exact command. A Delivery can be *delivered*, *failed* (and re-run), or cancelled; it never force-pushes and never pushes to the base branch.

## Workspace

**Base Sync**
What the engine does about the user's checkout being behind the remote: before a Goal explores the repository it fetches the base branch (remote-tracking refs only — the checkout itself is never changed) and starts the Goal branch from the remote tip when the local branch is strictly behind it. The user can fast-forward their own checkout with one explicit click; nothing else ever moves it. Optionally the base is fetched and merged in again between Tasks.

**Catch-up**
Bringing the Goal branch into a Task's own workspace before the Task is worked on or landed: whatever other Tasks merged meanwhile is merged into the Task branch first — cleanly, or through a Merge Attempt that has the Task's own context — so a retry builds on current code and the final landing cannot conflict. When even that fails, the Worker is told to merge by hand, and only at landing time does it become an Escalation.

**Manual Resolution**
The user taking over a Task whose Merge Attempts gave up: the conflict is re-created in a separate *resolve* workspace so the rest of the Goal keeps going, every conflicted file is shown with both sides, and the user resolves it file by file (take a side, edit the result, or use their own editor). Finishing turns the resolution into the Task Commit, runs the Must command checks and lands it on the Goal branch; the Escalation is answered by the act of finishing.

**Workspace**
The isolated checkout a Goal or Task works in. A Goal has its own workspace on a Goal branch; Tasks that run in parallel each get their own workspace on a Task branch and are merged back into the Goal workspace when their Checks pass. The user's own checkout is never touched.

**Progress folder**
Where the Goal workspace lives: next to the user's repository as `<repo>-foundry/<goal>/` (or under the root chosen in Settings), named after the Goal's title so a person finds it without knowing Foundry. It is the Goal branch checked out — open it, run it, read it at any time. The engine's own worktrees (Tasks, delivery, resolve, baseline) sit beside it under a hidden `.foundry/` folder, never inside it. The folder is fixed when the Goal is created; Goals from before this layout are moved there when the engine starts.

**Milestone**
A Task after which a person can see or try something meaningful for the first time. The Clarifier marks 1–3 per Goal with a "look for" note; the human edits them at approval. When a milestone Task lands, the engine launches nothing more, lets in-flight work land, then pauses the Goal (`awaiting_feedback`) with a `milestone` Escalation: the Preview starts, and the Inbox and the notification channels carry the note, the preview link and the latest screenshot.

**Checkpoint**
One pause at a Milestone. The human continues, or writes what they saw; a cheap triage session proposes what the feedback becomes — a *hint* for the remaining Tasks, *fix* Tasks (after which the same Milestone opens once more for a second look), or a *Decision* recorded with the Brief's Decisions — and the human confirms before anything changes. A Milestone opens at most twice; later feedback becomes hints.

**Preview**
The Goal's result running: the engine starts the Brief's run command (or the package.json dev/start script) in the Progress folder on a port from Settings → Preview, links the human to it, restarts it after each integration, and stops it when idle, when the Goal ends, or on shutdown.

**Difficulty**
routine, normal or hard — the Clarifier's rating of a Task, the human's to change in the Brief. It picks the model the Worker runs on (Settings → Models: by default hard Tasks run on the strong tier, the rest on the worker tier). The last Attempt of a budget of two or more, and every Attempt the human grants beyond the budget, run on the strong tier before the Task is handed back.

**Interview**
How Clarify talks to the human before the Brief exists: rounds of questions, each holding every decision that is askable now (its prerequisites settled), at most eight, each with the Clarifier's recommended answer first and the evidence that leaves it open. The answers reshape the next round; the Brief is written when nothing is left to ask, when the human says enough, or after the fourth round. Answers become Decisions. A small goal gets zero rounds; a goal created with *interview me* gets at least one. One Clarify session is resumed across rounds and by Revise; a lost session starts over with the interview so far.

**Self-check**
Off by default. After each integration the engine opens the Preview in headless Chromium, screenshots it and collects console, page and network errors; the result is a goal-level Must Check (re-run at Goal Review) and the screenshot reaches the timeline and the Milestone notification. No model involved.

**Role**
A named set of instructions given to a Claude session: Clarifier, Planner, Worker, Task Reviewer, Goal Reviewer, Merger. Roles are versioned text, not code.

**Context Provider**
A source the system consults to decide which parts of a repository are relevant to a Task, so that sessions are given only what they need.

## Skills

**Skill**
A packaged instruction set Claude Code can load (a `SKILL.md` directory). Foundry does not define skills; it sees the ones installed on the host, installs curated ones from its Catalog, and tells its Roles which to use.

**Skill Source**
Where an installed Skill comes from and who updates it: a GitHub repository managed by Foundry, by the community `skills` CLI, or by a Claude Code plugin; a gstack clone; a project directory; or a hand-installed copy whose origin is inferred by matching its contents against known sources. Skills of the same Source are updated together; a Skill whose bytes match an older version of its Source is *outdated*, one that matches no version is *modified*.

**Shadow copy**
A user-level Skill that has the same name as a Skill provided by a plugin. Both load; prompts use the plugin's copy because it is the one that gets updated. Shadow copies are reported and can be moved to the trash in one click.

**Workflow Skill**
A Skill a Role is told to invoke for a kind of work — *must* or *prefer* — because the engine follows Matt Pocock's engineering workflow: `tdd` for features and refactors, `diagnosing-bugs` for bugs, `resolving-merge-conflicts` for the Merger, `code-review` for the Goal Reviewer. The engine records which Skills each session actually invoked; a missing mandated invocation is a note for the next Attempt, never a failure on its own.

**Task Kind**
The nature of a Task — feature, bug, refactor, research or chore — set in the Brief. It selects the Workflow Skills the Worker is asked to follow.

**Scenario**
The area a Task works in — frontend, backend, fullstack, data, mobile, infra, docs or general — set in the Brief. A Goal's scenario is the one most of its Tasks share. Scenario-bound Skills (the Design Pack, presentation skills…) are shown to a session only when the scenario matches.

**Design Pack**
The one design skill set the engine hands to UI work (frontend / fullstack Scenarios): ui-ux-pro-max, Anthropic's frontend-design, impeccable, bencium or garden — or none. Packs are mutually exclusive: the Worker gets the chosen pack as a MUST and the Goal Reviewer its review counterpart; the others stay invisible even when installed.

**Project Skills**
Skills matched to a repository's own stack (React, Tailwind, Supabase…) that autoskills installs into a Goal's workspace after the Brief is approved. They live in the workspace's `.claude/skills`, are git-excluded so they never reach a commit, and are listed to every Worker of that Goal. An empty repository has no stack to detect yet, so the install is retried after each Task lands until a stack manifest exists.

**Model Registry**
What this machine has learned about model names: which id a requested name (`fable`, `opus`, a pinned id) resolved to, and when it last worked or failed. Learned from sessions, never hard-coded; a new model family is listed once it has been used (or tested) here.

**Fallback**
What the engine does when a session's model is unavailable: re-run the same session with the next model of the configured chain and record the swap on the Goal, so later sessions use the replacement; only when the whole chain fails does the Goal escalate.

**Simple mode**
A Goal viewed by someone who does not want the machinery: one plain-language Brief (what the system understood, what it will build, the questions only they can answer, the assumptions they can veto, the price) and a progress view (how far, what it costs, what needs them). The engine underneath is the same; Expert view — every control — is one click away on any Goal, and a Goal's mode is just which view it opens in.

**Discipline**
How hard the engine pushes an engineering practice on its sessions. For TDD: *required* (the Worker must invoke the skill and the Reviewer is told when it did not), *preferred* (suggested only), or *off* (never mentioned). Set per Goal, overridable per Task; docs, infra, chore and research Tasks never carry a TDD mandate. Simple-mode Goals start with *preferred*.

**Settings**
The engine's user-editable configuration: concurrency, models, session caps, workflow profile, Design Pack, autoskills, review and delivery defaults, tools, safety limits. A saved value beats an environment variable, which beats the default; most changes apply immediately, a few only after the engine restarts.

## Goal natures

**Nature**
What a Goal produces: *code* (software), *documents* (prose), *research* (a cited report), *image* or *video* (media files) — or *auto*, meaning the user did not say and the Clarifier decides. The engine is the same for every nature; the nature only changes what the Brief asks about, what acceptance looks like, and where the result ends up. Non-code Goals open in Simple mode. A mixed Goal carries its dominant nature; its Tasks keep their own Scenarios.

**Artifact**
A media file a Goal produces (an image, a video, audio). Artifacts are generated inside the Workspace but never enter git; when the Goal finishes they are copied to the Output Folder — or stay in the Workspace when none is set.

**Artifact Manifest**
The committed record of a media Task's Artifacts: one entry per file — its name, what it shows, and the prompt/parameters that produced it. The Manifest is what reviews and diffs see; an Artifact missing from disk or contradicting its Manifest entry is a blocker.

**Output Folder**
Where a Goal's Artifacts are delivered when it finishes. Chosen by the user when the Goal is created; optional.

**Image Pack / Video Pack**
The one media skill set mandated to Workers on image / video Tasks — chosen in Settings exactly like the Design Pack, mutually exclusive, *none* allowed. Media capability always comes from skills, never from the engine itself.

**Style Proposal**
One visual direction for a media or UI Goal — palette, typefaces, keywords, a described feel — proposed during Clarify (2–4 of them, recommendation first) and rendered as a card the human can *see* before any expensive generation starts. The pick is a Decision, and the chosen proposal's full parameters bind every Worker and Reviewer on every Task that produces something with a look (UI, mobile, media, general) — only backend, infra, docs, data and research Tasks never see it; deviating from it is a blocker.

**Style Sample**
A single cheap real image generated on demand to taste a Style Proposal before approving the Brief. Samples are a history: regenerating appends a new one and every earlier sample stays — the human can change their mind and pin any of them as the reference image Workers must match. Samples live in the goal workspace's `artifacts/samples/` (git-excluded) and are copied into every Task worktree so the Worker can open the pinned one.

**Pace**
How much the engine adds on top of what the human approved. *Thorough* (default) adds its own task reviews, the goal-diff review and generated docs; *fast* runs only what the Brief asks for — every approved Check, including Reviewer Checks, still executes. Chosen per Goal at creation.

## Completion

**Completion Actions**
The automatic wrap-up of a finished Goal, chosen once at Brief approval (defaults inferred from the kind of work planned; every choice editable in Expert view): which documents to generate, and whether to refresh the knowledge graph. They never block a Goal — every outcome is recorded and a failure is only a note.

**Documenter**
The session that writes a finished Goal's documentation (PRD, README updates, changelog entry, stakeholder confirmation sheet) after the Goal review passes. It may only touch documentation; its files land as one `docs:` commit on the Goal branch, so they ship in the same delivery as the code they describe.

**Graph Refresh**
Re-indexing the knowledge graph (graphify, and gitnexus when installed) where the delivered code lives, once the Goal is delivered — so the graph never describes a codebase that no longer exists. Local-mode Goals refresh their workspace; delivered Goals refresh the user's checkout.

**Tech Stack Question**
The one blocking Question a Brief carries when the repository is empty: there are no facts to discover, so the stack is the human's Decision. It offers 2–4 concrete options with the Clarifier's recommendation first; the plan assumes the recommendation, and the first Task scaffolds the chosen stack.

**Usage Pause**
The engine's reaction to a Claude usage limit (5-hour or weekly window): no new sessions start, Goals stay exactly where they are, and everything resumes by itself when the limit resets — surviving engine restarts. Visible as a banner and on the Usage page; never an Escalation.

## Agents monitor

**Agent Session**
One Claude Code process's conversation on this machine, headless or interactive — whoever started it. The Agents page shows every Agent Session, read live from what Claude Code itself records; Foundry stores nothing about them.

**Session Source**
Who started an Agent Session: *Foundry* (the engine spawned it for a Goal) or *external* (the user opened it themselves — terminal, VS Code, elsewhere). Only Foundry-sourced sessions can be stopped from the Agents page; external ones are watched, never touched.

**Session Status**
*Busy* — the session produced output within the last minute (a Foundry in-flight session is always busy). *Idle* — the process is alive but waiting for input. *Finished* — the process is gone; the session stays visible for a day. The header counts only busy sessions, so it is quiet when nothing is working.

**Subagent**
A helper agent a session spawns for a sub-task (the Task tool). It has its own conversation and its own context window, and is shown nested under the session that spawned it.

## Release & update

**Release**
One published version of the whole product — a single stable semver shared by every package, with its notes published where any deployment can read them. Foundry has no per-component versions.
_Avoid_: build, deploy

**Deployment Mode**
How this instance runs: *docker* (the published image) or *local* (a git checkout served directly). Detected by the instance itself, never configured; it decides what Self-Update does and what a Guided Update shows.

**Update Check**
The instance asking, on a schedule or on demand, whether a Release newer than itself exists. Only stable semver counts — pre-release and floating tags are invisible to it. The result is remembered, shown in the UI, and announced through Notifications once per new Release.
_Avoid_: version poll, upgrade check

**Self-Update**
The one-click path from a noticed Release to running it: the instance drains active work, replaces itself, and comes back on the new version — rolling back and staying put if any step fails. An instance that lacks the means to replace itself falls back to a Guided Update instead of failing.
_Avoid_: auto-update, hot update

**Guided Update**
The fallback when Self-Update is impossible: a popup with the exact commands for this Deployment Mode, for the human to run themselves.

**Drain**
Refusing new sessions while active Agents finish, so an update never kills running work. The human may override and update immediately.
