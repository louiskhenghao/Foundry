# ADR-0013: Clarify interviews the human in rounds

**Status:** accepted (2026-09-14)

## Context

Clarify asked its questions once, all at the same time, next to a Brief it had already written on guesses. An answer
never changed the next question, so the human got the whole list at once and then paid for a Revise session that re-planned
the Brief cold. People who had used grilling-style interviews elsewhere found this shallow and slow.

## Decision

- **Rounds before the Brief.** With an interview (the default, Settings → *Interview before the Brief*), the Clarify session
  explores first, then emits either a round of questions or the Brief (`InterviewOutput`). A round is the frontier: every
  decision askable now, at most 8, each with 2–4 options (recommendation first), the evidence that leaves it open
  (`reason`), and the earlier question it follows from (`dependsOn`). At most 4 rounds; zero is right for a small goal; a
  goal created with *interview me* asks at least one.
- **The answers reshape the next round.** The same session is resumed with the round's answers; unanswered non-blocking
  questions proceed on the recommendation. *Enough* asks for the Brief with what there is; after the fourth round the
  Clarifier is told to write it. A session the CLI cannot resume is replaced by a fresh one carrying the interview so far.
- **Answers are Decisions.** Every answered question lands in the Brief's questions as answered and applied, so every later
  session receives it and Revise honours it. Revise itself resumes the interview session (it knows the repository and the
  answers) and falls back to a fresh one when the session is gone.
- **State.** `Goal.interview` records mode, status (thinking / awaiting_answers / done), the session and the rounds;
  events `interview.round_asked / round_answered / finished`. The goal stays `clarifying` while a round is open; the tick
  does nothing until the human answers (goal page or Brief page), and picks a half-done interview up after a restart.
  Re-run Clarify resets the interview. A notification (`notifications.onInterview`) announces each round.

## Consequences

- Questions arrive when they are askable, with a reason and a recommendation; the Brief is written once, informed.
- One more human step for goals that have real decisions; none for goals that do not.
- The one-shot Clarify stays available (`never`), and every existing Brief tool (Draft, Revise, coverage gate, style
  samples) is unchanged.
