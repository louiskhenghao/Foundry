# Install Foundry

Foundry drives Claude Code, Codex or the Antigravity CLI against git repositories you already have. Each goal keeps its chosen backend; all three can run in one instance. Codex uses ChatGPT sign-in only. See [Run Foundry with Codex](codex.md) for the native capability differences. You can run it in two ways:

| | The app (macOS) | The binary (Linux) |
|---|---|---|
| Runs as | `Foundry.app`, in the menu bar | `foundry serve` from a release, as a service |
| Tools it needs | the Setup page or `foundry setup` installs them | `foundry setup` installs them |
| Native accounts | each CLI's login on your machine | each CLI's login on your machine |
| Your repositories | any path on the machine | any path on the machine |
| Data folder | `~/Library/Application Support/Foundry` | `~/.local/share/foundry` |
| Updates | one click: download, check, swap ([ADR-0104](../develop/adr/0104-foundry-ships-as-compiled-binaries-with-its-files-beside-them.md)) | one click: download, check, switch |

The app and the binary are the release itself, compiled: no Bun, no checkout, no build. They serve the web UI on
`http://127.0.0.1:4111`, or the next free port, which they keep. There is no Docker image and no install from source
any more: 2.36.1 was the last image
([ADR-0108](../develop/adr/0108-foundry-ships-only-as-the-app-and-the-binary.md)). An earlier install brings its goals
over with one click ([Moving an earlier install](#moving-an-earlier-install)). A git checkout is for working on Foundry
itself: see [Developing Foundry](../develop/README.md#getting-a-working-tree).

## The app (macOS)

**Download** `Foundry-<version>-mac-universal.dmg` from the
[releases](https://github.com/louiskhenghao/foundry-releases/releases), open it and drag **Foundry** onto
**Applications**. The app is not notarized by Apple, so the first time you open it macOS says it *cannot verify*
Foundry:

1. Press **Done** (not **Move to Trash**).
2. Open **System Settings → Privacy & Security**, scroll to *"Foundry" was blocked*, and press **Open Anyway**.
3. Confirm with your password or Touch ID. macOS does not ask again for this copy.

Or install it from a terminal, which downloads it the way macOS does not question:

```bash
curl -fsSL https://raw.githubusercontent.com/louiskhenghao/Foundry/main/install.sh | bash
```

It puts **Foundry.app** in `/Applications` (or `~/Applications` when that is not writable), runs `foundry setup`,
offers to sign in to the coding agents and GitHub, and opens the app. Either way, the app:

- runs Foundry from the menu bar (the **F** at the top right): open the page, what waits for you, an update, start at
  login, the log, quit. The [user guide](../guide/your-first-goal.md#foundry-in-the-menu-bar) shows the menu.
- starts at login the first time it opens (untick **Start at Login** to stop that; `FOUNDRY_LOGIN_ITEM=off` in its
  environment skips it).
- starts the engine with the PATH your login shell has, so a Homebrew, nvm or `~/.local/bin` tool is found as in a
  terminal.
- keeps its data in `~/Library/Application Support/Foundry` and its log in `~/Library/Logs/Foundry/app.log`.
- updates itself from the update dialog: it downloads the release's zip, checks it against the release's
  `SHA256SUMS`, swaps `Foundry.app`, and starts the new one. The old app is kept in the data folder's
  `updates/previous/`.

On a computer with an earlier Foundry, the app offers to bring its goals over the first time it opens: see
[Moving an earlier install](#moving-an-earlier-install).

The **Setup** page installs what is missing with one click: git (Apple's command line tools), uv, the coding agents'
CLIs, graphify, the GitHub CLI and Node.js, with Homebrew when you have it and into `~/.local` when you do not, never
asking for a password. Its last row links the `foundry` command into `~/.local/bin`, for `foundry ask`, `foundry usage`
and the rest in a terminal (`foundry link` does the same).

## The binary (Linux)

```bash
curl -fsSL https://raw.githubusercontent.com/louiskhenghao/Foundry/main/install.sh | bash
```

On Linux the installer downloads `foundry-<version>-linux-<x64|arm64>.tar.gz`, checks it against `SHA256SUMS`,
unpacks it into `~/.local/share/foundry/releases/<version>/` with `current` pointing at it, runs `foundry setup`, and
runs `current/foundry serve` as a `systemd --user` service (a background process where there is none). An update
unpacks the next version beside it, points `current` at it and restarts. The binary needs glibc on an x64 or arm64
computer: Alpine and other musl systems cannot run it, and the installer says so. On Windows, run it under WSL. macOS
without the app can take the binary too: `--mode binary`, run as a LaunchAgent.

On a server without a desktop, **Sign in** for Claude Code on the Setup page shows a link instead of opening a browser:
open it in your own browser, approve, and paste the code it shows into the dialog. Codex signs in with a device code
everywhere. To use the server from elsewhere, see [remote-access.md](./remote-access.md).

## The installer

[`install.sh`](../../install.sh), the one line above, installs the app on a Mac (it asks, with the binary as the other
choice) and the binary on Linux. It asks which coding agents to set up, as a checklist with Claude Code ticked: Claude
Code, Codex and Antigravity. The binary's service starts with the first one ticked, in that order, as its launch
profile; the app starts with Claude Code's. Goals moved in from an install that ran another coding agent's profile bring
that profile with them ([Moving an earlier install](#moving-an-earlier-install)). Every goal can still choose any coding
agent that is set up. Then it:

1. offers the optional tools as a checklist: markitdown, Chromium for the self-check and Docker for the services
   previews need are ticked unless they are already there, ffmpeg (video goals) is not. Docker comes as Docker Desktop
   through Homebrew on macOS, and from Docker's own install script on Linux;
2. downloads the release for this computer, checks it against `SHA256SUMS` and runs `foundry setup` for the chosen
   coding agents and tools;
3. offers to move the goals of an earlier Foundry it finds on this computer (see
   [Moving an earlier install](#moving-an-earlier-install));
4. offers to sign in to each coding agent and GitHub (Enter skips; the Setup page can do it later);
5. starts Foundry, leaves a `foundry` command in `~/.local/bin`, adds that folder to your shell's `PATH`, and opens
   Foundry in the browser.

| Option | Environment | Default | |
|---|---|---|---|
| `--mode app\|binary` | `FOUNDRY_MODE` | the app on a Mac (asked), the binary on Linux | how to run Foundry; `source` and `docker` are refused since 3.0 |
| `--version X.Y.Z` | `FOUNDRY_VERSION` | the newest | the release to install |
| `--app-dir PATH` | `FOUNDRY_APP_DIR` | `/Applications`, or `~/Applications` | app: where `Foundry.app` goes |
| `--agent claude,codex,agy` | `FOUNDRY_AGENT` | asked (`claude`) | the coding agents whose CLIs and skills to set up, one or more; `agy` is Antigravity, `both` is `claude,codex`, `all` the three |
| `--port N` | `FOUNDRY_PORT` | 4111 or the next free | binary: the port to serve on |
| `--with "markitdown chromium docker ffmpeg"` | `FOUNDRY_WITH` | the checklist | exactly these optional tools, without asking (`none` for none); `docker` is Docker for the services previews start |
| `--yes` | | | take every default, ask nothing: no sign-ins, and an earlier install it finds is moved when it is the only one |
| `--no-start` | | | set up, but do not start |
| `--no-open` | | | do not open the browser |
| `--no-modify-path` | | | leave the shell's configuration alone |
| `--dry-run` | | | say what would happen, change nothing |

The `foundry` command: `foundry status`, `start`, `stop` (the service, and a Foundry still answering on the install's
port that no service started, such as a checkout run by hand; anything else there is named and left alone, and the stop
fails), `restart`, `logs`, `open`, `update` (the newest installer,
run the same way as last time: it installs the newest release) and `uninstall` (removes the service, the command and the
binary's releases; the app goes to the Trash; `--purge` also deletes Foundry's data after asking; the tools it installed
stay). Every other command goes to Foundry's own CLI: `foundry ask`, `foundry usage`, `foundry doctor`,
`foundry status <goal>`. Running the one line again does the same as `foundry update`. Its choices are kept in
`~/.config/foundry/install.env`; to add a coding agent later, run the line again with all the agents you want, for
example `… | bash -s -- --agent claude,agy`. The command runs a copy of the installer kept in
`~/.local/share/foundry/install.sh`; the app and the binary put their own release's copy there each time they start, so
an update from the page or the menu bar brings the command's start, stop and status with it.

To use another port, change **Settings → Engine (install) → Port** and restart. The `foundry` command finds the port
the app or the binary serves on; for another address, tell it with `FOUNDRY_URL`.

## foundry setup

`foundry setup` installs what this computer lacks and leaves what it has: required are git, uv, the chosen coding
agents' CLIs and graphify (with its skill for each agent), recommended the GitHub CLI and Node.js, and `--with`
names the optional ones (`markitdown`, `chromium`, `ffmpeg`). What only you can install (git or ffmpeg through a Linux
package manager, which needs `sudo`) it names with the command to run.

```bash
foundry setup --agent claude,codex --with "markitdown chromium"
foundry setup --dry-run        # says what it would install
```

## Moving an earlier install

The app and the binary bring the goals of an earlier Foundry on the same computer with them: a checkout run from source,
or a Docker container ([ADR-0107](../develop/adr/0107-a-move-from-an-earlier-install-takes-one-click.md)). Open the
app: while it has no goals of its own, the **Goals** page shows **Bring your goals over**, with the Foundry it found,
its goals and one button. **Settings → Engine (install)** keeps the same move for later, and the installer offers it
before the new install starts. A move:

1. pauses the goals at work in the old Foundry and waits until nothing runs there (**Move now** does not wait: the
   steps in flight start again here);
2. stops it the way it runs: a launchd agent or systemd unit is turned off, a process started by hand gets SIGTERM, a
   container stops and Docker does not start it again;
3. copies each data folder beside this install's own, as an APFS clone or a reflink where the disk has them (instant,
   and no room taken), and points the paths it wrote at where they live now, a container's `/app/data` and mounts
   included;
4. keeps the settings it read from its `.env`, its service or a compose `.env`;
5. checks the copy against the original, then puts it in place of this install's folder, which is kept as
   `<folder>.before-move-<time>`;
6. links each goal worktree to its repository again, resumes the goals it paused, and takes over the old install's
   port, so bookmarks and the CLI keep working. The `foundry` command and `~/.config/foundry/install.env` name the new
   install from then on.

Goals made with Codex or Antigravity bring that coding agent's launch profile: a data folder belongs to one profile, so
this install starts with it from then on, kept in `~/.foundry/config.json`. When this install already has goals of its
own, the move asks to set them aside first (they stay in their folder) rather than hide them.

Nothing of the old install is deleted: its folder, or its container and volumes, is the backup, with a `MOVED.md` that
says how to go back. A Foundry does not open a folder that moved, so a checkout started again by habit says so instead of
running the same goals beside the app; deleting the `MOVED.md` is the way back. A move that fails before the copy is in
place starts the old one again and changes nothing here.

```bash
foundry migrate --dry-run      # what it finds, and what a move would do
foundry migrate                # asks, then moves (--from <checkout> or --from docker:<container> picks one)
```

A data folder you chose in Settings stays where it is: the new install opens it there once the old one has stopped.
Only one Foundry opens a data folder at a time: a second one is refused with the process that has it.

---

## Requirements

**Always:**

- An account supported by your selected CLI: Claude login for Claude Code, or ChatGPT sign-in for Codex. Agent inference does not use API keys. Optional image/video tools may need separate service credentials.

**The app and the binary:**

- macOS for the app. For the binary, Linux with glibc on x64 or arm64 (Windows through WSL), or macOS. Bun is compiled
  into both: nothing else is needed to run Foundry itself.
- git.
- For Claude goals: the Claude Code CLI, `claude` on your `PATH`, signed in. Install it with its native installer,
  `curl -fsSL https://claude.ai/install.sh | bash` (no npm needed), or `npm install -g @anthropic-ai/claude-code`. The Fable 5.2 model (what `fable` means from 2.1.321 on) needs at least 2.1.321, Fable 5.1 at least 2.1.259. When a newer release of a coding agent's CLI is out, the Setup page and Settings → Models & limits offer **Update**, and `foundry setup` updates it, each with the updater that fits how it was installed.
- For Codex goals: a hooks-capable Codex CLI (`SessionStart` and `PreToolUse` hooks; Setup checks them), `codex` on your `PATH`, signed in with ChatGPT. Install with `brew install --cask codex` (macOS), `npm install -g @openai/codex`, or the release binary from [github.com/openai/codex](https://github.com/openai/codex/releases); run `codex login`.
- For Antigravity goals: the Antigravity CLI, `agy` on your `PATH` (1.1.15 or newer), signed in once from a terminal. Install with `curl -fsSL https://antigravity.google/cli/install.sh | bash` or `brew install --cask antigravity-cli`; see [antigravity.md](antigravity.md).
- [graphify](https://github.com/safishamsi/graphify). It is the one *required* entry in the skills catalog; the
  doctor reports an error until it is installed. Its installer uses [uv](https://docs.astral.sh/uv/).
- Optional: Node.js 22 or newer (project skills via `npx autoskills` need it), the GitHub CLI `gh` (only for
  pushing, pull requests and merges), `markitdown` (converts PDFs and Office files before sessions read them).

[`foundry setup`](#foundry-setup) and the Setup page install what is missing from this list, except what needs `sudo`
on Linux, which they name with the command to run.

---

## First-run checks

Open **Setup** in the header (it opens by itself on first run when a check fails and there are no goals yet). It runs
the same checks as the doctor with the server running. Select the backend in Setup, or add `--provider codex` / `--provider claude` to doctor:

```bash
foundry doctor                      # the launch profile's coding agent
foundry doctor --provider codex     # or claude, or agy
```

| Check | Must pass? | If it fails |
|---|---|---|
| Claude Code CLI (Claude) | yes | **Install** on the Setup page (Claude Code's native installer), or `curl -fsSL https://claude.ai/install.sh \| bash` |
| Claude login (Claude) | yes | **Sign in** on the Setup page, or `claude auth login` |
| Codex CLI (Codex) | yes | **Install** on the Setup page (Homebrew on macOS, else npm, else the release binary), or `npm install -g @openai/codex` |
| Codex login (Codex) | yes | **Sign in to Codex**, or `codex login` with ChatGPT |
| git | yes | install git |
| Bun runtime | yes | compiled into the app and the binary, so it passes there |
| uv | no | **Install** on the Setup page, or `foundry setup`; graphify and markitdown install with it |
| Required: graphify | yes | **Install** on the Setup page, or `uv tool install --python 3.12 graphifyy && graphify install --platform claude` |
| Skills directory writable | yes | make the selected native home’s `skills/` directory writable |
| GitHub CLI (optional) | no | only for push / PR / auto-merge delivery: install `gh`, then **Sign in** on the Setup page (or `gh auth login --web`) |
| markitdown (optional) | no | **Install markitdown** on the Setup page |
| foundry in the terminal (optional) | no | **Install** on the Setup page, or `foundry link`; when your shell does not find `~/.local/bin`, add the line it shows to your shell's settings |
| Models (presets in use) | no | a model in a preset never resolved or failed last time: test it in **Settings → Models & limits** |
| Notifications (optional) | no | see [notifications.md](./notifications.md) |
| `<image pack> backend` | no | an image skill has no API key: see [troubleshooting.md](./troubleshooting.md#image-generation-keys) |
| Stale skill copies, Skill updates, settings.json | no | housekeeping of the selected backend’s skills; `settings.json` validation applies to Claude |

More about each check: [troubleshooting.md](./troubleshooting.md#doctor-checks).

## Where to go next

- Use **Coding agent** in **Settings → Models & limits**. Each goal type (Code, Docs & research, Media) uses one model preset.
  The built-in presets are Max, Production, Balanced and Economy. By default Code uses Production, and Docs & research
  and Media use Balanced.
- Set up [notifications](./notifications.md) and, if you want to use Foundry away from the machine,
  [remote access](./remote-access.md).
- Plan your [backups and updates](./updates-and-backup.md).
- All settings and their environment variables: [configuration.md](./configuration.md). All CLI commands: [cli.md](./cli.md).
- Using Foundry to run goals: [docs/guide/](../guide/).
