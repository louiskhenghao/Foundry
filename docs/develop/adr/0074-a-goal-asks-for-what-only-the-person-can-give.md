# ADR-0074: A goal asks for what only the person can give — Requests mid-task, Materials promised in the Brief, and an answer that continues the session

**Status:** accepted · 2026-10-24 · amends the Escalation triggers (CONTEXT.md); builds on [ADR-0038](0038-chat-answers-from-telegram.md) and [ADR-0073](0073-a-conversation-about-a-goal.md)

## Context

A worker runs with nobody watching. Its role says so: *you cannot ask questions; make sensible decisions and state
them*. That is right for almost everything — a worker that stops to ask about a variable name wastes an afternoon —
and wrong for the one class of thing it cannot decide or find: what only the person has. The realistic 3D models
they said they would supply. Their logos and copy. A key to a paid service. A decision that is theirs. Today a worker
in that spot guesses, builds on a placeholder and never says, or burns its retries; the person learns of it at the
goal review, and the only way to give the thing is to let the goal finish and start a Follow-up. In the interview the
person had said "I will provide the models" — and the Brief had nowhere to write it down.

The pieces are there. Escalations are the one way the system asks a person after the Brief is approved (a closed
enum of six triggers); they notify, they wait in the Inbox, they block a task without failing it. Attachments can be
added to a goal at any time and reach every later session. A cut session can be continued in place (Continuation),
keeping everything it knew. What is missing is a trigger for *I need something from you*, a place in the Brief for
what was promised, and an answer that carries files and goes back into the same session.

## Decision

- **A seventh Escalation trigger, `needs_input` — a Request.** A worker raises it by ending its segment with a
  ```foundry-needs block: `what`, `why`, `suggestions` (where or how to get it — links, steps, formats), and
  `canProceedWithout`. Foundry parses the block from the worker's final text, commits what was done, records the
  attempt as interrupted for that reason (no retry consumed, the worktree kept) and raises the Request; the task is
  blocked, the goal shows *needs you*, the usual notifications go out. The role file allows this **only for what must
  come from the person** — private assets, keys, decisions that are theirs; public samples, free assets and test data
  the worker finds itself and says so. One request per segment.
- **Materials promised in the Brief.** The Clarifier records what the person said they would provide later as
  `provides` on the Brief: a key, what it is, which tasks need it, and a mode the person chooses on the Brief page —
  **wait** (default) or **placeholder**. At approval each task that needs a material carries its key. In *wait* mode,
  when such a task becomes ready, **Foundry raises the Request itself**, from the Brief's words, without spending a
  worker session; the task starts when the material arrives. In *placeholder* mode the worker is told to build with a
  stand-in and keep the swap trivial; when the material arrives Foundry adds a swap-in task (`origin:
  'material-swap'`) after the tasks that used the placeholder.
- **Answers: provide, proceed without, skip.** *Provide* takes words, files and links; the files go through the
  staged uploads and become **attachments of the goal, marked with the Request** (every later session sees them; other
  tasks may need them too). *Proceed without* carries a note. *Skip the task* is the existing skip. A worker's Request
  is answered **into the same session**: the attempt is continued with a message naming what the person gave (paths
  and words) or that there is nothing; a refused resume falls back to a fresh attempt with the answer as its hint. A
  Foundry-raised Request simply lets the task start. Answers come from the Inbox card (text box, upload, links), from
  the goal page's *You will provide* card (dropping files on an item's slot receives the material and closes its
  Request), from a chat reply in words (ADR-0038), and — in ADR-0075 — from the Conversation.
- **Unprompted uploads while the goal runs** tell the tasks: an attachment added to a running goal appends a line to
  the hint of every pending or ready task, and a running attempt learns of it at its next continuation.
- **Bounds.** Waiting for the person does not count against the goal's time budget; a Request has no timeout; a task
  has at most one open Request; only workers (and Foundry, for materials) raise one — reviewers, QA and the Explainer
  do not. Chat bots carry the words of an answer; files come through the web for now.

## Consequences

- The closed enum of triggers grows to seven, and CONTEXT.md's promise ("nothing else interrupts the user") still
  holds: a Request is raised only by a worker that was told when it may, or by Foundry for a material the person
  promised.
- A worker's role text changes: *you cannot ask* becomes *you ask only for what only the person can give*. The
  prompts gain a *You will provide* section; the Brief, a `provides` list; the task, a `needs` list.
- The Continuation path, until now used only for cut sessions, carries an answer. The attempt's continue reason
  records `needs_input` so the Timeline shows a wait for the person, not a failure.
- Materials make Clarify ask one more thing of the person — which mode — on the Brief page, where the other decisions
  are made.

## Alternatives considered

- **A tool the worker calls and waits on (an MCP `ask_person`)**: the fullest context, but a process held open for
  hours, a concurrency slot taken, and a restart that loses it. The block-and-continue keeps the context through the
  session resume without holding a process.
- **A fresh attempt with the answer as a hint, always**: the simplest, and what every other answer does today; it
  throws away what the worker had worked out. Kept as the fallback when a resume is refused.
- **Task-level attachments**: more precise, but a second store and a second way of showing files; the goal's
  attachments already reach every session, and a material is seldom for one task only.
- **Letting the worker try first even for a promised material in wait mode**: it would do the parts that need no
  material, but spend a session and then stop; the person chose the mode, and *placeholder* is there for that.
