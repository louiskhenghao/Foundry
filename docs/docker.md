# Running Foundry in Docker

> [中文](./docker.zh.md) · English

Foundry drives Claude Code against **a git repository you already have**. The image brings the engine, its web
UI and every tool it uses (`bun`, `git`, `claude`, `gh`, `ripgrep`, `npx`, `uv`, `graphify`). It deliberately does
not bring two things, because they are yours: **your Claude login** and **your repositories**. Both are mounted.

You need: Docker (Desktop or Engine), a Claude subscription (Pro/Max) — no API key — and ~2 GB of disk for the image.

---

## 1. Get the image

```bash
docker pull imlouiskhenghao/foundry:latest
```

## 2. Sign in to Claude

The engine works through Claude Code, so the container needs its own Claude session — a container is a separate
machine as far as Claude Code is concerned, even if you are already signed in on your own. Three ways; any one is
enough, and you only do it once.

**a. From the web UI, after the container is running (simplest — no terminal).**
Do §3 first, open <http://127.0.0.1:4111>, and press *Sign in* on the Setup page. There is no browser inside the
container, so Claude Code shows a link and asks for a code instead of completing by itself: open the link in your
own browser, approve, and paste the code back into the dialog (you have 15 minutes). A rejected code just re-opens
the field.

**b. From the terminal, before you start it.**

```bash
docker volume create foundry-claude
docker run --rm -it -v foundry-claude:/home/node/.claude \
  imlouiskhenghao/foundry claude auth login
```

Same flow — it prints a URL, you approve in your browser and paste the code back (`-it` is what lets you paste).
The login lands in the `foundry-claude` volume and survives restarts.

**c. With a token from the machine you are already signed in on.**

```bash
claude setup-token            # on YOUR machine; prints a long-lived token for your subscription
```

Put it in a file you keep out of git and hand it to the container:

```bash
echo "CLAUDE_CODE_OAUTH_TOKEN=<the token>" > ~/.foundry.env   # chmod 600
docker run -d --name foundry --env-file ~/.foundry.env ...  # rest of the flags as in §3
```

`docker exec foundry claude auth status` then reports `"authMethod": "oauth_token"` and there is nothing to sign
in to. Treat the token like a password: it is your subscription.

> **Linux only:** you can instead mount the credentials you already have — `-v ~/.claude:/home/node/.claude`
> instead of the `foundry-claude` volume. On Linux Claude Code keeps them in `~/.claude/.credentials.json`, so
> they travel with the mount (the container will also write its sessions and skills there). On **macOS this does
> not work**: the credentials live in the Keychain, not in `~/.claude`, so a mounted `~/.claude` carries settings
> and skills but not the login.

Check any time: `docker exec foundry claude auth status`.

## 3. Point it at the repository you want worked on

Two shapes, pick the one that matches you.

### A. You have one repository

Say it lives at `/Users/dana/code/acme-app` (macOS) or `/home/dana/code/acme-app` (Linux):

```bash
docker volume create foundry-data

docker run -d --name foundry \
  -p 127.0.0.1:4111:4111 \
  -v foundry-data:/app/data \
  -v foundry-claude:/home/node/.claude \
  -v /Users/dana/code/acme-app:/repos/acme-app \
  imlouiskhenghao/foundry
```

Open <http://127.0.0.1:4111>, click **New goal**, and in *Repository* type the **container** path:

```
/repos/acme-app
```

The panel under the field should turn green with your branch and commit count. If it says *not a git repository*,
you typed the host path — the engine only sees what you mounted.

### B. You have several repositories under one folder

Mount the parent once and every repository inside it is reachable:

```bash
docker run -d --name foundry \
  -p 127.0.0.1:4111:4111 \
  -v foundry-data:/app/data \
  -v foundry-claude:/home/node/.claude \
  -v /Users/dana/code:/repos \
  imlouiskhenghao/foundry
```

| Where it is on your machine | Inside the container | What you type in *New goal → Repository* |
|---|---|---|
| `/Users/dana/code/acme-app` | `/repos/acme-app` | `/repos/acme-app` |
| `/Users/dana/code/work/api` | `/repos/work/api` | `/repos/work/api` |
| `C:\Users\dana\code\acme-app` (Windows) | `/repos/acme-app` | `/repos/acme-app` — mount as `-v C:\Users\dana\code:/repos` in PowerShell, `-v //c/Users/dana/code:/repos` in Git Bash |

You can add as many mounts as you like: `-v ~/code:/repos -v ~/Desktop/client-work:/client`.

The mount must be **writable**: the engine adds git worktrees, which write into your repository's `.git/`,
and creates each goal's **progress folder next to the repository** — `/repos/my-app-foundry/<goal>/` in the container,
`~/Projects/my-app-foundry/<goal>/` on the host — so you can open and run the work as it lands. It never touches your
working tree or your existing branches — it only adds `goal/<id>` (and task) branches, which you will see in `git branch`.
Files in the progress folder belong to uid 1000 (see *Permissions* below); set Settings → Engine → *Progress folders*
to another mounted path if you want them elsewhere.

### Linux: if your user id is not 1000

The image runs as uid 1000. If `id -u` gives you something else, run as yourself and keep the engine's state in
folders you own (named volumes would be created owned by 1000):

```bash
mkdir -p ~/.foundry/data ~/.foundry/home/.claude
docker run -d --name foundry \
  --user "$(id -u):$(id -g)" -e HOME=/home/node \
  -p 127.0.0.1:4111:4111 \
  -v ~/.foundry/data:/app/data \
  -v ~/.foundry/home:/home/node \
  -v ~/code:/repos \
  imlouiskhenghao/foundry
```

The whole home is mounted, not just `.claude`: as a non-1000 user the image's `/home/node` is read-only to you,
and `gh auth login`, `npx autoskills` and `uv` all need to write under it (`~/.config/gh`, `~/.npm`, `~/.cache`).
Use the same `--user`/`-e HOME` flags for the `claude auth login` step, with the same `~/.foundry/home` folder.
With compose, put the same value under `services.foundry.user:`.

### Prefer docker compose?

`docker compose` needs a `docker-compose.yml` **in the folder you run it from**, otherwise it answers
`no configuration file provided: not found`. The image ships one:

```bash
docker run --rm imlouiskhenghao/foundry cat /app/docker-compose.yml > docker-compose.yml
docker compose run --rm foundry claude auth login     # once
FOUNDRY_REPOS=~/code docker compose up -d             # mounts ~/code at /repos
```

Without `FOUNDRY_REPOS` the compose file mounts `~/Projects`. It also passes `FOUNDRY_MODEL_STRONG` /
`_WORKER` / `_CHEAP` and `FOUNDRY_MAX_CONCURRENT` through from your shell, and starts the watchtower sidecar
that makes one-click updates work (see *Updating*); its token defaults to `foundry-watchtower` —
set `FOUNDRY_WATCHTOWER_TOKEN` to change it. The sidecar's port is never published to the host.

## 4. Delivery: pushing, pull requests, merges (optional)

A goal produces a local branch. If you want the engine to push it or open a PR, give the container its own
GitHub login (Foundry never stores tokens — `gh` does). Either *Connect GitHub* on the Setup page (the same
device-code flow, no terminal), or:

```bash
docker exec -it foundry gh auth login
```

Add `-v foundry-gh:/home/node/.config/gh` to your `docker run` if you want that login to survive re-creating
the container.

---

## Where things live

| Path in the container | What | Keep it? |
|---|---|---|
| `/app/data/engine.db` | SQLite: goals, tasks, attempts, events (auto-created, auto-migrated — nothing to configure) | **yes** |
| `/repos/<repo>-foundry/` (bind mount) | the progress folders: one git worktree per goal, plus the engine's task worktrees under `.foundry/` | until the goal is deleted |
| `/app/data/worktrees` | worktrees of goals created before progress folders existed | until the goal is delivered |
| `/app/data/settings.json` | everything you changed on the Settings page | **yes** |
| `/app/data/models.json` | which model names resolved on this machine (learned) | optional |
| `/app/data/transcripts`, `check-output`, `attachments` | session logs, check output, your uploads | optional |
| `/app/data/skills-cache`, `skills-trash` | fetched skill sources; uninstalled skills (restorable) | optional |
| `/home/node/.claude` | Claude login, sessions, installed skills | **yes** |
| `/repos/...` | your repositories (mounted from your machine) | it *is* your machine |

Back up the two volumes:

```bash
docker stop foundry
docker run --rm -v foundry-data:/d -v "$PWD":/out alpine tar czf /out/foundry-data.tgz -C /d .
docker run --rm -v foundry-claude:/c -v "$PWD":/out alpine tar czf /out/foundry-claude.tgz -C /c .
docker start foundry
```

## Updating

Foundry checks the release registry once a day; when a newer version exists the header shows an update pill
(also Settings → About & updates), with the changelog.

- **One-click** (compose with the shipped `docker-compose.yml`): the compose file runs a small
  [watchtower](https://containrrr.dev/watchtower/) sidecar — the only container that touches the docker
  socket. *Update* in the UI first stops starting new sessions and waits for active agents to finish (up to an
  hour; tick *Update immediately* to interrupt them instead), then the sidecar pulls the new image and
  recreates the container; the page reconnects by itself. Two things must hold for the button to be live:
  the container is named `foundry` and it sees `FOUNDRY_WATCHTOWER_URL` + `FOUNDRY_WATCHTOWER_TOKEN` — both
  come from the compose file. A compose file fetched before v0.2.0 has no sidecar: fetch it again (§3).
- **Manual** (no sidecar): the UI shows `docker compose pull foundry` and `docker compose up -d foundry`
  instead. If you started with plain `docker run`, the equivalent is `docker pull imlouiskhenghao/foundry:latest`,
  `docker rm -f foundry`, then the same `docker run` line with the same volumes. Either way the event log is
  replayed and unfinished attempts resume where they stopped.

## Troubleshooting

| What you see | Why | Fix |
|---|---|---|
| `no configuration file provided: not found` | `docker compose` was run in a folder with no `docker-compose.yml` | use the `docker run` form above, or fetch the compose file out of the image (§3) |
| `Not logged in · Please run /login` | `claude login` is not a command | `claude auth login` (with `-it`) |
| Setup page shows a link and asks for a code | normal in Docker: no browser inside, so Claude Code uses the copy-the-code flow | open the link, sign in, paste the code into the dialog |
| *not a git repository* in New goal | you typed a host path | type the container path, e.g. `/repos/acme-app` |
| `Permission denied` writing in the repo, or worktrees fail (Linux) | your files are not owned by uid 1000 | use the `--user "$(id -u):$(id -g)"` recipe above |
| `port is already allocated` | something else uses 4111 | `-p 127.0.0.1:4112:4111` and open that port instead |
| Setup page: *markitdown not installed* | image older than v0.2.1 — since then the PDF/Office → markdown converter is baked in (the in-container install cannot write to the root-owned tool dirs) | `docker pull imlouiskhenghao/foundry:latest` and recreate the container |
| Stale worktrees in your repo's `git worktree list` | worktrees were registered with container paths | `git worktree prune` in that repository |

## Notes

- The UI has no authentication — keep the published port on `127.0.0.1`, never expose 4111 to a network. To reach it from outside, put the host on a Tailscale tailnet and `tailscale serve 4111` — see [remote-access.md](./remote-access.md).
- `FOUNDRY_HOST=0.0.0.0` is already set inside the image; do the loopback binding on the host side (`-p 127.0.0.1:…`).
- Useful env vars: `FOUNDRY_MODEL_STRONG` / `_WORKER` / `_CHEAP` (default `opus`/`opus`/`haiku`), `FOUNDRY_MAX_CONCURRENT` (3), `FOUNDRY_TDD` (`required|preferred|off`, default `required`), `FOUNDRY_GOAL_MODE` (`simple|expert`, default `expert`), `FOUNDRY_UPDATE_CHECK=off` (disable the daily version check). Everything else is editable in Settings.
- First start with an empty `~/.claude` volume: the entrypoint installs the graphify skill into it (`graphify install --platform claude`). `FOUNDRY_SKIP_SETUP=1` skips that; a mounted `~/.claude` that already has a `skills/` directory is never touched.
- Interrupted attempts resume as Continuations after a restart — see [runbook](./runbook.md).
- Build your own: `docker build -t foundry .` (add `--build-arg CLAUDE_CODE_VERSION=x.y.z` to pin a different CLI).
- No API key is ever needed or used; `ANTHROPIC_API_KEY` is stripped from every session the engine spawns.
