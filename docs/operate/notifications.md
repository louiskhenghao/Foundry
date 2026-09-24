# Notifications: Telegram and Discord

Foundry can send a short message to Telegram, Discord or both when something happens that you want to know about
away from the keyboard. You set it up once in **Settings → Notifications**. This page covers the setup. What each
kind of message means for the person running goals is in [docs/guide/settings.md](../guide/settings.md).

- Every enabled kind of message goes to every configured channel.
- Leave a channel's fields empty to keep that channel off.
- The credentials are stored only in your own `data/settings.json`.
- The engine sends the messages, never the model.

---

## Telegram

You need a **bot token** (who sends the message) and a **chat id** (where it lands).

### 1. Create a bot and copy its token

In Telegram, open a chat with [**@BotFather**](https://t.me/BotFather), Telegram's official bot for making bots.

1. Send `/newbot`.
2. Give it a display name (anything, for example *My Foundry*), then a username that ends in `bot`
   (for example `my_foundry_bot`).
3. BotFather replies with *"Use this token to access the HTTP API:"* and a token such as
   `123456789:AAExampleTokenStringHereDontShare`. Copy it.

Paste the token into **Settings → Notifications → Telegram bot token**.

### 2. Message your bot, then let Foundry find the chat id

Telegram does not show the numeric chat id anywhere. Foundry reads it back once you have messaged the bot:

1. Open your new bot in Telegram (the `t.me/<your_bot>` link from BotFather) and send it **any** message, for example
   `hi`. A bot cannot message you until you have messaged it first.
2. In Settings, press **Detect** next to *Telegram chat id*. Foundry calls Telegram's `getUpdates` with the token in the
   field and fills in the chat that last messaged the bot. If it says *no messages yet*, send the bot a message and
   press **Detect** again.

**Detect** only fills the field. Press **Save** to keep it.

> **A group chat instead of a private one?** Add the bot to the group. Send a message in the group that mentions the
> bot, or make the bot an admin so it sees all messages. Then press **Detect**. A group's chat id is negative (for
> example `-1001234567890`). That is normal.

### 3. Save and test

Press **Save**, then **Send test message**. Telegram should show *"👋 Foundry test notification — this channel
works."* within a second. The result is shown per channel. If it failed, you see why: a wrong token gives `401`.

---

## Discord

Discord uses a **webhook**: a URL that posts messages into one channel. There is no bot to create.

### 1. Create a webhook in your channel

You need the *Manage Webhooks* permission on the server. You have it on a server you own.

1. In Discord, hover the channel you want the messages in and click the gear (**Edit Channel**).
2. Open **Integrations → Webhooks → New Webhook**.
3. Name it (for example *Foundry*), optionally pick an avatar, then **Copy Webhook URL**. It looks like
   `https://discord.com/api/webhooks/123456789/AbC-ExampleWebhookToken`.

### 2. Paste, save, test

Paste it into **Settings → Notifications → Discord webhook URL**, press **Save**, then **Send test message**. The test
line appears in that Discord channel.

Treat the webhook URL like a password: anyone who has it can post to that channel. To revoke it, delete the webhook in
the same Discord dialog.

---

## Link base URL

When **Link base URL** is set, most messages end with a link to the right page: the Inbox for *Needs you*, the goal for
*Interview round*, *Goal finished* and most *Delivery* messages, the Usage page for *Usage pause*, and Settings for
*New version*. A message about an opened pull request carries the pull request's own URL instead.

Set it to wherever the UI is reachable **from your phone**:

- Foundry runs on your own machine and you read the messages there: leave it empty. A `127.0.0.1` link would not open
  on a phone anyway.
- You reach Foundry remotely: use the address from [remote-access.md](./remote-access.md), for example a Tailscale
  `https://mac-mini.<tailnet>.ts.net`. Include the scheme (`https://…`): the field needs a full URL.

Empty means messages carry no link.

---

## The switches

Below the channels are six switches, one per kind of message. All are on by default. Turn off the ones you do not
want.

| Switch | Settings key | Sends a message when |
|---|---|---|
| **Needs you** | `notifications.onEscalation` | a goal is blocked until you answer (also a milestone's *Have a look*) |
| **Interview round** | `notifications.onInterview` | the Clarifier asks a round of questions before writing the Brief |
| **Goal finished** | `notifications.onGoalFinished` | a goal ends done, over-delivered or failed (never when you cancel it) |
| **Delivery** | `notifications.onDelivery` | a pull request is opened or merged, or a delivery fails |
| **Usage pause** | `notifications.onRateLimit` | a Claude usage limit pauses the engine, and when the pause lifts |
| **New version** | `notifications.onUpdateAvailable` | a newer Foundry release is out (once per version) |

What each of these means for someone running goals, and what to do about it, is in
[docs/guide/settings.md](../guide/settings.md).

On Telegram, a milestone's *Have a look* message comes with the self-check's latest screenshot when there is one.

---

## Setting it from the environment

You can seed the channel fields from environment variables, for example with `-e` in Docker. A value saved in the UI
wins over the variable.

| Variable | Settings field |
|---|---|
| `FOUNDRY_TELEGRAM_BOT_TOKEN` | Telegram bot token |
| `FOUNDRY_TELEGRAM_CHAT_ID` | Telegram chat id |
| `FOUNDRY_DISCORD_WEBHOOK` | Discord webhook URL |
| `FOUNDRY_NOTIFY_BASE_URL` | Link base URL |

The six switches have no environment variables. Set them in the UI. The full list of variables is in
[configuration.md](./configuration.md).

---

## How sending behaves

- **Best effort.** A failed send is retried twice (after 2 and 10 seconds). Then it is dropped and noted as
  `notification via <channel> failed after 3 tries: …`. Nothing is queued or re-sent after a restart. A dead channel
  never blocks a goal.
- **Immediate.** Settings are read at send time. A new token or switch applies to the very next message, without a
  restart.
- **Plain text**, cut to 1,900 characters to stay under Telegram's and Discord's limits.
- **Send test message** uses the values currently in the fields, saved or not.
- The doctor (**Setup** page) shows *Notifications (optional)* in amber until at least one channel is configured.

---

## Troubleshooting

| What you see | Why | Fix |
|---|---|---|
| Test says `telegram 401` | wrong or revoked bot token | copy the token from @BotFather again, without spaces |
| Test says `telegram 400: … chat not found` | wrong chat id, or you never messaged the bot | message the bot, press **Detect** again, **Save** |
| **Detect** says *no messages yet* | the bot has not received a message from you | open the bot, send it anything, **Detect** again |
| Test says `discord 401` or `discord 404` | webhook URL wrong or deleted | create the webhook again, copy the full URL, **Save** |
| Test says *no channel configured* | neither a token and chat id nor a webhook URL is filled in | fill in one channel |
| Test works but later messages never arrive | the switch for that kind is off, or the channel was never saved | check the six switches; check the fields show a green *saved* badge |
| Messages arrive but have no link, or the link does not open | Link base URL is empty or points at `127.0.0.1` | set it to an address your phone can reach ([remote-access.md](./remote-access.md)) |
| An engine note says *notification via telegram failed after 3 tries: …* | the channel was unreachable or rejected the message | check the error text; run **Send test message** |
