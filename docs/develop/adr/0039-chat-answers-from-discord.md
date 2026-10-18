# ADR-0039: Discord takes answers through a bot of the user's, read over the gateway

**Status:** accepted · 2026-10-18 · amends ADR-0038

## Context

ADR-0038 gave Telegram buttons and replies and left Discord one-way: a channel webhook created by a user can post, but
Discord lets only an application's own messages carry buttons that answer, and a webhook receives nothing. Discord
delivers a press either to a public HTTPS endpoint the application registers, or over the gateway, a WebSocket the
application opens. Foundry runs on the user's computer, usually without a public address.

## Decision

- Answers on Discord come through a bot the user creates and adds to the server, its token set beside the webhook
  (`notifications.discordBotToken`). With it, the messages that wait for the person are posted by the bot in the
  webhook's channel (read from the webhook itself) with the same buttons as on Telegram; the other messages still come
  from the webhook.
- Foundry reads presses over the gateway, with no intents: interactions arrive without any, and Foundry reads no
  message text. Nothing on the computer is reachable from the internet, and nothing is read while Foundry is stopped.
- Words (a hint, milestone feedback, an interview answer of one's own) are typed in a form (a modal) the button opens,
  since without message text there is no reply to read.
- What a press did is shown only to the person who pressed (an ephemeral message); the buttons themselves turn into a
  disabled line saying what happened, for everyone.
- `/inbox` is registered as the bot's command and sends again what waits.
- Only interactions in the webhook's channel are answered. Everything else is as ADR-0038 decided: the same engine
  calls, a command outside the workspace approved in the Inbox only, confirmation before Abort, Mark as delivered and
  Approve.
- Telegram and Discord share what is not about reading: sending the messages with their buttons, a round as one message
  per question, `/inbox`, keeping buttons current when an answer comes from elsewhere, and one store of drafts, so a
  round can be picked partly in one channel and sent from the other.

## Consequences

- Setting up buttons on Discord takes a Developer Portal application, a token and an invite; the webhook alone keeps
  working as before.
- Anyone who can see the channel can press the buttons, as with a Telegram group.
- Discord gives an interaction three seconds for its first answer: a slow press is acknowledged first and finished
  after; a press while Foundry is stopped shows Discord's own "This interaction failed".
