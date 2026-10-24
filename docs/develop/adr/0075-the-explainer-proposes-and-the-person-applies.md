# ADR-0075: The Explainer proposes, the person applies — a task, a decision, a note, a follow-up or a hand-over, as a card under the answer

**Status:** accepted · 2026-10-24 · amends [ADR-0073](0073-a-conversation-about-a-goal.md); builds on [ADR-0074](0074-a-goal-asks-for-what-only-the-person-can-give.md)

## Context

ADR-0073 made the Explainer read-only on purpose: asked to change something, it says where in Foundry that is done and
drafts the words, and the person goes there. In use, that is one step too many. The person reads an answer, sees what
should be done — add a task, fix this, from now on do that, here are the files you asked for — and must then leave the
Conversation, find the page and retype what the Explainer already put into words. The Conversation knows the goal
better than any form does.

The reasons for read-only still hold: a model's reading of a sentence must not change a goal, and the Conversation is
no second control surface where a stray word adds work. The design interview settled the line between the two: the
Explainer may **propose**, the person **applies**.

## Decision

- **A Proposal is a card under the answer, and nothing until it is applied.** The Explainer ends its answer with one
  ```foundry-proposal block, a JSON object or an array of them; Foundry parses the blocks when the answer is recorded
  (`parseProposalBlocks`), gives each an id, keeps them on the message (`proposals`), and the page shows each as a card
  with **Apply** — the block itself is not shown as words. The role text allows a proposal only when the person asked
  for a change, and only for what they asked.
- **Five kinds**, each checked against the goal as it stands when applied (`conversation/proposals.ts`):
  - `task` — a task of this goal while it runs: title, spec, kind, scenario, difficulty, the tasks it runs after (by id
    or title, validated; none = after everything done so far), relevant files, and command checks of its own; it gets
    the goal's must commands as a fix task does, `origin: 'conversation'`, and the question it came from in its spec.
    Refused while the Brief awaits approval (a note is the way) and once the goal is over (a follow-up is).
  - `decision` — a constraint for the rest of the goal: a Decision on the Brief every later session reads, and a line on
    the hint of every task not yet started; running attempts are left alone.
  - `note` — a Note on the Brief while it awaits approval, for the next Revise.
  - `follow-up` — once the goal is over: Apply opens the New goal form prefilled with the proposal's prompt.
  - `fulfil` — files or links the person attached to their question, handed to an open Request or a material of the
    Brief (ADR-0074); the Explainer finds both, with ids and keys, in `materials.md` among its records. The goal gets
    copies of the files as attachments of its own, marked with the Request or the material; the Conversation keeps its.
- **Applying is recorded, once.** `conversation.proposal_applied` carries who (Access) and what came of it (a task id,
  the form's path, a word); the card shows it; a second Apply is refused. Dismiss hides a card on the page only.
- **Everywhere the Conversation is**: the bubble's window, the Conversation tab, and `foundry ask`, which lists what was
  proposed with its ids (applying stays on the page for now).

## Consequences

- The Explainer's role gains a section and a format; its records gain `materials.md`; an answer's text keeps the block
  (the page hides it), so an older client shows the JSON as words rather than losing it.
- Tasks have a new origin, `conversation`, and the Activity tab a line for an applied proposal.
- ADR-0073's "never acts" becomes "never acts by itself": a Proposal is the one way the Conversation reaches the goal,
  and it reaches it through the person's hand.

## Alternatives considered

- **Applying automatically when the person's words are a clear request**: fast, and a misread sentence changes the
  goal; the card costs one click and keeps the goal the person's.
- **A tool the Explainer calls (MCP) to propose**: a reliable structure, but a Foundry MCP server hung on every session
  for one call; the block rides on the answer the Explainer writes anyway.
- **A second, cheap model classifying each exchange into proposals**: a call and a cost per turn, and a judgement made
  behind the Explainer's back; the Explainer that answered knows best what it proposed.
