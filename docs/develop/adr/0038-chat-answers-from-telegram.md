# ADR-0038: Telegram takes answers — buttons and replies go through the app's own calls, and boundary commands stay in the Inbox

**Status:** accepted · 2026-10-18 · amends ADR-0003 · amended by [ADR-0039](0039-chat-answers-from-discord.md) (Discord through a bot)

## Context

Notifications told the person that something waited for them — a task out of attempts, a milestone to look at, an
interview round, a stopped delivery — and linked to the page where they could answer. Away from the computer, that
meant opening Foundry on a phone over the tailnet for a one-tap decision such as Retry, Continue or Send answers. A
Brief waiting for approval sent nothing at all. Telegram bots can put buttons under a message and receive the presses
and replies, which makes most of these decisions possible where the message is read.

## Decision

- A Notification about something that waits for the person carries buttons on Telegram, and a reply to it answers in
  words: the Inbox's answers for an escalation, the interview's options and Accept all recommended / Send answers /
  Enough, Approve and run for a ready Brief, Resume now for a usage pause. A reply is a hint for a retry, milestone
  feedback (classified first and shown for Apply or Drop, as on the goal page), or an interview answer of one's own.
- Every answer goes through the engine call the app's own button makes, with the same checks; nothing new can be done
  from a chat. The goal's activity records each answer with who gave it.
- A command outside the workspace (a boundary action) is never approved from a chat; the chat can only deny it.
  Approving runs a shell command on the computer, and the chat's only proof of who pressed is membership of the chat.
  Resolving a merge by hand stays on its own page.
- Abort, Mark as delivered and Approve ask for confirmation, and Approve says the budget it sets (an Auto goal's
  estimate ×2, as the Brief page proposes).
- Foundry fetches the updates itself with Telegram's long polling: nothing on the person's computer is reachable from
  the internet, and nothing is read while Foundry is stopped. Only the configured chat is answered. Only the `serve`
  engine reads, and only with the new `notifications.telegramActions` switch on (the default).
- A "Brief ready" Notification is added, with its own switch (`notifications.onBriefReady`); a Brief the engine
  approves itself (an automatic Brief, a Delegated goal's whose main goal approves it) never notifies.
- Discord stays one-way: a webhook posts but does not listen. Buttons there need a bot and a gateway connection, a
  separate decision.

## Consequences

- One bot per Foundry instance: Telegram gives a bot's updates to one reader at a time, so two instances on one bot
  take turns and lose each other's presses. The conflict is noted once and the reader waits a minute between tries.
- Anyone in the configured chat can press the buttons. A group chat shares that power with its members; the guide says
  to use a private chat when others are in the group.
- Detect (Settings) cannot call `getUpdates` while Foundry reads the bot, so it asks the reader which chat wrote last.
- Picked interview answers and a feedback plan awaiting Apply are kept in the data directory (`notify/drafts.json`),
  and the messages the bot sent in `notify/telegram.json`, so a press after a restart still finds them.
