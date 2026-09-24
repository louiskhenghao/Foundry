# Roles

A **Role** is a named set of instructions handed to a Claude session. The instructions are versioned text in `roles/*.md`, not code. This page lists what each Role drives: which session loads it, which Model Preset action picks that session's model, what the prompt contains, and what the session must return. It also covers the sessions that have no role file, and how skill hints are added to prompts.

## How a role reaches a session

`engine/src/roles.ts` is deliberately small:

```ts
export type RoleName = 'clarifier' | 'planner' | 'worker' | 'reviewer-task' | 'reviewer-goal' | 'merger' | 'documenter' | 'feedback';
roles.path(name) // → <rolesDir>/<name>.md, passed as --append-system-prompt-file
roles.text(name) // → file contents (only the Planner, which is a sub-agent prompt)
```

- `rolesDir` defaults to `<repo root>/roles` (`defaultConfig`, `engine/src/config.ts`).
- The role file is **appended** to Claude Code's own system prompt (`--append-system-prompt-file`). The task-specific content goes in the `-p` prompt, which the engine builds in code.
- The file is read when a session starts. An edit to `roles/*.md` reaches the next session without a restart, but a `bun --watch` dev server does not watch these files either way.
- Structured output is enforced with `--json-schema` (a Zod schema passed through `zodToJsonSchema`). The engine reads `result.structuredOutput`, falling back to `tryJson(finalText)` (`checks/reviewer.ts`). Sessions that must answer in JSON get **one** repair or nudge turn in the same session when the first answer does not parse.
- The model comes from the goal's Model Preset through `modelFor` / `workerModelFor` (`engine/src/models/roles.ts`, and [architecture.md](architecture.md#sessions-and-how-a-model-is-picked)).

**Adding a role:** add the name to `RoleName`, add `roles/<name>.md`, and load it with `engine.roles.path(...)` where the session is built. If the session's model should be configurable, add an action to `MODEL_ACTIONS` and `ACTION_INFO` in `core/src/schema/model-presets.ts` and a column to every shipped preset. If it should get skill hints, add it to `SkillRole` in `engine/src/skills/types.ts`.

## Role reference

| Role file | Session (code) | Preset action | Tools | Output |
|---|---|---|---|---|
| `clarifier.md` | Clarify + Interview (`clarify.ts` `prepareClarify`); Draft and Revise (`brief-draft.ts` `runDraft`) | `clarifier` | read-only | `InterviewOutput` or `BriefOutput`; Draft: `TaskDraftOutput` / `AreaDraftOutput` / `RevisionOutput` |
| `planner.md` | sub-agent `planner` inside the Clarify session (`--agents`) | `planner` | inherits Clarify's | task list JSON handed back to the Clarifier (not parsed by the engine) |
| `worker.md` | every work Attempt (`attempt-loop.ts` `runAttempt`), including fix tasks and delivery `fix-ci` tasks | `simple` / `standard` / `complex` by Difficulty | `WORKER_TOOLS` | free text summary; the engine commits and runs the Checks |
| `reviewer-task.md` | Task reviewer (`checks/reviewer.ts` `reviewTaskDiff`) | `taskReviewer` | read-only | `ReviewerVerdict` `{ pass, blockers[], notes? }` |
| `reviewer-goal.md` | Goal reviewer (`goal-review.ts` `reviewGoal`) | `goalReviewer`, or `taskReviewer` for small goals | read-only | `GoalReviewOutput` `{ mustVerdicts[], stretchVerdicts[], fixTasks[], notes }` |
| `merger.md` | Merge Attempt (`merge.ts` `runMergeAttempt`): integrate, Catch-up, base refresh, delivery sync and PR Stack | `merger` | `WORKER_TOOLS` | resolved, `git add`-ed files and a short summary |
| `documenter.md` | Completion docs (`docs-generate.ts` `runDocsGeneration`) | `documenter` | `WORKER_TOOLS` | markdown files; the engine commits only doc files |
| `feedback.md` | Milestone feedback triage (`feedback.ts` `classifyFeedback`) | `feedback` | read-only | `FeedbackPlan` `{ kind, rationale, hint, fixTasks[], decision }` |

"Read-only" means `READONLY_TOOLS` plus `disallowedTools: READONLY_DISALLOWED` (no Write/Edit/MultiEdit/NotebookEdit), from `engine/src/guards/boundary.ts`. Every session, read-only or not, also gets `boundarySettings(hooksDir)`: the hook canary, the boundary guard and the rm guard.

### Clarifier (`roles/clarifier.md`)

**Drives** the only conversation with the human before approval. The session explores the repository read-only, runs the Interview in rounds when the goal has one, lists Areas, plans with the Planner sub-agent, defines Must and Stretch Checks, marks 1–3 milestones, rates Difficulty, sets Task Kind and Scenario, and estimates cost and time.

**Input.** `buildClarifyPrompt` in `clarify.ts` assembles:

- the interview rules (when the goal has an interview)
- the goal prompt
- Decisions carried over from a re-run Clarify
- a nature-specific section (`natureSection`): tech-stack question for an empty repo, style directions for UI, the docs/research/media rules, or all of them for an `auto` goal
- Attachments and the markitdown hint
- the context provider's repository overview (with base-sync and recent-commit notes)
- the clarifier skill hint
- "Your job" requirements

The session runs with `CLARIFY_MAX_TURNS = 90` and `CLARIFY_MAX_BUDGET_USD = 6`, and its transcript goes to `data/transcripts/clarify-<goalId>.jsonl`.

**Output.** With an interview, `InterviewOutput = { questions[], brief | null }`: questions to ask a round, or the Brief. Without one, `BriefOutput` (`core/src/schema/brief.ts`). `settle()` handles the result: a schema repair turn, a "no more questions" turn at the round cap, and a coverage repair turn when an Area has no task. The engine adds the dirty-repo question, the interview Decisions, the style question (generated from `styleOptions`) and "Area has no tasks" questions itself.

**Draft and Revise** reuse this role with their own prompts (`buildDraftPrompt`) and schemas. Draft: `DRAFT_MAX_TURNS = 25`, `$2`. Revise: `REVISE_MAX_TURNS = 40`, `$3`. Revise resumes the interview session when there is one.

### Planner (`roles/planner.md`)

**Drives** the Task DAG: 1–6 tasks per Area, tracer-bullet slices, explicit `dependsOnKeys`, disjoint `relevantFiles` for parallel tasks, groundwork in the `shared` Area. It is not a top-level session. `prepareClarify` registers it as a sub-agent:

```ts
agents: { planner: { description: 'Plans the task DAG for a goal. ...', prompt: roles.text('planner') + plannerHint, model: modelFor(config, goal, 'planner').model } }
```

Its JSON answer goes back to the Clarifier, which folds it into the Brief. Difficulty and milestones are the Clarifier's job; the planner's field list does not include them.

### Worker (`roles/worker.md`)

**Drives** one Attempt at one Task in its workspace. It plans briefly, acts, runs its own checks and writes an honest summary. It never commits, never crosses the Boundary, and never runs ticketing or setup skills.

**Input.** `buildAttemptPrompt` in `attempt-prompt.ts` builds these sections:

- `# Goal` and `# Your task` (with Area and "Attempt n of m")
- the Decisions and the chosen Style direction, when the Scenario has a look (`styleApplies`)
- `# Start here` (`relevantFiles`) and `# Repository context` (context provider `locate`)
- `# Acceptance checks` and the Attachments
- `# Hint from the human`
- a note when the goal branch moved (Catch-up result) or the workspace was rolled back
- `# What happened in the previous attempt` (the last Observation Report)
- the worker skills section

A Continuation sends only `continuationMessage(reason)` into the resumed session. The prompt is saved beside the transcript as `data/transcripts/<attemptId>.prompt.md`.

**Model.** `workerModelFor` picks the Difficulty row and escalates to `complex` on the last budgeted attempt or a human-granted retry. On top of that, a session running `opus` gets the CLI's own `--fallback-model sonnet`.

**Caps.** `attemptMaxTurns` (default 150), `attemptMaxCostUsd` (default $10, clamped to the goal's remaining budget), `attemptTimeoutMs`.

**Output.** Free text. The engine judges the workspace, not the answer: it commits a snapshot, runs command Checks and the Task reviewer, and quotes the final text in the Observation Report ("Worker's own summary").

### Task reviewer (`roles/reviewer-task.md`)

**Drives** a blockers-only review of one Task's cumulative diff (task base ref → HEAD, capped at 20k characters). It runs only after every Must command Check passed, and only when the task has reviewer-type Checks or `alwaysReviewTasks` is on and the goal's pace is not `fast`.

**Input:** the task and its spec, the reviewer-check rubric, the chosen Style (UI and media scenarios), a media review section for `image` / `video`, the reviewer skill hint, the **Workflow** observation (which mandated skills the worker did or did not invoke, from `formatWorkflowObservation`), and the diff.

**Output:** `ReviewerVerdict` (`core/src/schema/observation.ts`). A missing verdict after the nudge turn marks the reviewer checks `skipped`, and the objective Checks decide. It runs with 20 turns and $0.80, and the nudge gets 2 turns and $0.20.

### Goal reviewer (`roles/reviewer-goal.md`)

**Drives** the final judgement of the whole goal diff against `baseBranch`: Must strict, Stretch generous, and cross-task problems a Task reviewer could not see.

**Input:** the goal, a media review section, Attachments, the approved understanding, Decisions, Style, the reviewer-goal skill hint, the "fixed point" (the base branch), every Check with its objective status, the **previous verdicts** from an earlier fix cycle (so a verdict flips only for a reason it can cite), and the diff. Diffs over 1500 lines are saved to `<internal>/review/goal-diff-<n>.patch` and referenced by path instead of pasted in.

**Model.** A diff of at most `smallGoalLines` (default 400) lines uses the `taskReviewer` model and gets no skill hint. Larger diffs use `goalReviewer`.

**Output:** `GoalReviewOutput`, defined in `goal-review.ts`. `checkName` must match the Check names. Proposed `fixTasks` become fix tasks when fix cycles remain. The session gets 80 turns, a cost cap of at least $6, and a 3-turn nudge on a missing verdict.

### Merger (`roles/merger.md`)

**Drives** conflict resolution hunk by hunk, preserving both sides' intent. It edits and `git add`s files; it never commits and never runs merge, rebase or reset. The prompt carries what the incoming side was doing, the receiving side's commits since the two diverged, the goal, the human's hint, the conflicted files and hunks, and the merger skill hint.

**Where it runs:** `integrateTask` (squash into the goal branch), `catchUp` (goal branch into a task worktree), `refreshBase`, delivery `sync-base`, and the PR Stack builder.

**Budget:** `MERGE_ATTEMPT_BUDGET = 2` per conflict, 50 turns and $2 each. The second attempt resumes the first session. After a resolution, the goal's Must command checks run (unless the caller turns that off).

### Documenter (`roles/documenter.md`)

**Drives** the completion documents chosen at approval (`DocType`: `to-prd`, `readme-update`, `changelog`, `to-questionnaire`; instructions in `DOC_INSTRUCTIONS`). It runs after the goal review passes and before the goal turns `done`. The prompt carries the goal, understanding, Decisions, the task commit subjects and the diffstat.

**Output:** files. The engine resets anything the session committed, stages only `.md/.mdx/.txt/.rst/.adoc` files, discards everything else, and commits `docs: <goal title>`. The result is recorded as `goal.docs_generated` and never blocks the goal. The session gets 50 turns and `DOCS_MAX_BUDGET_USD = 3`.

### Feedback triage (`roles/feedback.md`)

**Drives** what a person's Milestone feedback becomes: exactly one `hint`, `fix` or `decision`. On a second look (`recheck`), only `hint` is allowed (`hintOnly`).

**Input:** the goal, understanding, Decisions, the milestone and its "look for" note, the landed and remaining tasks, and what the person wrote.

**Output:** `FeedbackPlan` (`core/src/schema/feedback.ts`). The engine applies it only after the person confirms, when the checkpoint Escalation is answered with `feedback` (`applyFeedback`, `checkpoint.ts`). The session gets 15 turns and `FEEDBACK_MAX_BUDGET_USD = 0.5`.

## Sessions without a role file

| Session | Code | Model | Output |
|---|---|---|---|
| Nature classification (goals created as `auto`) | `clarify.ts` `classifyNature` | `goal.models.cheap` (legacy field, not a preset) | `{ nature }` |
| Suggestion for a blocked task | `escalation-suggest.ts` `runSuggest` | preset `suggest` | `SuggestOutput` `{ diagnosis, action, hint, confidence }` |
| Style Sample | `style-sample.ts` | preset `styleSample` | one image file at `artifacts/samples/<key>-<n>.png`; the prompt carries the *worker* skill hint for scenario `image` |
| Check-output distillation | `distill/summarize.ts` via `Engine.summarizer` | `goal.models.cheap` (legacy field) | `{ summary, keyErrors[] }` |
| Model probe, usage probe | `Engine.probeModel`, `Engine.probeUsage` | the probed model; `config.models.cheap` | none (reads `init` / the rate-limit signal) |

## Skill hints

Foundry does not define skills. It sees the ones installed on the host, and it tells each role which to use ([ADR-0004](adr/0004-workflow-skills-mandated-and-observed.md), [ADR-0005](adr/0005-scenario-skills-and-settings.md)).

**Where the rules come from.** Each entry in `catalog/skills.json` can list `roles` (the roles it is relevant to), `scenarios`, and `workflow` rules of the form `{ role, mandate: 'must' | 'prefer', when: <task kind> | 'any', scenarios, instruction }`. `SkillRole` (`engine/src/skills/types.ts`) covers `clarifier`, `planner`, `worker`, `reviewer-task`, `reviewer-goal` and `merger`. The Documenter and feedback triage get no hints.

**How a section is built.** `engine.skills.hints` is a `SkillsHints` (`engine/src/skills/hints.ts`). It caches catalog statuses for 10 seconds, and the cache is invalidated on install, uninstall and relevant Settings changes. Call sites ask for a prompt section:

| Call site | Call |
|---|---|
| `clarify.ts` | `sectionFor('clarifier', { scenario })` and `sectionFor('planner', { scenario })`; the scenario is set only for docs/research/media natures (`natureScenario`) |
| `brief-draft.ts` | `sectionFor('clarifier', { scenario })` |
| `attempt-loop.ts` | `sectionFor('worker', { taskKind, scenario, projectSkills, discipline })` and `mandatedFor('worker', ...)` |
| `checks/reviewer.ts` | `sectionFor('reviewer-task', { scenario })` |
| `goal-review.ts` | `sectionFor('reviewer-goal', { scenario: goalScenario(tasks) })`, skipped for small goals |
| `merge.ts` | `sectionFor('merger')` |
| `style-sample.ts` | `sectionFor('worker', { scenario: 'image' })` |

`formatWorkflowSection` (`engine/src/skills/workflow.ts`) turns that into a `# Workflow skills` block:

- Only **installed** skills count. Members of an exclusive pack the user did not choose (Design, Image, Video Pack) are invisible (`packAllows`, `skills/packs.ts`).
- `applicableRules` keeps the rules for this role whose `when` matches the Task Kind and whose `scenarios` match. Media scenarios see only skills that explicitly list them.
- **Discipline** changes the TDD rule: `off` drops it entirely (not even listed as installed), and `preferred` downgrades MUST to Prefer. `resolveDiscipline` lets a task's `tdd: 'off'` override the goal.
- Each rule becomes `- MUST: invoke \`/<invoke>\` — <instruction>` or `- Prefer: ...`. The invoke name is the one actually loaded on this machine, plugin copy first. A rule whose skill needs an env var the session lacks gets a "degraded" warning.
- The block always tells the session not to run the setup and ticketing skills (`NEVER_RUN`), then lists other relevant installed skills, then the goal's **Project Skills** from autoskills.
- With the `plain` workflow profile (Settings), the block is a one-line list of installed skills.

Hints are off entirely when `settingSources` excludes `user`, because user-level skills would not load in that session (`hintsEnabled` in the `Engine` constructor).

**Observing use.** The runner records every Skill-tool invocation (`RunResult.skillsUsed`). After an attempt, `attempt-loop.ts` compares it with `mandatedFor(...)` and hands the result to the Task reviewer (the `# Workflow` section) and to the next attempt's Observation Report (`summarizeReport`). A skipped mandated skill is a note, never a failure on its own.
