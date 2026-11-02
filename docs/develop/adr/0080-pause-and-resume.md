# ADR-0080: Pause and Resume — a goal at work pauses, and a paused, cancelled, failed or blocked goal goes on from where it stopped

**Status:** accepted · 2026-11-02 · builds on [ADR-0002](0002-event-sourced-state.md), [ADR-0065](0065-multi-account.md) (session resume and handoff) and [ADR-0074](0074-a-goal-asks-for-what-only-the-person-can-give.md); amends the Goal state machine

## Context

A goal that stopped at 24 of 26 tasks had one way forward: **Continue with a follow-up…**, a new goal with a fresh
Clarify and Brief, which reads as starting over. **Restart…** existed but sat in the ⋯ menu, took one task and reset
everything downstream of it, dropping the task worktrees. There was no pause at all: the only button on a running goal
was **Cancel**, with no confirmation, and a cancelled goal was not a clean stop. Its sessions were killed, but the attempt
loop went on as if the session had merely ended — a snapshot, the checks, perhaps a retry starting a new session on a
cancelled goal — while a task caught landing stayed in `merging` and the Inbox kept its items. The person could not say
"wait" to a goal, and could not take a stopped one up again where it was.

## Decision

- **A `paused` goal state**, entered only by the person. A running goal pauses **gently** by default: nothing more
  starts (`pausing`, kept on the goal), and once the work in flight has landed the goal is paused with those tasks done
  and the next ones untouched. **Stop now** stops the sessions instead. A Clarify is always stopped now: its session is
  spent either way, and Resume runs it again. A goal review is not paused — its session cannot be reached, and it is over
  in minutes; the goal pauses once it runs again. Paused time does not count against the goal's time limit: the working
  clock runs only while Foundry works.
- **A stopped session keeps its attempt.** When a session is killed because the person paused or cancelled the goal, the
  attempt loop reads the goal's new state and records the attempt as `interrupted` (what it did is committed, no retry
  spent) and its task as `ready`. Resume takes the session up where it was, as a Continuation past the cap, as after a
  usage limit or an engine restart: a pause is no fault of the session's.
- **Resume applies to paused, cancelled, failed and blocked goals alike**, and is the primary button on each. A paused
  goal goes back to where it was. A cancelled, failed or blocked one goes on from where it stopped: done tasks stay done;
  pending and ready ones run; failed, blocked and half-landed (`merging`) ones — and tasks a cancel of before left as
  running — run again with one more attempt (`failed → ready`, or `pending` while what they wait for is not done). The
  goal's open Inbox items are closed, except a Request for something only the person can give. Where there is nothing
  to run, the goal returns to its Brief (awaiting approval) or to Clarify. A commit a merge attempt left that git would
  not take back is taken back first, or the resume is refused with what is left to do, as a restart is.
- **The Resume dialog carries two things the remaining work may need:** a word from the person, appended to the hint of
  every task not done, and higher limits when the budget held the goal — without them it would stop again at once.
- **Cancel is a clean stop.** It stops the sessions, keeps their attempts resumable as above, closes the goal's Inbox
  items and moves to the ⋯ menu behind a confirmation; **Pause…** takes its place as the running goal's main button. A
  goal review that ends after its goal was cancelled writes no verdict over that.
- **Restart stays** in the ⋯ menu for what it does well — run a task and everything after it over from scratch.
  Follow-up becomes a secondary button: Resume is the way to go on; a Follow-up is a new goal (see [ADR-0081](0081-carry-over-unfinished-tasks.md)).
- Not paused here: Delegated goals of a paused main goal go on by themselves; delivery is never at work while a goal
  can be paused.

## Consequences

- Two fields on the Goal (`pausedFrom`, `pausing`), one event (`goal.pausing_set`), one attempt result subtype
  (`paused` / `cancelled`), one Continuation reason (`paused`). Old goals read the new fields as null and false.
- `POST /api/goals/:id/pause {now}` and `POST /api/goals/:id/resume {hint, budgets}`; `foundry pause [--now]` and
  `foundry resume [--hint] [--max-cost] [--max-min]`.
- The Goals page hangs a paused goal as a sign (**Resume**) with the goals that wait for the person: only they can let it
  go on. The Simple view's wording for a blocked goal changes from "Paused — something needs you" to "Stopped", since
  Paused now names the person's own act.
- A failed task may run again (`failed → ready | pending`), which the state machine did not allow before; the scheduler's
  cascade still fails pending tasks whose dependency failed, so a resumed task's dependencies are made ready first.
