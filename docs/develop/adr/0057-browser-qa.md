# ADR-0057: Browser QA — the finished app tried in Chromium before the final review, a failed must check a fix task

**Status:** accepted · 2026-10-21 · builds on ADR-0012, ADR-0031 and ADR-0032

## Context

A goal's acceptance checks are commands and reviewer rubrics; the milestone walkthroughs (ADR-0031) show a feature
as its task finishes; the self-check (ADR-0012) opens the preview and looks for errors. None of them tries the
finished result the way the person who asked for it will: open the app, do the thing, see whether it holds. The
audit (ADR-0032) gave the end of a goal a shape for that kind of pass — one session, bounded, structured findings,
must-fix findings in scope made fix tasks before the review — for the code. The slot for the running app stayed
empty when gstack's `qa-only` left (ADR-0048).

A session that drives a browser needs to write and run scripts, which the audit's read-only tools do not allow;
and a session with the worker's tools can change the application, which a tester must never do.

## Decision

- **Browser QA is a Completion Action**, chosen at Brief approval (**Test it in a browser at the end**; a Settings
  default for new goals, off), offered only when the Brief names an app to run. It runs once every task has landed,
  after the audit and before the final walkthrough and the goal review, so that what it finds is fixed before the
  review sees the branch.
- **One session, the goal reviewer's model, the worker's tools.** The engine starts the goal's preview from the
  finished branch and hands the session the app's address, the acceptance checks by name (must first, a command
  check with its command, a reviewer check with its rubric), where Playwright is on this computer, and where to
  put screenshots. The session writes small Playwright scripts under a scratch folder in the goal's folder
  (`.foundry-qa/`, excluded from git), runs them with `bun`, and reports one result per check — pass, fail with the
  steps and the smallest fix, or skipped with why — plus `general` for a problem outside the checks, naming the
  screenshots it saved. The role is `roles/qa.md`.
- **It changes no code.** After the session, whatever changed outside the scratch folder is put back (tracked
  files restored, new files removed) and the person told. The scratch folder stays, outside git.
- **A failed must check becomes a fix task** (origin `qa-fix`, at most six per QA) that runs before the final
  review, with the steps that showed the failure; every result stays on the goal with its screenshots, on the
  Completion card. A failed stretch or `general` result is shown, not fixed.
- Bounded like the audit: the goal review's cost cap with a floor, one pass per goal, a goal with no budget left
  skips it, no Chromium or no web app is a skipped QA, never an error.

## Consequences

- A QA costs a session with the worker's tools on the reviewer's model: minutes and a few dollars on a Claude goal.
- The QA reads the acceptance checks as written: a goal whose checks are all commands gets mostly `skipped` results
  and a `general` look at the app; the Brief's reviewer checks are what it can try.
- The preview it starts is the goal's own (ADR-0012): the same ports, environment and services; a goal whose
  preview cannot start skips the QA with the preview's reason.
- Codex sessions get the same prompt and the same scratch rules; the browser is Foundry's Chromium either way.
