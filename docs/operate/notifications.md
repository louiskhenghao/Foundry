# Notifications: Telegram and Discord

Foundry can send a short message to Telegram, Discord or both when something happens that you want to know about
away from the keyboard. You set it up once in **Settings → Notifications**. This page covers the setup. What each
kind of message means for the person running goals is in [docs/guide/settings.md](../guide/settings.md).

- Every enabled kind of message goes to every configured channel.
- Leave a channel's fields empty to keep that channel off.
- The credentials are stored in `settings.json` under your instance’s data directory (`data/`, `data-codex/` or `FOUNDRY_DATA_DIR`).
- The engine sends the messages, never the model.
- Telegram also takes answers: a message about something that waits for you carries buttons, and a reply answers it
  in words. See [Answering from Telegram](#answering-from-telegram). Discord does too with a bot of yours beside the
  webhook: see [Answering from Discord](#answering-from-discord).

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

Discord uses a **webhook**: a URL that posts messages into one channel. That is all one-way messages need. For buttons
that answer, add a bot as well (step 3).

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

### 3. Optional: a bot for buttons

A webhook can post but not listen, so buttons that answer need a bot. It posts the messages that wait for you in the
webhook's channel, and Foundry reads the presses over Discord's gateway (a connection Foundry opens; nothing on your
computer is reachable from the internet).

1. Open the [Discord Developer Portal](https://discord.com/developers/applications) and press **New Application**.
   Name it, for example *Foundry*.
2. Open **Bot**, press **Reset Token** and copy the token. No privileged intents are needed: leave *Message Content
   Intent* off.
3. Open **OAuth2 → URL Generator**. Tick the scopes **bot** and **applications.commands**, and the bot permissions
   **View Channels**, **Send Messages** and **Read Message History**. Open the generated URL and add the bot to the
   server that holds the webhook's channel.
4. Paste the token into **Settings → Notifications → Discord bot token (buttons)**, press **Save**, then **Send test
   message**. The result shows *discord bot: ✓ sent* when the bot can post in that channel.

Treat the bot token like a password. To revoke it, press **Reset Token** again.

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

Below the channels are **Answer from Telegram** (see [Answering from Telegram](#answering-from-telegram)) and seven
switches, one per kind of message. All are on by default. Turn off the ones you do not want.

| Switch | Settings key | Sends a message when |
|---|---|---|
| **Needs you** | `notifications.onEscalation` | a goal is blocked until you answer (also a milestone's *Have a look*) |
| **Interview round** | `notifications.onInterview` | the Clarifier asks a round of questions before writing the Brief |
| **Brief ready** | `notifications.onBriefReady` | a Brief waits for your approval (never one the engine approves itself: an automatic Brief, or a delegated goal's Brief its main goal approves) |
| **Goal finished** | `notifications.onGoalFinished` | a goal ends done, over-delivered or failed (never when you cancel it) |
| **Delivery** | `notifications.onDelivery` | a pull request is opened or merged, or a delivery fails (a stack of pull requests is told together, see below) |
| **Usage pause** | `notifications.onRateLimit` | a backend’s usage limit pauses its new sessions, and when retrying resumes; other backends can continue |
| **New version** | `notifications.onUpdateAvailable` | a newer Foundry release is out (once per version) |

What each of these means for someone running goals, and what to do about it, is in
[docs/guide/settings.md](../guide/settings.md).

A stacked delivery (one pull request per task) does not send a message per pull request. When it builds a stack of two or more, the channels get *Opening N pull requests* with their titles, then one *N pull requests opened* message listing each with its link once all are open (or after 15 minutes, or when the delivery ends, with the ones open by then). Merges are gathered the same way and sent once none has come for two minutes: *3 pull requests merged* with their numbers. A delivery with one pull request keeps its usual messages.

A milestone sends two messages: *Have a look* (or *Milestone* when the goal does not pause for it) at once, then *What the milestone looks like* with the screenshots and the video of the walkthrough Foundry recorded in the preview. Telegram gets them as an album (photos up to 10 MB, a video up to 50 MB); Discord as attachments of the webhook message (10 MB together). A file over the limit is left out and the message says it is on the goal page. A picture Telegram will not take as a photo (too many pixels, an odd shape) is sent again as a file, which has no such limits; only when Telegram refuses that too does the text go alone, saying the files could not be attached. Without a recording, the self-check's latest screenshot is attached when there is one. When screenshots of error pages were left out of the walkthrough, or no walkthrough could be planned, a ⚠️ line says so. The *Needs you* switch covers both.

---

## Answering from Telegram

With **Answer from Telegram** on (the default) and a Telegram bot set up, a message about something that waits for you
is answered where you read it. Foundry reads your bot's messages for this with Telegram's long polling, so nothing has
to reach your computer from the internet.

| Message | Buttons | A reply in words |
|---|---|---|
| **Needs you**: a task ran out of attempts, or a tool was refused | **Retry**, **Retry with hint…**, **Skip task**, **Abort goal…** | retries the task with your words as its hint |
| **Needs you**: the final review failed | **Fix and review again**, **Retry with hint…**, **Accept as-is**, **Abort goal…** | the fix tasks carry your words |
| **Needs you**: the budget ran out | **Raise budget ×2**, **Abort goal…** | — |
| **Needs you**: a command outside the workspace | **Deny** | — |
| **Have a look** (a milestone) | **Continue**, **Give feedback…** | Foundry says what it makes of it, then you **Apply** or **Drop** that |
| **Needs you**: the delivery stopped | **Retry delivery**, **Mark as delivered…** | — |
| **Interview round** | one message per question with its options, then **Accept all recommended**, **Send answers**, **Enough — write the Brief** | a reply to a question is your own answer |
| **Brief ready** | **Approve and run…** | — |
| **Usage pause** | **Resume now** | — |

- The buttons give the Inbox's, the interview's and the Brief page's own answers. The same checks apply, and what
  Foundry refuses is shown as an alert under the button.
- A button ending in … asks before it acts. **Abort goal…** and **Mark as delivered…** ask you to confirm. **Approve
  and run…** says the budget it sets: for an Auto goal, the estimate ×2, as on the Brief page. **Retry with hint…**
  and **Give feedback…** ask you to reply with your words.
- A command outside the workspace is approved in the Inbox only. From a chat it can be denied, never run.
- Once something is answered, here or in Foundry, its buttons turn into one line saying what happened, for example
  **✓ Skipped · 14:02**.
- The goal's activity records each answer and who gave it, for example *Skipped from Telegram by @ann*.
- Send **/inbox** to get everything that waits for you again, with its buttons. Any other message gets a short help.
- Only the chat in **Telegram chat id** is answered. In a group, anyone in it can press the buttons: use a private
  chat with your bot when others are in the group.
- Give each Foundry its own bot. Telegram hands a bot's messages to one reader at a time, so two instances on one bot
  take turns and lose each other's presses. Make a second bot with @BotFather for a second instance, or turn **Answer
  from Telegram** off on one of them.
- While Foundry reads the bot, **Detect** asks Foundry, not Telegram, which chat wrote last: send the bot a message,
  then press **Detect**.

## Answering from Discord

With a **Discord bot token** beside the webhook, the messages in the table above are posted by your bot in the
webhook's channel, with the same buttons. The other messages still come from the webhook.

- A button that asks for words (**Retry with hint…**, **Give feedback…**, **✍️ My own answer…**) opens a form over the
  chat: type, then **Submit**. There is no reply in words in Discord: Foundry reads no message text.
- What a press did is shown only to the person who pressed, under the message; the buttons turn into one grey line
  saying what happened, for everyone.
- **/inbox** is a command of the bot: it sends again everything that waits for you.
- Only presses in the webhook's channel are answered. Anyone who can see that channel can press the buttons.
- A command outside the workspace is approved in the Inbox only, as on Telegram.
- Without the bot token, Discord messages carry the same text and links, without buttons.

---

## Setting it from the environment

You can seed the channel fields from environment variables, for example with `-e` in Docker. A value saved in the UI
wins over the variable.

| Variable | Settings field |
|---|---|
| `FOUNDRY_TELEGRAM_BOT_TOKEN` | Telegram bot token |
| `FOUNDRY_TELEGRAM_CHAT_ID` | Telegram chat id |
| `FOUNDRY_DISCORD_WEBHOOK` | Discord webhook URL |
| `FOUNDRY_DISCORD_BOT_TOKEN` | Discord bot token (buttons) |
| `FOUNDRY_NOTIFY_BASE_URL` | Link base URL |
| `FOUNDRY_TAILSCALE` | Tailscale links (`auto` or `off`) |
| `FOUNDRY_TAILSCALE_HOST` | Tailscale name |

**Answer from Telegram** and the seven switches have no environment variables. Set them in the UI. The full list of variables is in
[configuration.md](./configuration.md).

---

## How sending behaves

- **Best effort.** A failed send is retried twice (after 2 and 10 seconds). Then it is dropped and noted as
  `notification via <channel> failed after 3 tries: …`. Nothing is queued or re-sent after a restart. A dead channel
  never blocks a goal.
- **Answers are fetched, not pushed.** With **Answer from Telegram** on, Foundry keeps one request to Telegram open
  (about a minute each, then the next) to receive presses and replies. Nothing listens on your computer, and nothing
  runs while Foundry is stopped: a press made then is acted on when it starts, if Telegram still holds it (a day).
- **Immediate.** Settings are read at send time. A new token or switch applies to the very next message, without a
  restart.
- **Plain text**, cut to 1,900 characters to stay under Telegram's and Discord's limits.
- **No pings.** A Discord message mentions no one: an `@everyone`, `@here` or user mention in a goal's title, a file
  name or a model's words is shown as text and notifies nobody.
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
| The buttons spin, then nothing happens | Foundry is not reading the bot: **Answer from Telegram** is off, Foundry is stopped, or another reader holds the bot | turn the switch on, start Foundry, and check the notes below |
| An engine note says *Telegram buttons wait: something else reads this bot's updates* | another Foundry, or another program, uses the same bot | give each Foundry its own bot, or turn **Answer from Telegram** off on the other one |
| An engine note says *this bot sends its updates to a webhook* | the bot was set up with a webhook elsewhere | remove it (open `https://api.telegram.org/bot<token>/deleteWebhook`), or give Foundry a bot of its own |
| A press says *Foundry answers only the chat set in its Settings* | the button was pressed in another chat than **Telegram chat id** | press it in that chat, or **Detect** the other chat and **Save** |
| Test says `discord bot: … discord 403` | the bot is not on the server, or cannot see or post in the webhook's channel | add it with the URL from step 3, and give it View Channels and Send Messages there |
| An engine note says *Discord buttons are off: Discord refused the bot token* | the token is wrong or was reset | copy a new one (**Bot → Reset Token**), paste it, **Save** |
| A Discord button says *This interaction failed* | Foundry is stopped, or was not connected when you pressed | start Foundry; press again once it runs |
