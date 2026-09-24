# Updates and backup

This page says where Foundry keeps its state, how to back it up and restore it, and how updates work.

---

## What lives where

| What | Local install | Docker | Back it up? |
|---|---|---|---|
| **Data folder**: event log, settings, transcripts, uploads | `data/` in the Foundry checkout | `/app/data`, volume `engine-data` | **yes** |
| **Claude home**: Claude Code login, sessions, skills, plugins | `~/.claude` (or `CLAUDE_CONFIG_DIR`) | `/home/node/.claude`, volume `claude-home` | **yes** |
| **Your repositories** | wherever they are | bind-mounted, usually at `/repos` | your normal backups |
| **Progress folders**: one per goal, next to each repository | `<repo>-foundry/<goal>/` | same, inside the mount | until the goal is deleted |
| **GitHub login** (`gh`) | `~/.config/gh` | `/home/node/.config/gh`, no volume unless you add one | optional |

With Docker Compose, the real volume names start with the Compose project name, which is the folder you run
`docker compose` from. From `~/foundry` they are `foundry_engine-data` and `foundry_claude-home`.
`docker volume ls` lists them. With the `docker run` recipes in [install.md](./install.md) they are plainly
`engine-data` and `claude-home`. The two sets are different volumes: switching from one way of running to the
other means restoring a backup into the new volumes.

With the Linux uid ≠ 1000 recipe, the data folder is `~/.foundry/data` and the whole home is `~/.foundry/home`.

On macOS, a local install's Claude login is in the Keychain, not in `~/.claude`.

### Inside the data folder

| Path | What | Keep? |
|---|---|---|
| `engine.db` | SQLite: goals, tasks, attempts, every event. Created and migrated automatically. | **yes** |
| `settings.json` | every value you changed on the Settings page | **yes** |
| `models.json` | which model names resolved on this machine (learned) | optional |
| `transcripts/`, `check-output/` | session logs, check output | optional |
| `attachments/` | files and links attached to goals | yes, if you want them |
| `skills-cache/`, `skills-trash/` | fetched skill sources; uninstalled skills (restorable) | optional |
| `worktrees/`, `screenshots/` | work of goals created before 0.3.0 (before progress folders) | until those goals are delivered |
| `update-restart.log` | output of a local install after it restarted itself for an update | no |

### Inside a progress folder's parent

Each repository `my-app` gets a sibling folder `my-app-foundry/`:

| Path | What |
|---|---|
| `my-app-foundry/<goal>/` | the goal's worktree on its `goal/<id>` branch. Open and run the work here. |
| `my-app-foundry/.foundry/<goal>/` | the engine's own worktrees for that goal (`tasks/`, `delivery/`, `resolve/`, `baseline/`) and self-check `screenshots/` |

**Settings → Engine (install) → Progress folders** (`FOUNDRY_WORKSPACES_ROOT`) moves new goals to
`<folder>/<repo>/<goal>/` instead.

---

## Back up

Stop Foundry first, so the SQLite database is not written while you copy it. A stopped engine loses nothing:
unfinished attempts resume after the restart.

### Docker

This works for Compose and `docker run` alike, because `--volumes-from` finds the volumes by container:

```bash
docker stop foundry
docker run --rm --volumes-from foundry -v "$PWD":/out alpine \
  tar czf /out/foundry-data.tgz -C /app/data .
docker run --rm --volumes-from foundry -v "$PWD":/out alpine \
  tar czf /out/foundry-claude.tgz -C /home/node/.claude .
docker start foundry
```

The same by volume name (`docker run` recipe; with Compose use the prefixed names from `docker volume ls`):

```bash
docker stop foundry
docker run --rm -v engine-data:/d -v "$PWD":/out alpine tar czf /out/foundry-data.tgz -C /d .
docker run --rm -v claude-home:/c -v "$PWD":/out alpine tar czf /out/foundry-claude.tgz -C /c .
docker start foundry
```

### Local install

Stop the server (Ctrl-C, or stop the service), then copy the data folder:

```bash
tar czf foundry-data.tgz -C /path/to/foundry data
```

Back up `~/.claude` with the rest of your home folder.

---

## Restore

Stop Foundry. Restore into the existing container's volumes:

```bash
docker stop foundry
docker run --rm --volumes-from foundry -v "$PWD":/in alpine sh -c \
  'find /app/data -mindepth 1 -delete && tar xzf /in/foundry-data.tgz -C /app/data && chown -R 1000:1000 /app/data'
docker run --rm --volumes-from foundry -v "$PWD":/in alpine sh -c \
  'find /home/node/.claude -mindepth 1 -delete && tar xzf /in/foundry-claude.tgz -C /home/node/.claude && chown -R 1000:1000 /home/node/.claude'
docker start foundry
```

On a new machine, create the container first (`docker compose up -d` or your `docker run` line), then run the
commands above. With the uid ≠ 1000 recipe, unpack into `~/.foundry/data` and `~/.foundry/home/.claude` instead and
skip the `chown`.

For a local install, stop the server and unpack `foundry-data.tgz` in the checkout, so it recreates `data/`.

The database stores repository paths as the engine saw them (container paths in Docker). On a new machine, mount the
repositories at the same paths. If a repository's `git worktree list` shows worktrees that no longer exist, run
`git worktree prune` in that repository.

---

## Self-update

Foundry checks for a new version by itself: about 15 seconds after it starts, then every 24 hours. When a newer
release exists:

- the header shows an update pill with the new version number;
- **Settings → About & updates** shows the changelog and an **Update to x.y.z** button. **Check now** checks right away;
- the **New version** notification fires, once per version (see [notifications.md](./notifications.md)).

### What pressing Update does

1. **Drain.** Foundry stops starting new sessions and waits for active ones to finish, for up to one hour. If they
   are still running after an hour, the update stops with *drain timed out after 60min* and Foundry carries on as
   before. Tick **Update immediately without waiting — interrupts running agents** to skip the wait.
2. **Replace.** How depends on the install (below). The dialog streams the progress.
3. **Restart.** The page reconnects by itself. On start the engine replays its event log, and attempts that were
   cut off resume where they stopped.

The mode is detected, never configured: the image sets `FOUNDRY_DOCKER=1`; a checkout with a `.git` folder is a
local install. **Settings → About & updates** shows the mode next to the version.

### Docker with the updater sidecar (Compose)

The shipped `docker-compose.yml` runs a [watchtower](https://containrrr.dev/watchtower/) sidecar. It is the only
container that touches the Docker socket. Foundry asks it over HTTP to pull the new image and re-create the
`foundry` container.

One-click update needs all of these, and the shipped compose file provides them:

- the container is named `foundry`;
- the container sees `FOUNDRY_WATCHTOWER_URL` and `FOUNDRY_WATCHTOWER_TOKEN`;
- the sidecar runs with the same token (`WATCHTOWER_HTTP_API_TOKEN`).

If the container is still running five minutes after watchtower accepted the request, Foundry logs
`[update] watchtower accepted the trigger but this container was never replaced` and starts taking work again.

A compose file fetched before 0.2.0 has no sidecar. Fetch the current one again (this overwrites your edits to it, so
re-apply them):

```bash
docker run --rm imlouiskhenghao/foundry:latest cat /app/docker-compose.yml > docker-compose.yml
docker compose up -d
```

### Docker without the sidecar

Without the sidecar the dialog shows the commands to run on the host instead of an Update button:

```bash
docker compose pull foundry
docker compose up -d foundry
```

If you started with `docker run`, do the same by hand. Use exactly the flags and volumes you started with:

```bash
docker pull imlouiskhenghao/foundry:latest
docker rm -f foundry
docker run -d --name foundry ...        # your original line, same volumes
```

After re-creating the container, install Chromium again if you use the self-check (it is not kept in a volume), and
log in to `gh` again unless you mounted a volume for it (see [install.md](./install.md#7-github-for-delivery-optional)).

### Local install (git)

When `git` and `bun` are on the `PATH`, **Update** runs in the Foundry checkout:

```bash
git pull --ff-only
bun install
bun run web:build
```

Each step may take up to 15 minutes. If any step fails, Foundry runs `git reset --hard` back to the commit it
started from and `bun install` again, and does **not** restart. You stay on the old version.

- The rollback is a hard reset, so do not keep uncommitted changes in the Foundry checkout.
- `git pull --ff-only` pulls the branch the checkout is on. Releases are tagged `vX.Y.Z` on `main`.

After a successful update Foundry restarts itself: it starts a detached `bun apps/cli/src/main.ts serve` that logs to
`data/update-restart.log`, then exits.

**Under launchd or systemd, set `FOUNDRY_SUPERVISED=1`.** Then Foundry just exits after the update and the service
manager starts the new version. Without it, the self-started copy and the service manager fight over the port.
Under systemd, Foundry also detects the service by its `INVOCATION_ID` variable. The service files are in
[remote-access.md](./remote-access.md#the-engine-as-a-service).

If `git` or `bun` is missing, the dialog shows the commands to run yourself, then restart:

```bash
git pull
bun install
bun run web:build
bun run serve
```

### Restarting by hand

Before a manual restart, check that nothing is running. See
[troubleshooting.md § Restarting safely](./troubleshooting.md#restarting-safely).

---

## Release channel

- **Where versions come from.** Both Docker and local installs ask Docker Hub for the tags of
  `imlouiskhenghao/foundry` and take the newest stable `x.y.z` tag. Other tags are ignored.
- **Image tags.** Every release is pushed as `x.y.z` and as `latest`, for `linux/amd64` and `linux/arm64`.
- **Pinning.** To stay on one version, use a version tag, for example `image: imlouiskhenghao/foundry:0.4.0` in
  `docker-compose.yml`. The sidecar re-pulls the tag the container runs, so a pinned container does not move. Change
  the tag and run `docker compose up -d` to move. Use `latest` for one-click updates.
- **Changelog.** <https://raw.githubusercontent.com/louiskhenghao/foundry-releases/main/CHANGELOG.md>
  (repository `louiskhenghao/foundry-releases`). The update dialog shows the sections newer than your version.
- **Your version.** **Settings → About & updates**, or the `version` field of `GET /api/health`.

### Turning the check off

```bash
FOUNDRY_UPDATE_CHECK=off      # also accepted: 0, false, no
```

This stops the daily background check. Opening the UI still checks once after each start, and **Check now** still
works. The Update button is never pressed for you.

The version source and changelog URL can be pointed elsewhere with `FOUNDRY_UPDATE_IMAGE` (default
`imlouiskhenghao/foundry`) and `FOUNDRY_CHANGELOG_URL`. Normal installs do not need them.
