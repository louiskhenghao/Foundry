# ADR-0058: Smoke — the goal's milestone scripts against a deployed address, once a deploy is live

**Status:** accepted · 2026-10-21 · builds on [ADR-0031](0031-feature-milestones-with-scripts.md) and [ADR-0041](0041-deploy-web-apps.md)

## Context

Deploy (ADR-0041) ends with an address and the host's word that the build went up. Whether what is online does what
the goal's features showed is another matter — an environment variable the host lacks, a database that is not there, a
build that differs from the one the checks ran — and the person finds out by clicking through, or from a user. The goal
already has what tries each feature end to end: its milestone scripts (ADR-0031), Playwright tests in the repository
that walk a feature's states, written to run against `baseURL` while the project's own `webServer` starts the app. The
final walkthrough runs them on the finished branch; nothing ran them on the deployed result.

## Decision

- **A smoke follows a deploy that ended live:** every landed task's milestone script runs against the deployed address,
  one after the other, in the deploy's own checkout of the deployed commit, so the scripts are the ones that shipped
  and no task's folder is touched. Each runs through a config Foundry writes next to the project's — the project's
  config on Chromium, as a recording is — that leaves its `webServer` out and sets `baseURL` to the address, on every
  project too, with no `PORT` or `API_PORT`: nothing of the project's starts here.
- **The result stays on the deployment:** passed, or failed with which scripts and why; each script's video, captioned
  screenshots, attached outputs and runner log under the goal's screenshots folder, shown under the deploy's row on
  the Deploy card the way a milestone's recording is. A goal without milestone scripts gets a skipped smoke with the
  reason. It is told under the Delivery notification switch; a skipped one is not.
- **A preview gets a smoke by default; production only when asked.** A milestone script writes what it tries — an
  order, an account, a message — and against production that lands in real data. The card's checkbox follows the kind
  of deploy, and the production confirmation says what will be written.
- **It mends nothing.** A failed script online is the person's to look into (the host's environment, most often);
  **Smoke again** runs the scripts against the same live address once they did, after any deploy or smoke using the
  deploy folder. The deploy itself is not undone: rolling back is the host's own act, and a failed smoke of a preview
  address is no emergency.

## Considered options

- **A fix task for a failed smoke,** like the audit's (ADR-0032) and the QA's (ADR-0057). Rejected: a goal that is done
  has delivered; what differs online is almost never in the code, and a task that changes the code after delivery
  would need a delivery of its own.
- **Foundry's own browser session against the address** (the QA, ADR-0057). Rejected: the scripts are the features'
  own tests, cheaper and exact; a session is for what has no script.
- **Running the smoke in the milestone worktree.** Rejected: that worktree follows the goal branch's tip and is shared
  with Rerun; the deploy folder is at the deployed commit, has the project installed, and is already serialized with
  the deploys of the repository.
- **Rolling the host back on a failed production smoke.** Rejected: a rollback differs per host, and a script can fail
  for a reason that is no outage; the person is told at once and decides.

## Consequences

- A smoke takes as long as the scripts, minutes at most, after the deploy's own message: the address is announced
  before the smoke ends.
- A script that counts on the project's `webServer` having seeded data, or reads `process.env.PORT` itself, fails
  online with its message; the smoke says so, and the script is for a later goal to mend.
- `Deployment` gained an optional `smoke`; two events, `deploy.smoke_started` and `deploy.smoke_finished`, name the
  deploy by its `at`. Older events replay unchanged.
