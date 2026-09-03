# 通知：Telegram 与 Discord
> 中文 · [English](./notifications.md)

当有你离开键盘时也想第一时间知道的事情发生，Foundry 可以在应用之外主动提醒你。你只需在 **Settings → Notifications** 里配置一次；此后每当以下五类事件之一发生，引擎就会向 Telegram 和/或 Discord 发送一条简短消息。

五类事件家族，每一类都有独立的开关（默认全部开启）：

| 家族 | 触发时机 |
|---|---|
| **Needs you**（需要你介入） | 某个 goal 被卡住、需要你处理——一个 Brief 问题、重试次数用尽、某条命令想离开工作区、触及预算上限、某个工具被拒绝 |
| **Goal finished**（goal 结束） | 某个 goal 以 *done*、*over-delivered* 或 *failed* 结束（你自己取消 goal 永远不会触发通知） |
| **Delivery**（交付） | 一个 pull request 被打开或合并，或某次交付失败 |
| **Usage pause**（用量暂停） | Claude 的用量上限使引擎暂停，以及暂停解除时 |
| **New version**（新版本） | 有比你当前更新的 Foundry 版本发布（每个版本仅提醒一次） |

你可以只启用 Telegram、只启用 Discord，或两者都启用——每个启用的家族都会发往每个已配置的渠道。把某个渠道的字段留空即可让它保持关闭。除了你自己的 `data/settings.json`，任何地方都不会存储这些信息，而且负责发送的是引擎——绝不是模型。

---

## Telegram

你需要一个 **bot token**（决定由谁发送消息）和一个 **chat id**（决定消息发到哪里）。两者各花约两分钟即可搞定。

### 1. 创建一个 bot 并复制它的 token

在 Telegram 里，打开与 [**@BotFather**](https://t.me/BotFather) 的对话——它是 Telegram 官方用于创建 bot 的 bot。

1. 发送 `/newbot`。
2. 给它起一个显示名称（随意，例如 *My Foundry*），然后起一个以 `bot` 结尾的用户名（例如 `my_foundry_bot`）。
3. BotFather 会回复一行类似 *"Use this token to access the HTTP API:"* 的话，后面跟着一个形如
   `123456789:AAExampleTokenStringHereDontShare` 的 token。把它复制下来。

把这个 token 粘贴到 **Settings → Notifications** 的「Telegram bot token」字段。

### 2. 给你的 bot 发条消息，再让 Foundry 自动探测 chat id

数字形式的 chat id 在 Telegram 里任何地方都看不到——诀窍在于：只要你给这个 bot 发过消息，Foundry 就能把它读回来：

1. 在 Telegram 里打开你新建的 bot（点击 BotFather 给你的 `t.me/<your_bot>` 链接），给它发**任意**一条消息，
   例如 `hi`。这一步是必须的——在你先给 bot 发消息之前，bot 无法主动给你发消息。
2. 回到 Settings，点击 *Telegram chat id* 旁边的 **Detect**。Foundry 会调用 Telegram 的 `getUpdates`，并自动
   填入最近给 bot 发过消息的那个对话的 id。（如果提示 *no messages yet*，就给 bot 发条消息，再点一次 Detect。）

### 3. 保存并测试

点击 **Save**，然后点击 **Send test message**。你应当在一秒内于 Telegram 收到 *"Foundry test notification — this channel works."*。
结果会按渠道分别显示，因此如果失败，你能看到原因（token 错误会给出 `401`）。

> **想用群聊而不是私聊？** 把 bot 加进群，在群里发一条 @ 它的消息（或把它设为管理员，让它能看到所有消息），
> 然后点击 Detect——群的 chat id 是负数（例如 `-1001234567890`），这是正常的。

---

## Discord

Discord 使用 **webhook**——一个针对单个频道的 URL，会把消息发布到该频道。无需创建 bot。

### 1. 在你的频道里创建一个 webhook

你需要在该服务器上拥有 *Manage Webhooks* 权限（在你自己拥有的服务器上你就有）。

1. 在 Discord 里，将鼠标悬停在你想接收提醒的频道上 → 点齿轮（**Edit Channel**）。
2. **Integrations → Webhooks → New Webhook**。
3. 给它命名（例如 *Foundry*），可选地挑一个头像，然后点 **Copy Webhook URL**。它形如
   `https://discord.com/api/webhooks/123456789/AbC-ExampleWebhookToken`。

### 2. 粘贴、保存、测试

把它粘贴到 **Settings → Notifications** 的「Discord webhook URL」字段，点击 **Save**，然后点击 **Send test message**。
测试消息就会出现在那个 Discord 频道里。

请把 webhook URL 当成密码看待——任何拿到它的人都能向该频道发消息。要作废它，就在同一个 Discord 对话框里删除这个 webhook。

---

## 回到应用的链接（可选，但很值得设置）

当你设置了 **Link base URL** 后，每条消息都会带上一个直达相关页面的链接——「needs you」跳到 Inbox，
「finished」跳到对应的 goal，暂停则跳到 Usage 页面。请把它设置为*从你手机上*能访问到 UI 的地址：

- 只在自己的机器上运行 Foundry 并就地查看：这一项可以留空（反正 `127.0.0.1` 的链接在手机上也打不开）。
- 需要远程访问：使用[远程访问指南](./remote-access.zh.md)里的地址，例如 Tailscale 的
  `https://mac-mini.<tailnet>.ts.net`。要带上协议头（`https://…`）；这个字段需要一个完整的 URL。

留空的话，消息就单纯不带链接。

## 选择哪些事件提醒你

两个渠道下方是那五个开关。把你不关心的家族关掉——例如保留 **Needs you** 和 **Goal finished** 开启，
如果 **Delivery** 和 **New version** 对你来说是噪音，就把它们关掉。一个没有启用任何渠道的家族就什么也不做。

## 通过环境变量设置

每个字段都可以用环境变量来预置，而不必用 UI（这对 Docker 的 `-e` 参数或一次性运行很方便）；你之后在 UI 里保存的值会优先生效。

| 变量 | Settings 字段 |
|---|---|
| `FOUNDRY_TELEGRAM_BOT_TOKEN` | Telegram bot token |
| `FOUNDRY_TELEGRAM_CHAT_ID` | Telegram chat id |
| `FOUNDRY_DISCORD_WEBHOOK` | Discord webhook URL |
| `FOUNDRY_NOTIFY_BASE_URL` | Link base URL |

各家族的开关仅存在于 UI/settings 中。

## 它的行为方式

- **发了就不管（Fire-and-forget）。** 通知是一种提示，而非账本：发送失败会重试两次，然后被记录并丢弃——
  重启后不会有任何东西被排队或重放。一个失效的 webhook 永远不会阻塞 goal。
- **即时生效。** 设置在发送时才读取，因此改动一个 token 或一个开关会立即作用于下一个事件——无需重启。
- **纯文本**，并会裁剪以保持在 Telegram 和 Discord 的长度上限之内。

## 疑难排查

| 你看到的现象 | 原因 | 修复办法 |
|---|---|---|
| 测试提示 `telegram 401` | bot token 错误或已被作废 | 从 @BotFather 重新复制 token；不要带空格 |
| 测试提示 `telegram 400: chat not found` | chat id 错误，或你从未给 bot 发过消息 | 给 bot 发条消息，再点一次 Detect，然后 Save |
| Detect 提示 *no messages yet* | bot 还没收到过你发的消息 | 打开 bot，给它发任意内容，再点 Detect |
| 测试提示 `discord 401`/`404` | webhook URL 错误或已被删除 | 重新创建 webhook，复制完整的 URL，然后 Save |
| 测试成功，但之后收不到消息 | 该事件所属的家族被关掉了，或那个渠道在测试之后被清空了 | 检查那五个开关；再确认 token/URL 已保存（绿色的 *saved* 徽标） |
| 消息能收到，但链接点了没反应 | Link base URL 为空或是 `127.0.0.1` | 把它设置为你手机能访问到的地址（[远程访问](./remote-access.zh.md)） |
