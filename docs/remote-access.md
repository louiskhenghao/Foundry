# Remote access: run Foundry at home, use it from anywhere

> [中文](./remote-access.zh.md) · English

Foundry drives Claude Code against repositories on **one machine** — that machine does the work, and the web UI
is how you steer it. This guide makes that machine reachable from your phone or laptop wherever you are, and
keeps it working while you are away, using [Tailscale](https://tailscale.com) (a WireGuard mesh: only devices
signed in to *your* tailnet can reach it — no port forwarding, no public exposure).

**Why not just open the port?** The UI has no login. Anyone who can reach port 4111 can create goals, approve
Briefs, push branches with your `gh` login and spend your Claude subscription. So the rule is simple: Foundry
stays on loopback, and Tailscale is the only door. Never publish it to the internet, never use `tailscale funnel`.

You need: a machine that stays on (a Mac mini, a desktop, a home server, a VPS) with Foundry already working
locally — either `bun run serve` ([README](../README.md#quick-start)) or the Docker image ([docs/docker.md](./docker.md)) —
plus a free Tailscale account.

---

## 1. Put the machine and your devices on one tailnet

Install Tailscale on the Foundry machine and on every device you will use it from, signed in to the same account:

- macOS / Windows / Linux: <https://tailscale.com/download> (Linux servers: `curl -fsSL https://tailscale.com/install.sh | sh && sudo tailscale up`)
- iPhone / Android: the Tailscale app from the store

Check from the Foundry machine:

```bash
tailscale status        # lists every device on your tailnet; note this machine's name (e.g. mac-mini)
tailscale ip -4         # its tailnet address, 100.x.y.z
```

Enable **MagicDNS** and **HTTPS certificates** once in the admin console (<https://login.tailscale.com/admin/dns>) —
both are one toggle, and they give you a stable `https://mac-mini.<tailnet>.ts.net` name instead of an IP.

## 2. Expose Foundry on the tailnet — and nowhere else

Foundry keeps listening on `127.0.0.1:4111` exactly as it does today. Tailscale proxies it onto the tailnet with
HTTPS, using the machine's own certificate:

```bash
tailscale serve --bg 4111
tailscale serve status     # → https://mac-mini.<tailnet>.ts.net  proxy http://127.0.0.1:4111
```

That is the whole exposure step. `--bg` makes it persist across reboots. It works identically whether Foundry
runs from source or in Docker (the compose file and the `docker run` recipes already publish on
`127.0.0.1:4111`, which is what `serve` forwards to). The live WebSocket goes through it too.

Open `https://mac-mini.<tailnet>.ts.net` on your phone (Wi-Fi off, to prove the point). The header's live dot
should be green.

> **Alternative without `serve`** — bind Foundry to the tailnet address directly: Settings → Engine (install)
> → Host = `100.x.y.z` (takes effect after a restart), or `-p 100.x.y.z:4111:4111` for Docker. You get plain
> `http://100.x.y.z:4111` without a certificate, and the engine no longer listens on loopback: on that machine
> open the same address in the browser and give the CLI `FOUNDRY_URL=http://100.x.y.z:4111`. Only do this if
> `serve` is unavailable on your Tailscale plan; never use `0.0.0.0`.

To undo: `tailscale serve reset`.

## 3. Keep it working while you are away

Remote access is only useful if the machine keeps running goals after you close the lid or the terminal.

### The engine as a service

**macOS — a LaunchAgent** (starts at login, restarts if it dies, runs in your user session so the `claude`
login in the Keychain is available). Save as `~/Library/LaunchAgents/com.foundry.serve.plist`, adjusting the
three paths:

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

`PATH` must contain wherever `bun`, `claude`, `git`, `gh` and `graphify` live (`which claude` tells you); a
LaunchAgent does not read your shell profile. Use plain `bun run serve`, not `bun --watch`.
`FOUNDRY_SUPERVISED=1` tells a one-click update (§5) to simply exit when it is done, so the service manager
brings the new version up — without it the engine restarts itself and the two would fight over the port.

**Linux — a systemd user service.** Save as `~/.config/systemd/user/foundry.service`:

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

**Docker.** The compose file already says `restart: unless-stopped`, so the container comes back after a
reboot on its own. On a Mac, also turn on Docker Desktop → Settings → General → *Start Docker Desktop when you
sign in*.

### The machine itself must not sleep

- **macOS**: System Settings → Energy (or Battery → Options) → *Prevent automatic sleeping when the display is
  off* — on; keep the machine on power. For a laptop that must work with the lid closed:
  `sudo pmset -a disablesleep 1` (`0` to undo). Turn on *Wake for network access* while you are there.
  If the machine may reboot on its own (updates, power), enable automatic login so the LaunchAgent starts
  without you — with the usual FileVault trade-off.
- **Linux**: on a desktop session, `sudo systemctl mask sleep.target suspend.target hibernate.target`; on a
  server there is nothing to do.

Check it is really alive after a reboot: `curl -s https://mac-mini.<tailnet>.ts.net/api/health` from another
device should answer `{"ok":true,…}`.

## 4. Make notifications point back at the tailnet URL

Foundry can ping you on Telegram or Discord when a goal needs you, finishes or delivers, when a Claude usage
limit pauses the engine, or when a new version is out (Settings → Notifications, one switch per family). Set
**Link base URL** to `https://mac-mini.<tailnet>.ts.net` (scheme included — the field wants a full URL): every
message then carries a link that opens the right page on your phone. Leave it empty and messages carry no link
at all; set it to `127.0.0.1` and the link opens nowhere but on the machine itself. Press *Send test message*
to confirm.

That is the loop: the machine works, you get a ping, you tap it, you answer the question or approve the Brief,
the machine carries on.

## 5. What you can do remotely

Everything — it is the same UI: create goals, answer the Clarifier, approve Briefs, answer Inbox escalations,
watch live logs, stop sessions from the Agents page, deliver PRs (the machine's own `gh auth login`), and
update Foundry itself from the header pill when a new version appears. The UI is responsive; the header
collapses into a menu on a phone.

The repositories a goal works on must be on that machine (or mounted into the container at `/repos`), and
delivery pushes with that machine's `gh` login — set it up once while you are at the keyboard:
`gh auth login` (or `docker exec -it foundry gh auth login`).

## 6. Security checklist

- Foundry listens on `127.0.0.1` (or the `100.x.y.z` tailnet address); it is never bound to `0.0.0.0`, and no
  router port-forward or `tailscale funnel` points at it. `tailscale serve status` must show the listener as
  *tailnet only* — never *Funnel on*.
- The Foundry machine holds your Claude login, your repositories and a `gh` login that can push and open PRs.
  Treat it like your laptop: disk encryption on, screen lock on, only your own devices on the tailnet.
- Sharing the tailnet with other people (family, colleagues)? Restrict who can reach port 4111 with a
  Tailscale ACL (<https://login.tailscale.com/admin/acls>), e.g. only devices tagged as yours.
- Keep the `docker-compose.yml` watchtower sidecar's API unpublished (the shipped file does); it is reachable
  only from inside the compose network.

## Alternatives

- **SSH tunnel** (nothing to install, laptop only): `ssh -N -L 4111:127.0.0.1:4111 you@your-machine`, then open
  `http://127.0.0.1:4111` locally. Fine for a quick check; not for phones or for the notification links.
- **Cloudflare Tunnel** if you cannot use Tailscale: put **Cloudflare Access** (an identity check) in front of
  the tunnel — a bare tunnel is a public URL to an unauthenticated UI, which is exactly the thing to avoid.

## Troubleshooting

| What you see | Why | Fix |
|---|---|---|
| Browser says the certificate is not ready / HTTPS times out | first `tailscale serve` provisions the `ts.net` certificate on demand | wait a minute, reload; check HTTPS is enabled in the admin DNS page |
| The header's live dot is red (*reconnecting…* on a wider screen) and nothing loads | the machine is asleep, or the engine stopped | `tailscale ping mac-mini` from another device; `curl …/api/health`; check the sleep settings and the service log |
| `curl …/api/health` works, but messages carry no link or the link opens nothing | Link base URL empty (no links at all) or set to `127.0.0.1` | Settings → Notifications → Link base URL = the `https://…ts.net` URL |
| After a one-click update the service log shows a port-in-use crash loop | the engine restarted itself instead of letting launchd/systemd do it | add `FOUNDRY_SUPERVISED=1` to the plist/unit (§3), then `launchctl kickstart -k …` / `systemctl --user restart foundry` |
| Goals start but sessions fail immediately after a reboot | the service `PATH` lacks `claude` / `bun`, or the Keychain login is not available (macOS, user not logged in) | fix `PATH` in the plist/unit; enable automatic login |
| `tailscale serve` says the feature is not available | older client or plan without serve | update Tailscale, or use the bind-to-`100.x.y.z` alternative in §2 |
