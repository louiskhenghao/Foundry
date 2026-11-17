# Remote access: run Foundry at home, use it from anywhere

Foundry drives Claude Code, Codex or Antigravity against repositories on **one machine** — that machine does the work, and the web UI
is how you steer it. This guide makes that machine reachable from your phone or laptop wherever you are, and
keeps it working while you are away, using [Tailscale](https://tailscale.com) (a WireGuard mesh: only devices
signed in to *your* tailnet can reach it — no port forwarding, no public exposure).

**Why not just open the port?** The UI has no login until you give people tokens ([below](#give-each-person-a-token)), and a token is a light lock, not a perimeter. Anyone who can reach port 4111 can create goals, approve
Briefs, push branches with your `gh` login and use either signed-in backend’s quota. So the rule is simple: Foundry
stays on loopback, and Tailscale is the only door. Never publish it to the internet, never use `tailscale funnel`.

You need a machine that stays on (a Mac mini, a desktop, a home server, a VPS) with Foundry already working on it,
the app on a Mac or the binary on Linux (both in [install.md](./install.md)), and a free Tailscale account.

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

That is the whole exposure step. `--bg` makes it persist across reboots. The app and the binary listen on
`127.0.0.1:4111`, which is what `serve` forwards to; when Foundry chose another port because 4111 was taken, use that
one (**Settings → Engine (install) → Port** shows it). The live WebSocket goes through it too.

Open `https://mac-mini.<tailnet>.ts.net` on your phone (Wi-Fi off, to prove the point). The header's live dot
should be green.

> **Alternative without `serve`** — bind Foundry to the tailnet address directly: Settings → Engine (install)
> → Host = `100.x.y.z` (takes effect after a restart). You get plain
> `http://100.x.y.z:4111` without a certificate, and the engine no longer listens on loopback: on that machine
> open the same address in the browser and give the CLI `FOUNDRY_URL=http://100.x.y.z:4111`. Only do this if
> `serve` is unavailable on your Tailscale plan; never use `0.0.0.0`.

To undo: `tailscale serve reset`.

### Give each person a token

One tailnet, two or three people? Turn on **Access** (Settings → Access, or `foundry access add <name>` on the
machine): each person gets a token, shown once. From then on every request to Foundry needs one — the sign-in page
takes it in a browser and keeps it in a cookie for 90 days; the CLI reads `FOUNDRY_TOKEN` — and a goal, a Brief
approval or an Inbox answer is recorded under the person's name (the goal page says *asked by Ada, Brief approved by
Bob*). The first token signs in the browser that made it, so turning Access on locks no one out; revoke a token to
take it back, revoke them all to turn Access off. Tokens are kept as fingerprints in `access.json` beside the data,
never in the event log and never in a Transfer. It is a light lock for people you already share a tailnet with, not a
reason to open the port to the internet: everything in the checklist below still holds.

## 3. Keep it working while you are away

Remote access is only useful if the machine keeps running goals after you close the lid or the terminal.

### The engine as a service

The installer already runs Foundry this way ([install.md](./install.md)):

- **The app (macOS)** starts at login (**Start at Login** in its menu, ticked the first time it opens) and starts the
  engine again if it stops. It runs in your user session, so the `claude` login in the Keychain is available.
- **The binary (Linux)** runs as a `systemd --user` service, `~/.config/systemd/user/foundry.service`, which restarts it
  if it stops. The installer turns on lingering, so the service keeps running after you log out; when it could not, it
  says so, and `sudo loginctl enable-linger "$USER"` does it. Its log: `foundry logs`, or
  `journalctl --user -u foundry -f`.
- **The binary on macOS** (`--mode binary`) runs as a LaunchAgent, `~/Library/LaunchAgents/dev.foundry.server.plist`,
  which starts at login and restarts it if it stops.

The app starts the engine with the `PATH` your login shell has. The binary's service keeps the `PATH` of the terminal
that installed it: after installing a coding agent's CLI somewhere new, run `foundry restart` from a terminal that finds
it, which writes the service again with that `PATH`. The binary's service, systemd or launchd, sets
`FOUNDRY_SUPERVISED=1`, so a one-click update simply exits when it is done and the service manager brings the new
version up; the app swaps itself (see [updates-and-backup.md](./updates-and-backup.md#self-update)).

The binary's service starts with `FOUNDRY_PROVIDER` set to the first coding agent you chose at install, which picks its
data folder (`data-codex/` for Codex). To add Codex goals to an existing Claude-profile install, keep its profile and
data folder; sign into Codex in **Accounts** instead. Services do not inherit your interactive shell’s variables.

### The machine itself must not sleep

- **macOS**: System Settings → Energy (or Battery → Options) → *Prevent automatic sleeping when the display is
  off* — on; keep the machine on power. For a laptop that must work with the lid closed:
  `sudo pmset -a disablesleep 1` (`0` to undo). Turn on *Wake for network access* while you are there.
  If the machine may reboot on its own (updates, power), enable automatic login so the app starts without you,
  with the usual FileVault trade-off.
- **Linux**: on a desktop session, `sudo systemctl mask sleep.target suspend.target hibernate.target`; on a
  server there is nothing to do.

Check it is really alive after a reboot: `curl -s https://mac-mini.<tailnet>.ts.net/api/health` from another
device should answer `{"ok":true,…}`.

## 4. Make notifications point back at the tailnet URL

Foundry can ping you on Telegram or Discord when a goal needs you, when the Clarifier asks you an interview round,
when a goal finishes or delivers, when a backend usage limit pauses that backend’s goals, or when a new version is out
(Settings → Notifications, one switch per kind; step-by-step in [notifications.md](./notifications.md)). With
Tailscale running on the machine, every message already links to the right page twice: on the machine itself and on
your tailnet (**Tailscale links** = auto finds the `ts.net` name and reuses the `tailscale serve` above, or adds one).
A milestone's preview gets a tailnet link too: Foundry serves the preview's port while it runs. The proxy is pointed
at the loopback address the dev server really listens on (recent Node binds `localhost` to IPv6 only, which a proxy
to `127.0.0.1` cannot reach), and the preview's process gets the tailnet name in
`__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS`, so a Vite dev server answers to it; a server with an allow-list of its own
(Next's `allowedDevOrigins`, webpack's `allowedHosts`) needs the name in its config, or in the variable it reads, set
in the goal's Preview environment. Leave **Link base URL** empty unless you reach Foundry at another address. Press
*Send test message* to confirm the channel.

That is the loop: the machine works, you get a ping, you tap it, you answer the question or approve the Brief,
the machine carries on.

## 5. What you can do remotely

Everything — it is the same UI: create goals, answer the Clarifier, approve Briefs, answer Inbox escalations,
watch live logs, stop sessions from the Agents page, deliver PRs (the machine's own `gh auth login`), and
update Foundry itself from the header pill when a new version appears. The UI is responsive; the header
collapses into a menu on a phone.

The repositories a goal works on must be on that machine, and delivery pushes with that machine's `gh` login. Set it
up once while you are at the keyboard: `gh auth login`, or **Sign in** under *GitHub CLI* on the Setup page.

## 6. Security checklist

- Foundry is reachable only on `127.0.0.1` (or the `100.x.y.z` tailnet address): the app and the binary bind there;
  never set **Host** to `0.0.0.0`. No router port-forward or `tailscale funnel` points at it. `tailscale serve status`
  must show the listener as *tailnet only*, never *Funnel on*.
- The Foundry machine holds your native backend logins, your repositories and a `gh` login that can push and open PRs.
  Treat it like your laptop: disk encryption on, screen lock on, only your own devices on the tailnet.
- Sharing the tailnet with other people (family, colleagues)? Restrict who can reach port 4111 with a
  Tailscale ACL (<https://login.tailscale.com/admin/acls>), e.g. only devices tagged as yours. Sharing the Foundry
  itself with two or three of them? Give each a token ([above](#give-each-person-a-token)): what each does is then
  recorded under their name, and a lost phone is one revoked token.

## Alternatives

- **SSH tunnel** (nothing to install, laptop only): `ssh -N -L 4111:127.0.0.1:4111 you@your-machine`, then open
  `http://127.0.0.1:4111` locally. Fine for a quick check; not for phones or for the notification links.
- **Cloudflare Tunnel** if you cannot use Tailscale: put **Cloudflare Access** (an identity check) in front of
  the tunnel — a bare tunnel is a public URL to an unauthenticated UI, which is exactly the thing to avoid. Foundry
  refuses names it does not know (against DNS rebinding), so set the tunnel's URL as the Link base URL (§4) or add its
  domain to `FOUNDRY_ALLOWED_HOSTS`.

## Troubleshooting

| What you see | Why | Fix |
|---|---|---|
| Browser says the certificate is not ready / HTTPS times out | first `tailscale serve` provisions the `ts.net` certificate on demand | wait a minute, reload; check HTTPS is enabled in the admin DNS page |
| The header's live dot is red (*reconnecting…* on a wider screen) and nothing loads | the machine is asleep, or the engine stopped | `tailscale ping mac-mini` from another device; `curl …/api/health`; check the sleep settings and the service log |
| `curl …/api/health` works, but messages carry no link or the link opens nothing | Link base URL empty (no links at all) or set to `127.0.0.1` | Settings → Notifications → Link base URL = the `https://…ts.net` URL |
| A page that says *Foundry does not answer to the name "…"* | the address uses a name Foundry does not know as this computer's (a custom domain, a proxy) | Settings → Notifications → Link base URL = that address, or add the name to `FOUNDRY_ALLOWED_HOSTS` and restart |
| After a one-click update the service log shows a port-in-use crash loop | the service lacks `FOUNDRY_SUPERVISED=1` (one written by hand), so the engine restarted itself instead of letting launchd/systemd do it | `foundry restart` writes the installer's service, which sets it (§3) |
| Goals start but sessions fail immediately after a reboot | the service `PATH` lacks `claude` / `codex`, or the Keychain login is not available (macOS, user not logged in) | `foundry restart` from a terminal that finds them; enable automatic login |
| `tailscale serve` says the feature is not available | older client or plan without serve | update Tailscale, or use the bind-to-`100.x.y.z` alternative in §2 |
| A preview's tailnet link answers *502* while it works on the machine | the dev server listens on IPv6 loopback only and the proxy was made for `127.0.0.1` (an earlier Foundry, or a serve you added by hand) | start the preview again: Foundry points the proxy at the address that answers; by hand, `tailscale serve --bg --https=<port> http://[::1]:<port>` |
| A preview's tailnet link shows *Blocked request. This host ("…ts.net") is not allowed* | the dev server checks the Host header against an allow-list (Vite, Next) | Vite: start the preview again, Foundry passes the name in `__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS`; another server: add the name to its allow-list, or set the variable it reads in the goal's Preview environment |
