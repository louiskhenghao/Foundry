# Running ai-engine in Docker

ai-engine drives Claude Code against **a git repository you already have**. The image brings the engine, its web
UI and every tool it uses (`bun`, `git`, `claude`, `gh`, `ripgrep`, `npx`, `uv`, `graphify`). It deliberately does
not bring two things, because they are yours: **your Claude login** and **your repositories**. Both are mounted.

You need: Docker (Desktop or Engine), a Claude subscription (Pro/Max) — no API key — and ~2 GB of disk for the image.

---

## 1. Get the image

```bash
docker pull imlouiskhenghao/ai-engine:latest
```

## 2. Sign in to Claude, once

```bash
docker volume create ai-engine-claude
docker run --rm -it -v ai-engine-claude:/home/node/.claude \
  imlouiskhenghao/ai-engine claude auth login
```

It prints a URL; open it in your browser, approve, then paste the code back into the terminal
(`-it` is what lets you paste). The login is stored in the `ai-engine-claude` volume and survives restarts.

> The login **must** happen inside the container. On macOS your host's Claude Code keeps its credentials in the
> Keychain, so mounting your `~/.claude` from the Mac carries settings and skills but *not* the login.

Check any time: `docker exec ai-engine claude auth status`.

### Already signed in to Claude Code on your own machine?

The container is a separate machine as far as Claude Code is concerned, so it needs its own credentials. Pick one:

**Any OS — reuse your subscription with a long-lived token (nothing to log in inside the container):**

```bash
claude setup-token            # on YOUR machine, where you are already signed in; prints a token
```

Put it in a file you keep out of git and hand it to the container:

```bash
echo "CLAUDE_CODE_OAUTH_TOKEN=<the token>" > ~/.ai-engine.env   # chmod 600
docker run -d --name ai-engine --env-file ~/.ai-engine.env ...  # rest of the flags as in §3
```

`docker exec ai-engine claude auth status` then reports `"authMethod": "oauth_token"` and you can skip §2 entirely.
Treat the token like a password: it is your subscription.

**Linux only — mount the credentials you already have:**

```bash
-v ~/.claude:/home/node/.claude      # instead of the ai-engine-claude volume
```

On Linux Claude Code keeps its credentials in `~/.claude/.credentials.json`, so they travel with the mount (the
container will also write its sessions and skills there). On **macOS this does not work**: the credentials live in
the Keychain, not in `~/.claude`.

> **The Setup page's *Sign in* button does not finish inside Docker.** When the engine runs directly on your
> machine, that button opens your browser and the login completes by itself. In a container there is no browser,
> so Claude Code falls back to "copy this code back into the terminal" — which the Setup page has nowhere to
> paste. Use `claude auth login` from §2, or the token above.

## 3. Point it at the repository you want worked on

Two shapes, pick the one that matches you.

### A. You have one repository

Say it lives at `/Users/dana/code/acme-app` (macOS) or `/home/dana/code/acme-app` (Linux):

```bash
docker volume create ai-engine-data

docker run -d --name ai-engine \
  -p 127.0.0.1:4111:4111 \
  -v ai-engine-data:/app/data \
  -v ai-engine-claude:/home/node/.claude \
  -v /Users/dana/code/acme-app:/repos/acme-app \
  imlouiskhenghao/ai-engine
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
docker run -d --name ai-engine \
  -p 127.0.0.1:4111:4111 \
  -v ai-engine-data:/app/data \
  -v ai-engine-claude:/home/node/.claude \
  -v /Users/dana/code:/repos \
  imlouiskhenghao/ai-engine
```

| Where it is on your machine | Inside the container | What you type in *New goal → Repository* |
|---|---|---|
| `/Users/dana/code/acme-app` | `/repos/acme-app` | `/repos/acme-app` |
| `/Users/dana/code/work/api` | `/repos/work/api` | `/repos/work/api` |
| `C:\Users\dana\code\acme-app` (Windows) | `/repos/acme-app` | `/repos/acme-app` — mount as `-v C:\Users\dana\code:/repos` in PowerShell, `-v //c/Users/dana/code:/repos` in Git Bash |

You can add as many mounts as you like: `-v ~/code:/repos -v ~/Desktop/client-work:/client`.

The mount must be **writable**: the engine adds git worktrees, which write into your repository's `.git/`.
It never edits your working tree or your branches — work happens on `goal/<id>` branches inside `/app/data`.

### Linux: if your user id is not 1000

The image runs as uid 1000. If `id -u` gives you something else, run as yourself and keep the engine's state in
folders you own (named volumes would be created owned by 1000):

```bash
mkdir -p ~/.ai-engine/data ~/.ai-engine/claude
docker run -d --name ai-engine \
  --user "$(id -u):$(id -g)" -e HOME=/home/node \
  -p 127.0.0.1:4111:4111 \
  -v ~/.ai-engine/data:/app/data \
  -v ~/.ai-engine/claude:/home/node/.claude \
  -v ~/code:/repos \
  imlouiskhenghao/ai-engine
```

Use the same `--user`/`-e HOME` flags for the `claude auth login` step, with the same `~/.ai-engine/claude` folder.

### Prefer docker compose?

`docker compose` needs a `docker-compose.yml` **in the folder you run it from**, otherwise it answers
`no configuration file provided: not found`. The image ships one:

```bash
docker run --rm imlouiskhenghao/ai-engine cat /app/docker-compose.yml > docker-compose.yml
docker compose run --rm ai-engine claude auth login     # once
AI_ENGINE_REPOS=~/code docker compose up -d             # mounts ~/code at /repos
```

## 4. Delivery: pushing, pull requests, merges (optional)

A goal produces a local branch. If you want the engine to push it or open a PR, give the container its own
GitHub login (ai-engine never stores tokens — `gh` does):

```bash
docker exec -it ai-engine gh auth login
```

Add `-v ai-engine-gh:/home/node/.config/gh` to your `docker run` if you want that login to survive re-creating
the container.

---

## Where things live

| Path in the container | What | Keep it? |
|---|---|---|
| `/app/data/engine.db` | SQLite: goals, tasks, attempts, events (auto-created, auto-migrated — nothing to configure) | **yes** |
| `/app/data/worktrees` | one git worktree per goal/task; the branches with the actual work | until the goal is delivered |
| `/app/data/transcripts`, `check-output`, `attachments` | session logs, check output, your uploads | optional |
| `/home/node/.claude` | Claude login, sessions, installed skills | **yes** |
| `/repos/...` | your repositories (mounted from your machine) | it *is* your machine |

Back up the two volumes:

```bash
docker stop ai-engine
docker run --rm -v ai-engine-data:/d -v "$PWD":/out alpine tar czf /out/ai-engine-data.tgz -C /d .
docker start ai-engine
```

Upgrade: `docker pull imlouiskhenghao/ai-engine:latest`, then `docker rm -f ai-engine` and run it again with the
same volumes — the event log is replayed and unfinished attempts resume where they stopped.

## Troubleshooting

| What you see | Why | Fix |
|---|---|---|
| `no configuration file provided: not found` | `docker compose` was run in a folder with no `docker-compose.yml` | use the `docker run` form above, or fetch the compose file out of the image (§3) |
| `Not logged in · Please run /login` | `claude login` is not a command | `claude auth login` (with `-it`) |
| Setup page shows the login URL but never completes | in Docker the OAuth flow needs a code pasted into a terminal | log in with `docker run … -it … claude auth login`, or use `CLAUDE_CODE_OAUTH_TOKEN` (§2) |
| *not a git repository* in New goal | you typed a host path | type the container path, e.g. `/repos/acme-app` |
| `Permission denied` writing in the repo, or worktrees fail (Linux) | your files are not owned by uid 1000 | use the `--user "$(id -u):$(id -g)"` recipe above |
| `port is already allocated` | something else uses 4111 | `-p 127.0.0.1:4112:4111` and open that port instead |
| Setup page: *markitdown not installed* | optional PDF/Office → markdown converter | `docker exec ai-engine uv tool install --python 3.12 'markitdown[all]'` |
| Stale worktrees in your repo's `git worktree list` | worktrees were registered with container paths | `git worktree prune` in that repository |

## Notes

- The UI has no authentication — keep the published port on `127.0.0.1`, never expose 4111 to a network.
- `AI_ENGINE_HOST=0.0.0.0` is already set inside the image; do the loopback binding on the host side (`-p 127.0.0.1:…`).
- Useful env vars: `AI_ENGINE_MODEL_STRONG` / `_WORKER` / `_CHEAP` (default `opus`/`opus`/`haiku`), `AI_ENGINE_MAX_CONCURRENT` (3), `AI_ENGINE_TDD` (`required|preferred|off`), `AI_ENGINE_GOAL_MODE` (`simple|expert`). Everything else is editable in Settings.
- Interrupted attempts resume as Continuations after a restart — see [runbook](./runbook.md).
- Build your own: `docker build -t ai-engine .` (add `--build-arg CLAUDE_CODE_VERSION=x.y.z` to pin a different CLI).
- No API key is ever needed or used; `ANTHROPIC_API_KEY` is stripped from every session the engine spawns.
