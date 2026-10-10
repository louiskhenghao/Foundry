# Ports

**Ports** shows which ports are in use on the computer Foundry runs on, and who holds each one. Open it from the ⚙ menu at the right of the top bar: **Ports — what holds which port**. Use it when a preview says a port is already in use but nothing seems to hold it.

## What it lists

Each port is in one group:

| Group | What holds the port |
|---|---|
| **Foundry** | Foundry itself, a goal's preview app (**Preview · app name**), **VS Code (web)**, something a task's session started in a goal's folder (**Task · task name**, or **Started in a goal folder**), or a Docker service Foundry runs for a repository's previews (**Service · name**). |
| **Tailscale serve** | A port `tailscale serve` forwards to your tailnet: **by Foundry** (a preview's tailnet link), **yours** (one you added), or **→ Foundry** (the one that carries Foundry to your other devices). The tailnet address is a link. |
| **Docker** | A container that publishes the port, with its name and compose project. |
| **Other processes** | Any other program: its name, process id and the folder it runs in. |
| **Unknown holder** | Something your user cannot see (the system or another user). `sudo lsof -nP -iTCP:<port> -sTCP:LISTEN` in a terminal names it. |

A `tailscale serve` holds its port in a way `lsof -i` does not show without sudo, yet a dev server cannot listen there: that is the usual case of a port that is "in use" with nothing to see.

By default the page shows what matters for development: Foundry's, Tailscale's and Docker's ports, the usual dev ports (3000, 5173, 8080…), the preview port range and programs running in your projects. **Show all** adds system and background programs. The filter box matches a port number or a name. The list refreshes every five seconds while the page is open; **Refresh** scans again at once.

Open from Foundry's Docker image, the page shows only the ports inside its container, and says so.

## Stop & release

**Stop & release** stops what holds the port, so the port is free again:

- A preview app, **VS Code (web)** and a serve Foundry added stop at once; start them again whenever you like.
- Everything else asks first and says what will stop: a task's process (its attempt may fail), a Docker service or container (the whole container stops; its data is kept), a serve you added, or one of your own programs (it gets SIGTERM, then SIGKILL after a few seconds).
- Foundry itself, the serve that carries Foundry to your other devices (and the one you opened the page through), system programs and other users' programs have no button; the row says why.

Stopping something that belongs to a goal is noted in that goal's **Activity**.

## From a preview that will not start

When a preview stops with `EADDRINUSE`, its card names what holds that port, with **Stop & release** when it can be, and **Ports →** opens this page at that port. Foundry does not restart the preview by itself: press **Start preview** when the port is free.

In a terminal, `foundry ports` prints the same list (`--all` for everything, `--json` for the data); stopping is done on the page.
