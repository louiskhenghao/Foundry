# Install Foundry

Foundry drives Claude Code against git repositories you already have. You can run it in two ways:

| | Locally, from source | In Docker |
|---|---|---|
| Runs as | `bun run serve` in a Foundry checkout | the `imlouiskhenghao/foundry` image |
| Tools it needs | you install them | all in the image (`bun`, `git`, `claude`, `gh`, `ripgrep`, `npx`, `uv`, `graphify`, `markitdown`) |
| Your Claude login | the one on your machine | the container's own login (you sign in once) |
| Your repositories | any path on the machine | only what you mount into the container |
| Updates | one click (git-based) | one click with the shipped `docker-compose.yml` |

Both serve the web UI on `http://127.0.0.1:4111`.

---

## Requirements

**Always:**

- A Claude subscription (Pro or Max). No API key is needed or used.

**Local install:**

- macOS or Linux.
- [Bun](https://bun.sh) 1.1 or newer. The Docker image ships Bun 1.3.13.
- git.
- The Claude Code CLI, `claude` on your `PATH`, signed in. Install it with
  `npm install -g @anthropic-ai/claude-code`. The Docker image ships 2.1.259; the Fable 5.1 model needs at least that version.
- [graphify](https://github.com/safishamsi/graphify). It is the one *required* entry in the skills catalog; the
  doctor reports an error until it is installed. Its installer uses [uv](https://docs.astral.sh/uv/).
- Optional: Node.js 22 or newer (project skills via `npx autoskills` need it), the GitHub CLI `gh` (only for
  pushing, pull requests and merges), `markitdown` (converts PDFs and Office files before sessions read them).

**Docker install:**

- Docker Desktop or Docker Engine.
- About 2 GB of disk for the image. The image is published for `linux/amd64` and `linux/arm64`.

---

## Install locally

1. Get the source and build the UI. You need access to the Foundry repository.

   ```bash
   git clone git@github.com:louiskhenghao/Foundry.git foundry
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
   bun run cli skills install --tier required    # installs graphify
   bun run cli doctor                            # claude installed? logged in? git, bun, graphify …
   ```

   `doctor` works without the server running. Every line with `✘` must be fixed; lines with `⚠` are optional.

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

Everything Foundry stores lives in the `data/` folder of the checkout. See
[updates-and-backup.md](./updates-and-backup.md).

To keep Foundry running after you close the terminal (launchd on macOS, systemd on Linux), see
[remote-access.md § Keep it working while you are away](./remote-access.md#3-keep-it-working-while-you-are-away).
Use plain `bun run serve` for that, never `bun --watch`.

To use another port, set `FOUNDRY_PORT` before starting, or change **Settings → Engine (install) → Port** and
restart. If the server listens somewhere other than `http://127.0.0.1:4111`, tell the CLI with `FOUNDRY_URL`.

---

## Install with Docker

The image brings the engine, the UI and every tool Foundry uses. It does not bring two things, because they are
yours: **your Claude login** and **your repositories**. Both are mounted.

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
folder: Compose names the volumes after that folder (for `~/foundry` they are `foundry_engine-data` and
`foundry_claude-home`).

What the compose file sets up:

| Item | Value |
|---|---|
| Container name | `foundry` (the updater sidecar looks for this exact name) |
| UI port | `127.0.0.1:4111:4111` |
| Preview ports | `127.0.0.1:4200-4299:4200-4299`, commented out (see [Previews](#6-previews-from-the-host)) |
| Volumes | `engine-data` → `/app/data`, `claude-home` → `/home/node/.claude`, `${FOUNDRY_REPOS:-${HOME}/Projects}` → `/repos` |
| Environment passed through | `FOUNDRY_MODEL_CHEAP` (default `haiku`), `FOUNDRY_MAX_CONCURRENT` (default `3`) |
| Updater | `FOUNDRY_WATCHTOWER_URL=http://watchtower:8080`, `FOUNDRY_WATCHTOWER_TOKEN` (default `foundry-watchtower`) |
| Sidecar | `containrrr/watchtower`, container `foundry-watchtower`, its API never published to the host |
| Restart policy | `unless-stopped` for both containers |

`FOUNDRY_MODEL_CHEAP` is only the *housekeeping model* (one-turn chores such as classifying a goal). All other
models come from the model presets in **Settings → Models & limits**.

To change the sidecar token, set `FOUNDRY_WATCHTOWER_TOKEN` in the shell before `docker compose up -d`.

#### With `docker run`

If you have **one repository**, for example at `/Users/dana/code/acme-app` (macOS) or `/home/dana/code/acme-app` (Linux):

```bash
docker run -d --name foundry \
  -p 127.0.0.1:4111:4111 \
  -v engine-data:/app/data \
  -v claude-home:/home/node/.claude \
  -v /Users/dana/code/acme-app:/repos/acme-app \
  imlouiskhenghao/foundry
```

If you have **several repositories under one folder**, mount the parent once:

```bash
docker run -d --name foundry \
  -p 127.0.0.1:4111:4111 \
  -v engine-data:/app/data \
  -v claude-home:/home/node/.claude \
  -v /Users/dana/code:/repos \
  imlouiskhenghao/foundry
```

Docker creates the `engine-data` and `claude-home` volumes on first use. A container started with `docker run` has no
updater sidecar, so updates are manual (see [updates-and-backup.md](./updates-and-backup.md#self-update)).

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
mkdir -p ~/.foundry/data ~/.foundry/home/.claude
docker run -d --name foundry \
  --user "$(id -u):$(id -g)" -e HOME=/home/node \
  -p 127.0.0.1:4111:4111 \
  -v ~/.foundry/data:/app/data \
  -v ~/.foundry/home:/home/node \
  -v ~/code:/repos \
  imlouiskhenghao/foundry
```

The whole home folder is mounted, not just `.claude`. As a non-1000 user, the image's `/home/node` is read-only to
you, and `gh auth login`, `npx autoskills` and `uv` all need to write under it (`~/.config/gh`, `~/.npm`, `~/.cache`).

- Use the same `--user` and `-e HOME` flags, and the same `~/.foundry/home` folder, for the `claude auth login` step.
- With Compose, under `services.foundry` set `user: "<uid>:<gid>"`, add `HOME: /home/node` to `environment:`, and
  replace the two named volumes with the two folders above.

### 6. Previews from the host

A goal's preview (its dev server, started at milestones and from the goal page) listens on a port from 4200–4299
inside the container. To open previews from your machine, publish that range:

- Compose: uncomment `- '127.0.0.1:4200-4299:4200-4299'` under `ports:` and run `docker compose up -d`.
- `docker run`: add `-p 127.0.0.1:4200-4299:4200-4299`.

**Settings → Preview & self-check → First port / Last port** changes the range. Publish the same range.

The headless self-check needs Chromium in the container. **Settings → Preview & self-check → Install Chromium** runs
`bunx playwright install chromium` (a few hundred MB). The download goes into the container's own file system, not
into a volume, so a re-created container (every update does that) needs it again.

### 7. GitHub for delivery (optional)

A goal produces a local branch. For Foundry to push it, open a pull request or merge, the container needs its own
GitHub login. Foundry never stores tokens; `gh` does. Either:

- press **Connect GitHub** in the *Delivery* part of the New goal page (or on a goal's Delivery tab). It runs `gh`'s
  device-code flow: copy the code, open the URL, approve. No terminal needed.
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
- Build your own image: `docker build -t foundry .`. Add `--build-arg CLAUDE_CODE_VERSION=x.y.z` to pin another
  Claude Code version.

---

## First-run checks

Open **Setup** in the header (it opens by itself on first run when a check fails and there are no goals yet). It runs
the same checks as the doctor:

```bash
bun run cli doctor                               # local install
docker exec foundry bun apps/cli/src/main.ts doctor   # Docker
```

| Check | Must pass? | If it fails |
|---|---|---|
| Claude Code CLI | yes | install it: `npm install -g @anthropic-ai/claude-code` |
| Claude login | yes | **Sign in** on the Setup page, or `claude auth login` |
| git | yes | install git |
| Bun runtime | yes | `curl -fsSL https://bun.sh/install \| bash` |
| Required: graphify | yes | **Install** on the Setup page, or `bun run cli skills install --tier required` |
| Skills directory writable | yes | make `~/.claude/skills` writable |
| GitHub CLI (optional) | no | only for push / PR / auto-merge delivery: install `gh`, then `gh auth login --web` |
| markitdown (optional) | no | **Install markitdown** on the Setup page |
| Models (presets in use) | no | a model in a preset never resolved or failed last time: test it in **Settings → Models & limits** |
| Notifications (optional) | no | see [notifications.md](./notifications.md) |
| `<image pack> backend` | no | an image skill has no API key: see [troubleshooting.md](./troubleshooting.md#image-generation-keys) |
| Stale skill copies, Skill updates, settings.json | no | housekeeping of your Claude Code skills and settings |

More about each check: [troubleshooting.md](./troubleshooting.md#doctor-checks).

## Where to go next

- Choose models: **Settings → Models & limits**. Each goal type (Code, Docs & research, Media) uses one model preset.
  The built-in presets are Max, Production, Balanced and Economy. By default Code uses Production, and Docs & research
  and Media use Balanced.
- Set up [notifications](./notifications.md) and, if you want to use Foundry away from the machine,
  [remote access](./remote-access.md).
- Plan your [backups and updates](./updates-and-backup.md).
- All settings and their environment variables: [configuration.md](./configuration.md). All CLI commands: [cli.md](./cli.md).
- Using Foundry to run goals: [docs/guide/](../guide/).
