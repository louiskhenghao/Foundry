# ADR-0052: A goal from a GitHub issue — read once through gh, carried as an attachment, closed by the pull request

**Status:** accepted · 2026-10-20 · builds on ADR-0003

## Context

Most of the work people hand to Foundry already exists as a GitHub issue: a title, a description, labels, and a
thread of comments in which the real requirements were settled. Until now the person retyped or pasted the issue
into the New goal form, the comments stayed behind, and when the pull request merged the issue stayed open until
someone remembered it. The loop between the repository's issue tracker and Foundry was open at both ends.

Two things are already in place: `gh` is the one GitHub identity Foundry uses (ADR-0003), and a goal's Attachments
are the way to hand every session of a goal something that cannot be said in the prompt, with a markdown rendition
sessions read instead of fetching the web.

## Decision

- **An issue is read once, when the person asks for it**, from the New goal form (**From a GitHub issue**, then
  **Read issue**), the `?issue=` query of the form, or `goal new --issue`. The reference may be the issue's link,
  `owner/name#12`, or `#12` resolved through the chosen folder's GitHub remote. The read goes through `gh issue view`
  on the engine, with the account `gh` is logged in as; without `gh`, or logged out, the read refuses with the way
  to connect, and nothing else changes.
- **The thread is an Attachment**: a link to the issue whose markdown rendition, written by the engine from what
  `gh` returned (header, description, every comment with its author and date, capped at 400 KB with a pointer to
  the rest), is ready at once and travels with the goal like any upload. Every session is told it is the issue the
  goal was made from. The issue's title and body become the form's title and description, unless the person already
  wrote their own; those are kept, and the thread is attached anyway. The goal records the issue (`Goal.issue`:
  repository, number, link, title, state and labels at the time of the read) so pages can show where it came from.
- **The pull request closes the issue.** A delivery that opens a pull request puts `Closes #12` (or
  `Closes owner/name#12` when the pull request is in another repository) as the first line of the body; in a stack
  the last pull request carries it and the ones below say `Part of`. GitHub closes the issue when the pull request
  merges into the default branch. Foundry writes nothing to the issue itself: no comment when the goal starts, none
  when the pull request opens. The linked pull request shows in the issue's timeline on its own.
- The snapshot is what was read at that moment. Comments written after the read are not fetched again; the person
  reads the issue again from a new goal, or attaches the link as before.

## Consequences

- Reading an issue costs nothing beyond one `gh` call and runs before any session; a goal made from an issue is
  otherwise an ordinary goal, and a Follow-up of it carries the thread as it carries every attachment.
- An issue in a private repository reads only when the `gh` account can see it; the error says so.
- `Closes` keys off GitHub's rules: a pull request merged into a branch other than the default one does not close
  the issue, and GitHub, not Foundry, decides. The Delivery plan names the issue the pull request will close.
- Review comments on the pull request are the other half of the loop and a decision of their own (the next ADR).
