# ADR-0031: A milestone per feature, shown by a Playwright script its task writes

**Status:** accepted · 2026-10-14 · amends [ADR-0012](0012-milestones-previews-and-the-self-check.md) (milestones) · amended by [ADR-0042](0042-subjects-and-the-likeness-review.md) (a Likeness review of each recording when the Brief has Subject pictures)

## Context

Milestones were planned as "the 1–3 tasks after which a person can see something for the first time", so a goal
showed a look near its start, one in the middle and maybe one at the end, while most of what it built was never shown.
Each milestone was recorded by a walkthrough a cheap session planned against the running preview. That works for a
plain web app; with a backend or Docker services the preview often did not start (a command missing from the login
shell's PATH, a service not up, no seed data), and the walkthrough fell back to the app's mock command, so the look
showed fake data and still counted as reached. Nothing could record a milestone again, and the steps a walkthrough
followed were thrown away, so what a milestone showed could not be reproduced.

## Decision

- **One milestone per user-visible feature,** on the feature's closing task (the one after which it can be tried end to
  end), as many as the goal has features. Scaffolding, refactors and docs get none.
- **A feature with a web UI or an HTTP API gets a milestone script:** a Playwright Test file in the repository,
  `e2e/milestones/<feature>.spec.ts`, written by that task. It walks through the feature's states and attaches a
  captioned screenshot at each one (or an API's responses). Its runner is the project's own `playwright.config` at the
  repository root, whose `webServer` starts everything the feature needs on a bare checkout. The script is the task's
  must check, run on two free ports (`PORT`, `API_PORT`), so the feature cannot land unless what it shows works. It
  stays in the repository as the feature's end-to-end test.
- **Foundry records a scripted milestone by running its script** in a worktree of its own at the goal branch's tip
  (kept between recordings so its dependencies stay installed, never where a task is working), through a config of
  its own that extends the project's with a video and a JSON report, on Chromium, then removes it. The task's check
  runs through the same Chromium config, so a project that also tests other browsers is judged the way it is recorded. The evidence is the script's attachments, a
  video per test, and the runner log. There is no mock fallback: a script either passes or fails.
- **A scripted milestone does not pause the goal.** Once every task is done, the **final walkthrough** runs every
  script again on the finished branch, and the goal pauses once for a look at it ("Have a look" decides that pause).
  No task starts while it runs; a task created meanwhile makes it run again later. What the person says at that look
  always becomes fix tasks, since no task is left to carry a hint.
  A milestone without a script (documents, media, older goals) pauses as before.
- **A script that fails after its feature landed is repaired once:** a fix task, with the script as its check, mends
  the app, its start or the script. When it still fails after that, the goal pauses at the milestone with the failing
  recording and its log, so the person decides; that pause waits until no task is in flight.
- **A recording has a status:** shown, failed, or unverified when only fake data could be shown. Unverified does not
  count as reached.
- **Any milestone can be recorded again (Rerun).** A script runs again; a walkthrough replays the steps it recorded,
  which are now kept with its evidence.

## Considered options

- **Keep 1–3 milestones and only make the preview more robust.** Rejected: the person's complaint was as much about
  which states were shown as about the preview failing.
- **Let the walkthrough session keep driving the browser, and export its steps as a script afterwards.** Rejected: a
  recording and its reproduction would differ, and the session cannot see whether the feature works, only what the
  page offers.
- **Keep the scripts in Foundry's data folder.** Rejected by the person: in the repository they are reviewed with the
  code, run by anyone with `npx playwright test`, and catch regressions after delivery.
- **Pause at every feature milestone.** Rejected: with one milestone per feature the goal would stop five to ten times;
  one look at the end, with every recording on one card, replaces them.
- **Start the app through Foundry's Preview for the script.** Rejected: the project's own `webServer` is what the task's
  check already proved on a bare worktree, and it makes the script runnable without Foundry.

## Consequences

- A goal with UI or API features adds `@playwright/test` and a root `playwright.config.ts` to the repository when it has
  none, and its milestone tasks take longer: the script must pass, with every server it starts.
- Must command checks are also re-run at conflict merges and on the baseline, so milestone scripts run there too.
- The final walkthrough is due again whenever a task is created after it ran (a fix, a review fix), and the look at the
  end opens at most twice, like a milestone.
- `milestone.evidence` gained optional fields (script, status, clips, outputs, log, steps, final); older evidence reads
  as shown when it has screenshots and no mock, else failed.
