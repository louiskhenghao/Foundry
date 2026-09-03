# Notifications: Telegram and Discord
> [中文](./notifications.zh.md) · English

Foundry can ping you outside the app the moment something happens that you would want to know about while away
from the keyboard. You configure it once on **Settings → Notifications**; from then on the engine sends a short
message to Telegram and/or Discord whenever one of five things happens.

The five event families, each with its own on/off switch (all default on):

| Family | Fires when |
|---|---|
| **Needs you** | a goal is blocked and needs you — a Brief question, retries exhausted, a command that wants to leave the workspace, a budget hit, a denied tool |
| **Goal finished** | a goal ends *done*, *over-delivered* or *failed* (cancelling a goal yourself never notifies) |
| **Delivery** | a pull request is opened or merged, or a delivery fails |
| **Usage pause** | a Claude usage limit pauses the engine, and when the pause lifts |
| **New version** | a Foundry release newer than yours is out (once per version) |

You can enable Telegram, Discord, or both — every enabled family goes to every configured channel. Leave a
channel's fields empty to keep it off. Nothing is stored anywhere but your own `data/settings.json`, and the
engine — never the model — does the sending.

---

## Telegram

You need a **bot token** (who sends the message) and a **chat id** (where it lands). Both take about two minutes.

### 1. Create a bot and copy its token

In Telegram, open a chat with [**@BotFather**](https://t.me/BotFather) — Telegram's official bot for making bots.

1. Send `/newbot`.
2. Give it a display name (anything, e.g. *My Foundry*) and then a username ending in `bot` (e.g. `my_foundry_bot`).
3. BotFather replies with a line like *"Use this token to access the HTTP API:"* followed by a token such as
   `123456789:AAExampleTokenStringHereDontShare`. Copy it.

Paste the token into **Settings → Notifications → Telegram bot token**.

### 2. Message your bot, then let Foundry detect the chat id

The numeric chat id is not shown anywhere in Telegram — the trick is that once you message the bot, Foundry can
read it back:

1. Open your new bot in Telegram (tap the `t.me/<your_bot>` link BotFather gave you) and send it **any** message,
   e.g. `hi`. This is required — a bot cannot message you until you have messaged it first.
2. Back in Settings, press **Detect** next to *Telegram chat id*. Foundry calls Telegram's `getUpdates` and fills
   in the id of the chat that last messaged the bot. (If it says *no messages yet*, send the bot a message and
   press Detect again.)

### 3. Save and test

Press **Save**, then **Send test message**. You should get *"Foundry test notification — this channel works."*
in Telegram within a second. The result shows per channel, so if it failed you see why (a wrong token gives a
`401`).

> **Group chat instead of a private one?** Add the bot to the group, send a message in the group that mentions
> it (or make it an admin so it sees all messages), then press Detect — the chat id of a group is negative
> (e.g. `-1001234567890`), which is normal.

---

## Discord

Discord uses a **webhook** — a per-channel URL that posts messages into that channel. No bot to create.

### 1. Create a webhook in your channel

You need *Manage Webhooks* permission on the server (you have it on a server you own).

1. In Discord, hover the channel you want the alerts in → the gear (**Edit Channel**).
2. **Integrations → Webhooks → New Webhook**.
3. Name it (e.g. *Foundry*), optionally pick an avatar, then **Copy Webhook URL**. It looks like
   `https://discord.com/api/webhooks/123456789/AbC-ExampleWebhookToken`.

### 2. Paste, save, test

Paste it into **Settings → Notifications → Discord webhook URL**, press **Save**, then **Send test message**.
The test line appears in that Discord channel.

Treat the webhook URL like a password — anyone who has it can post to that channel. To revoke it, delete the
webhook in the same Discord dialog.

---

## Links back to the app (optional but worth it)

When you set **Link base URL**, every message carries a link straight to the relevant page — the Inbox for a
"needs you", the goal for a "finished", the Usage page for a pause. Set it to wherever the UI is reachable
*from your phone*:

- Running Foundry only on your own machine and reading it there: you can leave this empty (a `127.0.0.1` link
  would not open on a phone anyway).
- Reaching it remotely: use the address from the [remote-access guide](./remote-access.md), e.g. a Tailscale
  `https://mac-mini.<tailnet>.ts.net`. Include the scheme (`https://…`); the field wants a full URL.

Leave it empty and messages simply carry no link.

## Choosing what pings you

Under the two channels are the five switches. Turn off the families you do not care about — for example keep
**Needs you** and **Goal finished** on, and turn **Delivery** and **New version** off if they are noise to you.
A family with no enabled channel simply does nothing.

## Setting it from the environment

Every field can be seeded from an environment variable instead of the UI (handy for a Docker `-e` flag or a
one-off run); a value you later save in the UI takes precedence.

| Variable | Settings field |
|---|---|
| `FOUNDRY_TELEGRAM_BOT_TOKEN` | Telegram bot token |
| `FOUNDRY_TELEGRAM_CHAT_ID` | Telegram chat id |
| `FOUNDRY_DISCORD_WEBHOOK` | Discord webhook URL |
| `FOUNDRY_NOTIFY_BASE_URL` | Link base URL |

The per-family switches are UI/settings only.

## How it behaves

- **Fire-and-forget.** A notification is a hint, not a ledger: a failed send is retried twice, then noted and
  dropped — nothing is queued or replayed after a restart. A dead webhook never blocks a goal.
- **Immediate.** Settings are read at send time, so changing a token or a switch applies to the very next event —
  no restart.
- **Plain text**, trimmed to stay under Telegram's and Discord's length caps.

## Troubleshooting

| What you see | Why | Fix |
|---|---|---|
| Test says `telegram 401` | wrong or revoked bot token | re-copy the token from @BotFather; no spaces |
| Test says `telegram 400: chat not found` | wrong chat id, or you never messaged the bot | message the bot, press Detect again, Save |
| Detect says *no messages yet* | the bot has not received a message from you | open the bot, send it anything, Detect again |
| Test says `discord 401`/`404` | webhook URL wrong or deleted | recreate the webhook, copy the full URL, Save |
| Test works but no messages arrive later | the event's family is switched off, or that channel was cleared after the test | check the five switches; re-check the token/URL is saved (green *saved* badge) |
| Messages arrive but links do nothing | Link base URL empty or `127.0.0.1` | set it to the address your phone can reach ([remote access](./remote-access.md)) |
