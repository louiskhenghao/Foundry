# ADR-0060: Reports — what Foundry cost and did over a window, by project and by session kind

**Status:** accepted · 2026-10-21 · builds on [ADR-0056](0056-estimate-calibration.md)

## Context

The Usage page answers one question: how close is the account to its limits, with the last seven days of Foundry's
own sessions beside it. Everything longer is in the event log and the read models already — the usage ledger (every
session with its kind, model, cost and time), the goals with their folder, state, cost and working time, the tasks
and attempts, the Briefs with their estimates — and nothing showed it: what a project cost this quarter, which kind of
session eats the budget, how often a task needs a second attempt, how far the Briefs' estimates run from what goals
come to. Calibration (ADR-0056) computes that last one for the next estimate, and the person never sees the whole.

## Decision

- **A Reports page, read on request from what is already recorded.** `buildReport` reduces the ledger and the goal
  records for a window — the last 30 days, 90 days, 12 months or all time — into: the spend over time (per day, week
  or month, the step following the window, with the goals that finished in each); every project with its goals
  started, finished, failed and cancelled, its spend and cost per finished goal, Foundry's working hours, its retry
  rate and its estimate error; every session kind with its share of the dollars and of the time; and the goals whose
  estimates missed most. Nothing is stored and no projection is added: the numbers come from the usage ledger, the
  goals, tasks, attempts and Briefs each time.
- **Goals count by when they were created, sessions by when they ran.** The two differ at a window's edge (a goal
  started before it whose sessions ran inside it) and the page says so; a project's spend is its goals' sessions in the
  window, a project's goals are the ones started in it.
- **The retry rate is the share of attempted tasks that needed more than one work attempt;** merge attempts are
  syncs, not retries, and fix tasks (a review's, an audit's, CI's, the browser QA's, a review comment's) are counted
  beside it, not inside it.
- **The estimate error is calibration's own factor** (the median of actual ÷ estimate over the finished goals with an
  approved, estimated Brief, three at least), so the page and the Brief's correction agree.
- **Dollars are the ledger's Claude Code estimates,** as everywhere in Foundry: Codex sessions report none and are
  counted, and a session cut before it reported a cost is unknown, not $0, and said so.
- The page is under ⚙ beside Schedules and Learnings and linked from the Usage page; `GET /api/reports?days=` and
  `foundry report` carry the same numbers.

## Considered options

- **More on the Usage page.** Rejected: Usage is about the account's limits now, read often and kept short; a report
  is read now and then and wants a window, a table per project and room.
- **A projection kept up to date by the engine** (a `reports` read model). Rejected: the ledger and the goal records
  are small (hundreds of goals, thousands of sessions) and already indexed; a reduction on request costs milliseconds
  and cannot drift from the events.
- **Charts from a library.** Rejected: one row of bars with a hover is enough for a trend, and the page stays
  dependency-free and readable on a phone.
- **Spend by model and by skill.** Left out: the Usage page shows models for the week; skills are on the Agents page.
  A later window selector there, or a column here, is a small change.

## Consequences

- `engine/src/reports.ts` and the `Report` types in `engine/src/usage/types.ts` (browser-safe, shared with the web);
  `Engine.report(days)`, `GET /api/reports`, `apps/web/src/pages/ReportsPage.tsx`, `foundry report`.
- A long all-time window over years of records reads every ledger row once per request; fine at today's sizes, and the
  place to add a cache if a Foundry ever grows past that.
- The guide's Costs and usage page gains a Reports section with a screenshot of the demo's records.
