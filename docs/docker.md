# Running ai-engine in Docker

The image ships the engine, its web UI and the tools it drives (`bun`, `git`, `claude`, `gh`, `rg`, `npx`, `uv`, `graphify`).
Two things it deliberately does **not** ship: your Claude login and your repositories — both are mounted.

```bash
docker pull imlouiskhenghao/ai-engine:latest
```

## First run

```bash
# 1. log in to Claude once — the credentials land in the claude-home volume
AI_ENGINE_REPOS=~/Projects docker compose run --rm ai-engine claude login   # follow the URL, paste the code

# 2. start it
AI_ENGINE_REPOS=~/Projects docker compose up -d
open http://127.0.0.1:4111
```

Without compose:

```bash
docker volume create ai-engine-data && docker volume create ai-engine-claude
docker run --rm -it -v ai-engine-claude:/home/node/.claude imlouiskhenghao/ai-engine claude login
docker run -d --name ai-engine -p 127.0.0.1:4111:4111 \
  -v ai-engine-data:/app/data -v ai-engine-claude:/home/node/.claude \
  -v ~/Projects:/repos imlouiskhenghao/ai-engine
```

**The login must happen inside the container.** On macOS the host's Claude Code keeps its credentials in the
Keychain, so mounting `~/.claude` from a Mac carries settings and skills but not the login. In the container they
are written to `/home/node/.claude/.credentials.json` inside the `claude-home` volume and survive restarts.

## Repositories

Mount the directory that holds them and give goals the **container** path:

| Host | Container | What you type in *New goal → Repository* |
|---|---|---|
| `~/Projects/my-app` | `/repos/my-app` | `/repos/my-app` |

The engine never touches your checkout: it creates git worktrees under `/app/data/worktrees`. Those worktrees are
registered in your repository's `.git/worktrees` with *container* paths, so on the host they look stale — harmless,
and `git worktree prune` in that repository clears the entries once a goal is deleted.

## Delivery (push / PR / merge)

Delivery uses the GitHub CLI, which needs its own login inside the container:

```bash
docker compose exec ai-engine gh auth login
```

No tokens are stored by ai-engine; `gh` owns them, in the `claude-home` volume's neighbouring `~/.config/gh`
(add `-v ai-engine-gh:/home/node/.config/gh` if you want that to persist too).

## Notes

- The UI has no authentication: the compose file binds it to `127.0.0.1` only. Do not expose 4111 publicly.
- `AI_ENGINE_HOST=0.0.0.0` is set inside the image so the port is reachable from the host; keep the loopback binding on the host side.
- Everything the engine writes — event log, worktrees, transcripts, settings, model registry — lives in `/app/data`.
- The image runs as the non-root `node` user (uid 1000). Files it creates in mounted repos belong to that uid.
- Restarting the container is safe: interrupted attempts resume as Continuations (see [runbook](./runbook.md) §7).
- `markitdown` (PDF/Office → markdown before a session reads them) is not bundled; install it once into the container with `docker compose exec ai-engine uv tool install --python 3.12 'markitdown[all]'`, or from the Setup page.
- Bump the bundled CLI with `docker build --build-arg CLAUDE_CODE_VERSION=x.y.z .`; the engine itself never needs an API key (`ANTHROPIC_API_KEY` is stripped from every session).
