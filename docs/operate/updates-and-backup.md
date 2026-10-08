# Updates and backup

This page says where Foundry keeps its state, how to back it up and restore it, and how updates work.

---

## What lives where

| What | Local install | Docker | Back it up? |
|---|---|---|---|
| **Data folder**: event log, settings, transcripts, uploads | `data/` for the Claude launch profile; `data-codex/` for Codex; `FOUNDRY_DATA_DIR` overrides either | `/app/data` (`engine-data`) or `/app/data-codex` (`codex-data`) | **yes**, every instance’s active directory |
| **Claude home**: Claude Code login, sessions, skills, plugins | `~/.claude` (or `CLAUDE_CONFIG_DIR`) | `/home/node/.claude`, volume `claude-home` | **yes** |
| **Codex home**: native login/configuration, sessions, skills, plugins | `~/.codex`, or the configured Codex home (`FOUNDRY_CODEX_HOME`, then `CODEX_HOME`) | `/home/node/.codex`, volume `codex-home` | **yes**; re-login may still be needed when credentials use a host credential store |
| **Shared skills** | `~/.agents/skills` | wherever you explicitly mount shared skills | if you customized them |
| **Your repositories** | wherever they are | bind-mounted, usually at `/repos` | your normal backups |
| **Progress folders**: one per goal, next to each repository | `<repo>-foundry/<goal>/` | same, inside the mount | until the goal is deleted |
| **GitHub login** (`gh`) | `~/.config/gh` | `/home/node/.config/gh`, no volume unless you add one | optional |
| **Chromium** for the self-check | `~/.cache/ms-playwright` | `/home/node/.cache/ms-playwright`, volume `playwright-browsers` (Compose) | no: **Install Chromium** downloads it again |

With Docker Compose, the real volume names start with the Compose project name, which is the folder you run
`docker compose` from. From `~/foundry` they include `foundry_engine-data`, `foundry_codex-data`, `foundry_claude-home` and `foundry_codex-home`.
`docker volume ls` lists them. With the `docker run` recipes in [install.md](./install.md) they are plainly
`engine-data`, `codex-data`, `claude-home` and `codex-home` when those mounts are present. The prefixed and unprefixed sets are different volumes: switching from one way of running to the
other means restoring a backup into the new volumes.

With the Linux uid ≠ 1000 recipe, the data folders are `~/.foundry/data` and `~/.foundry/data-codex`, and the whole home is `~/.foundry/home`.

On macOS, a local install's Claude login is in the Keychain, not in `~/.claude`.

### Inside the data folder

| Path | What | Keep? |
|---|---|---|
| `engine.db` | SQLite: goals, tasks, attempts, every event. Created and migrated automatically. | **yes** |
| `settings.json` | every value you changed on the Settings page, including both providers’ presets and permissions | **yes** |
| `preview-env.json` | variables entered on goals' Preview cards, per repository; may hold secrets, so it is readable by your user only | **yes** |
| `provider` | the directory’s original launch profile; required to keep old goals on the right backend | **yes** |
| `models.json` | native model catalog for the launch provider | optional |
| `providers/<other-provider>/` | the other backend’s model catalog and skills cache/trash/update state; goal events remain in the shared `engine.db` | keep with the whole data folder |
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
eligible unfinished attempts resume after restart on the same backend. Stop the supervising service or disable its restart while copying, so it does not immediately start the engine again. Native homes may also be written by terminal or desktop clients: close those clients before taking a consistent copy. Use a private backup directory; it contains account and service credentials.

### Docker

This works for Compose and `docker run` alike, because `--volumes-from` finds the volumes by container:

```bash
mkdir -p foundry-backup
chmod 700 foundry-backup
cd foundry-backup
umask 077
docker stop foundry
docker run --rm --volumes-from foundry -v "$PWD":/out alpine \
  tar czf /out/foundry-data.tgz -C /app/data .
docker run --rm --volumes-from foundry -v "$PWD":/out alpine \
  tar czf /out/foundry-claude.tgz -C /home/node/.claude .
```

For a Codex-profile or mixed-provider container, also copy each mounted Codex path while the container remains stopped:

```bash
docker run --rm --volumes-from foundry -v "$PWD":/out alpine \
  tar czf /out/foundry-codex-data.tgz -C /app/data-codex .
docker run --rm --volumes-from foundry -v "$PWD":/out alpine \
  tar czf /out/foundry-codex-home.tgz -C /home/node/.codex .
```

Only archive paths your container actually mounts; a Claude-profile instance with Codex goals still keeps those goals in `/app/data`, so back up that directory as well as the Codex home. `FOUNDRY_DATA_DIR` may point elsewhere: substitute its actual path.

After all mounted state has been copied, run `docker start foundry`.

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
umask 077
tar czf foundry-data.tgz -C /path/to/foundry/data .
```

Substitute `/path/to/foundry/data-codex` or your actual `FOUNDRY_DATA_DIR` when appropriate. Copy the complete directory, including `provider` and `providers/`. Back up the configured Claude and Codex homes and any shared skills with the rest of your home folder.

---

## Restore

Stop Foundry and its supervisor. Keep a backup of the current state before replacing it: the commands below empty the destination. From the private backup directory, restore the matching data archive and native homes into the existing container’s volumes:

```bash
docker stop foundry
docker run --rm --volumes-from foundry -v "$PWD":/in alpine sh -c \
  'find /app/data -mindepth 1 -delete && tar xzf /in/foundry-data.tgz -C /app/data && chown -R 1000:1000 /app/data'
docker run --rm --volumes-from foundry -v "$PWD":/in alpine sh -c \
  'find /home/node/.claude -mindepth 1 -delete && tar xzf /in/foundry-claude.tgz -C /home/node/.claude && chown -R 1000:1000 /home/node/.claude'
```

On a new machine, create the container first (`docker compose up -d` or your `docker run` line), then run the
commands above. With the uid ≠ 1000 recipe, unpack into `~/.foundry/data` and `~/.foundry/home/.claude` instead and
skip the `chown`.

For Codex, repeat the restore pattern with `/app/data-codex` and `foundry-codex-data.tgz`, and `/home/node/.codex` with `foundry-codex-home.tgz`, only for paths you mounted. Match the original UID/GID. Keep the container stopped until every required archive has been restored, then run `docker start foundry`.

For a local install, restore the archive contents into an empty data directory, for example `tar xzf foundry-data.tgz -C /path/to/foundry/data`. Restore native homes separately. Start with the same launch profile, native-home settings and data path as the backup. Confirm both accounts in **Accounts**; a copied native home does not guarantee credentials remain valid.

The database stores repository paths as the engine saw them (container paths in Docker). On a new machine, mount the
repositories at the same paths. If a repository's `git worktree list` shows worktrees that no longer exist, run
`git worktree prune` in that repository.

---

## Moving to another computer: Transfer

A backup copies the whole data folder and restores it as it was, at the same paths. To move to a new computer, or to
bring some goals into a Foundry that already has its own, use a **Transfer** instead (Settings → **Transfer**, or the CLI):

```bash
# on the old computer (with or without the server running)
foundry export --out move.tgz --settings --goals all --secrets --password-stdin <<<'a long password'
# on the new one
foundry import move.tgz --dry-run
foundry import move.tgz --secrets --password-stdin --map /Users/old/app=/Users/new/app <<<'a long password'
foundry reattach <goalId>            # an unfinished goal carries on here
```

- It merges: a goal already here is skipped, settings sections and credentials change only as chosen.
- Imported goals are history until Reattached: no session, delivery, PR polling or notification touches them.
- Branches with work the base branch lacks travel as git bundles. They are restored when the goal's repository is
  mapped to a checkout here, matched by path and remote or chosen. A thin bundle fetches its base commits from the
  remote when the checkout lacks them.
- Never transferred: native sign-ins, skills, MCP servers and plugins, and the settings tied to one computer
  (the `engine` section, `notifications.baseUrl` and `tailscaleHost`, `tools.markitdownBin`, `safety.allowedRoots`,
  `preview.portFrom`/`portTo`).
- Keys & secrets are sealed with scrypt and AES-256-GCM. The rest of the file is plain: keep it private anyway, it
  holds your goals' history.
- A file from an older release imports into a newer one; a newer file is refused until this Foundry is updated.
- The server accepts the upload streamed (any size); `foundry export --transcripts` is the comfortable path for very
  large logs.

## Upgrading to mixed-provider goals

Back up before the first startup of this revision. Startup appends provider assignments for older goals and records the data directory’s launch profile. Keep the existing Claude profile for an existing `data/`; add Codex through **Accounts** and the New goal backend selector. Changing `FOUNDRY_PROVIDER` is not a migration, and existing `data/` and `data-codex/` directories are not merged automatically.

**Do not open an upgraded mixed-provider directory with an older binary.** A rollback needs both the old binary/image and its matching pre-upgrade data backup. Keep post-upgrade data separately if it contains work you need. Reverting application code alone is insufficient. Repository branches and progress folders are separate from the database backup, so preserve those too.

If trying an unreleased branch, retain the previous image tag or commit. A successful merge does not publish a Docker image. Build that source revision explicitly; use [the validation record](../develop/codex-validation.md) to distinguish tested paths from live integration checks still outstanding.

## Self-update

An install made with the [one-line installer](./install.md#one-line) also updates from the terminal: `foundry update`
runs the newest installer the same way as last time (source: pull, rebuild, restart the service; Docker: pull the
image, recreate the container). Its service sets `FOUNDRY_SUPERVISED=1`, so the button below works with it too.

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

With Docker 29 or newer, the sidecar needs `DOCKER_API_VERSION: '1.40'` in its environment: its own client asks for API
1.25, which Docker 29 refuses, and the sidecar restarts in a loop. The compose file in images after 1.0.0 sets it; an
older `docker-compose.yml` needs the line added under `watchtower: environment:`, or run the installer again.

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

After re-creating the container, install Chromium again if you use the self-check, unless you mounted a volume at
`/home/node/.cache/ms-playwright` (see [install.md](./install.md#6-previews-from-the-host)), and log in to `gh` again
unless you mounted a volume for it (see [install.md](./install.md#7-github-for-delivery-optional)).

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
`<dataDir>/update-restart.log`, then exits.

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
