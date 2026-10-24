# ADR-0073: A Conversation about a goal — a read-only Explainer on the goal's page answers questions from its code and Foundry's records, and never acts

**Status:** accepted · 2026-10-23 · amends ADR-0072; builds on [ADR-0011](0011-progress-folders-next-to-the-repo.md), [ADR-0016](0016-mcp-servers-allowed-per-server.md) and [ADR-0061](0061-access-tokens.md)

## Context

A goal's page tells what happened: the Brief, the tasks, their attempts and reviews, the timeline, the diff, the
delivery. It does not answer *why*. Why does this task wait for that one? Where did the worker put the validation,
and why there? What did the reviewer object to in the second attempt? What would a decision on the Brief have
changed? Today the person opens the live log, reads a transcript, greps the repository, or starts a session of their
own in the folder — which knows nothing of the goal: not the Brief, not the Decisions, not what each attempt
reported. The question is about the goal; the tools that could answer it are elsewhere.

The person asked for a conversation on the goal's page, like a coding-agent session: ask, and the agent reads the
goal's repository and the goal's own data to answer. Twenty-seven decisions were settled in a design interview; the
ones that shape the system are recorded here. The feature ships as a **beta**: Foundry had no beta mechanism, and
this is the first thing to need one.

Foundry's rules bound the design. A session must not spoil the goal: the progress folder is the goal's worktree, with
a shared hooks file and a worker about to commit in it, so a shell that writes there, even `git stash`, breaks the
goal (ADR-0011). Sessions are the goal's coding agent, on the preset's model rows (ADR-0014, ADR-0018), with MCP servers
allowed per server (ADR-0016). The Budget is a promise about the goal's work; a conversation is the person's own
spending. Concurrency slots exist so goals do not starve each other, and a lane for sessions a person waits for (ADR-0046). Who did what is known only with
Access on (ADR-0061).

## Decision

- **A Conversation is a thread of questions and answers kept on the goal**, as events (`conversation.started`,
  `conversation.asked`, `conversation.answered`) projected into a `conversations` table. A goal may have several;
  only the newest goes on, the earlier ones are read. It is titled by its first question. Everyone who opens the
  goal sees the same Conversations, with who asked when Access is on. It is open in every state of the goal, running
  or finished, failed, delivered, cancelled.
- **The Explainer is a role of its own** (`roles/explainer.md`) on the goal's coding agent, with a row of its own in
  the model presets (`explainer`, labelled *Conversation*): Production takes Opus, Balanced and Economy Sonnet, as
  the Suggestion row does; a saved preset without the row takes its Suggestion row when read (`withExplainerRow`),
  so nobody's custom preset breaks. Codex presets carry the row with effort `medium` on Production. The Explainer
  reads and explains; it never changes the repository, the goal or Foundry. Asked to change something, it says
  where in Foundry that is done and drafts the words — a Note on the Brief, a hint in the Inbox, a Follow-up goal —
  and offers no button, since a button would make the Conversation a second control surface for the goal.
- **It runs in a detached read-only worktree of its own**, `.foundry/<goal>/conversation`, never in the progress
  folder: brought to the goal branch's tip before every answer (`reset --hard`, `clean` keeping the records,
  `checkout --detach`), so the same folder serves the resumed session turn after turn. Once the goal's branch is
  merged and tidied, the base branch stands in, since it holds the goal's commits (the `Goal:` trailer finds them).
  Without a repository on this computer there is no code to read, and the records alone go into
  `<data>/conversations/<goal>/`. The worktree is removed with the goal, after the delivery's cleanup, and after a day
  without a question.
- **Its shell is kept to reading by a hook, not by prompt.** The read-only tool set, plus Bash allowed only through
  `hooks/readonly-bash.ts`: a judgement of each command against an allowlist of readers, git's read-only subcommands
  (and the read-only forms of `branch`, `tag`, `stash`, `worktree`, `remote`, `reflog`, `config`, `notes`), with
  redirections, substitutions, `sed -i` and `find -exec` refused; a refusal exits 2 with a message the model reads
  (`READ_ONLY_SHELL_MESSAGE`). The agy guard applies the same judgement under a `readOnlyShell` policy; Codex runs in
  its read-only sandbox. No tests, no builds, no installs. MCP servers Allowed in goals are offered, and the web.
- **Foundry's records travel beside the code**: before each answer, `.foundry-goal/` in the worktree (git-excluded)
  is rewritten — `README.md`, `goal.md`, `brief.md` with the Decisions, `tasks/<id>.md` with each attempt's report
  and review, `timeline.md`, `escalations.md`, `review.md`, `delivery.md`, `attachments.md`, `learnings.md`, and a
  short rendering of every transcript. The prompt carries the goal in short as well. A later turn carries only the
  delta: what happened to the goal since the last answer.
- **One session per Conversation, resumed for each question.** A refused resume starts a fresh session with the
  conversation so far. Questions sent while one is being answered queue within their Conversation, in order. The
  answer streams: Claude and agy by token (`--include-partial-messages`, a `text_delta` event), Codex by message,
  with the latest tool call as an activity line; **Stop** keeps what was said. An answer has 50 turns, $3 and
  8 minutes; one cut by a limit says so and keeps what it had.
- **A question can carry pictures and files.** They go through the same staged uploads as a goal's attachments and
  are claimed into the goal's attachments folder (so one id space and one route serve both), kept on the
  `conversation.asked` event, and copied under the records (`.foundry-goal/asked/<question>/`) before each answer, with
  a ready markdown rendition beside them; the prompt names them and tells the Explainer to open them. Up to eight a
  question; a question that is only its files reads "See the attached files."
- **Lane `aside`.** The Explainer takes no concurrency slot and waits for none; the goal's work is never held up by a
  question, and a question never waits behind the work. Conversation events do not tick the goal's scheduler.
- **Cost on the goal, outside the Budget.** Each answer is booked as `goal.cost_added` with `source: 'conversation'`
  and summed in `conversationCostUsd`; the goal's total includes it (the cost shows the split on hover), while the
  Budget bar and the overspend check leave it out. The usage ledger records kind `conversation`, so Usage and Reports
  show it as its own kind. A Conversation is refused during a Usage Pause.
- **With Memory on (ADR-0072), the Explainer gets the bank's name and the hindsight tools** — recall, reflect, the
  knowledge pages — to answer questions that reach beyond this goal, on demand, with no per-turn recall. ADR-0072
  gave Memory's MCP tools to workers only; this amends it: a read-only role may have them too, since they read.
- **In the web app**: a bubble at the bottom right of the goal page and the Brief page opens the newest Conversation
  in a window beside the page (a popover, not a modal; a full sheet on a phone), pulsing in the colour of work while an
  answer is written, with a dot for an answer that came while it was closed; its open state is kept per goal in the
  browser. A **Conversation** tab (Expert view) lists every Conversation, newest first. No selection on the page is
  sent along: the question is the whole context. Conversation events are hidden from the Activity tab's default view,
  the Timeline and the Agents page.
- **In the CLI**: `foundry ask <goalId> "question"` asks and prints the answer as it is written over the live feed,
  then how it ended and what it cost; `--new` starts a new Conversation. The feed's address takes the Access token as
  `?token=`, since a WebSocket cannot carry the bearer header.
- **Beta**: a **Beta** section in Settings with the switch `beta.conversation`, off by default. Off, the API answers
  `409`, the bubble and the tab are not shown, and the Conversations already had are kept.

## Consequences

- A person reads the goal's story in their own words, with the code and the records in one place, without a
  session of their own and without the risk of one. The answer costs what a short session costs, on the goal.
- A new worktree per goal with Conversations, under `.foundry/`, and a records folder rewritten before each answer:
  cheap for the goal's size, visible in `git worktree list` of the repository, removed with the goal.
- The read-only shell is an allowlist: a reader not on it is refused, and the Explainer is told to say so rather than
  work around it. New readers are added to the hook, with its tests.
- `goal.cost_added` carries two meanings now (work and conversation); the Budget's arithmetic reads
  `conversationCostUsd`, so every place that compares cost with Budget goes through `budgetStatus`.
- A thirteenth preset row: the preset table's shape changed, read through a preprocess so old saved presets keep
  working; the Settings panels show it.
- Beta is now a mechanism: a settings section, a chip, and the expectation that a beta feature may change or go
  away; the guide says so.

## Alternatives considered

- **Resume the goal's own sessions** (a worker's, the reviewer's) to ask them: they know the most, but they live in
  the progress folder and the task worktrees, are written for one job, and a question would compete with the work.
- **Run the Explainer in the progress folder, read-only by prompt**: the goal's worktree is the one place a stray
  write spoils the goal; a prompt is not a boundary (ADR-0003).
- **Answer from the records alone, no code**: half the questions are about where things are and how they work; the
  records say what was reported, the code says what is.
- **Count the Conversation against the Budget**: the Budget bounds the goal's work; a person's questions would eat
  into it and raise escalations the goal did not earn.
- **A notification when an answer comes**: an answer arrives within minutes while the person is on the page; the
  bubble's dot suffices, and the Inbox stays for what needs a decision.
- **Buttons on the answer (apply this hint, add this Note)**: a second way to act on the goal, in a window meant for
  reading; the Explainer drafts the words, and the person acts where Foundry already offers it.
- **A shared Conversation across goals, or one per person**: the question is about one goal, and the answer helps
  whoever opens it; what Access knows is who asked.
