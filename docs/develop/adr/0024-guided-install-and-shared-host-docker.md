# ADR-0024: One installer for both ways to run Foundry, and the host's Docker shared on request

**Status:** accepted · 2026-10-06

## Context

The one-line installer set up a source install only. It skipped tools Foundry depends on: the GitHub CLI (delivery),
Node.js (autoskills runs `npx`; JavaScript previews need it), markitdown, Chromium. It ended by printing the commands to
sign in and start, which a person who is not technical then had to run. The Docker route was a separate set of manual
steps. Inside the container Foundry could not start the services a preview needs (Postgres, object storage), because
the image has no Docker access.

## Decision

- **One script, two modes.** `install.sh` asks: from source or Docker. It suggests source on macOS and on Linux with a
  desktop, where Foundry can use the computer's own logins and tools, and Docker on a headless Linux server. `--mode`
  and `--yes` skip the questions; `--dry-run` only says what would happen. The choices are kept in
  `~/.config/foundry/install.env`, so running the script again, or `foundry update`, updates the same way.
- **Source installs everything Foundry needs.** Required tools are installed without asking; markitdown, Chromium,
  Docker and ffmpeg are offered as a checklist. On Linux, Node.js and the GitHub CLI come from release builds in
  `~/.local`, so no `sudo` is needed beyond system packages.
- **It starts Foundry.** A source install runs as a launchd agent (macOS) or a `systemd --user` unit with lingering
  (Linux), with `FOUNDRY_SUPERVISED=1` so the in-app update exits and lets the service restart it. Where neither exists
  it runs as a background process. A Docker install writes the compose file, `.env` and an override to `~/foundry` and
  starts it. Both offer to sign in, open the browser, and leave a `foundry` command (start, stop, restart, status, logs,
  open, update, uninstall) that runs a kept copy of the installer.
- **The port** is 4111, or the next free one, recorded with the other choices.
- **Docker shares the host only where that is useful.** The projects folder is mounted at `/repos` and again at the
  same path as on the host. `~/.gitconfig` is mounted read-only, and `~/.config/gh` when it holds a token. The Claude
  and Codex sign-ins are made inside the container: on macOS Claude's sign-in is in the keychain, which a container
  cannot read.
- **The host's Docker, on request.** When the person agrees (the default answer), the override mounts the Docker
  socket with its group, and the image carries the Docker CLI and compose plugin. Foundry then starts a preview's
  services on the host's Docker through a compose override written next to its data:
  - `network_mode: container:foundry`, so the services share the Foundry container's network and the apps in it
    reach them on `localhost`;
  - no ports of their own;
  - a label naming the container. When an update recreates the container, services that joined the old one's network
    count as stopped and are started again in the new one's network.

  The same-path mount makes the bind mounts of a repository's compose file resolve on the host.
- **No guard on Docker commands.** The person chose not to block `docker` commands in AI sessions when the socket is
  shared. The installer says what sharing means before asking.

## Consequences

- Sharing the socket is root-level access to the host for Foundry and for every AI session it runs. It is opt-in per
  install, but the default answer is yes.
- Services joined to the Foundry container's network have no service-name DNS between them, and two repositories whose
  services want the same port share one network. The second one finds the port taken and reuses the running service, as
  a source install does.
- Goals created before the same-path mount keep their `/repos/...` paths and work as before. Their services can only be
  started on the host's Docker once the goal points at the host path.
- The installer no longer leaves Foundry stopped. `--no-start` keeps the old behaviour.
