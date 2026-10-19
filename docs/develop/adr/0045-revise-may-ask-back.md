# ADR-0045: A Revise may ask the human back before it proposes

**Status:** accepted · 2026-10-19 · builds on ADR-0013 and ADR-0044

## Context

Revise was one-shot: the Clarifier re-read the Brief with the human's Decisions and had to return a whole revision in
one turn. When a Decision opened a question it could not settle from the repository — "students only" leaves open
whether the teacher portal goes or stays read-only — it had two bad choices: guess and record an assumption, or push
the question onto the Brief as a non-blocking `newQuestions` item that nothing would act on until the next Revise.

The human, for their part, had no way to make the system ask more once the Brief existed (ADR-0027): the interview is
over, and Re-run Clarify throws the Brief away. ADR-0044 gave them a way to speak unasked; this gives the Clarifier a
way to ask.

The interview already has the right form: a round of questions as structured output, each with the Clarifier's
recommendation first and the reason that leaves it open, answered on the page and fed back into the same session
(ADR-0013).

## Decision

- **A Revise turn is a round or a revision.** The Revise session's output is `{questions, revision}`: a round of
  questions with `revision: null`, or the revision with `questions: []`. A bare revision is still accepted, as a bare
  Brief is from an interview session. The prompt says when to ask: only what a Decision leaves open and the
  repository cannot answer; at most two rounds.
- **The round lives on the goal.** `revise.round_asked` records the questions and the session that asked; the goal
  carries `revise` (status, session, rounds in the interview's shape) so the round survives a reload and a page
  elsewhere sees it. The human answers it with the same form as the interview — options, "something else…", a Note,
  Send / Accept all recommended / Enough — through `answerRevise`, which resumes that session with the answers (a
  lost session starts fresh with the rounds so far) and comes back with the proposal, or one more round.
- **Two rounds, then it proposes.** After the second round's answers the Clarifier is told to propose; if it still
  asks, one forcing turn gets the revision and no third round is opened. "Enough" tells it to propose with its
  recommendations for what is still open.
- **Answers are Decisions.** The round's answers and Note come back on the revised Brief as applied Decisions, beside
  the ones that caused the Revise; the proposal already honours them. The page records them the moment the proposal
  arrives, whatever the human accepts of it: they are the human's words, not the model's proposal. Revise saves the
  page's edits first, as Re-run Clarify does (ADR-0044), so the note that caused it survives a reload while a round
  waits.
- **Nothing is held hostage.** The Brief can be approved while a round is open, and the human can cancel the
  revision: either records `revise.finished` as abandoned, and the Brief stays as it is. A Revise that asks nothing
  records no round at all.

## Consequences

- A Revise can take two extra sessions' worth of turns and the human's time; the cap keeps it a touch-up, not a second
  interview. The interview depth does not apply here.
- The round is only on the Brief page: no chat notification carries it yet, unlike interview rounds.
- `DraftProposal` grows a `round` variant the page must handle; the other draft modes are unchanged.
