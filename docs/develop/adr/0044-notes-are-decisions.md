# ADR-0044: A note from the human is a Decision, asked for or not

**Status:** accepted · 2026-10-19 · amends ADR-0013 and ADR-0027

## Context

Before the Brief, the human could only speak when spoken to. An interview round took an answer per question, with a
"something else…" box per question for an answer of the human's own; a round had no place for what the questions
missed. On the Brief page, free text reached a model only as the one-off "notes for the AI" of a Revise or a task
Draft, shown only once a Decision existed, hidden on a phone, and kept nowhere. Re-run Clarify took no words at all and
lost the answers typed on the page but not saved.

So a person who saw, in round two, that the goal had been misread, or who wanted to add "the admin role is out of
scope", had to bend an unrelated question's answer to say it, or edit the plan by hand and hope the workers read it.
What they wrote in the Revise box was gone after that one session.

Decisions already travel everywhere such words need to go: every Worker, Reviewer and the pull request receive them
verbatim; Revise honours them; a Re-run Clarify starts from them (ADR-0013, ADR-0027).

## Decision

- **A Note is a Decision.** The human's unasked words become a Decision of kind *note*, kept among the Brief's
  questions (`kind: 'note'`, the words in `text` and again in `answer`, so every place that derives Decisions from
  answered questions sees it unchanged). It renders to sessions as `Note from the human (unasked): …` beside the
  answers and the rejected assumptions.
- **Two places to write one.** An interview round has an **Anything else?** box; what it holds is recorded on the round
  (`interview.round_answered.note`), goes to the Clarifier with the answers as a section it is told to treat as a
  Decision, survives a lost session in the "interview so far" replay, and becomes an applied Note on the Brief when
  it is written. The Brief page's **Decisions** card is always shown while the Brief can be edited and carries the
  composer: **Add note** appends a pending Note, saved with the Brief like any edit; ✕ removes one. The Simple view has
  the same composer as **Anything to add?**.
- **Chat too.** The round's last message gets **✍️ Add a note…**; a reply to that message is the note (Discord opens a
  form). The note waits in the drafts with the round's answers and is sent with them by whichever button closes the
  round.
- **Re-run Clarify saves first.** The Brief page saves its unsaved edits before asking for a Re-run, so answers and
  notes typed there reach the new Clarify as Decisions. Re-run still carries Decisions only, as text.
- **The prompt stays immutable.** The goal prompt cannot be edited before approval: it is the record of what was asked,
  and Follow-ups, Learnings and the pull request cite it. A Note is how the human adds to it or corrects it.

## Consequences

- The one-off "notes for the AI" of Revise is gone from the Decisions card: a Note is persistent and reaches Revise as a
  pending Decision instead. A task's Draft keeps its own one-off notes field, which is about that task alone.
- A Note on the Brief page is pending until a Revise honours it, like an answer given there; a Note written during the
  interview is applied, because the Clarifier read it before writing the Brief.
- The Questions card never lists a Note; the Decisions card does. Older Briefs have no Notes and read as before.
- A Note is capped at 4000 characters per round. Nothing prevents a Note from contradicting an answer: the Clarifier and
  the workers receive both, in order, as they would two answers.
