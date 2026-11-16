# ADR-0102: The Foundry app and the release installs

**Status:** accepted · 2026-11-16 · builds on ADR-0101 · amends ADR-0024 and ADR-0082

## Context

ADR-0101 made Foundry a compiled executable with its files beside it, released on GitHub. Four things were still
missing before the Docker image could go. A Mac needs an app a person can download and open, which runs Foundry
without a terminal and keeps it running. A computer that never ran the installer has no one to install git, uv, the
coding agents' CLIs, graphify, the GitHub CLI or Node.js. A source install (a git checkout run by Bun) needs a way to
its goals in the new install. And the installer itself has to place a release instead of building a checkout. The
choices were settled with the person who owns the project on 2026-11-16: a Swift menu bar app around the engine, the
page staying in the browser; not notarized; the recipes of the installer moved into Foundry itself; the source
install's data copied, never moved.

## Decision

- **The app is a menu bar shell around the engine.** `apps/mac/Foundry/main.swift`, AppKit and ServiceManagement only,
  built by `scripts/build-release.ts` with `swiftc` for arm64 and x86_64 and joined with `lipo` (no Xcode project).
  `Foundry.app/Contents/MacOS/Foundry` is the shell; the universal foundry beside it is `foundry-engine`, because
  `foundry` and `Foundry` are one name on the case-insensitive disk most Macs have. `Contents/Resources` holds the
  release's resources (ADR-0101) and the icon (`apps/mac/Foundry.icns`, drawn from the favicon by
  `scripts/mac-icon.ts`). The bundle is `com.louiskhenghao.foundry`, a menu bar app (`LSUIElement`) for macOS 13 and
  later, signed ad-hoc and not notarized. The release carries it twice: `Foundry-<version>-mac-universal.zip` (what an
  installed app updates from) and `Foundry-<version>-mac-universal.dmg` (what a person downloads), both in
  `SHA256SUMS`.
- **What the shell does.** It starts `foundry-engine serve` with `FOUNDRY_APP_SHELL=1`, its output in
  `~/Library/Logs/Foundry/app.log`, and keeps it running: a crashed engine starts again after 1, 2, 4… seconds, and
  five failures in two minutes stop it with *Start Foundry Again* in the menu. The menu says whether Foundry runs and
  which version, and offers *Open Foundry* (the page in the person's browser), *N things wait for you* (the Inbox),
  *N Briefs to approve* (the goals waiting for approval), *Update to …* (the page with `?update`, which opens the
  update dialog), *Start at Login*, *Show Log* and *Quit Foundry*; the count beside the icon adds up what waits. *Show
  Log* joined the six items agreed for the first version because with the engine down the Settings page is out of
  reach. The first launch makes Foundry a login item once (`SMAppService.mainApp`), as the installer's service always
  started at login; `FOUNDRY_LOGIN_ITEM=off` skips it. Quit, logout and restart stop the engine before the app ends.
- **The engine starts with a terminal's PATH.** An app opened from the Finder, the Dock or at login gets launchd's
  `/usr/bin:/bin:/usr/sbin:/sbin`. Bun looks commands up in the PATH its process started with and ignores later
  changes to `process.env.PATH` (`Bun.which(bin)` and a bare `Bun.spawn` alike), so the engine cannot fix its own: the
  shell asks the login shell (`$SHELL -l -i -c`, PATH printed between two marks, six seconds at most) and starts the
  engine with that PATH, `~/.local/bin` and the usual tool folders added. For the same reason the doctor's and setup's
  lookups pass `PATH` to `Bun.which`, so what `adoptLocalBin` or an install adds is found.
- **Shell and engine know each other through two channels.** The engine writes `~/.foundry/app.json` (pid, port, URL,
  data folder, version) each time it listens; the shell reads it and asks `GET /api/app/status` every five seconds
  (version, open escalations, Briefs awaiting approval, the update). The engine's stdin is a pipe only the shell holds:
  when it closes, however the shell ended, the engine stops.
- **An update swaps the app.** The engine downloads the release's zip, checks it against `SHA256SUMS`, unpacks it and
  exits 75 (ADR-0101). The shell moves the running app to the data folder's `updates/previous/Foundry.app`, moves the
  new one into its place, and opens it with the same environment and `--after-update` (no new browser tab: the page
  reconnects by itself). An app macOS runs from a translocated copy (opened where it was downloaded) cannot replace
  itself and says so; one it cannot write over points to the releases page.
- **A release install keeps one port.** With no `FOUNDRY_PORT`, `foundry serve` takes 4111 or the next free port and
  keeps it in `~/.foundry/config.json` (`port`), where a `FOUNDRY_PORT` a service was given is kept too. The CLI of a
  release install talks to that port; one that never served has no server of its own and never borrows whatever
  answers on 4111.
- **One Foundry per data folder.** `foundry serve` claims the folder with `engine.pid` and refuses one whose claimant
  still runs; a claim left by a process that is gone is taken over, and an in-process restart (ADR-0082) keeps its own.
  The app beside a checkout made two engines on one database possible, through the folder `~/.foundry/config.json`
  names.
- **Foundry installs its own tools.** The installer's recipes are TypeScript now (`tools/installers.ts`): git through
  Apple's command line tools on a Mac, uv through its installer, the GitHub CLI and Node.js 22 through Homebrew when it
  is there and otherwise their release builds unpacked under `~/.local/share/foundry` and linked into `~/.local/bin`,
  ffmpeg through Homebrew; what needs a package manager with `sudo` is a command to run by hand. The Setup page's rows
  for git, uv, the GitHub CLI and Node.js get an **Install** button, and `foundry setup [--agent …] [--with …]`
  (`tools/setup.ts`) runs the whole list in order (required: git, uv, the agents' CLIs, graphify with its skill per
  agent; recommended: the GitHub CLI, Node.js; chosen: markitdown, Chromium, ffmpeg), leaving what is there. graphify
  and markitdown install with Python 3.12, as the image had: uv's newest Python had no tree-sitter wheel, and building
  one needs a compiler a fresh machine lacks.
- **The installer places releases.** `install.sh` gains `--mode app` (the default on a Mac) and `--mode binary` (the
  default on Linux): the release's JSON from GitHub (`FOUNDRY_RELEASES_API` points a test elsewhere), the file for this
  computer downloaded and checked against `SHA256SUMS`, then `Foundry.app` in `/Applications` (or `~/Applications`,
  `--app-dir`) or `~/.local/share/foundry/releases/<version>` with `current` pointing at it, `foundry setup`, the
  sign-ins, and the app opened or `current/foundry serve` run as the service. Its `foundry` command keeps the
  installer's verbs (start, stop, restart, status, logs, open, update, uninstall) and hands every other command to the
  binary, so `foundry ask` works from a terminal; the Setup page and `foundry link` link `~/.local/bin/foundry` to the
  app's binary when the installer did not. Source and Docker modes stay until 3.0.
- **A source install moves by copy.** `foundry migrate` (offered by the installer when the earlier install was from
  source) stops the checkout's service (only a launchd agent or systemd unit that runs the checkout's entry point, or
  its recorded process), waits until no process has its `engine.db` open, and copies each data folder to the new
  install's with ADR-0082's copy-and-rewrite, leaving the original with a `MOVED.md`. A folder chosen in Settings is
  opened where it is.

## Consequences

- The first open of a downloaded `.dmg` goes through *System Settings → Privacy & Security → Open Anyway*; the
  installer's download is not quarantined and opens at once. The ad-hoc signature changes with every release, so
  macOS may ask again for folders it guards (Documents, Desktop) after an update.
- Releases are cut on a Mac: the app needs `swiftc`, `lipo`, `codesign`, `ditto` and `hdiutil`.
- The page stays the engine's in the browser; the app is a few hundred lines that start, watch and swap. Nothing of
  the UI moved into Swift.
- Tools installed by Setup land in `~/.local`, not in the system: removing Foundry leaves them, as the installer always
  did.
- The image keeps shipping until the last 2.x, whose risk dialog before the jump to 3.0 is the next ADR.
