# Updates and backup

This page says where Foundry keeps its state, how to back it up and restore it, and how updates work.

---

## What lives where

| What | Where | Back it up? |
|---|---|---|
| **Data folder**: event log, settings, transcripts, uploads | `data/` for the Claude launch profile, `data-codex/` for Codex, `data-agy/` for Antigravity, under `~/Library/Application Support/Foundry/` on macOS (the app, or the binary there) and `~/.local/share/foundry/` on Linux; the folder chosen in Settings → Engine (install), remembered in `~/.foundry/config.json`; `FOUNDRY_DATA_DIR` overrides all of them | **yes**, every instance’s active directory (**Settings → Engine (install) → Data folder** shows it) |
| **Claude home**: Claude Code login, sessions, skills, plugins | `~/.claude` (or `CLAUDE_CONFIG_DIR`) | **yes** |
| **Codex home**: native login/configuration, sessions, skills, plugins | `~/.codex`, or the configured Codex home (`FOUNDRY_CODEX_HOME`, then `CODEX_HOME`) | **yes**; re-login may still be needed when credentials use a host credential store |
| **Shared skills** | `~/.agents/skills` | if you customized them |
| **Your repositories** | wherever they are | your normal backups |
| **Progress folders**: one per goal, next to each repository | `<repo>-foundry/<goal>/` | until the goal is deleted |
| **GitHub login** (`gh`) | `~/.config/gh` | optional |
| **Chromium** for the self-check | `~/Library/Caches/ms-playwright` on macOS, `~/.cache/ms-playwright` on Linux | no: **Install Chromium** downloads it again |

On macOS, the Claude login is in the Keychain, not in `~/.claude`.

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
| `skill-snapshots/` | the SKILL.md of every skill a goal's sessions were given, as it read then (small, one copy per content) | yes, if you want a goal's Skills card to open them |
| `attachments/` | files and links attached to goals | yes, if you want them |
| `skills-cache/`, `skills-trash/` | fetched skill sources; uninstalled skills (restorable) | optional |
| `worktrees/`, `screenshots/` | work of goals created before 0.3.0 (before progress folders) | until those goals are delivered |
| `update-restart.log` | output of Foundry after it restarted itself for an update, where no service manager restarts it | no |

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
eligible unfinished attempts resume after restart on the same backend. Choose **Quit Foundry** in the app's menu, or run `foundry stop` (the installer's command, which stops the binary's service too), so nothing starts the engine again while you copy. Native homes may also be written by terminal or desktop clients: close those clients before taking a consistent copy. Use a private backup directory; it contains account and service credentials.

```bash
umask 077
foundry stop                 # or Quit Foundry in the app's menu
tar czf foundry-data.tgz -C "$HOME/Library/Application Support/Foundry/data" .   # Linux: -C ~/.local/share/foundry/data
foundry start                # or open the app again
```

Use `data-codex` or `data-agy` for a Codex or Antigravity launch profile, and the folder **Settings → Engine (install) → Data folder** shows when you chose another, or your `FOUNDRY_DATA_DIR`. Copy the complete directory, including `provider` and `providers/`. Back up the configured Claude and Codex homes and any shared skills with the rest of your home folder.

---

## Restore

Stop Foundry as for a backup, then restore the archive into an empty data folder. Keep the current one aside rather
than deleting it:

```bash
foundry stop                 # or Quit Foundry in the app's menu
cd "$HOME/Library/Application Support/Foundry"      # Linux: cd ~/.local/share/foundry
mv data data.before-restore
mkdir data && tar xzf /path/to/foundry-data.tgz -C data
foundry start                # or open the app again
```

Use the same folder as the backup (`data-codex`, `data-agy`, or the one you chose). On a new machine, install the app or the binary first, then restore. Restore native homes separately. Start with the same launch profile, native-home settings and data path as the backup. Confirm both accounts in **Accounts**; a copied native home does not guarantee credentials remain valid.

The database stores repository paths as the engine saw them. On a new machine, put the repositories at the same paths.
If a repository's `git worktree list` shows worktrees that no longer exist, run `git worktree prune` in that
repository.

---

## Moving to another computer: Transfer

A backup copies the whole data folder and restores it as it was, at the same paths. To move to a new computer, or to
bring some goals into a Foundry that already has its own, use a **Transfer** instead (the ⚙ menu → **Transfer**, or the CLI):

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

**Do not open an upgraded mixed-provider directory with an older binary.** A rollback needs both the old release and its matching pre-upgrade data backup. Keep post-upgrade data separately if it contains work you need. Reverting application code alone is insufficient. Repository branches and progress folders are separate from the database backup, so preserve those too.

If trying an unreleased branch, retain the previous release or commit. A successful merge does not publish a release. Build that revision explicitly ([Developing Foundry](../develop/README.md)); use [the validation record](../develop/codex-validation.md) to distinguish tested paths from live integration checks still outstanding.

## Moving to 3.0

From 3.0 Foundry ships only as the macOS app and the Linux binary
([ADR-0108](../develop/adr/0108-foundry-ships-only-as-the-app-and-the-binary.md)): there is no image and no install
from source. A source install or a Docker container on the last 2.x sees 3.0 in **About & updates** as a switch, not an
update ([ADR-0106](../develop/adr/0106-before-3-0-a-switch-not-an-update.md)): the dialog says what switching does, the
risks and the way back before anything happens.

**From source.** Tick *I understand* and press **Switch to 3.0**, or run `foundry update` and answer yes. Foundry
downloads 3.0 for this computer and checks it, puts the app in Applications (the binary in
`~/.local/share/foundry` on Linux), stops itself and its service, copies its data folder to the new install's
(`~/Library/Application Support/Foundry`, `~/.local/share/foundry`), and starts the new one on the same port. The
page reconnects by itself. The checkout and its `data/` stay as they were, with a `MOVED.md` saying where the data
went: they are the backup. Watch it in `~/.foundry/switch.log`. To go back, quit the new Foundry and start the
checkout again. A source install older than 2.36 has no switch: its `foundry update` says so and names the one line
below, which installs 3.0, finds the checkout and offers to move its goals the same way.

**From Docker.** Nothing in the container can install on the host, so the dialog shows one command to run on the
computer Docker runs on:

```bash
curl -fsSL https://raw.githubusercontent.com/louiskhenghao/Foundry/main/install.sh | bash
```

It installs 3.0 (the app on a Mac, the binary on Linux), finds the container and offers to move its goals
([ADR-0107](../develop/adr/0107-a-move-from-an-earlier-install-takes-one-click.md)). The goals at work are paused, the
container and its watchtower stop and Docker does not start them again, and the data in its volumes is copied with
`/app/data` and each bind mount (`/repos`…) pointed at this computer's folders. On a Mac, downloading the app and
opening it offers the same move. The sign-ins are your computer's own: sign in to each coding agent on the Setup page.
The container and its volumes stay as they were: to go back, quit the new Foundry and start the container again
(`docker update --restart=unless-stopped foundry && docker start foundry`).

The 2.36.0 dialog lists six commands instead (install with `--no-start`, copy the volume, `foundry repath`, start).
They still work: an installer run with `--no-start` leaves the container to them.

**From the app or the binary.** A source or Docker install can move at any time: install the app (or the binary), open
it and press **Bring your goals over** ([Moving an earlier install](./install.md#moving-an-earlier-install)).

## Self-update

The app and the binary update themselves from the release on GitHub
([ADR-0104](../develop/adr/0104-foundry-ships-as-compiled-binaries-with-its-files-beside-them.md)). An install made
with the [installer](./install.md#the-installer) also updates from the terminal: `foundry update` runs the newest
installer the same way as last time, which installs the newest release. The binary's service sets
`FOUNDRY_SUPERVISED=1`, so the button below works with it too.

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

The mode is detected, never configured: the app and the binary know their own layout, and a git checkout (for working
on Foundry itself) is a local install, which pulls with git instead. **Settings → About & updates** shows the mode next
to the version.

### The app

**Update** downloads `Foundry-<version>-mac-universal.zip` into the data folder's `updates/` and checks it against the
release's `SHA256SUMS`: a file that does not match is deleted and nothing changes. Then the engine exits, and the menu
bar app swaps `Foundry.app` for the new one and starts it. The app it replaced is kept in `updates/previous/`. An
engine started without the menu bar app cannot swap the bundle: the dialog then names the file to download and put in
place of `Foundry.app` yourself.

### The binary

**Update** downloads `foundry-<version>-<platform>.tar.gz`, checks it against `SHA256SUMS`, unpacks it beside the
current version in `~/.local/share/foundry/releases/`, points `current` at it and restarts. The version it replaced
stays in `releases/`. Under the installer's systemd or launchd service (`FOUNDRY_SUPERVISED=1`; systemd is also detected
by its `INVOCATION_ID`), Foundry just exits and the service manager starts the new version. Without a service manager it
starts the new version itself, detached, logging to `<dataDir>/update-restart.log`. A `foundry` that is not in a
`releases/<version>` folder with a `current` link cannot update itself: the dialog shows the steps instead.

### Restarting by hand

Before a manual restart, check that nothing is running. See
[troubleshooting.md § Restarting safely](./troubleshooting.md#restarting-safely).

---

## Release channel

- **Where versions come from.** Every install reads the GitHub Releases of `louiskhenghao/foundry-releases` and takes
  the newest published, stable `vX.Y.Z` release. Drafts, pre-releases and other tags are ignored.
- **Release files.** Every release carries the macOS app (`Foundry-<version>-mac-universal.dmg` and `.zip`), the
  binaries (`foundry-<version>-darwin-universal.tar.gz`, `foundry-<version>-linux-x64.tar.gz`,
  `foundry-<version>-linux-arm64.tar.gz`) and `SHA256SUMS`.
- **Pinning.** To stay on one version, install it with `--version X.Y.Z` and do not press **Update**: Foundry never
  updates by itself.
- **No image.** The Docker Hub image `imlouiskhenghao/foundry` ends at 2.36.0, where `latest` stays
  ([ADR-0108](../develop/adr/0108-foundry-ships-only-as-the-app-and-the-binary.md)).
- **Changelog.** <https://raw.githubusercontent.com/louiskhenghao/foundry-releases/main/CHANGELOG.md>
  (repository `louiskhenghao/foundry-releases`). The update dialog shows the sections newer than your version.
- **Your version.** **Settings → About & updates**, or the `version` field of `GET /api/health`.

### Turning the check off

```bash
FOUNDRY_UPDATE_CHECK=off      # also accepted: 0, false, no
```

This stops the daily background check. Opening the UI still checks once after each start, and **Check now** still
works. The Update button is never pressed for you.

The version source and changelog URL can be pointed elsewhere with `FOUNDRY_RELEASES_URL` (default: the GitHub
Releases API of `louiskhenghao/foundry-releases`) and `FOUNDRY_CHANGELOG_URL`. Normal installs do not need them.
