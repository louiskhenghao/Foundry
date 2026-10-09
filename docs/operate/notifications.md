# Notifications: Telegram and Discord

Foundry can send a short message to Telegram, Discord or both when something happens that you want to know about
away from the keyboard. You set it up once in **Settings → Notifications**. This page covers the setup. What each
kind of message means for the person running goals is in [docs/guide/settings.md](../guide/settings.md).

- Every enabled kind of message goes to every configured channel.
- Leave a channel's fields empty to keep that channel off.
- The credentials are stored in `settings.json` under your instance’s data directory (`data/`, `data-codex/` or `FOUNDRY_DATA_DIR`).
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

## Links

Every message that is about a page ends with links to it, sent as links (Telegram HTML, Discord masked links), since
the apps do not turn `localhost` addresses into links on their own: the Inbox for *Needs you*, the goal for *Interview
round*, *Goal finished*, milestones and most *Delivery* messages, the Usage page for *Usage pause*, and Settings for
*New version*. A message about an opened pull request carries the pull request's own URL too. A channel that refuses a
link gets the address written out instead.

A message's first line is its title and reads bold (Telegram HTML, Discord Markdown). Telegram drops a link to an
address only this computer can open (`localhost`, `127.0.0.1`, a bare host name) and leaves its label as plain text, so
such an address is written out as code instead: a tap copies it. For a link you can tap on your phone, set **Link base
URL** or use Tailscale.

- **Open in Foundry**: **Link base URL** plus the page, or `http://localhost:<port>` when it is empty. Set it when you
  reach Foundry at another address (a LAN address, a domain), scheme included.
- **Open on your tailnet**: added when Tailscale runs on this computer (**Tailscale links** = auto, the default). It is
  the HTTPS address `tailscale serve` gives Foundry's port: the one you already serve (see
  [remote-access.md](./remote-access.md)), or one Foundry adds (`tailscale serve --bg --https=<port>`). **Tailscale
  name** sets the machine's name when `tailscale status` should not be asked.
- A milestone also links to its preview, here and on the tailnet: Foundry serves each running preview's port the same
  way and takes it down when the preview stops. Ports you serve yourself are never taken down.

**Tailscale links** = off: no tailnet links, and Foundry never runs `tailscale serve`.

---

## The switches

Below the channels are six switches, one per kind of message. All are on by default. Turn off the ones you do not
want.

| Switch | Settings key | Sends a message when |
|---|---|---|
| **Needs you** | `notifications.onEscalation` | a goal is blocked until you answer (also a milestone's *Have a look*) |
| **Interview round** | `notifications.onInterview` | the Clarifier asks a round of questions before writing the Brief |
| **Goal finished** | `notifications.onGoalFinished` | a goal ends done, over-delivered or failed (never when you cancel it) |
| **Delivery** | `notifications.onDelivery` | a pull request is opened or merged, or a delivery fails (a stack of pull requests is told together, see below) |
| **Usage pause** | `notifications.onRateLimit` | a backend’s usage limit pauses its new sessions, and when retrying resumes; other backends can continue |
| **New version** | `notifications.onUpdateAvailable` | a newer Foundry release is out (once per version) |

What each of these means for someone running goals, and what to do about it, is in
[docs/guide/settings.md](../guide/settings.md).

A stacked delivery (one pull request per task) does not send a message per pull request. When it builds a stack of two or more, the channels get *Opening N pull requests* with their titles, then one *N pull requests opened* message listing each with its link once all are open (or after 15 minutes, or when the delivery ends, with the ones open by then). Merges are gathered the same way and sent once none has come for two minutes: *3 pull requests merged* with their numbers. A delivery with one pull request keeps its usual messages.

A milestone sends two messages: *Have a look* (or *Milestone* when the goal does not pause for it) at once, then *What the milestone looks like* with the screenshots and the video of the walkthrough Foundry recorded in the preview. Telegram gets them as an album (photos up to 10 MB, a video up to 50 MB); Discord as attachments of the webhook message (10 MB together). A file over the limit is left out and the message says it is on the goal page. Without a recording, the self-check's latest screenshot is attached when there is one. When screenshots of error pages were left out of the walkthrough, or no walkthrough could be planned, a ⚠️ line says so. The *Needs you* switch covers both.

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
| `FOUNDRY_TAILSCALE` | Tailscale links (`auto` or `off`) |
| `FOUNDRY_TAILSCALE_HOST` | Tailscale name |

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
| The links open nothing on your phone | no tailnet link (Tailscale not running here, or Tailscale links off) and the Link base URL is empty | start Tailscale here, or set Link base URL to an address your phone can reach ([remote-access.md](./remote-access.md)) |
| An engine note says *notification via telegram failed after 3 tries: …* | the channel was unreachable or rejected the message | check the error text; run **Send test message** |
