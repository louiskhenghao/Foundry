# Install Foundry

Foundry drives Claude Code or Codex against git repositories you already have. Each goal keeps its chosen backend; both can run in one instance. Codex uses ChatGPT sign-in only. See [Run Foundry with Codex](codex.md) for the native capability differences. You can run it in two ways:

| | Locally, from source | In Docker |
|---|---|---|
| Runs as | `bun run serve` or `bun run serve:codex` in a Foundry checkout | the `imlouiskhenghao/foundry` image |
| Tools it needs | you install them | all in the image (`bun`, `git`, `claude`, `codex`, `gh`, `ripgrep`, `npx`, `uv`, `graphify`, `markitdown`) |
| Native accounts | each CLI’s login on your machine | separate Claude and Codex homes; sign into each backend you use |
| Your repositories | any path on the machine | only what you mount into the container |
| Updates | one click (git-based) | one click with the shipped `docker-compose.yml` |

Both serve the web UI on `http://127.0.0.1:4111`.

---

## Requirements

**Always:**

- An account supported by your selected CLI: Claude login for Claude Code, or ChatGPT sign-in for Codex. Agent inference does not use API keys. Optional image/video tools may need separate service credentials.

**Local install:**

- macOS or Linux.
- [Bun](https://bun.sh) 1.1 or newer. The Docker image ships Bun 1.3.13.
- git.
- For Claude goals: the Claude Code CLI, `claude` on your `PATH`, signed in. Install it with its native installer,
  `curl -fsSL https://claude.ai/install.sh | bash` (no npm needed), or `npm install -g @anthropic-ai/claude-code`. The Docker image ships 2.1.259; the Fable 5.1 model needs at least that version.
- For Codex goals: a hooks-capable Codex CLI, `codex` on your `PATH`, signed in with ChatGPT. This Dockerfile pins 0.160.0. Install with `brew install --cask codex` (macOS), `npm install -g @openai/codex`, or the release binary from [github.com/openai/codex](https://github.com/openai/codex/releases); run `codex login`.
- [graphify](https://github.com/safishamsi/graphify). It is the one *required* entry in the skills catalog; the
  doctor reports an error until it is installed. Its installer uses [uv](https://docs.astral.sh/uv/).
- Optional: Node.js 22 or newer (project skills via `npx autoskills` need it), the GitHub CLI `gh` (only for
  pushing, pull requests and merges), `markitdown` (converts PDFs and Office files before sessions read them).

**Docker install:**

- Docker Desktop or Docker Engine.
- About 2 GB of disk for the image. The image is published for `linux/amd64` and `linux/arm64`.

---

## Install locally

### One line

```bash
curl -fsSL https://raw.githubusercontent.com/louiskhenghao/Foundry/main/install.sh | bash
```

[`install.sh`](../../install.sh) first asks how to run Foundry: **From source** (on this computer) or **Docker** (in a
container, see [the Docker section](#install-with-docker)). It suggests source on macOS and on Linux with a desktop,
Docker on a Linux server. From source it:

1. installs what is missing, and only that: git, Bun, uv, graphify and its skill, the coding agent's CLI (Claude Code
   through its native installer; Codex through Homebrew's cask on macOS or its release binary), the GitHub CLI, and
   Node.js 22 with corepack (pnpm and yarn), which autoskills and previews of JavaScript projects need. On macOS these
   come from Homebrew, which it installs first if needed; on Linux it uses release builds in `~/.local`, so no `sudo`
   except for system packages such as `unzip`;
2. offers the optional tools as a checklist: markitdown, Chromium for the self-check and Docker for the services
   previews need are ticked, ffmpeg (video goals) is not;
3. clones Foundry into `~/foundry`, builds it, offers to sign in to the coding agent and GitHub (Enter skips; the
   Setup page can do it later) and runs the doctor;
4. runs Foundry as a background service that starts when you log in and restarts if it stops: launchd on macOS,
   `systemd --user` on Linux (with lingering, so it keeps running after you log out), a plain background process
   where neither exists. It serves on port 4111, or the next free one, and opens it in the browser;
5. adds `~/.local/bin` and `~/.bun/bin` to your shell's `PATH` and leaves a `foundry` command there.

| Option | Environment | Default | |
|---|---|---|---|
| `--mode source\|docker` | `FOUNDRY_MODE` | asked | how to run Foundry |
| `--agent claude\|codex\|both` | `FOUNDRY_AGENT` | `claude` | which coding agent's CLI and skills to set up |
| `--dir PATH` | `FOUNDRY_DIR` | `~/foundry` | where Foundry goes |
| `--repos PATH` | `FOUNDRY_REPOS` | `~/Projects` | Docker: your projects folder |
| `--port N` | `FOUNDRY_PORT` | 4111 or the next free | the port to serve on |
| `--ref BRANCH\|TAG` | `FOUNDRY_REF` | `main` | source: what to check out, for example a release tag |
| `--with "markitdown chromium docker ffmpeg"` | `FOUNDRY_WITH` | the checklist | source: exactly these optional tools, without asking |
| `--yes` | | | take every default, ask nothing (no sign-ins) |
| `--no-start` | | | set up, but do not start |
| `--no-open` | | | do not open the browser |
| `--no-modify-path` | | | leave the shell's configuration alone |
| `--dry-run` | | | say what would happen, change nothing |

The `foundry` command: `foundry status`, `start`, `stop`, `restart`, `logs`, `open`, `update` (the newest installer,
run the same way as last time: source pulls, rebuilds and restarts; Docker pulls the image and recreates the
container) and `uninstall` (removes the service and the command; `--purge` also deletes Foundry's data after asking;
the tools it installed stay). Running the one line again does the same as `foundry update`. Its choices are kept in
`~/.config/foundry/install.env`.

### By hand

These numbered steps use the Claude launch profile. For Codex, use `codex login`, `bun run cli doctor --provider codex` and `bun run serve:codex`; use **Setup → Codex** for backend-specific skill installation. Keep an existing instance’s launch profile and select **Coding agent** on New goal to add the other backend without changing its data directory.

1. Get the source and build the UI.

   ```bash
   git clone https://github.com/louiskhenghao/Foundry.git foundry
   cd foundry
   bun install
   bun run web:build          # builds the UI into apps/web/dist; the server serves it
   ```

2. Sign in to Claude Code, if you have not already.

   ```bash
   claude auth login
   claude auth status         # should say you are logged in
   ```

3. Install the required tools and check the machine.

   ```bash
   uv tool install graphifyy && graphify install --platform claude   # graphify, the one required tool
   bun run cli doctor                            # claude installed? logged in? git, bun, graphify …
   ```

   `doctor` works without the server running; it then skips the markitdown, Models and Notifications checks, which need
   the engine. Every line with `✘` must be fixed; lines with `⚠` are optional.

4. Optional: sign in to GitHub, for delivery (push, pull requests, merges).

   ```bash
   gh auth login              # or: bun run cli github login
   ```

   Foundry never stores a GitHub token. `gh` keeps it.

5. Start Foundry.

   ```bash
   bun run serve              # same as: bun apps/cli/src/main.ts serve
   ```

   It prints `foundry listening on http://127.0.0.1:4111  (data: …/data)`. Open <http://127.0.0.1:4111>.

Foundry’s instance data lives in `data/` (Claude launch profile), `data-codex/` (Codex launch profile), or `FOUNDRY_DATA_DIR`. Native account/configuration files stay in the selected CLI’s home, and goal work stays beside the target repositories. See
[updates-and-backup.md](./updates-and-backup.md).

To keep Foundry running after you close the terminal (launchd on macOS, systemd on Linux), see
[remote-access.md § Keep it working while you are away](./remote-access.md#3-keep-it-working-while-you-are-away).
Use plain `bun run serve` for that, never `bun --watch`.

To use another port, set `FOUNDRY_PORT` before starting, or change **Settings → Engine (install) → Port** and
restart. If the server listens somewhere other than `http://127.0.0.1:4111`, tell the CLI with `FOUNDRY_URL`.

---

## Install with Docker

The image brings the engine, the UI and every tool Foundry uses. It does not bring two things, because they are
yours: **your native accounts** and **your repositories**. Persist the corresponding homes and mount the repositories. What each image version contains is in the [changelog](https://github.com/louiskhenghao/foundry-releases/blob/main/CHANGELOG.md).

The [one-line install](#one-line) with **Docker** does all of this: it installs Docker if it is missing (the official
script on Linux, Docker Desktop through Homebrew on macOS; Docker Compose v2 is required), writes `docker-compose.yml`, `.env` and
`docker-compose.override.yml` to `~/foundry`, starts the container and offers to sign in inside it. The override
shares, besides your projects folder:

- the projects folder a second time **at the same path as on your computer**, so goal paths and the bind mounts of a
  repository's compose file mean the same inside and outside (the folder picker starts there; `/repos` keeps working);
- `~/.gitconfig`, read-only, for your commit name and email, and `~/.config/gh` when your GitHub CLI sign-in is kept
  there (on macOS it is usually in the keychain, which a container cannot read: sign in inside instead);
- if you agree, **your computer's Docker** (ADR-0024). Foundry then starts the services a preview needs (databases,
  object storage) on it, in the Foundry container's network, so the apps reach them on `localhost`. The Docker socket
  is root-level access to your computer, for Foundry and for the AI sessions it runs.

The steps below are the same by hand.

### 1. Get the image

```bash
docker pull imlouiskhenghao/foundry:latest
```

### 2. Start it

There are two ways. **Docker Compose is recommended**: the shipped `docker-compose.yml` also starts the updater
sidecar that makes one-click updates work (see [updates-and-backup.md](./updates-and-backup.md#self-update)).

#### With Docker Compose

`docker compose` needs a `docker-compose.yml` in the folder you run it from. The image ships one:

```bash
mkdir -p ~/foundry && cd ~/foundry
docker run --rm imlouiskhenghao/foundry cat /app/docker-compose.yml > docker-compose.yml
FOUNDRY_REPOS=~/code docker compose up -d      # mounts ~/code at /repos
```

Without `FOUNDRY_REPOS`, the compose file mounts `~/Projects` at `/repos`. Always run `docker compose` from the same
folder: Compose names the volumes after that folder (for `~/foundry` they are `foundry_engine-data`, `foundry_codex-data`,
`foundry_claude-home` and `foundry_codex-home`).

What the compose file sets up:

| Item | Value |
|---|---|
| Container name | `foundry` (the updater sidecar looks for this exact name) |
| UI port | `127.0.0.1:4111:4111` |
| Preview ports | `127.0.0.1:4200-4299:4200-4299` (see [Previews](#6-previews-from-the-host)) |
| Volumes | `engine-data` → `/app/data`, `codex-data` → `/app/data-codex`, `claude-home` → `/home/node/.claude`, `codex-home` → `/home/node/.codex`, `playwright-browsers` → `/home/node/.cache/ms-playwright` (Chromium for the self-check), `${FOUNDRY_REPOS:-${HOME}/Projects}` → `/repos` |
| Environment passed through | `FOUNDRY_PROVIDER` (default `claude`), `FOUNDRY_CODEX_MODEL` (default `codex-default`), `FOUNDRY_MODEL_CHEAP` (default `haiku`), `FOUNDRY_MAX_CONCURRENT` (default `3`, shared by both backends) |
| Updater | `FOUNDRY_WATCHTOWER_URL=http://watchtower:8080`, `FOUNDRY_WATCHTOWER_TOKEN` (default `foundry-watchtower`) |
| Sidecar | `containrrr/watchtower`, container `foundry-watchtower`, its API never published to the host |
| Restart policy | `unless-stopped` for both containers |

`FOUNDRY_MODEL_CHEAP` is only the Claude *housekeeping model* (one-turn chores such as classifying a goal). All other
models come from the model presets in **Settings → Models & limits**. Codex Housekeeping is part of its own captured preset. Changing `FOUNDRY_PROVIDER` selects another default data directory; it does not migrate goals. To enable Codex in a Claude-profile instance, keep the profile, sign in under **Accounts → Codex**, then choose Codex on New goal.

To change the sidecar token, set `FOUNDRY_WATCHTOWER_TOKEN` in the shell before `docker compose up -d`.

#### With `docker run`

If you have **one repository**, for example at `/Users/dana/code/acme-app` (macOS) or `/home/dana/code/acme-app` (Linux):

```bash
docker run -d --init --name foundry \
  -p 127.0.0.1:4111:4111 \
  -v engine-data:/app/data \
  -v claude-home:/home/node/.claude \
  -v /Users/dana/code/acme-app:/repos/acme-app \
  imlouiskhenghao/foundry
```

If you have **several repositories under one folder**, mount the parent once:

```bash
docker run -d --init --name foundry \
  -p 127.0.0.1:4111:4111 \
  -v engine-data:/app/data \
  -v claude-home:/home/node/.claude \
  -v /Users/dana/code:/repos \
  imlouiskhenghao/foundry
```

Docker creates the `engine-data` and `claude-home` volumes on first use. A container started with `docker run` has no
updater sidecar, so updates are manual (see [updates-and-backup.md](./updates-and-backup.md#self-update)).

The `docker run` examples above persist Claude state. For mixed-provider goals, also mount `-v codex-home:/home/node/.codex`. For a Codex launch profile add `-e FOUNDRY_PROVIDER=codex -v codex-data:/app/data-codex`; keep all existing mounts when recreating the container. Use `--init` to reap native child processes.

### 3. Sign in to Claude

The container needs its own Claude session. To Claude Code, a container is a separate machine, even if you are signed
in on your own. Pick one of three ways. You only do it once: the login is stored in the `claude-home` volume.

**a. From the web UI (simplest, no terminal).** Open <http://127.0.0.1:4111>. The **Setup** page opens by itself on
first run when a check fails. Press **Sign in** on the *Claude login* check. There is no browser inside the
container, so Claude Code shows a link and asks for a code. Open the link in your own browser, approve, and paste
the code into the dialog. You have 15 minutes. A rejected code just re-opens the field.

**b. From the terminal.** The command prints a URL; approve in your browser and paste the code back.

```bash
# Compose (run in the folder with docker-compose.yml)
docker compose run --rm foundry claude auth login

# docker run, before you start the container
docker run --rm -it -v claude-home:/home/node/.claude \
  imlouiskhenghao/foundry claude auth login
```

`-it` is what lets you paste the code.

**c. With a token from a machine where you are already signed in.**

```bash
claude setup-token            # on YOUR machine; prints a long-lived token for your subscription
```

Put it in a file outside any git repository, readable only by you:

```bash
echo "CLAUDE_CODE_OAUTH_TOKEN=<the token>" > ~/.foundry.env
chmod 600 ~/.foundry.env
```

Then hand the file to the container. With `docker run`, add `--env-file ~/.foundry.env` to the command in step 2.
With Compose, add this under `services.foundry` in `docker-compose.yml`:

```yaml
    env_file: ${HOME}/.foundry.env
```

Treat the token like a password: it is your subscription.

> **Linux only:** instead of the `claude-home` volume you can mount the credentials you already have:
> `-v ~/.claude:/home/node/.claude`. On Linux, Claude Code keeps them in `~/.claude/.credentials.json`, so they
> travel with the mount. The container also writes its sessions and skills there. **On macOS this does not work**:
> the credentials are in the Keychain, not in `~/.claude`, so the mount carries settings and skills but not the login.

Check the login at any time:

```bash
docker exec foundry claude auth status
```

With method c it reports `"authMethod": "oauth_token"`.

To use Codex in the same container, open **Accounts → Sign in to Codex**, or run `docker exec -it foundry codex login --device-auth` while Foundry is idle. Enter the displayed code on the linked ChatGPT page; unlike Claude’s returned code, it is not pasted into Foundry. Credentials persist in `codex-home`. **Setup → Codex** checks that account and its tools. See [Codex Docker setup](codex.md#docker).

### 4. Point goals at container paths

The engine only sees what you mounted. In **New goal → Repository**, type the path **inside the container**:

| On your machine | Inside the container | What you type |
|---|---|---|
| `/Users/dana/code/acme-app` | `/repos/acme-app` | `/repos/acme-app` |
| `/Users/dana/code/work/api` | `/repos/work/api` | `/repos/work/api` |
| `C:\Users\dana\code\acme-app` (Windows) | `/repos/acme-app` | `/repos/acme-app` |

On Windows, mount the parent as `-v C:\Users\dana\code:/repos` in PowerShell, or `-v //c/Users/dana/code:/repos` in
Git Bash.

The panel under the field turns green with the branch and commit count. If it says *not a git repository*, you
typed the host path.

You can add more mounts, for example `-v ~/code:/repos -v ~/Desktop/client-work:/client`.

**The mount must be writable.** Foundry writes in two places:

- **Your repository's `.git/`.** It adds git worktrees and `goal/<id>` (and task) branches. It never touches your
  working tree or your existing branches.
- **A progress folder next to the repository.** Each goal gets `<repo>-foundry/<goal>/`, for example
  `/repos/acme-app-foundry/<goal>/` in the container, which is `/Users/dana/code/acme-app-foundry/<goal>/` on your
  machine. You can open and run the work there while it lands. The engine's own worktrees sit beside it, hidden, under
  `<repo>-foundry/.foundry/<goal>/`.

Files Foundry creates belong to uid 1000 (see [step 5](#5-linux-if-your-user-id-is-not-1000)). To put progress
folders somewhere else, set **Settings → Engine (install) → Progress folders** to another *mounted* path. Goals then
go to `<that folder>/<repo>/<goal>/`. The change applies to goals created afterwards.

### 5. Linux: if your user id is not 1000

The image runs as uid 1000. If `id -u` prints something else, run the container as yourself and keep its state in
folders you own. Named volumes would be created owned by uid 1000.

```bash
mkdir -p ~/.foundry/data ~/.foundry/data-codex ~/.foundry/home/.claude ~/.foundry/home/.codex
docker run -d --init --name foundry \
  --user "$(id -u):$(id -g)" -e HOME=/home/node \
  -p 127.0.0.1:4111:4111 \
  -v ~/.foundry/data:/app/data \
  -v ~/.foundry/data-codex:/app/data-codex \
  -v ~/.foundry/home:/home/node \
  -v ~/code:/repos \
  imlouiskhenghao/foundry
```

The whole home folder is mounted, not just `.claude`. As a non-1000 user, the image's `/home/node` is read-only to
you, and `gh auth login`, `npx autoskills` and `uv` all need to write under it (`~/.config/gh`, `~/.npm`, `~/.cache`).

- Use the same `--user` and `-e HOME` flags, and the same `~/.foundry/home` folder, for the `claude auth login` step.
- With Compose, under `services.foundry` set `user: "<uid>:<gid>"`, add `HOME: /home/node` to `environment:`, and
  replace the data and native-home named volumes with the folders above (mount the whole home once). Keep cache volumes as appropriate.

### 6. Previews from the host

A goal's preview (its dev server, started at milestones and from the goal page) listens on a port from 4200–4299
inside the container. The link Foundry shows (on the goal page, in milestone notifications and on Telegram) is
`http://localhost:<port>`, so publish the range with the same numbers on both sides:

- Compose: the shipped file already publishes `127.0.0.1:4200-4299:4200-4299`. A `docker-compose.yml` from image 0.4.1
  or older has that line commented out: uncomment it and run `docker compose up -d`.
- `docker run`: add `-p 127.0.0.1:4200-4299:4200-4299`.

**Settings → Preview & self-check → First port / Last port** changes the range. Publish the same range.

Inside the image (`FOUNDRY_DOCKER=1`) a preview listens on every interface, because a published port cannot reach a
server that only listens on the container's own loopback. Foundry adds `--host 0.0.0.0` to a detected Vite command
and `-H 0.0.0.0` to a detected Next command, and sets `HOST=0.0.0.0` and `HOSTNAME=0.0.0.0` for every preview. Expo's
web server already listens on every interface. A run command you give in the Brief is used as written: if its server
ignores `HOST`, add its own flag for listening on `0.0.0.0`. A local install (no Docker) keeps previews on localhost.

A monorepo's preview runs one dev server per app, each on its own port from the range, so publish enough of it for
the apps you run at once. The Docker services those apps need (from the repository's compose file) are started only by
a local install, or by the image when the installer shared your computer's Docker with it (see above): otherwise the
preview card lists the services and the `docker compose` command to run on the host instead.

The headless self-check needs Chromium. The image already has the system libraries and fonts Chromium needs;
**Settings → Preview & self-check → Install Chromium** downloads the browser itself (about 650 MB on disk) with the
Playwright version Foundry ships. It goes to `/home/node/.cache/ms-playwright` (`PLAYWRIGHT_BROWSERS_PATH`), which
the compose file keeps in the `playwright-browsers` volume, so updates do not lose it. With `docker run`, add
`-v playwright-browsers:/home/node/.cache/ms-playwright` to keep it; without that volume a re-created container
needs the install again.

### 7. GitHub for delivery (optional)

A goal produces a local branch. For Foundry to push it, open a pull request or merge, the container needs its own
GitHub login. Foundry never stores tokens; `gh` does. Either:

- press **Sign in** under *GitHub CLI (optional)* on the Setup page, or **Connect GitHub** in the *Delivery* part of the
  New goal page (or on a goal's Delivery tab). It runs `gh`'s device-code flow: copy the code, open the URL, approve.
  No terminal needed.
- or run:

  ```bash
  docker exec -it foundry gh auth login
  ```

The login lives in `/home/node/.config/gh`, which is not in a volume. To keep it when the container is re-created
(updates included), mount a volume there:

- `docker run`: add `-v foundry-gh:/home/node/.config/gh`.
- Compose: add `- gh-config:/home/node/.config/gh` under `services.foundry.volumes`, and `gh-config:` under the
  top-level `volumes:`.

With the uid ≠ 1000 recipe this is already covered: the whole home folder is mounted.

### Docker notes

- The UI has no login. Keep the published port on `127.0.0.1` and never expose 4111 to a network. For access from
  elsewhere, see [remote-access.md](./remote-access.md).
- The image sets `FOUNDRY_HOST=0.0.0.0` inside the container. Bind to loopback on the host side (`-p 127.0.0.1:…`).
- On first start with an empty `claude-home` volume, the entrypoint installs the graphify skill into it
  (`graphify install --platform claude`). `FOUNDRY_SKIP_SETUP=1` skips that. A mounted `~/.claude` that already has a
  `skills/` folder is never touched.
- The container has a health check: `curl -fsS http://127.0.0.1:4111/api/health`.
- Node.js, npm and corepack's `pnpm` and `yarn` are in the image, so repositories that use any of them install and
  preview without anything on your computer; corepack fetches the pnpm or yarn version a repository asks for on first use.
- The image carries Chromium's system libraries (from `playwright install-deps chromium`, minus Xvfb), but not the
  browser: it is downloaded on demand (see [Previews](#6-previews-from-the-host)).
- Build your own image: `docker build -t foundry .`. Add `--build-arg CLAUDE_CODE_VERSION=x.y.z` to pin another
  Claude Code version, or `--build-arg CODEX_VERSION=x.y.z` to pin Codex. The entrypoint’s automatic graphify setup is Claude-profile-only; use **Setup → Codex** for Codex skills.

---

## First-run checks

Open **Setup** in the header (it opens by itself on first run when a check fails and there are no goals yet). It runs
the same checks as the doctor with the server running. Select the backend in Setup, or add `--provider codex` / `--provider claude` to doctor:

```bash
bun run cli doctor                               # local install
docker exec foundry bun apps/cli/src/main.ts doctor   # Docker
```

| Check | Must pass? | If it fails |
|---|---|---|
| Claude Code CLI (Claude) | yes | **Install** on the Setup page (Claude Code's native installer), or `curl -fsSL https://claude.ai/install.sh \| bash` |
| Claude login (Claude) | yes | **Sign in** on the Setup page, or `claude auth login` |
| Codex CLI (Codex) | yes | **Install** on the Setup page (Homebrew on macOS, else npm, else the release binary), or `npm install -g @openai/codex` |
| Codex login (Codex) | yes | **Sign in to Codex**, or `codex login` with ChatGPT |
| git | yes | install git |
| Bun runtime | yes | `curl -fsSL https://bun.sh/install \| bash` |
| Required: graphify | yes | **Install** on the Setup page, or `uv tool install graphifyy && graphify install --platform claude` |
| Skills directory writable | yes | make the selected native home’s `skills/` directory writable |
| GitHub CLI (optional) | no | only for push / PR / auto-merge delivery: install `gh`, then **Sign in** on the Setup page (or `gh auth login --web`) |
| markitdown (optional) | no | **Install markitdown** on the Setup page |
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
