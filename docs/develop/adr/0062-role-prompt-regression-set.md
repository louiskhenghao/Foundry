# ADR-0062: A role-prompt regression set for maintainers

**Status:** accepted · 2026-10-21 · builds on [ADR-0004](0004-workflow-skills-mandated-and-observed.md) and [ADR-0047](0047-latest-mattpocock-skills-in-the-workflow.md)

## Context

Foundry's roles are prompts and the skills they are told to follow: the clarifier, the planner, the worker, the task
and goal reviewers, the auditor, the documenter. Three things move under them without a test noticing: the workflow
suites (mattpocock pinned by tag, pstack by version), the model aliases (`opus`, `sonnet`, `haiku` resolve to new
models), and the prompts themselves when a maintainer edits a role. The unit tests run every role against fakes and
say nothing about whether a real session still finishes a small goal, at what cost. The gstack retro clash (ADR-0048)
was found by hand after a bump; the next one will be too unless something small and fixed is run on purpose.

## Decision

- **Five small, fixed goals** (`packages/engine/src/regress/cases.ts`): fix a planted bug touching nothing else; add
  two functions with tests and exports; a docs-only change; a refactor that keeps the tests green; a feature on a
  static page. Each builds its fixture repository from code (no files in the repository), says which shell checks the
  finished checkout must pass and which files the goal may touch, and carries a cost and time budget.
- **One in-process engine per run, the real coding agent, Clarify included.** `runSuite` creates each goal with the
  interview off and its Brief approved by the harness once ready, so the clarifier and the planner are exercised too;
  `--no-clarify` runs the case's checks as a one-task Brief for a cheaper look at the worker and reviewer roles alone.
  A goal that stops for the person is given up as a failure, as is one that runs past its time.
- **A run is a record, compared, never a gate.** `regress/results/<time>-<label>.json` and `.md` say what passed, what
  it cost and how long it took, with tasks, attempts and retries; `--baseline` sets the run against a saved one and
  names the regressions (passed before, failed now), the improvements and the cases that cost half again as much;
  `--save-baseline` keeps a run under `regress/baselines/`. Nothing runs in CI or in `bun test` but the harness's own
  self-test on a fake runner: the set spends real money and is run by a person, after a bump, before a release.

## Considered options

- **Golden transcripts** (assert what the roles say). Rejected: the prompts' words are not the point and change on
  purpose; the finished checkout is.
- **A larger benchmark** (dozens of goals, several repositories). Rejected for now: five cases at a few dollars are
  run; fifty are not. More cases are a list entry each.
- **Running it in CI.** Rejected: it needs a signed-in coding agent and spends its quota; the machine it runs on is a
  maintainer's.
- **Judging by the goal review alone.** Rejected: the review is one of the roles under test; the checks and the
  allowed files judge it from outside.

## Consequences

- `scripts/regress.ts` (the entry), `packages/engine/src/regress/{cases,run}.ts`, `regress/baselines/` (kept) and
  `regress/results/` (ignored); the self-test `run.test.ts` runs with the fake runner.
- A case's checks run in the goal's progress folder after it finished; the run leaves its data and fixtures under
  a temporary work folder, or `--work-dir`.
- testing.md says how and when to run it; release.md asks for a run after a suite or model bump.
