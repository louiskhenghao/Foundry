# ADR-0012: Milestones, previews and the headless self-check

**Status:** accepted (2026-09-14)

## Context

A goal ran from Brief approval to delivery with no way in: the person could not see or steer anything until the whole
result was merged, and found problems on their own afterwards. Progress folders (ADR-0011) put the work where they can
open it; this decision makes the engine stop at the right moments, run the result for them, look at it itself, and carry
their reaction into the remaining work.

## Decision

- **Milestones in the Brief.** The Clarifier marks 1–3 tasks (`milestone`: what to open, try and judge); the human edits
  them at approval. A Brief may also carry a `run` section (install, dev command with `{port}`, URL, platform); otherwise
  the engine detects the dev/start script from package.json (Vite, Next and Expo get their port flag, anything else gets
  `PORT`).
- **Checkpoint.** When a milestone task lands, the scheduler launches nothing more; once no attempt is in flight the goal
  moves to `awaiting_feedback` with a `milestone` escalation (Inbox, Telegram with the latest screenshot and the preview
  link). `goal.checkpoint` names the task; `task.milestoneVisits` counts the pauses.
- **Feedback.** *Continue* resumes. Text goes through a cheap read-only triage session (role `feedback`, ≤ $0.5) that
  proposes a `FeedbackPlan` — hint / fix / decision — which the human confirms (the answer carries the plan). Hints reach
  every task still to run; fix tasks (`origin: feedback-fix`, `checkpointOf`) re-open the same milestone once when they
  land; a decision is appended to the Brief's Decisions so every later session sees it. A second look allows hints only.
  Nothing is re-planned wholesale; that stays a human act on the Brief.
- **Preview.** One dev server per goal, started by the engine in the progress folder on a port from Settings → Preview
  (default 4200–4299), started at milestones and on request, restarted after each integration, stopped when idle
  (default 60 min, never while the goal waits for a look), when the goal ends, and on shutdown. Output streams to the
  goal page. The URL is local to the engine host; remote users reach it through a published port or their own tunnel.
- **Self-check.** Off by default (Settings → Preview, and per goal on its Preview card). After each integration and at
  goal review the engine opens the preview in headless Chromium (Playwright, browser installed on demand), screenshots
  it and collects console, page and network errors. It is a goal-level must check of type `selfcheck`: a failure is a
  failing must check at review (fix cycle / escalation as usual); a missing browser or run command is an `error`, never a
  fail. No model is involved.

## Consequences

- People see the result at the moments that matter and steer with a sentence; the engine stops guessing what "done"
  looks like to them.
- Two new escalation actions (`continue`, `feedback`) and one goal state (`awaiting_feedback`); every state map in the web
  app learned it.
- Playwright is a dependency of the engine package; its browser is a separate, optional download. Docker users publish
  the preview port range to open previews from the host.
