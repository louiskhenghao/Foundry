# 远程访问：把 Foundry 跑在家里，随处使用

> 中文 · [English](./remote-access.md)

Foundry 在**一台机器**上驱动 Claude Code 处理仓库——真正干活的是那台机器，Web UI 只是你操控它的方式。本指南教你如何让这台机器无论你身在何处，都能从手机或笔记本访问到，并在你离开时持续工作，靠的是 [Tailscale](https://tailscale.com)（一张基于 WireGuard 的网状网络：只有登录到*你自己*的 tailnet 的设备才能访问它——无需端口转发，也不对公网暴露）。

**为什么不干脆开放端口？** 这个 UI 没有登录。任何能访问 4111 端口的人都能创建目标、批准 Brief、用你的 `gh` 登录推分支，并花掉你的 Claude 订阅额度。所以规则很简单：Foundry 始终待在 loopback 上，Tailscale 是唯一的门。永远不要把它发布到互联网上，永远不要用 `tailscale funnel`。

你需要：一台常开的机器（Mac mini、台式机、家用服务器、VPS），且 Foundry 已经能在本地正常运行——要么用 `bun run serve`（[README](../README.zh.md#quick-start)），要么用 Docker 镜像（[docs/docker.md](./docker.zh.md)）——外加一个免费的 Tailscale 账号。

---

## 1. 把机器和你的各台设备放到同一个 tailnet

在 Foundry 机器上，以及你将来会用来访问它的每一台设备上安装 Tailscale，并登录同一个账号：

- macOS / Windows / Linux：<https://tailscale.com/download>（Linux 服务器：`curl -fsSL https://tailscale.com/install.sh | sh && sudo tailscale up`）
- iPhone / Android：应用商店里的 Tailscale app

在 Foundry 机器上检查：

```bash
tailscale status        # lists every device on your tailnet; note this machine's name (e.g. mac-mini)
tailscale ip -4         # its tailnet address, 100.x.y.z
```

在管理后台（<https://login.tailscale.com/admin/dns>）里一次性启用 **MagicDNS** 和 **HTTPS certificates**——两者各是一个开关，启用后你就能得到一个稳定的 `https://mac-mini.<tailnet>.ts.net` 名称，而不用记 IP。

## 2. 把 Foundry 暴露到 tailnet 上——且仅此而已

Foundry 继续监听 `127.0.0.1:4111`，跟今天完全一样。Tailscale 用机器自己的证书，以 HTTPS 把它代理到 tailnet 上：

```bash
tailscale serve --bg 4111
tailscale serve status     # → https://mac-mini.<tailnet>.ts.net  proxy http://127.0.0.1:4111
```

暴露这一步就这些。`--bg` 让它在重启后依然生效。无论 Foundry 是从源码运行还是在 Docker 里运行，效果都一样（compose 文件和 `docker run` 方案本来就发布在 `127.0.0.1:4111` 上，而这正是 `serve` 转发的目标）。实时的 WebSocket 也走它。

在手机上打开 `https://mac-mini.<tailnet>.ts.net`（关掉 Wi-Fi，以证明确实生效）。页头那颗实时状态圆点应当是绿的。

> **不用 `serve` 的替代方案**——把 Foundry 直接绑定到 tailnet 地址：Settings → Engine（install）
> → Host = `100.x.y.z`（重启后生效），Docker 则用 `-p 100.x.y.z:4111:4111`。这样你得到的是不带证书的普通
> `http://100.x.y.z:4111`，而且引擎不再监听 loopback：在那台机器上要用同一个地址打开浏览器，并给 CLI 传
> `FOUNDRY_URL=http://100.x.y.z:4111`。只有当你的 Tailscale 套餐用不了
> `serve` 时才这么做；永远不要用 `0.0.0.0`。

撤销：`tailscale serve reset`。

## 3. 让它在你离开时持续工作

只有当你合上盖子或关掉终端后机器仍在跑目标，远程访问才有意义。

### 把引擎做成服务

**macOS——一个 LaunchAgent**（登录时启动，挂掉后重启，运行在你的用户会话里，因此 Keychain 里的 `claude`
登录是可用的）。存成 `~/Library/LaunchAgents/com.foundry.serve.plist`，并调整其中的三处路径：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.foundry.serve</string>
  <key>ProgramArguments</key><array>
    <string>/Users/you/.bun/bin/bun</string><string>run</string><string>serve</string>
  </array>
  <key>WorkingDirectory</key><string>/Users/you/Projects/foundry</string>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>/Users/you/.bun/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
    <key>FOUNDRY_SUPERVISED</key><string>1</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/Users/you/Projects/foundry/data/serve.log</string>
  <key>StandardErrorPath</key><string>/Users/you/Projects/foundry/data/serve.log</string>
</dict></plist>
```

```bash
mkdir -p ~/Projects/foundry/data                                                    # launchd does not create the log dir
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.foundry.serve.plist   # start now + at every login
launchctl kickstart -k gui/$(id -u)/com.foundry.serve                              # restart it
tail -f ~/Projects/foundry/data/serve.log
```

`PATH` 必须包含 `bun`、`claude`、`git`、`gh` 和 `graphify` 所在的位置（用 `which claude` 查）；LaunchAgent
不会读你的 shell profile。用普通的 `bun run serve`，不要用 `bun --watch`。
`FOUNDRY_SUPERVISED=1` 告诉一键更新（见 §5）在完成后直接退出，由服务管理器
把新版本拉起来——没有它的话引擎会自行重启，两者就会争抢端口。

**Linux——一个 systemd user service。** 存成 `~/.config/systemd/user/foundry.service`：

```ini
[Unit]
Description=Foundry
After=network-online.target

[Service]
WorkingDirectory=%h/Projects/foundry
Environment=PATH=%h/.bun/bin:%h/.local/bin:/usr/local/bin:/usr/bin:/bin
Environment=FOUNDRY_SUPERVISED=1
ExecStart=%h/.bun/bin/bun run serve
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
```

```bash
systemctl --user enable --now foundry
sudo loginctl enable-linger "$USER"     # keep user services running when you are not logged in
journalctl --user -u foundry -f
```

**Docker。** compose 文件本来就写了 `restart: unless-stopped`，所以重启后容器会自己回来。在 Mac 上，还要打开
Docker Desktop → Settings → General → *Start Docker Desktop when you sign in*。

### 机器本身不能睡眠

- **macOS**：System Settings → Energy（或 Battery → Options）→ *Prevent automatic sleeping when the display is
  off*——打开；让机器保持接通电源。对于必须合盖工作的笔记本：
  `sudo pmset -a disablesleep 1`（`0` 撤销）。顺手把 *Wake for network access* 也打开。
  如果机器可能自行重启（更新、断电），启用自动登录，好让 LaunchAgent 无需你在场就能启动——代价是 FileVault
  那道众所周知的取舍。
- **Linux**：桌面会话下执行 `sudo systemctl mask sleep.target suspend.target hibernate.target`；服务器上则
  无事可做。

重启后确认它真的活着：从另一台设备执行 `curl -s https://mac-mini.<tailnet>.ts.net/api/health`，应当回复
`{"ok":true,…}`。

## 4. 让通知指回 tailnet URL

当某个目标需要你、完成或交付时，当 Claude 用量限额让引擎暂停时，或者有新版本发布时，Foundry 都能在 Telegram
或 Discord 上提醒你（Settings → Notifications，每一类一个开关）。把 **Link base URL** 设为
`https://mac-mini.<tailnet>.ts.net`（要带上协议头——这个字段要的是完整 URL）：这样每条消息都会带上一个链接，
在你手机上打开正确的页面。留空的话消息就完全不带链接；设成 `127.0.0.1`，那链接就只有在机器本机上才打得开。按
*Send test message* 来确认。

这就是那个闭环：机器干活，你收到提醒，一点，回答问题或批准 Brief，机器继续往下走。

## 5. 你远程能做什么

一切——就是同一个 UI：创建目标、回答 Clarifier、批准 Brief、回复 Inbox 升级、看实时日志、在 Agents 页面停止会话、
交付 PR（用机器自己的 `gh auth login`），以及在有新版本出现时从页头那颗药丸更新 Foundry 本身。UI 是响应式的；
页头在手机上会收进一个菜单里。

目标要处理的仓库必须在那台机器上（或挂载进容器的 `/repos`），而交付是用那台机器的 `gh` 登录来推送的——趁你人在
键盘前时一次性设好：`gh auth login`（或 `docker exec -it foundry gh auth login`）。

## 6. 安全清单

- Foundry 监听在 `127.0.0.1`（或 `100.x.y.z` 这个 tailnet 地址）上；它绝不绑定到 `0.0.0.0`，也没有任何
  路由器端口转发或 `tailscale funnel` 指向它。`tailscale serve status` 必须把这个监听显示为
  *tailnet only*——绝不能是 *Funnel on*。
- Foundry 机器上握着你的 Claude 登录、你的仓库，以及一个能推送和开 PR 的 `gh` 登录。把它当成你的笔记本对待：
  磁盘加密开着、锁屏开着、tailnet 上只有你自己的设备。
- 要和别人（家人、同事）共享 tailnet？用 Tailscale ACL（<https://login.tailscale.com/admin/acls>）限制谁能
  访问 4111 端口，例如只允许打了属于你的标签的设备。
- 保持 `docker-compose.yml` 里 watchtower 边车的 API 不对外发布（随包的文件就是这样）；它只能从 compose
  网络内部访问到。

## 替代方案

- **SSH 隧道**（无需安装任何东西，仅限笔记本）：`ssh -N -L 4111:127.0.0.1:4111 you@your-machine`，然后本地打开
  `http://127.0.0.1:4111`。用来快速看一眼没问题；但不适合手机，也不适合通知链接。
- 如果你用不了 Tailscale，用 **Cloudflare Tunnel**：在隧道前面加上 **Cloudflare Access**（一道身份校验）——
  裸隧道就是一个指向无认证 UI 的公开 URL，而那正是要极力避免的东西。

## 排障

| 你看到的现象 | 原因 | 解决 |
|---|---|---|
| 浏览器说证书还没就绪 / HTTPS 超时 | 第一次 `tailscale serve` 会按需签发 `ts.net` 证书 | 等一分钟，重新加载；检查管理后台 DNS 页面里 HTTPS 是否已启用 |
| 页头那颗实时圆点是红的（宽屏上显示 *reconnecting…*），且什么都加载不出来 | 机器睡着了，或者引擎停了 | 从另一台设备执行 `tailscale ping mac-mini`；`curl …/api/health`；检查睡眠设置和服务日志 |
| `curl …/api/health` 能通，但消息不带链接、或链接打不开任何东西 | Link base URL 留空了（完全没链接），或设成了 `127.0.0.1` | Settings → Notifications → Link base URL = 那个 `https://…ts.net` URL |
| 一键更新之后服务日志显示端口被占用的崩溃循环 | 引擎自行重启了，而没让 launchd/systemd 来做 | 往 plist/unit 里加上 `FOUNDRY_SUPERVISED=1`（见 §3），然后 `launchctl kickstart -k …` / `systemctl --user restart foundry` |
| 目标能启动，但重启后会话立刻失败 | 服务的 `PATH` 里缺 `claude` / `bun`，或者 Keychain 登录不可用（macOS，用户未登录） | 修好 plist/unit 里的 `PATH`；启用自动登录 |
| `tailscale serve` 说这个功能不可用 | 客户端太老，或套餐没有 serve | 更新 Tailscale，或改用 §2 里绑定到 `100.x.y.z` 的替代方案 |
