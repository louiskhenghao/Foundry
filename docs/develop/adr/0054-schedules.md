# ADR-0054: Schedules — a saved goal recipe that fires on a cadence, one run at a time, its Brief approved by the engine when the person said so

**Status:** accepted · 2026-10-21 · builds on ADR-0013, ADR-0034 and ADR-0040

## Context

Some goals are the same every time: upgrade the dependencies and run the tests, audit the repository, refresh the
generated docs, check the links. Until now each one was typed again on the New goal form, by a person, at a time a
person was there. Foundry's other pieces are ready for unattended runs: budgets stop a run that grows, Learnings
give a run what the last one found, the Inbox and the chat channels say when something needs a person, and a
Delegated goal already shows that the engine can approve a Brief by itself (ADR-0034).

What was missing was the clock, and a decision about what an unattended run may skip. The interview (ADR-0013) asks
a person questions; a run at three in the morning has none to ask.

## Decision

- **A Schedule is the New goal form, saved.** Its recipe is what the form would submit: the description, the folder,
  the coding agent and preset, the workflow switches, the delivery policy, the budget, links. What cannot be
  submitted twice is not kept: an upload (staged once), a reference (investigated once), an issue (read once). The
  form is the schedule's editor: **Schedule…** saves the form as one, **Edit** on the Schedules page opens the form
  filled with it.
- **A cadence is one of three**: every day, one weekday a week, one day a month (1–28, so every month has it), at a
  time of this computer's clock. No cron syntax; the person chooses from a list.
- **The engine looks every minute** and fires each enabled schedule that is due: one goal from the recipe, titled
  after the schedule and the day. A schedule counts from its last run, or from when it was last changed; a run
  missed while the engine was off fires once when it is back, late, and the next counts from that. Enabling a
  schedule counts from then: the time it was off is not caught up.
- **One run at a time.** While the previous run is still going, a firing makes no goal and is recorded as skipped
  with the reason; **Run now** refuses with the same reason. A recipe that cannot make a goal (the folder is gone) is
  a skipped firing too, said in words, never a crash.
- **Approve each run's Brief for me** (on by default): the interview is skipped, milestones do not pause, and the
  engine approves the Brief once it is in, with the budget the Brief proposes when the budget is Auto — exactly as a
  Delegated goal on auto-approve. A Brief with a blocking question waits for the person and says so (Brief ready).
  Off: the run is an ordinary goal; its interview and its Brief wait for the person.
- **Schedules are this computer's.** Global events (`schedule.*`, no goal on the envelope) like the Learnings; a
  Transfer carries none. A goal made by a schedule records which (name, when, whether the engine approves), and
  says so on its page and in the goal list; deleting the schedule leaves its goals as they are.
- A **Schedule fired** notification says which goal a firing made, or why it made none.

## Consequences

- A schedule spends money while nobody watches: its budget preset and the Auto budget's cap are the brake, and the
  Inbox collects what a run could not settle. The guide says to start with Quick budgets.
- A run skipped because the previous one still goes is lost, not queued; a cadence shorter than a run's length
  skips every other time, which the page shows.
- Times are local: a laptop that changes time zone fires at the new local time.
- A schedule's recipe keeps a workflow suite and presets by name; renaming a preset later makes the run refuse at
  creation, recorded as a skipped firing.
