# ADR-0008: Non-code goals: nature, git substrate, media artifacts outside git

**Status:** accepted · 2026-08-26

## Context

The system's goal is that anyone can finish a goal through it — documents, research, images, video, not just software. The engine core (event log, task DAG, attempts, escalations, budgets, Simple mode) was already domain-agnostic; what locked it to coding was the prompts (build/test/commit everywhere), command-centric checks, the scenario enum, and one hard problem: a task whose deliverables live outside the repository produces an empty diff, which the reviewer treats as failure — but committing media files (a video per attempt) would bloat every repository.

## Decisions

1. **`Goal.nature`, settled once.** `auto | code | docs | research | image | video`, chosen at creation or decided by the Clarifier for `auto` (recorded as `goal.nature_set`). Every fork — Clarify prompt, tech-stack question, acceptance guidance, Simple-mode default, TDD exemption — keys off nature or the task's scenario. Rejected: inferring everything from task scenarios only (the signal arrives too late to shape Clarify itself).

2. **Git stays the only substrate.** Prose and research are committed markdown — versioning, parallel tasks, merges and diff-review come for free. A folder-based non-git workspace mode was rejected: it would re-implement isolation, rollback and review for one class of goals.

3. **Media artifacts live in the workspace but outside git.** Tasks generate into `artifacts/` (excluded via `.git/info/exclude`, root-anchored) and commit a manifest under `docs/artifacts/` describing every file with its generation parameters. The manifest gives the reviewer a diff and a checklist; the binaries never enter history. After a task integrates, the engine copies its worktree's artifacts into the goal workspace (a squash merge cannot carry excluded files); when the goal finishes they are copied to the goal's output folder (`goal.artifacts_delivered`, never blocking). Rejected: writing directly to the output folder (no isolation between parallel tasks, failed attempts leave debris, zero-diff review problem returns) and committing artifacts (repo bloat).

4. **Acceptance is honest about what models can judge.** Image reviewers open the listed files with the Read tool (it renders images) and judge them against the rubric. Video reviewers verify existence and ffprobe metadata and may extract frames; final visual quality explicitly stays with the human, who gets the artifacts in their output folder at done. Rejected: a blocking human-approval check type — acceptance is defined in the Brief and the system does not interrupt after approval.

5. **Media capability comes from skills, chosen as packs.** `workflow.imagePack` / `videoPack` mirror the design pack: mutually exclusive catalog options (gpt-image-2; web-video-presentation / mmx-cli), mandated to workers by scenario, `none` allowed. The engine never integrates a media API directly — tools change too fast, and the boundary already permits network calls.

## Consequences

- The clarifier/planner/worker prompts fork by nature/scenario; auto goals carry all nature sections until the verdict (a few KB of prompt).
- New defaulted fields (`nature`, `outputDir`, `completion.artifactsRun`) and events → `replay` required on deploy.
- The exclude pattern is `/artifacts/` (root-anchored): an unanchored `artifacts/` would also exclude the committed `docs/artifacts/` manifests — found by test.
- Anyone-facing defaults: non-code goals open Simple, deliver locally, get no TDD mandate, no graph refresh, no tech-stack question.
