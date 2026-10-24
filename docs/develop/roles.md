# Roles

A **Role** is a named set of instructions handed to a session on the goal’s backend. The instructions are versioned text in `roles/*.md`, not code. This page lists what each Role drives: which session loads it, which Model Preset action picks that session's model, what the prompt contains, and what the session must return. It also covers the sessions that have no role file, and how skill hints are added to prompts.

## How a role reaches a session

`engine/src/roles.ts` is deliberately small:

```ts
export type RoleName = 'clarifier' | 'planner' | 'worker' | 'reviewer-task' | 'reviewer-goal' | 'merger' | 'documenter' | 'feedback';
roles.path(name) // → <rolesDir>/<name>.md, read by the selected native adapter
roles.text(name) // → file contents, including the Planner prompt
```

- `rolesDir` defaults to `<repo root>/roles` (`defaultConfig`, `engine/src/config.ts`).
- The role file is **appended** to Claude Code's own system prompt (`--append-system-prompt-file`). The task-specific content goes in the prompt the engine builds in code. Codex prepends the role instructions to its session prompt.
- The file is read when a session starts. An edit to `roles/*.md` reaches the next session without a restart, but a `bun --watch` dev server does not watch these files either way.
- Structured output uses Claude’s `--json-schema` or Codex’s `--output-schema` (a Zod schema passed through `zodToJsonSchema`). The engine reads `result.structuredOutput`, falling back to `tryJson(finalText)` (`checks/reviewer.ts`). Sessions that must answer in JSON get **one** repair or nudge turn in the same session when the first answer does not parse.
- The model comes from the goal's Model Preset through `modelFor` / `workerModelFor` (`engine/src/models/roles.ts`, and [architecture.md](architecture.md#sessions-and-how-a-model-is-picked)).

**Adding a role:** add the name to `RoleName`, add `roles/<name>.md`, and load it with `engine.roles.path(...)` where the session is built. If the session's model should be configurable, add an action to `MODEL_ACTIONS` and `ACTION_INFO` in `core/src/schema/model-presets.ts` and a column to every shipped preset. Update `CODEX_MODEL_ACTIONS` / Codex preset tables as well when the role applies to that backend. If it should get skill hints, add it to `SkillRole` in `engine/src/skills/types.ts`.

Dollar caps below apply only to Claude, whose native protocol reports cost. Codex reports tokens without USD cost; its session limits use wall time, idle time and tool-call count. The shared `maxTurns` setting bounds tool calls for Codex, not model turns. Native multi-agent creation and Skill-tool telemetry are unavailable there.

## Role reference

| Role file | Session (code) | Preset action | Tools | Output |
|---|---|---|---|---|
| `clarifier.md` | Clarify + Interview (`clarify.ts` `prepareClarify`); Draft and Revise (`brief-draft.ts` `runDraft`) | `clarifier` | read-only | `InterviewOutput` (its `brief` a `BriefSkeleton`) or `BriefSkeleton`; Draft: `TaskDraftOutput` / `AreaDraftOutput` / `RevisionOutput` |
| `planner.md` | a separate Foundry-managed session right after the Clarifier's Brief (`planTasks`), both backends | `planner` | read-only | `PlanOutput`: tasks, task-level checks and the estimate, merged into the Brief as written |
| `worker.md` | every work Attempt (`attempt-loop.ts` `runAttempt`), including fix tasks and delivery `fix-ci` tasks | `simple` / `standard` / `complex` by Difficulty | `workerTools(mcpAllowed)` | free text summary; the engine commits and runs the Checks |
| `reviewer-task.md` | Task reviewer (`checks/reviewer.ts` `reviewTaskDiff`) | `taskReviewer` | read-only | `ReviewerVerdict` `{ pass, blockers[], notes? }` |
| `brief-reviewer.md` | Second opinion on the Brief (`brief-second-opinion.ts` `secondOpinion`), on demand or once per proposed Brief when Settings say so | `goalReviewer` | read-only | `RevisionOutput`: the revised Brief and a change summary, kept as `brief.second_opinion` — or `brief.second_opinion_failed`, why there is none ([ADR-0051](adr/0051-brief-second-opinion.md)) |
| `reviewer-goal.md` | Goal reviewer (`goal-review.ts` `reviewGoal`) | `goalReviewer`, or `taskReviewer` for small goals | read-only | `GoalReviewOutput` `{ mustVerdicts[], stretchVerdicts[], fixTasks[], notes }` |
| `merger.md` | Merge Attempt (`merge.ts` `runMergeAttempt`): integrate, Catch-up, base refresh, delivery sync and PR Stack | `merger` | `workerTools(mcpAllowed)` | resolved, `git add`-ed files and a short summary |
| `documenter.md` | Completion docs (`docs-generate.ts` `runDocsGeneration`) | `documenter` | `workerTools(mcpAllowed)` | markdown files; the engine commits only doc files |
| `feedback.md` | Milestone feedback triage (`feedback.ts` `classifyFeedback`) | `feedback` | read-only | `FeedbackPlan` `{ kind, rationale, hint, fixTasks[], decision }` |
| `qa.md` | Browser QA at the end of a goal (`qa.ts` `runQa`): the finished app tried in Chromium ([ADR-0057](adr/0057-browser-qa.md)) | `goalReviewer` | the worker's tools (scripts under `.foundry-qa/` only; other changes are put back) | `QaOutput` `{ summary, results[{ check, status, evidence, problem, fix, files, shots }] }`; a failed must check becomes a `qa-fix` task |
| `explainer.md` | the Explainer of a Conversation on the goal page (`conversation/conversations.ts` `answer`): one session per Conversation, resumed for each question; Settings → Beta | `explainer` | read-only files, a shell kept to reading (`hooks/readonly-bash.ts`), the MCP servers Allowed in goals, the web | Markdown, streamed as it is written and kept as `conversation.answered` ([ADR-0073](adr/0073-a-conversation-about-a-goal.md)) |

"Read-only" means `READONLY_TOOLS` plus `disallowedTools: READONLY_DISALLOWED` (no Write/Edit/MultiEdit/NotebookEdit), from `engine/src/guards/boundary.ts`. Every session also gets boundary settings. Claude uses the hook canary, boundary guard and rm guard. Codex enforces the role through native sandboxing and its SessionStart/PreToolUse guards.

### Clarifier (`roles/clarifier.md`)

**Drives** the only conversation with the human before approval. The session explores the repository read-only, runs the Interview in rounds when the goal has one, lists Areas, defines the goal-level Must and Stretch Checks, and writes `planningNotes` for the Planner. It never writes tasks.

**Input.** `buildClarifyPrompt` in `clarify.ts` assembles:

- the interview rules (when the goal has an interview)
- the goal prompt
- Decisions carried over from a re-run Clarify
- a nature-specific section (`natureSection`): tech-stack question for an empty repo, style directions for UI, the docs/research/media rules, or all of them for an `auto` goal
- Attachments and the markitdown hint
- the context provider's repository overview (with base-sync and recent-commit notes)
- what the goal follows, what it is part of, the folder's Learnings (ADR-0040) and what its Memory recalls about goals like it when a Hindsight server is set (ADR-0072) — the same `previous` sections go to the Planner
- the clarifier skill hint
- "Your job" requirements

The session runs with `CLARIFY_MAX_TURNS = 90` and `CLARIFY_MAX_BUDGET_USD = 6`, and its transcript goes to `data/transcripts/clarify-<goalId>.jsonl`.

**Output.** With an interview, `InterviewOutput = { questions[], brief | null }`: questions to ask a round, or the Brief skeleton. Without one, `BriefSkeleton` (`core/src/schema/brief.ts`): the Brief without tasks, task checks and estimate, plus `goalChecks` and `planningNotes`. `settle()` handles the result: a schema repair turn, a "no more questions" turn at the round cap, then `planTasks` and `mergePlan`. A whole `BriefOutput` with tasks is still accepted (no Planner then, and a coverage repair turn when an Area has no task). The engine adds the dirty-repo question, the interview Decisions, the style question (generated from `styleOptions`) and "Area has no tasks" questions itself.

**Draft and Revise** reuse this role with their own prompts (`buildDraftPrompt`) and schemas. Draft: `DRAFT_MAX_TURNS = 25`, `$2`. Revise: `REVISE_MAX_TURNS = 40`, `$3`. Revise resumes the interview session when there is one.

### Planner (`roles/planner.md`)

**Drives** the Task DAG: 1–6 tasks per Area, tracer-bullet slices (the `to-tickets` method: vertical slices, prefactoring first, expand–contract for wide refactors, specs that say what to build from the user's side), explicit `dependsOnKeys`, disjoint `relevantFiles` for parallel tasks, groundwork in the `shared` Area, 1–3 milestones, task-level checks and the estimate. `planTasks` in `clarify.ts` runs it as its own read-only session with the Planner model and effort, for both backends, once the Clarifier has written its Brief skeleton (ADR-0028). `buildPlannerPrompt` gives it the goal, the interview answers, the nature rules, the overview, the skeleton and the Clarifier's `planningNotes`. Its `PlanOutput` goes into the Brief as written (`mergePlan`); an unusable plan gets one more try in the same session, an Area without tasks one repair turn, and a plan that never comes leaves one task per Area and a blocking question. `PLANNER_MAX_TURNS = 45`, `$4`.

### Worker (`roles/worker.md`)

**Drives** one Attempt at one Task in its workspace. It plans briefly, acts, runs its own checks and writes an honest summary. It never commits, never crosses the Boundary, and never runs ticketing or setup skills.

**Input.** `buildAttemptPrompt` in `attempt-prompt.ts` builds these sections:

- `# Goal` and `# Your task` (with Area and "Attempt n of m")
- the Decisions and the chosen Style direction, when the Scenario has a look (`styleApplies`)
- `# Start here` (`relevantFiles`) and `# Repository context` (context provider `locate`)
- `# Notes on this repository` (the folder's Learnings in short, ADR-0040) and `# What Memory recalls` (the folder's bank's answer about this task when a Hindsight server is set, with the bank's name for a worker that has the hindsight tools; ADR-0072)
- `# Acceptance checks` and the Attachments
- `# You will provide` (`renderProvides`): the materials the person promised that this task needs — one that arrived with its files by path, one still to come that the task builds a placeholder for, one the person has none of (ADR-0074)
- `# Hint from the human`
- a note when the goal branch moved (Catch-up result) or the workspace was rolled back
- `# What happened in the previous attempt` (the last Observation Report)
- the worker skills section

A Continuation sends only `continuationMessage(reason)` into the resumed session; for `needs_input` it carries the person's answer — their words, the files they gave by path, the links, or that there is none (ADR-0074). The prompt is saved beside the transcript as `data/transcripts/<attemptId>.prompt.md`.

**Model.** `workerModelFor` picks the Difficulty row and escalates to `complex` on the last budgeted attempt or a human-granted retry. On top of that, a Claude session running `opus` gets the CLI's own `--fallback-model sonnet`.

**Caps.** `attemptMaxTurns` (default 150), `attemptMaxCostUsd` (default $10, clamped to the goal's remaining budget), `attemptTimeoutMs`.

**Output.** Free text. The engine judges the workspace, not the answer: it commits a snapshot, runs command Checks and the Task reviewer, and quotes the final text in the Observation Report ("Worker's own summary"). One exception (ADR-0074): a final text ending in a ```` ```foundry-needs ```` block (`what`, `why`, `suggestions`, `canProceedWithout`; `parseNeedsBlock` in `core/src/schema/needs.ts`) is a Request for something only the person can give — the snapshot is committed, nothing is checked, the attempt waits as `interrupted` (`resultSubtype: 'needs_input'`, no retry spent) and a `needs_input` Escalation blocks the task; the role text allows it only for private assets, keys and decisions that are the person's. The answer resumes the same session.

### Task reviewer (`roles/reviewer-task.md`)

**Drives** a blockers-only review of one Task's cumulative diff (task base ref → HEAD). Up to 20k characters are pasted (`fitDiff`): whole files in git's order while they fit, then the first part of the next one, cut at a line boundary and marked. A longer diff is also saved whole to `<internal>/review/task-diff-<attemptId>.patch`, and the prompt lists every changed file with how much of it is pasted, so a file past the cut is read rather than reported as incomplete or missing. It runs only after every Must command Check passed, and only when the task has reviewer-type Checks or `alwaysReviewTasks` is on and the goal's pace is not `fast`.

**Input:** the task and its spec, the reviewer-check rubric, the chosen Style (UI and media scenarios), the Brief's Subjects with their pictures by absolute path when the scenario has a look (their folder is added to the session; `subjects.ts` `renderSubjects`), a media review section for `image` / `video` and a CAD review section for `cad`, the reviewer skill hint, the **Workflow** observation (which mandated skills the worker did or did not invoke, from `formatWorkflowObservation`), what the folder's **Memory** recalls about such a change when a Hindsight server is set (ADR-0072), and the diff.

**Output:** `ReviewerVerdict` (`core/src/schema/observation.ts`). A missing verdict after the nudge turn marks the reviewer checks `skipped`, and the objective Checks decide. It runs with 20 turns and $0.80, and the nudge gets 2 turns and $0.20.

### Goal reviewer (`roles/reviewer-goal.md`)

**Drives** the final judgement of the whole goal diff against `baseBranch`: Must strict, Stretch generous, and cross-task problems a Task reviewer could not see.

**Input:** the goal, a media review section, Attachments, the approved understanding, Decisions, Style, the reviewer-goal skill hint, the "fixed point" (the base branch), every Check with its objective status, the **previous verdicts** from an earlier fix cycle (so a verdict flips only for a reason it can cite), what the folder's **Memory** recalls of earlier goal reviews there when a Hindsight server is set (ADR-0072), and the diff. Diffs over 1500 lines are saved to `<internal>/review/goal-diff-<n>.patch` and referenced by path instead of pasted in.

**Model.** A diff of at most `smallGoalLines` (default 400) lines uses the `taskReviewer` model and gets no skill hint. Larger diffs use `goalReviewer`.

**Output:** `GoalReviewOutput`, defined in `goal-review.ts`. `checkName` must match the Check names. Proposed `fixTasks` become fix tasks when fix cycles remain. The session gets 80 turns, a cost cap of at least $6, and a 3-turn nudge on a missing verdict.

### Merger (`roles/merger.md`)

**Drives** conflict resolution hunk by hunk, preserving both sides' intent. It edits and `git add`s files; it never commits and never runs merge, rebase or reset. The prompt carries what the incoming side was doing, the receiving side's commits since the two diverged, the goal, the human's hint, the conflicted files and hunks, and the merger skill hint.

**Where it runs:** `integrateTask` (squash into the goal branch), `catchUp` (goal branch into a task worktree), `refreshBase`, delivery `sync-base`, and the PR Stack builder.

**Budget:** `MERGE_ATTEMPT_BUDGET = 2` per conflict, 50 turns and $2 each. The second attempt resumes the first session. After a resolution, the goal's Must command checks run (unless the caller turns that off).

### Documenter (`roles/documenter.md`)

**Drives** the completion documents chosen at approval (`DocType`: `to-prd`, `readme-update`, `changelog`, `to-questionnaire`; instructions in `DOC_INSTRUCTIONS`). It runs after the goal review passes and before the goal turns `done`. The prompt carries the goal, understanding, Decisions, the task commit subjects, the diffstat and the documenter skill hint (`writing-for-agents` preferred for a document an agent reads).

**Output:** files. The engine resets anything the session committed, stages only `.md/.mdx/.txt/.rst/.adoc` files, discards everything else, and commits `docs: <goal title>`. The result is recorded as `goal.docs_generated` and never blocks the goal. The session gets 50 turns and `DOCS_MAX_BUDGET_USD = 3`.

### Feedback triage (`roles/feedback.md`)

**Drives** what a person's Milestone feedback becomes: exactly one `hint`, `fix` or `decision`. On a second look (`recheck`), only `hint` is allowed (`hintOnly`).

**Input:** the goal, understanding, Decisions, the milestone and its "look for" note, the landed and remaining tasks, and what the person wrote.

**Output:** `FeedbackPlan` (`core/src/schema/feedback.ts`). The engine applies it only after the person confirms, when the checkpoint Escalation is answered with `feedback` (`applyFeedback`, `checkpoint.ts`). The session gets 15 turns and `FEEDBACK_MAX_BUDGET_USD = 0.5`.

### QA tester (`roles/qa.md`)

Runs once every task has landed, after the audit, when the Brief chose **Test it in a browser at the end**. The engine starts the goal's preview and the prompt gives the app's address, the acceptance checks by name (must first), the path of Foundry's Playwright, the screenshots folder and a file-name prefix. The session writes Playwright scripts under `.foundry-qa/` (excluded from git), runs them with `bun`, and reports one result per check with screenshots; after it, the engine puts back anything it changed outside the scratch folder. Failed must checks become `qa-fix` tasks before the final walkthrough and the review ([ADR-0057](adr/0057-browser-qa.md)).

### Explainer (`roles/explainer.md`)

Answers a Conversation on the goal page (a beta feature, Settings → Beta). It runs in a detached worktree of its own at the goal branch's tip (`conversation/workspace.ts`: `.foundry/<goal>/conversation`; the base branch once the goal's branch is merged and gone, since it holds the goal's commits; a records-only folder under `<data>/conversations/<goal>/` when the repository is not on this computer), brought to the tip again before every answer with what a shell left behind discarded. The prompt names that folder, the records Foundry writes into `.foundry-goal/` there before each answer (`conversation/records.ts`: the goal, the Brief with the person's Decisions, one file per task with its attempts, reports and reviews, the timeline, the escalations, the review, the delivery, the attachments, the Learnings, and a short rendering of every transcript), a summary of the goal, and the question; a later turn adds what happened to the goal since the last answer. With Memory on (ADR-0072), the bank's name and the hindsight tools are offered for questions that reach beyond this goal. Tools: the read-only set plus Bash kept to reading by the `readonly-bash` hook on Claude (the agy guard applies the same judgement; Codex runs in its read-only sandbox), the MCP servers Allowed in goals, and the web. Lane `aside`: it takes no concurrency slot. Each answer has 50 turns, $3 and 8 minutes (`CONVERSATION_MAX_TURNS`, `CONVERSATION_MAX_BUDGET_USD`, `CONVERSATION_TIMEOUT_MS`); an answer cut by a limit is kept with why, a stopped one with what it had said. The cost is booked on the goal as `goal.cost_added` with `source: 'conversation'`, counted in the total and left out of the Budget, and in the usage ledger as kind `conversation` ([ADR-0073](adr/0073-a-conversation-about-a-goal.md)).

## Sessions without a role file

| Session | Code | Model | Output |
|---|---|---|---|
| Nature classification (goals created as `auto`) | `clarify.ts` `classifyNature` | Claude: `goal.models.cheap`; Codex: captured `housekeeping` choice | `{ nature }` |
| Suggestion for a blocked task | `escalation-suggest.ts` `runSuggest` | preset `suggest` | `SuggestOutput` `{ diagnosis, action, hint, confidence }` |
| Style Sample | `style-sample.ts` | preset `styleSample` | one image file at `artifacts/samples/<key>-<n>.png`; the prompt carries the *worker* skill hint for scenario `image` |
| Subject pictures search | `subjects.ts` `startSubjectSearch` | preset `styleSample` (worker tools, $1.50, 6 minutes) | `{ pictures[{ file, url, caption }], note }`; the files it downloaded into `<dataDir>/subjects/<goal>/.incoming/<key>/`, of which the engine keeps the real pictures as `<key>-<n>.<type>` ([ADR-0042](adr/0042-subjects-and-the-likeness-review.md)) |
| Likeness review | `likeness.ts` `reviewLikeness` | preset `taskReviewer` (read-only, $0.80) | `LikenessVerdict` `{ subjects[{ key, shown, score, matches[], differences[{ what, major }], shots[] }], summary }`, recorded as `milestone.likeness`; major differences make one `likeness-fix` task per milestone |
| Check-output distillation | `distill/summarize.ts` via `Engine.summarizer` | Claude: `goal.models.cheap`; Codex: captured `housekeeping` choice | `{ summary, keyErrors[] }` |
| Learnings (a goal ended) | `learnings.ts` `distill` | `goal.models.cheap` (Read and Skill only, 8 turns, $0.50) | `DistillOutput` `{ learnings[], note }`: the folder's notebook after the goal ([ADR-0040](adr/0040-learnings-per-repository.md)). The prompt opens with the `retro` skill's slash name when it is installed (Claude), lists the goal's transcripts as primary sources, carries the `learnings` skill hint, and is kept as `transcripts/learnings-<goal>.prompt.md` ([ADR-0047](adr/0047-latest-mattpocock-skills-in-the-workflow.md)) |
| Model probe, usage probe | `Engine.probeModel`, `Engine.probeUsage` | the probed model/effort; Claude quota probe uses `config.models.cheap`, Codex quota uses account metadata | none (reads `init` / the rate-limit signal) |

## Skill hints

Foundry does not define skills. It sees the ones installed on the host, and it tells each role which to use ([ADR-0004](adr/0004-workflow-skills-mandated-and-observed.md), [ADR-0005](adr/0005-scenario-skills-and-settings.md)).

**Where the rules come from.** Each entry in `catalog/skills.json` can list `roles` (the roles it is relevant to), `scenarios`, and `workflow` rules of the form `{ role, mandate: 'must' | 'prefer', when: <task kind> | 'any', scenarios, whenFiles, instruction }`; `whenFiles` (worker rules) names files the task must touch for the rule to apply — a file name anywhere, a path, or a folder ending in `/` — matched against the task's `relevantFiles` (`matchesFile`). `SkillRole` (`engine/src/skills/types.ts`) covers `clarifier`, `planner`, `worker`, `reviewer-task`, `reviewer-goal`, `merger`, `documenter` and `learnings`. Feedback triage gets no hints. The mattpocock entries are pinned to one release (`ref: v1.3.1` on their git source; the installer fetches and resets the cache to the tag, [ADR-0047](adr/0047-latest-mattpocock-skills-in-the-workflow.md)).

**How a section is built.** `engine.skillsFor(goal).hints` selects the goal’s native skill manager and its `SkillsHints` (`engine/src/skills/hints.ts`). It caches catalog statuses for 10 seconds, and the cache is invalidated on install, uninstall and relevant Settings changes. Call sites ask for a prompt section:

| Call site | Call |
|---|---|
| `clarify.ts` | `sectionFor('clarifier', { scenario, packs })` and `sectionFor('planner', { scenario, packs })`; the scenario is set only for docs/research/media/figure natures (`natureScenario`); `packs` is `engine.packsFor(goal)`, the goal's own Figure pack over Settings' (ADR-0076) |
| `brief-draft.ts` | `sectionFor('clarifier', { scenario })` |
| `attempt-loop.ts` | `sectionFor('worker', { taskKind, scenario, projectSkills, discipline, files, packs })` and `mandatedFor('worker', ...)`; `files` is the task's `relevantFiles` |
| `docs-generate.ts` | `sectionFor('documenter', { scenario: 'docs' })` |
| `learnings.ts` | `sectionFor('learnings')`, and `invokeFor('retro')` for the slash name that opens the session; on the pstack suite the opener is reflect's lenses as text (ADR-0050) |
| `checks/reviewer.ts` | `sectionFor('reviewer-task', { scenario })` |
| `goal-review.ts` | `sectionFor('reviewer-goal', { scenario: goalScenario(tasks) })`, skipped for small goals |
| `merge.ts` | `sectionFor('merger')` |
| `style-sample.ts` | `sectionFor('worker', { scenario: 'image' })` |

`formatWorkflowSection` (`engine/src/skills/workflow.ts`) turns that into a `# Workflow skills` block:

- Only **installed** skills count. Members of an exclusive pack the user did not choose (Design, Image, Video, Figure Pack) are invisible (`packAllows`, `skills/packs.ts`); a goal's own pack choice (`Goal.figurePack`) is laid over Settings' by `SkillsHints` (`packs` in `SectionOpts`).
- `applicableRules` keeps the rules for this role whose `when` matches the Task Kind, whose `scenarios` match, and whose `whenFiles` (if any) match one of the task's files. Media scenarios see only skills that explicitly list them.
- **Discipline** changes the TDD rule: `off` drops it entirely (not even listed as installed), and `preferred` downgrades MUST to Prefer. `resolveDiscipline` lets a task's `tdd: 'off'` override the goal.
- Each rule becomes `- MUST: invoke \`/<invoke>\` — <instruction>` or `- Prefer: ...`. The invoke name is the one actually loaded on this machine, plugin copy first. A rule whose skill needs an env var the session lacks gets a "degraded" warning.
- The block always tells the session not to run the setup and ticketing skills (`NEVER_RUN`), then lists other relevant installed skills, then the goal's **Project Skills** from autoskills.
- With the `plain` workflow profile (Settings), the block is a one-line list of installed skills.

For Claude, hints are off when `settingSources` excludes `user`, because user-level skills would not load in that session (`hintsEnabled` in the `Engine` constructor).

**Observing use.** Claude’s runner records every Skill-tool invocation (`RunResult.skillsUsed`). After an attempt, `attempt-loop.ts` compares it with `mandatedFor(...)` and hands the result to the Task reviewer (the `# Workflow` section) and to the next attempt's Observation Report (`summarizeReport`). A skipped mandated skill is a note, never a failure on its own. An invoked name matches a skill when it equals the bare name or ends with `:<name>`; a suite name such as `pstack:tdd` matches only itself (`skillMatches`, `engine/src/skills/usage.ts`). The same matcher drives `skillUsage`, which counts how many of the newest Claude goals invoked each installed skill for the Extensions page (the `usage` option of `SkillsManager`). Codex skill-use telemetry is unavailable; an empty telemetry list must not be interpreted as proof that a skill was skipped.
